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

    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      'tu-1',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-abc')
    expect(result!.messages).toHaveLength(2)
    expect(binding.get('tu-1')).toBe('agent-abc')
  })

  it('does not re-bind a subagent that another tool_use already owns', async () => {
    // Two subagent files share the same agentType + description + prompt.
    // First call (tool_use=tu-1) binds one of them; second call from a
    // DIFFERENT tool_use (tu-2) with the same input must pick the OTHER
    // file, because the first one is already bound. Proves the one-to-one
    // tool_use ↔ agent file constraint.
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

    const binding = new Map<string, string>()
    const input = { subagent_type: 'Explore', description: 'D', prompt: 'P' }

    const first = await readAssociatedSubagent(subagentsDir, 'tu-1', input, binding)
    const second = await readAssociatedSubagent(subagentsDir, 'tu-2', input, binding)

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(second!.agentId).not.toBe(first!.agentId)
    expect(binding.size).toBe(2)
  })

  it('re-reads the same agent file when called again with the same tool_use id', async () => {
    // Regression for prod bug: subagent jsonl grows incrementally. After the
    // first poll binds tu-1 → agent-G, a second poll for tu-1 must skip
    // matching entirely and re-parse the file (now larger), so newly
    // appended lines flow through to the caller.
    const agentId = 'agent-grow'
    await writeFile(
      join(subagentsDir, `${agentId}.meta.json`),
      JSON.stringify({ agentType: 'Explore', description: 'D' }),
    )
    const userLine = JSON.stringify({
      type: 'user', uuid: 'u-1', isSidechain: true,
      message: { role: 'user', content: 'P' },
    })
    await writeFile(join(subagentsDir, `${agentId}.jsonl`), userLine + '\n')

    const binding = new Map<string, string>()
    const first = await readAssociatedSubagent(
      subagentsDir,
      'tu-1',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )
    expect(first!.messages).toHaveLength(1)
    expect(binding.get('tu-1')).toBe(agentId)

    // Append a new line — simulates Claude streaming the assistant reply.
    const assistantLine = JSON.stringify({
      type: 'assistant', uuid: 'a-1', isSidechain: true,
      message: { role: 'assistant', id: 'msg', content: [{ type: 'text', text: 'hi' }] },
    })
    await writeFile(
      join(subagentsDir, `${agentId}.jsonl`),
      userLine + '\n' + assistantLine + '\n',
    )

    const second = await readAssociatedSubagent(
      subagentsDir,
      'tu-1',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )
    expect(second!.agentId).toBe(agentId)
    expect(second!.messages).toHaveLength(2)
    // Still only one binding (no duplicate registration).
    expect(binding.size).toBe(1)
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

    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      'tu-miss',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )

    expect(result).toBeNull()
    expect(binding.size).toBe(0)
  })

  it('returns null when subagents directory does not exist', async () => {
    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      join(subagentsDir, 'nonexistent'),
      'tu-none',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )
    expect(result).toBeNull()
    expect(binding.size).toBe(0)
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

    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      'tu-bad',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
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

    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      'tu-fb',
      { subagent_type: 'Explore', description: 'D', prompt: 'PROMPT_THAT_NOBODY_HAS' },
      binding,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-early')
    expect(binding.get('tu-fb')).toBe('agent-early')
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

    const binding = new Map<string, string>()
    const result = await readAssociatedSubagent(
      subagentsDir,
      'tu-strict',
      { subagent_type: 'Explore', description: 'D', prompt: 'P' },
      binding,
    )

    expect(result).not.toBeNull()
    expect(result!.agentId).toBe('agent-match')
    expect(Array.from(binding.values())).not.toContain('agent-old')
  })
})
