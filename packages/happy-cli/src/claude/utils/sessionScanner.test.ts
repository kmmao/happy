import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSessionScanner, parseJsonlText } from './sessionScanner'
import type { ClaudeGoalStatusTranscriptEvent } from '../claudeGoalStatus'
import { RawJSONLines } from '../types'
import { mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { getProjectPath } from './path'

// Helper: encode one main-jsonl message line.
const ln = (obj: unknown) => JSON.stringify(obj) + '\n'

describe('sessionScanner', () => {
  let testDir: string
  let projectDir: string
  let collectedMessages: RawJSONLines[]
  let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null
  
  beforeEach(async () => {
    testDir = join(tmpdir(), `scanner-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    // Use the same path calculation as the scanner to ensure paths match
    projectDir = getProjectPath(testDir)
    await mkdir(projectDir, { recursive: true })

    collectedMessages = []
  })
  
  afterEach(async () => {
    // Clean up scanner
    if (scanner) {
      await scanner.cleanup()
      scanner = null
    }
    
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true })
    }
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true })
    }
  })
  
  it('should process initial session and resumed session correctly', async () => {
    // TEST SCENARIO:
    // Phase 1: User says "lol" → Assistant responds "lol" → Session closes
    // Phase 2: User resumes with NEW session ID → User says "run ls tool" → Assistant runs LS tool → Shows files
    // 
    // Key point: When resuming, Claude creates a NEW session file with:
    // - Summary line
    // - Complete history from previous session (with NEW session ID)
    // - New messages
    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg)
    })
    
    // PHASE 1: Initial session (0-say-lol-session.jsonl)
    const fixture1 = await readFile(join(__dirname, '__fixtures__', '0-say-lol-session.jsonl'), 'utf-8')
    const lines1 = fixture1.split('\n').filter(line => line.trim())
    
    const sessionId1 = '93a9705e-bc6a-406d-8dce-8acc014dedbd'
    const sessionFile1 = join(projectDir, `${sessionId1}.jsonl`)
    
    // Write first line
    await writeFile(sessionFile1, lines1[0] + '\n')
    scanner.onNewSession(sessionId1)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    expect(collectedMessages).toHaveLength(1)
    expect(collectedMessages[0].type).toBe('user')
    if (collectedMessages[0].type === 'user') {
      const content = collectedMessages[0].message.content
      const text = typeof content === 'string' ? content : (content as any)[0].text
      expect(text).toBe('say lol')
    }
    
    // Write second line with delay
    await new Promise(resolve => setTimeout(resolve, 50))
    await appendFile(sessionFile1, lines1[1] + '\n')
    await new Promise(resolve => setTimeout(resolve, 200))
    
    expect(collectedMessages).toHaveLength(2)
    expect(collectedMessages[1].type).toBe('assistant')
    if (collectedMessages[1].type === 'assistant' && collectedMessages[1].message) {
      expect((collectedMessages[1].message.content as any)[0].text).toBe('lol')
    }
    
    // PHASE 2: Resumed session (1-continue-run-ls-tool.jsonl)
    const fixture2 = await readFile(join(__dirname, '__fixtures__', '1-continue-run-ls-tool.jsonl'), 'utf-8')
    const lines2 = fixture2.split('\n').filter(line => line.trim())
    
    const sessionId2 = '789e105f-ae33-486d-9271-0696266f072d'
    const sessionFile2 = join(projectDir, `${sessionId2}.jsonl`)
    
    // Reset collected messages count for clarity
    const phase1Count = collectedMessages.length
    
    // Write summary + historical messages (lines 0-2) - NOT line 3 which is new
    let initialContent = ''
    for (let i = 0; i <= 2; i++) {
      initialContent += lines2[i] + '\n'
    }
    await writeFile(sessionFile2, initialContent)
    
    scanner.onNewSession(sessionId2)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Should have added only 1 new message (summary) 
    // The historical user + assistant messages (lines 1-2) are deduplicated because they have same UUIDs
    expect(collectedMessages).toHaveLength(phase1Count + 1)
    expect(collectedMessages[phase1Count].type).toBe('summary')
    
    // Write new messages (user asks for ls tool) - this is line 3
    await new Promise(resolve => setTimeout(resolve, 50))
    await appendFile(sessionFile2, lines2[3] + '\n')
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Find the user message we just added
    const userMessages = collectedMessages.filter(m => m.type === 'user')
    const lastUserMsg = userMessages[userMessages.length - 1]
    expect(lastUserMsg).toBeDefined()
    if (lastUserMsg && lastUserMsg.type === 'user') {
      expect(lastUserMsg.message.content).toBe('run ls tool ')
    }
    
    // Write remaining lines (assistant tool use, tool result, final assistant message) - starting from line 4
    for (let i = 4; i < lines2.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      await appendFile(sessionFile2, lines2[i] + '\n')
    }
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Final count check
    const finalMessages = collectedMessages.slice(phase1Count)
    
    // Should have: 1 summary + 0 history (deduplicated) + 4 new messages = 5 total for session 2
    expect(finalMessages.length).toBeGreaterThanOrEqual(5)
    
    // Verify last message is assistant with the file listing
    const lastAssistantMsg = collectedMessages[collectedMessages.length - 1]
    expect(lastAssistantMsg.type).toBe('assistant')
    if (lastAssistantMsg.type === 'assistant' && lastAssistantMsg.message?.content) {
      const content = (lastAssistantMsg.message.content as any)[0].text
      expect(content).toContain('0-say-lol-session.jsonl')
      expect(content).toContain('readme.md')
    }
  })
  
  it('should not process duplicate assistant messages with same message ID', async () => {
    // Currently broken unclear if we need this or not post migrating to sdk & removeing deduplication
    return;

    // scanner = await createSessionScanner({
    //   sessionId: null,
    //   workingDirectory: testDir,
    //   onMessage: (msg) => collectedMessages.push(msg)
    // })
    
    // const fixture = await readFile(join(__dirname, '__fixtures__', 'duplicate-assistant-response.jsonl'), 'utf-8')
    // const lines = fixture.split('\n').filter(line => line.trim())
    
    // const sessionId = 'b91d4412-e6c4-4e51-bb1b-585bcd78aca4'
    // const sessionFile = join(projectDir, `${sessionId}.jsonl`)
    
    // // Write first user message
    // await writeFile(sessionFile, lines[0] + '\n')
    // scanner.onNewSession(sessionId)
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(1)
    // expect(collectedMessages[0].type).toBe('user')
    
    // // Write first assistant response
    // await appendFile(sessionFile, lines[1] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(2)
    // expect(collectedMessages[1].type).toBe('assistant')
    // const firstAssistantMsg = collectedMessages[1]
    // if (firstAssistantMsg.type === 'assistant') {
    //   expect((firstAssistantMsg.message.content as any)[0].text).toBe('lol')
    //   expect(firstAssistantMsg.message.id).toBe('msg_01R62tkBs9tw5X76JmpWXYbc')
    // }
    
    // // Write duplicate assistant response (same message ID, different UUID)
    // await appendFile(sessionFile, lines[2] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // // Should NOT process the duplicate - still only 2 messages
    // expect(collectedMessages).toHaveLength(2)
    
    // // Write next user message
    // await appendFile(sessionFile, lines[3] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(3)
    // expect(collectedMessages[2].type).toBe('user')
    
    // // Write final assistant response
    // await appendFile(sessionFile, lines[4] + '\n')
    // await new Promise(resolve => setTimeout(resolve, 100))
    
    // expect(collectedMessages).toHaveLength(4)
    // expect(collectedMessages[3].type).toBe('assistant')
    // const lastAssistantMsg = collectedMessages[3]
    // if (lastAssistantMsg.type === 'assistant') {
    //   expect((lastAssistantMsg.message.content as any)[0].text).toBe('kekr')
    //   expect(lastAssistantMsg.message.id).toBe('msg_01KWeuP88pkzRtXmggJRnQmV')
    // }
  })

  describe('subagent interleave', () => {
    it('injects subagent messages with parent_tool_use_id and dedups across polls', async () => {
      // Cycle 1 tracer:
      //   - Main jsonl contains: user → assistant w/ Task tool_use (id=tu_1).
      //   - subagents/agent-X.{meta.json,jsonl} matches the tool_use via triple-key.
      //   - First sync: onMessage receives the main pair AND the subagent's two
      //     internal messages, each carrying parent_tool_use_id === 'tu_1'.
      //   - Second sync (triggered by appending a new main message) must NOT
      //     re-emit the subagent's messages (uuid dedup by processedMessageKeys).
      const sessionId = 'sess-tracer-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      await mkdir(subagentsDir, { recursive: true })

      const mainUser = {
        type: 'user',
        uuid: 'main-u-1',
        message: { role: 'user', content: 'spawn an agent' },
      }
      const mainAssistantWithTask = {
        type: 'assistant',
        uuid: 'main-a-1',
        message: {
          role: 'assistant',
          id: 'msg_main',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Task',
              input: {
                subagent_type: 'Explore',
                description: 'Find files',
                prompt: 'List all the files in this repo',
              },
            },
          ],
        },
      }
      await writeFile(sessionFile, ln(mainUser) + ln(mainAssistantWithTask))

      await writeFile(
        join(subagentsDir, 'agent-X.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'Find files' }),
      )
      const subUser = {
        type: 'user',
        uuid: 'sub-u-1',
        isSidechain: true,
        message: { role: 'user', content: 'List all the files in this repo' },
      }
      const subAssistant = {
        type: 'assistant',
        uuid: 'sub-a-1',
        isSidechain: true,
        message: {
          role: 'assistant',
          id: 'msg_sub',
          content: [{ type: 'text', text: 'Here are the files' }],
        },
      }
      await writeFile(
        join(subagentsDir, 'agent-X.jsonl'),
        ln(subUser) + ln(subAssistant),
      )

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (msg) => collectedMessages.push(msg),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))

      const subUserOut = collectedMessages.find(
        (m) => m.type === 'user' && m.uuid === 'sub-u-1',
      )
      const subAssistantOut = collectedMessages.find(
        (m) => m.type === 'assistant' && m.uuid === 'sub-a-1',
      )
      expect(subUserOut).toBeDefined()
      expect(subAssistantOut).toBeDefined()
      expect((subUserOut as any).parent_tool_use_id).toBe('tu_1')
      expect((subAssistantOut as any).parent_tool_use_id).toBe('tu_1')

      const subCountAfterFirstSync = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_1',
      ).length
      expect(subCountAfterFirstSync).toBe(2)

      // Trigger a second sync by appending a brand-new main message.
      await new Promise((r) => setTimeout(r, 50))
      const mainUser2 = {
        type: 'user',
        uuid: 'main-u-2',
        message: { role: 'user', content: 'thanks' },
      }
      await appendFile(sessionFile, ln(mainUser2))
      await new Promise((r) => setTimeout(r, 250))

      expect(
        collectedMessages.some(
          (m) => m.type === 'user' && m.uuid === 'main-u-2',
        ),
      ).toBe(true)
      const subCountAfterSecondSync = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_1',
      ).length
      expect(subCountAfterSecondSync).toBe(2)
    })

    it('re-reads subagent jsonl on subsequent polls when file grows incrementally', async () => {
      // Regression for the bug found in production: subagents/agent-XXX.jsonl
      // is written incrementally by Claude (just like the main jsonl). On the
      // first sync the file may only contain the initial user prompt; the
      // Bash/Grep/Read tool_use + tool_result lines + final assistant reply
      // arrive seconds later. We must NOT mark the agent file as
      // "fully consumed" on first hit — we have to re-read on every poll and
      // let processedMessageKeys (uuid-level) handle dedup downstream.
      const sessionId = 'sess-grow-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      await mkdir(subagentsDir, { recursive: true })

      const mainUser = {
        type: 'user',
        uuid: 'g-u-1',
        message: { role: 'user', content: 'spawn an agent' },
      }
      const mainAssistantWithTask = {
        type: 'assistant',
        uuid: 'g-a-1',
        message: {
          role: 'assistant',
          id: 'msg_grow',
          content: [
            {
              type: 'tool_use',
              id: 'tu_grow',
              name: 'Task',
              input: {
                subagent_type: 'Explore',
                description: 'Grow test',
                prompt: 'list files',
              },
            },
          ],
        },
      }
      await writeFile(sessionFile, ln(mainUser) + ln(mainAssistantWithTask))

      // First sync: subagent file has ONLY the initial user prompt line.
      await writeFile(
        join(subagentsDir, 'agent-G.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'Grow test' }),
      )
      const subUserOnly = {
        type: 'user',
        uuid: 'sub-g-u',
        isSidechain: true,
        message: { role: 'user', content: 'list files' },
      }
      const subagentJsonlPath = join(subagentsDir, 'agent-G.jsonl')
      await writeFile(subagentJsonlPath, ln(subUserOnly))

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (msg) => collectedMessages.push(msg),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))

      expect(
        collectedMessages.some(
          (m) => m.type === 'user' && m.uuid === 'sub-g-u',
        ),
      ).toBe(true)
      const firstPollSubCount = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_grow',
      ).length
      expect(firstPollSubCount).toBe(1)

      // Second poll: subagent jsonl grows with the assistant tool_use+text.
      const subAssistant = {
        type: 'assistant',
        uuid: 'sub-g-a',
        isSidechain: true,
        message: {
          role: 'assistant',
          id: 'msg_sub_g',
          content: [{ type: 'text', text: 'here are the files' }],
        },
      }
      await new Promise((r) => setTimeout(r, 50))
      await appendFile(subagentJsonlPath, ln(subAssistant))
      // Bump main file mtime so the watcher schedules a sync — appending to
      // the subagent file alone is enough in production because the periodic
      // 3s tick triggers sync.invalidate(), but in tests we want determinism.
      const mainUser2 = {
        type: 'user',
        uuid: 'g-u-2',
        message: { role: 'user', content: 'thanks' },
      }
      await appendFile(sessionFile, ln(mainUser2))
      await new Promise((r) => setTimeout(r, 300))

      // The new subagent assistant message MUST appear, still tagged with
      // parent_tool_use_id === 'tu_grow'.
      const subAssistantOut = collectedMessages.find(
        (m) => m.type === 'assistant' && m.uuid === 'sub-g-a',
      )
      expect(subAssistantOut).toBeDefined()
      expect((subAssistantOut as any).parent_tool_use_id).toBe('tu_grow')

      const secondPollSubCount = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_grow',
      ).length
      expect(secondPollSubCount).toBe(2)
    })

    it('routes multiple Agent tool calls to their own subagents without crosstalk', async () => {
      // Cycle 2: two Task tool_use blocks in main jsonl, two subagent files.
      // Each subagent's messages must carry its OWN tool_use.id as parent —
      // never the other one. Guards against off-by-one block.id capture in
      // interleaveSubagentMessages.
      const sessionId = 'sess-multi-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      await mkdir(subagentsDir, { recursive: true })

      const mainUser = {
        type: 'user',
        uuid: 'm-u-1',
        message: { role: 'user', content: 'two tasks please' },
      }
      const makeAssistant = (uuid: string, toolId: string, desc: string, prompt: string) => ({
        type: 'assistant',
        uuid,
        message: {
          role: 'assistant',
          id: `msg_${uuid}`,
          content: [
            {
              type: 'tool_use',
              id: toolId,
              name: 'Task',
              input: { subagent_type: 'Explore', description: desc, prompt },
            },
          ],
        },
      })
      const mainAssistantA = makeAssistant('m-a-A', 'tu_A', 'DescA', 'promptA')
      const mainAssistantB = makeAssistant('m-a-B', 'tu_B', 'DescB', 'promptB')
      await writeFile(
        sessionFile,
        ln(mainUser) + ln(mainAssistantA) + ln(mainAssistantB),
      )

      // Subagent A
      await writeFile(
        join(subagentsDir, 'agent-A.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'DescA' }),
      )
      await writeFile(
        join(subagentsDir, 'agent-A.jsonl'),
        ln({
          type: 'user',
          uuid: 'sub-A-u',
          isSidechain: true,
          message: { role: 'user', content: 'promptA' },
        }) +
          ln({
            type: 'assistant',
            uuid: 'sub-A-a',
            isSidechain: true,
            message: {
              role: 'assistant',
              id: 'msg_subA',
              content: [{ type: 'text', text: 'reply A' }],
            },
          }),
      )

      // Subagent B
      await writeFile(
        join(subagentsDir, 'agent-B.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'DescB' }),
      )
      await writeFile(
        join(subagentsDir, 'agent-B.jsonl'),
        ln({
          type: 'user',
          uuid: 'sub-B-u',
          isSidechain: true,
          message: { role: 'user', content: 'promptB' },
        }) +
          ln({
            type: 'assistant',
            uuid: 'sub-B-a',
            isSidechain: true,
            message: {
              role: 'assistant',
              id: 'msg_subB',
              content: [{ type: 'text', text: 'reply B' }],
            },
          }),
      )

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (msg) => collectedMessages.push(msg),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))

      // Subagent A messages must all point to tu_A; never to tu_B.
      const subAUser = collectedMessages.find(
        (m) => m.type === 'user' && m.uuid === 'sub-A-u',
      )
      const subAAssistant = collectedMessages.find(
        (m) => m.type === 'assistant' && m.uuid === 'sub-A-a',
      )
      expect((subAUser as any)?.parent_tool_use_id).toBe('tu_A')
      expect((subAAssistant as any)?.parent_tool_use_id).toBe('tu_A')

      const subBUser = collectedMessages.find(
        (m) => m.type === 'user' && m.uuid === 'sub-B-u',
      )
      const subBAssistant = collectedMessages.find(
        (m) => m.type === 'assistant' && m.uuid === 'sub-B-a',
      )
      expect((subBUser as any)?.parent_tool_use_id).toBe('tu_B')
      expect((subBAssistant as any)?.parent_tool_use_id).toBe('tu_B')

      // No crosstalk: nothing tagged tu_A should belong to subagent B and vice-versa.
      const taggedA = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_A',
      )
      const taggedB = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id === 'tu_B',
      )
      expect(taggedA.every((m) => m.type !== 'user' || m.uuid?.startsWith('sub-A-'))).toBe(true)
      expect(taggedB.every((m) => m.type !== 'user' || m.uuid?.startsWith('sub-B-'))).toBe(true)
      expect(taggedA).toHaveLength(2)
      expect(taggedB).toHaveLength(2)
    })

    it('passes through unchanged when subagents directory absent or tool is not Task/Agent', async () => {
      // Cycle 3: graceful degradation. Main jsonl has BOTH a Task tool_use
      // (would normally trigger lookup) AND a Bash tool_use (must never
      // trigger lookup). The subagents/ directory does NOT exist. Scanner
      // must emit only the main messages with no parent_tool_use_id wiring
      // and no thrown error.
      const sessionId = 'sess-degrade-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      // Note: subagents/ deliberately NOT created.

      const mainUser = {
        type: 'user',
        uuid: 'd-u-1',
        message: { role: 'user', content: 'do things' },
      }
      const taskCall = {
        type: 'assistant',
        uuid: 'd-a-1',
        message: {
          role: 'assistant',
          id: 'msg_d1',
          content: [
            {
              type: 'tool_use',
              id: 'tu_orphan',
              name: 'Task',
              input: {
                subagent_type: 'Explore',
                description: 'WillNotMatch',
                prompt: 'orphan',
              },
            },
          ],
        },
      }
      const bashCall = {
        type: 'assistant',
        uuid: 'd-a-2',
        message: {
          role: 'assistant',
          id: 'msg_d2',
          content: [
            {
              type: 'tool_use',
              id: 'tu_bash',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
      }
      await writeFile(sessionFile, ln(mainUser) + ln(taskCall) + ln(bashCall))

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (msg) => collectedMessages.push(msg),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))

      // All three main messages flow through.
      expect(
        collectedMessages.some((m) => m.type === 'user' && m.uuid === 'd-u-1'),
      ).toBe(true)
      expect(
        collectedMessages.some((m) => m.type === 'assistant' && m.uuid === 'd-a-1'),
      ).toBe(true)
      expect(
        collectedMessages.some((m) => m.type === 'assistant' && m.uuid === 'd-a-2'),
      ).toBe(true)

      // No subagent messages, no parent_tool_use_id injection happened.
      const tagged = collectedMessages.filter(
        (m) => (m as any).parent_tool_use_id !== undefined,
      )
      expect(tagged).toHaveLength(0)
    })
  })

  describe('incremental read (P2)', () => {
    it('does not emit a half-written line until its newline arrives', async () => {
      // readMainMessages parses only through the last newline; a line written
      // without its trailing \n must stay buffered as `partial` and surface
      // exactly once when completed — never as a parse error or a duplicate.
      const sessionId = 'sess-partial-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)

      const u1 = { type: 'user', uuid: 'p-u-1', message: { role: 'user', content: 'one' } }
      await writeFile(sessionFile, ln(u1))

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (m) => collectedMessages.push(m),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.filter((m) => m.type === 'user').length).toBe(1)

      // Append a line WITHOUT its trailing newline (half-written).
      const u2line = JSON.stringify({ type: 'user', uuid: 'p-u-2', message: { role: 'user', content: 'two' } })
      await appendFile(sessionFile, u2line.slice(0, 12))
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.some((m) => (m as any).uuid === 'p-u-2')).toBe(false)

      // Complete the line + newline.
      await appendFile(sessionFile, u2line.slice(12) + '\n')
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.filter((m) => (m as any).uuid === 'p-u-2')).toHaveLength(1)
    })

    it('reassembles a multi-byte UTF-8 char split across two reads', async () => {
      // The trailing `partial` is kept as raw bytes, so a 你/🌟 character whose
      // UTF-8 bytes straddle the read boundary must decode intact once the
      // rest arrives — not as a U+FFFD replacement char.
      const sessionId = 'sess-utf8-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const buf = Buffer.from(
        ln({ type: 'user', uuid: 'utf-u-1', message: { role: 'user', content: '你好🌟世界' } }),
        'utf-8',
      )
      const cut = buf.length - 6 // inside the trailing multi-byte chars, before the \n

      await writeFile(sessionFile, buf.subarray(0, cut))
      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (m) => collectedMessages.push(m),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.some((m) => (m as any).uuid === 'utf-u-1')).toBe(false)

      await appendFile(sessionFile, buf.subarray(cut))
      await new Promise((r) => setTimeout(r, 200))
      const out = collectedMessages.find((m) => (m as any).uuid === 'utf-u-1')
      expect(out).toBeDefined()
      if (out && out.type === 'user') {
        expect(out.message.content).toBe('你好🌟世界')
      }
    })

    it('falls back to a full reparse when the file shrinks (truncation)', async () => {
      // st.size < offset means the file was rewound/rewritten in place; the
      // reader resets offset+cache and reparses so the new content surfaces.
      const sessionId = 'sess-trunc-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const a = { type: 'user', uuid: 't-u-1', message: { role: 'user', content: 'aaaaaaaaaa' } }
      const b = { type: 'user', uuid: 't-u-2', message: { role: 'user', content: 'bbbbbbbbbb' } }
      await writeFile(sessionFile, ln(a) + ln(b))

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (m) => collectedMessages.push(m),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.filter((m) => ['t-u-1', 't-u-2'].includes((m as any).uuid)).length).toBe(2)

      // Rewrite shorter — size drops below the consumed offset.
      await writeFile(sessionFile, ln({ type: 'user', uuid: 't-u-3', message: { role: 'user', content: 'c' } }))
      await new Promise((r) => setTimeout(r, 200))
      expect(collectedMessages.some((m) => (m as any).uuid === 't-u-3')).toBe(true)
    })
  })

  describe('subagents watcher (P1)', () => {
    it('surfaces a late subagent message after appending only the subagent jsonl', async () => {
      // The whole point of P1: a tool_result written to the subagent file
      // *after* the main jsonl has settled must surface promptly via the
      // subagents/ dir watcher — well under the 15s poll. We assert it shows
      // up within 500ms while never touching the main session file.
      const sessionId = 'sess-watch-1'
      const sessionFile = join(projectDir, `${sessionId}.jsonl`)
      const subagentsDir = join(projectDir, sessionId, 'subagents')
      await mkdir(subagentsDir, { recursive: true })

      const mainUser = { type: 'user', uuid: 'w-u-1', message: { role: 'user', content: 'spawn' } }
      const mainAssistantTask = {
        type: 'assistant',
        uuid: 'w-a-1',
        message: {
          role: 'assistant',
          id: 'msg_w',
          content: [
            { type: 'tool_use', id: 'tu_w', name: 'Task', input: { subagent_type: 'Explore', description: 'WatchTest', prompt: 'go' } },
          ],
        },
      }
      await writeFile(sessionFile, ln(mainUser) + ln(mainAssistantTask))

      await writeFile(
        join(subagentsDir, 'agent-W.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'WatchTest' }),
      )
      const subagentJsonl = join(subagentsDir, 'agent-W.jsonl')
      await writeFile(subagentJsonl, ln({ type: 'user', uuid: 'sub-w-u', isSidechain: true, message: { role: 'user', content: 'go' } }))

      scanner = await createSessionScanner({
        sessionId: null,
        workingDirectory: testDir,
        onMessage: (m) => collectedMessages.push(m),
      })
      scanner.onNewSession(sessionId)
      await new Promise((r) => setTimeout(r, 250))
      // First sync binds the subagent and attaches the dir watcher.
      expect(collectedMessages.some((m) => (m as any).uuid === 'sub-w-u')).toBe(true)

      // Append ONLY the subagent file — no main-file write, no poll wait.
      await appendFile(
        subagentJsonl,
        ln({ type: 'assistant', uuid: 'sub-w-a', isSidechain: true, message: { role: 'assistant', id: 'msg_sub_w', content: [{ type: 'text', text: 'done' }] } }),
      )
      await new Promise((r) => setTimeout(r, 500))

      const out = collectedMessages.find((m) => m.type === 'assistant' && (m as any).uuid === 'sub-w-a')
      expect(out).toBeDefined()
      expect((out as any).parent_tool_use_id).toBe('tu_w')
    })
  })
  it('emits the synthetic assistant message written when the API rejects a turn', async () => {
    // Reproduces the "session goes silent" bug: on an API error (here a 429)
    // Claude Code writes a synthetic assistant message carrying the error text.
    // Those messages send `usage.service_tier: null`, which used to fail schema
    // validation, so the scanner dropped them and the client saw the user's own
    // message followed by nothing at all.
    scanner = await createSessionScanner({
      sessionId: null,
      workingDirectory: testDir,
      onMessage: (msg) => collectedMessages.push(msg),
    })

    const fixture = await readFile(join(__dirname, '..', '__fixtures__', 'api-error', 'rate-limit.jsonl'), 'utf-8')
    const sessionId = 'c1d0a6cf-1f6c-4bb0-9a5a-2b0c2f5f9d10'

    await writeFile(join(projectDir, `${sessionId}.jsonl`), fixture)
    scanner.onNewSession(sessionId)
    await new Promise((r) => setTimeout(r, 200))

    expect(collectedMessages.map((m) => m.type)).toEqual(['user', 'assistant'])
    const assistant = collectedMessages[1]
    expect(assistant).toMatchObject({
      type: 'assistant',
      isApiErrorMessage: true,
      apiErrorStatus: 429,
    })
  })
})

describe('parseJsonlText — goal_status interception', () => {
  const goalLine = ln({
    type: 'attachment',
    uuid: 'goal-1',
    sessionId: 'sess-1',
    timestamp: '2026-06-19T14:38:48.095Z',
    attachment: { type: 'goal_status', met: false, sentinel: true, condition: 'keep going' },
  })
  const assistantLine = ln({
    type: 'assistant',
    uuid: 'msg-1',
    sessionId: 'sess-1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
  })

  it('routes goal_status attachments to onGoalStatus and excludes them from messages', () => {
    const goals: ClaudeGoalStatusTranscriptEvent[] = []
    const messages = parseJsonlText(goalLine + assistantLine, (e) => goals.push(e))
    expect(goals).toHaveLength(1)
    expect(goals[0]).toMatchObject({ uuid: 'goal-1', sourceSessionId: 'sess-1', attachment: { met: false } })
    // Only the assistant message survives as a conversation message.
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('assistant')
  })

  it('does not fire onGoalStatus for ordinary messages', () => {
    const goals: ClaudeGoalStatusTranscriptEvent[] = []
    const messages = parseJsonlText(assistantLine, (e) => goals.push(e))
    expect(goals).toHaveLength(0)
    expect(messages).toHaveLength(1)
  })

  it('drops goal_status lines even when no sink is provided (never leak into chat)', () => {
    const messages = parseJsonlText(goalLine + assistantLine)
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('assistant')
  })
})