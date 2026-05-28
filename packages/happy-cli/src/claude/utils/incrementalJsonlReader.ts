import { open, stat } from "node:fs/promises";
import { type Stats } from "node:fs";

/**
 * Incrementally tail a growing, append-only file and parse it line-by-line.
 *
 * This concentrates the byte-level tailing that a naive `readFile + parse` loop
 * gets wrong on a file another process is still writing. Each {@link read} call
 * handles, behind a one-method interface:
 *
 *  - **append-only delta** — only the bytes past the previous offset are read,
 *    so a stable file costs a `stat` + no-op instead of re-reading and
 *    re-parsing the whole transcript every poll.
 *  - **half-written line** — parsing stops at the last newline; the trailing
 *    bytes are buffered as a `partial` and re-prepended on the next read, so a
 *    line caught mid-write surfaces exactly once: when its newline arrives.
 *  - **multi-byte UTF-8 split** — the `partial` is kept as raw bytes (not a
 *    decoded string), so a `你`/`🌟` whose UTF-8 bytes straddle a read boundary
 *    decodes intact rather than as a U+FFFD replacement char.
 *  - **truncation / rewrite-in-place** — if the file shrank below the consumed
 *    offset the reader resets and reparses from zero.
 *  - **missing file** — yields the records accumulated so far (empty on the
 *    first read, the prior list once the file has come and gone).
 *
 * `read()` returns the FULL accumulated record list, not just the new tail: the
 * session scanner re-walks the whole list each poll to re-bind subagent files
 * and relies on downstream uuid dedup rather than tail slicing.
 *
 * The reader is generic over `parseChunk` so it carries no JSONL/Zod/logging
 * dependency — the caller injects how a block of complete-line text (one or more
 * whole lines, newline-terminated) becomes records, including how malformed
 * lines are skipped.
 */
export interface IncrementalJsonlReader<T> {
  read(): Promise<T[]>;
}

export function createIncrementalJsonlReader<T>(
  filePath: string,
  parseChunk: (text: string) => T[],
): IncrementalJsonlReader<T> {
  let offset = 0;
  let partial = Buffer.alloc(0);
  let records: T[] = [];

  const read = async (): Promise<T[]> => {
    let st: Stats;
    try {
      st = await stat(filePath);
    } catch {
      return records;
    }

    // File shrank → truncated / rewritten in place. Reset and reparse from 0.
    // --resume writes a NEW file, so the common case never hits this; the guard
    // just keeps us correct if a file is ever rewound.
    if (st.size < offset) {
      offset = 0;
      partial = Buffer.alloc(0);
      records = [];
    }

    if (st.size > offset) {
      const fd = await open(filePath, "r");
      try {
        const len = st.size - offset;
        const buf = Buffer.alloc(len);
        await fd.read(buf, 0, len, offset);
        const combined = Buffer.concat([partial, buf]);
        // Parse only through the last newline; trailing bytes are a half-written
        // line we re-prepend on the next read.
        const lastNl = combined.lastIndexOf(0x0a);
        if (lastNl === -1) {
          partial = combined;
        } else {
          const complete = combined.subarray(0, lastNl + 1).toString("utf-8");
          partial = combined.subarray(lastNl + 1);
          records.push(...parseChunk(complete));
        }
        offset = st.size;
      } finally {
        await fd.close();
      }
    }

    return records;
  };

  return { read };
}
