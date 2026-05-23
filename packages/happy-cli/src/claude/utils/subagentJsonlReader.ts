import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { RawJSONLines, RawJSONLinesSchema } from '../types'

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
 * Matching is two-layered:
 *   Layer 1 (strict): meta.agentType + meta.description + first-user-prompt all equal input.
 *   Layer 2 (fallback): meta.agentType + meta.description match, pick the candidate whose
 *                       jsonl mtime is earliest (the oldest unconsumed file).
 *
 * On match, `agentId` is added to `consumedAgentIds` so a subsequent call with the same
 * directory will not pick the same file again (enforces one-to-one mapping).
 *
 * Returns null when no candidate matches at either layer.
 */
export async function readAssociatedSubagent(
  subagentsDir: string,
  input: SubagentInput,
  consumedAgentIds: Set<string>,
): Promise<AssociatedSubagent | null> {
  if (!existsSync(subagentsDir)) return null

  const entries = await readdir(subagentsDir)
  const metaFiles = entries.filter(f => f.endsWith('.meta.json'))

  type FallbackCandidate = { agentId: string; jsonlPath: string; mtimeMs: number }
  const fallback: FallbackCandidate[] = []

  for (const metaFile of metaFiles) {
    const agentId = metaFile.slice(0, -'.meta.json'.length)
    if (consumedAgentIds.has(agentId)) continue

    const meta = await readMetaSafely(join(subagentsDir, metaFile))
    if (!meta) continue
    if (meta.agentType !== input.subagent_type) continue
    if (meta.description !== input.description) continue

    const jsonlPath = join(subagentsDir, `${agentId}.jsonl`)
    const firstPrompt = await readFirstUserPrompt(jsonlPath)
    if (firstPrompt === input.prompt) {
      consumedAgentIds.add(agentId)
      return { agentId, messages: await parseAllLines(jsonlPath) }
    }

    const mtimeMs = await readMtimeMs(jsonlPath)
    if (mtimeMs !== null) fallback.push({ agentId, jsonlPath, mtimeMs })
  }

  if (fallback.length === 0) return null

  fallback.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const pick = fallback[0]
  consumedAgentIds.add(pick.agentId)
  return { agentId: pick.agentId, messages: await parseAllLines(pick.jsonlPath) }
}

async function readMetaSafely(
  metaPath: string,
): Promise<{ agentType?: string; description?: string } | null> {
  try {
    const text = await readFile(metaPath, 'utf-8')
    return JSON.parse(text) as { agentType?: string; description?: string }
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
