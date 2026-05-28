import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createIncrementalJsonlReader } from './incrementalJsonlReader'

// A trivial record + parseChunk so the test exercises the byte-level tailing in
// isolation — no Zod, no logger, no session scanner. `chunks` records every
// block of text handed to parseChunk so we can assert WHAT got parsed, proving
// only newly-appended, newline-terminated text is ever fed in.
type Rec = { n: number }

function makeParser() {
  const chunks: string[] = []
  const parse = (text: string): Rec[] => {
    chunks.push(text)
    return text
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Rec)
  }
  return { chunks, parse }
}

const ln = (n: number) => JSON.stringify({ n }) + '\n'

describe('createIncrementalJsonlReader', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'incjsonl-'))
    file = join(dir, 'transcript.jsonl')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('返回累计的全量记录，且只解析新追加的字节', async () => {
    const { chunks, parse } = makeParser()
    const reader = createIncrementalJsonlReader<Rec>(file, parse)

    await writeFile(file, ln(1) + ln(2))
    expect((await reader.read()).map((r) => r.n)).toEqual([1, 2])

    await appendFile(file, ln(3))
    expect((await reader.read()).map((r) => r.n)).toEqual([1, 2, 3])

    // The second read only parsed the delta — not the whole file again.
    expect(chunks).toEqual([ln(1) + ln(2), ln(3)])
  })

  it('文件未增长时不再解析，原样返回上次结果', async () => {
    const { chunks, parse } = makeParser()
    const reader = createIncrementalJsonlReader<Rec>(file, parse)

    await writeFile(file, ln(1))
    await reader.read()
    const again = await reader.read()

    expect(again.map((r) => r.n)).toEqual([1])
    // No second parse call for a stable file.
    expect(chunks).toHaveLength(1)
  })

  it('半行（无换行）先缓冲，换行到达后恰好出现一次', async () => {
    const { parse } = makeParser()
    const reader = createIncrementalJsonlReader<Rec>(file, parse)

    const line = ln(7) // includes trailing \n
    await writeFile(file, line.slice(0, 4)) // half-written, no newline yet
    expect(await reader.read()).toEqual([])

    await appendFile(file, line.slice(4)) // completes the line + newline
    expect((await reader.read()).map((r) => r.n)).toEqual([7])

    // No duplicate once completed.
    expect((await reader.read()).map((r) => r.n)).toEqual([7])
  })

  it('跨读边界的多字节 UTF-8 字符能完整解码', async () => {
    const reader = createIncrementalJsonlReader<{ s: string }>(file, (text) =>
      text
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as { s: string }),
    )

    const buf = Buffer.from(JSON.stringify({ s: '你好🌟世界' }) + '\n', 'utf-8')
    const cut = buf.length - 6 // inside the trailing multi-byte chars, before \n

    await writeFile(file, buf.subarray(0, cut))
    expect(await reader.read()).toEqual([])

    await appendFile(file, buf.subarray(cut))
    const out = await reader.read()
    expect(out).toEqual([{ s: '你好🌟世界' }])
  })

  it('文件缩短（截断/原地重写）时重置并从头重解析', async () => {
    const { parse } = makeParser()
    const reader = createIncrementalJsonlReader<Rec>(file, parse)

    await writeFile(file, ln(1) + ln(2))
    expect((await reader.read()).map((r) => r.n)).toEqual([1, 2])

    // Rewrite shorter — size drops below the consumed offset.
    await writeFile(file, ln(9))
    expect((await reader.read()).map((r) => r.n)).toEqual([9])
  })

  it('文件不存在时返回目前累计的记录（首次为空）', async () => {
    const { chunks, parse } = makeParser()
    const reader = createIncrementalJsonlReader<Rec>(file, parse)

    // Never created yet.
    expect(await reader.read()).toEqual([])
    expect(chunks).toHaveLength(0)

    // Appears, gets read, then disappears — the prior list is retained.
    await writeFile(file, ln(5))
    expect((await reader.read()).map((r) => r.n)).toEqual([5])

    await rm(file)
    expect((await reader.read()).map((r) => r.n)).toEqual([5])
  })
})
