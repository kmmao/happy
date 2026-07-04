import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { RawJSONLines, RawJSONLinesSchema } from '../types'
import { logger } from '@/ui/logger'

export type SubagentInput = {
  subagent_type?: string
  description?: string
  prompt?: string
}

export type AssociatedSubagent = {
  agentId: string
  messages: RawJSONLines[]
}

/**
 * Locate the subagent jsonl file matching a Task/Agent tool_use and return its messages.
 *
 * Behavior is "bind once, re-read on every poll":
 *   - If `binding` already maps this tool_use.id → agentId, skip matching and
 *     re-read the bound jsonl from disk. Claude writes subagent jsonl
 *     INCREMENTALLY (initial user prompt first, then Bash/Grep/Read tool_use
 *     + tool_result blocks, then the final assistant reply, all over several
 *     seconds). Returning the whole file each poll lets the caller pick up
 *     new lines; downstream uuid dedup (processedMessageKeys) handles the
 *     already-emitted ones.
 *   - Otherwise, try to match a new agent file. Matching is three-layered:
 *       Layer 0 (exact): meta.toolUseId equals the tool_use.id. Claude Code
 *                        writes the spawning tool_use id into meta.json, so
 *                        the binding is unambiguous — essential for background
 *                        agents where several same-type/same-description
 *                        agents run concurrently.
 *       Layer 1 (strict): meta.agentType + meta.description + first-user-prompt all equal input.
 *       Layer 2 (fallback): meta.agentType + meta.description match, pick the
 *                            candidate whose jsonl mtime is earliest (the
 *                            oldest still-unbound file).
 *     Already-bound agentIds (those in `binding.values()`) are excluded
 *     from consideration to keep tool_use ↔ agent file one-to-one.
 *     On match, `binding` is mutated to record tool_use.id → agentId.
 *
 * Returns null when no candidate matches at either layer.
 */
export async function readAssociatedSubagent(
  subagentsDir: string,
  toolUseId: string,
  input: SubagentInput,
  binding: Map<string, string>,
): Promise<AssociatedSubagent | null> {
  const dirExists = existsSync(subagentsDir)
  if (!dirExists) return null

  // Fast path: already bound — just re-read the file.
  const bound = binding.get(toolUseId)
  if (bound) {
    const jsonlPath = join(subagentsDir, `${bound}.jsonl`)
    if (!existsSync(jsonlPath)) {
      logger.debug(`[SUBAGENT_READER] bound file vanished: ${jsonlPath}`)
      return null
    }
    const messages = await parseAllLines(jsonlPath)
    logger.debug(
      `[SUBAGENT_READER] REREAD ${bound} for tool_use=${toolUseId} messages=${messages.length}`,
    )
    return { agentId: bound, messages }
  }

  logger.debug(
    `[SUBAGENT_READER] dir=${subagentsDir} exists=${dirExists} ` +
      `tool_use=${toolUseId} input.type=${input.subagent_type} ` +
      `input.desc="${(input.description ?? '').slice(0, 60)}" ` +
      `prompt.len=${input.prompt?.length ?? 0} bindings=${binding.size}`,
  )

  const entries = await readdir(subagentsDir)
  const metaFiles = entries.filter(f => f.endsWith('.meta.json'))
  const alreadyBound = new Set(binding.values())

  type FallbackCandidate = { agentId: string; jsonlPath: string; mtimeMs: number }
  const fallback: FallbackCandidate[] = []

  for (const metaFile of metaFiles) {
    const agentId = metaFile.slice(0, -'.meta.json'.length)
    if (alreadyBound.has(agentId)) {
      logger.debug(`[SUBAGENT_READER] skip ${agentId} (bound to another tool_use)`)
      continue
    }

    const meta = await readMetaSafely(join(subagentsDir, metaFile))
    if (!meta) {
      logger.debug(`[SUBAGENT_READER] meta unreadable: ${metaFile}`)
      continue
    }

    // Layer 0: exact binding via meta.toolUseId.
    if (meta.toolUseId === toolUseId) {
      binding.set(toolUseId, agentId)
      const messages = await parseAllLines(join(subagentsDir, `${agentId}.jsonl`))
      logger.debug(`[SUBAGENT_READER] HIT(toolUseId) ${agentId} messages=${messages.length}`)
      return { agentId, messages }
    }
    // A meta that names a DIFFERENT tool_use can never belong to this one —
    // skip it even if type/description/prompt happen to collide.
    if (typeof meta.toolUseId === 'string' && meta.toolUseId.length > 0) {
      continue
    }

    const typeOk = meta.agentType === input.subagent_type
    const descOk = meta.description === input.description
    logger.debug(
      `[SUBAGENT_READER] ${agentId} meta.type=${meta.agentType} meta.desc="${(meta.description ?? '').slice(0, 60)}" ` +
        `typeOk=${typeOk} descOk=${descOk}`,
    )
    if (!typeOk || !descOk) continue

    const jsonlPath = join(subagentsDir, `${agentId}.jsonl`)
    const firstPrompt = await readFirstUserPrompt(jsonlPath)
    const promptOk = firstPrompt === input.prompt
    logger.debug(
      `[SUBAGENT_READER] ${agentId} firstPrompt.len=${firstPrompt?.length ?? 0} ` +
        `expected.len=${input.prompt?.length ?? 0} promptOk=${promptOk}`,
    )
    if (promptOk) {
      binding.set(toolUseId, agentId)
      const messages = await parseAllLines(jsonlPath)
      logger.debug(`[SUBAGENT_READER] HIT(strict) ${agentId} messages=${messages.length}`)
      return { agentId, messages }
    }

    const mtimeMs = await readMtimeMs(jsonlPath)
    if (mtimeMs !== null) fallback.push({ agentId, jsonlPath, mtimeMs })
  }

  if (fallback.length === 0) {
    logger.debug(`[SUBAGENT_READER] MISS no fallback candidates`)
    return null
  }

  fallback.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const pick = fallback[0]
  binding.set(toolUseId, pick.agentId)
  const messages = await parseAllLines(pick.jsonlPath)
  logger.debug(
    `[SUBAGENT_READER] HIT(fallback) ${pick.agentId} messages=${messages.length}`,
  )
  return { agentId: pick.agentId, messages }
}

async function readMetaSafely(
  metaPath: string,
): Promise<{ agentType?: string; description?: string; toolUseId?: string } | null> {
  try {
    const text = await readFile(metaPath, 'utf-8')
    return JSON.parse(text) as { agentType?: string; description?: string; toolUseId?: string }
  } catch {
    return null
  }
}

async function readMtimeMs(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).mtimeMs
  } catch {
    return null
  }
}

async function readFirstUserPrompt(jsonlPath: string): Promise<string | null> {
  const text = await readFile(jsonlPath, 'utf-8')
  const firstLine = text.split('\n').find(l => l.trim() !== '')
  if (!firstLine) return null
  const parsed = JSON.parse(firstLine)
  if (parsed.type === 'user' && typeof parsed.message?.content === 'string') {
    return parsed.message.content
  }
  return null
}

async function parseAllLines(jsonlPath: string): Promise<RawJSONLines[]> {
  const text = await readFile(jsonlPath, 'utf-8')
  const out: RawJSONLines[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const parsed = RawJSONLinesSchema.safeParse(JSON.parse(line))
    if (parsed.success) out.push(parsed.data)
  }
  return out
}
