import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { readAssociatedSubagent } from './subagentJsonlReader'

describe('subagentJsonlReader', () => {
  let subagentsDir: string

  beforeEach(async () => {
    subagentsDir = join(
      tmpdir(),
      `subagent-reader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    await mkdir(subagentsDir, { recursive: true })
  })

  afterEach(async () => {
    if (existsSync(subagentsDir)) {
      await rm(subagentsDir, { recursive: true, force: true })
    }
  })

  it('returns matched subagent messages when triple-key matches exactly', async () => {
    // Setup: one subagent with meta + jsonl, three-tuple matches input exactly.
    const agentId = 'agent-abc'
    await writeFile(
      join(subagentsDir, `${agentId}.meta.json`),
      JSON.stringify({ agentType: 'Explore', description: 'D' }),
    )
    const userMsg = JSON.stringify({
      type: 'user',
      uuid: 'u-1',
      isSidechain: true,
      message: { role: 'user', content: 'P' },
    })
    const assistantMsg = JSON.stringify({
      type: 'assistant',
      uuid: 'u-2',
      isSidechain: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    })
    await writeFile(
      join(subagentsDir, `${agentId}.jsonl`),
      userMsg + '\n' + assistantMsg + '\n',
    )

    const consumedAgentIds = new Set<string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      consumedAgentIds,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-abc')
    expect(result!.messages).toHaveLength(2)
    expect(consumedAgentIds.has('agent-abc')).toBe(true)
  })

  it('does not re-match a subagent that is already in consumedAgentIds', async () => {
    // Two subagent files share the same agentType + description + prompt.
    // First call should pick one of them; second call with the same input
    // must skip the consumed one and return the OTHER (proves the guard works
    // even when the matcher would otherwise pick the same file again).
    const writeAgent = async (id: string) => {
      await writeFile(
        join(subagentsDir, `${id}.meta.json`),
        JSON.stringify({ agentType: 'Explore', description: 'D' }),
      )
      await writeFile(
        join(subagentsDir, `${id}.jsonl`),
        JSON.stringify({
          type: 'user',
          uuid: `u-${id}`,
          message: { role: 'user', content: 'P' },
        }) + '\n',
      )
    }
    await writeAgent('agent-1')
    await writeAgent('agent-2')

    const consumed = new Set<string>()
    const input = { subagent_type: 'Explore', description: 'D', prompt: 'P' }

    const first = await readAssociatedSubagent(subagentsDir, input, consumed)
    const second = await readAssociatedSubagent(subagentsDir, input, consumed)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!.agentId).not.toBe(first!.agentId)
    expect(consumed.size).toBe(2)
  })

  it('returns null when no subagent file matches the input', async () => {
    await writeFile(
      join(subagentsDir, 'agent-x.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'OTHER' }),
    )
    await writeFile(
      join(subagentsDir, 'agent-x.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content: 'P' } }) + '\n',
    )

    const consumed = new Set<string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      consumed,
    )

    expect(result).toBeNull()
    expect(consumed.size).toBe(0)
  })

  it('returns null when subagents directory does not exist', async () => {
    const consumed = new Set<string>()
    const result = await readAssociatedSubagent(
      join(subagentsDir, 'nonexistent'),
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      consumed,
    )
    expect(result).toBeNull()
    expect(consumed.size).toBe(0)
  })

  it('skips a subagent whose meta.json is not valid JSON and falls through to the next candidate', async () => {
    // A corrupted meta.json must not crash the matcher.  We also place a valid
    // matching candidate to prove the loop continues past the broken file.
    await writeFile(join(subagentsDir, 'agent-bad.meta.json'), '{not valid json')
    await writeFile(join(subagentsDir, 'agent-bad.jsonl'), '')

    await writeFile(
      join(subagentsDir, 'agent-good.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'D' }),
    )
    await writeFile(
      join(subagentsDir, 'agent-good.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content: 'P' } }) + '\n',
    )

    const consumed = new Set<string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      consumed,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-good')
  })

  it('falls back to (agentType + description) + earliest mtime when prompt does not match any candidate', async () => {
    // Both candidates match agentType + description but neither matches the prompt.
    // The matcher should still return one — the earliest by mtime — so the App
    // gets to show at least something instead of nothing.
    const writeCandidate = async (id: string, jsonlPrompt: string) => {
      await writeFile(
        join(subagentsDir, `${id}.meta.json`),
        JSON.stringify({ agentType: 'Explore', description: 'D' }),
      )
      await writeFile(
        join(subagentsDir, `${id}.jsonl`),
        JSON.stringify({
          type: 'user', uuid: `u-${id}`, message: { role: 'user', content: jsonlPrompt },
        }) + '\n',
      )
    }
    await writeCandidate('agent-late', 'NOT_MATCH_A')
    await writeCandidate('agent-early', 'NOT_MATCH_B')

    // Force agent-early to have an earlier mtime than agent-late.
    const earlyTime = new Date('2024-01-01T00:00:00Z')
    const lateTime = new Date('2024-06-01T00:00:00Z')
    await utimes(join(subagentsDir, 'agent-early.jsonl'), earlyTime, earlyTime)
    await utimes(join(subagentsDir, 'agent-late.jsonl'), lateTime, lateTime)

    const consumed = new Set<string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      { subagent_type: 'Explore', description: 'D', prompt: 'PROMPT_THAT_NOBODY_HAS' },
      consumed,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-early')
    expect(consumed.has('agent-early')).toBe(true)
    expect(consumed.has('agent-late')).toBe(false)
  })

  it('prefers a Layer-1 triple match over a Layer-2 (earlier mtime) candidate', async () => {
    // agent-old has earlier mtime but its prompt does NOT match.
    // agent-match has later mtime but its prompt DOES match.
    // The strict triple-key match must win.
    await writeFile(
      join(subagentsDir, 'agent-old.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'D' }),
    )
    await writeFile(
      join(subagentsDir, 'agent-old.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u-old', message: { role: 'user', content: 'WRONG' } }) + '\n',
    )
    await writeFile(
      join(subagentsDir, 'agent-match.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'D' }),
    )
    await writeFile(
      join(subagentsDir, 'agent-match.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u-match', message: { role: 'user', content: 'P' } }) + '\n',
    )
    await utimes(join(subagentsDir, 'agent-old.jsonl'), new Date('2024-01-01'), new Date('2024-01-01'))
    await utimes(join(subagentsDir, 'agent-match.jsonl'), new Date('2024-06-01'), new Date('2024-06-01'))

    const consumed = new Set<string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      consumed,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-match')
    expect(consumed.has('agent-old')).toBe(false)
  })
})
