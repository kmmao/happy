/**
 * ReplayBuffer — terminal-aware rolling buffer used for reconnect replay.
 *
 * The classic "slice off the front N bytes" buffer used to land mid-escape-
 * sequence after a busy command — xterm.js would render the leftover bytes
 * as garbage glyphs (e.g. `<87>`) until the next full sequence arrived. This
 * buffer keeps the same FIFO semantics but trims smarter:
 *
 *   1. When trimming for size, never cut inside a CSI/OSC escape sequence
 *      (the prefix `\x1b[` … final byte `@`–`~`, or `\x1b]` … `\x07`/`ST`).
 *      We back the cut up to the next sequence boundary.
 *
 *   2. When the producer writes a known full-screen synchronisation marker
 *      (CSI `2J` clear screen + cursor home, or the alt-screen toggle
 *      `\x1b[?1049h` / `\x1b[?1049l`), we drop everything before it. After
 *      `clear`, history before the clear is invisible anyway — keeping it
 *      bloats the buffer and risks confusing the renderer on replay.
 *
 *   3. UTF-16 surrogate pairs are kept together (same rule as
 *      `chunkStringSafe`) so emoji at chunk boundaries never render as
 *      lone replacement glyphs.
 *
 * The buffer is byte-level by code unit (not grapheme), which is the same
 * resolution xterm.js itself operates on. Future revisions may swap the
 * implementation for `@xterm/headless` + `SerializeAddon` to render a true
 * virtual screen snapshot — the consumer surface is intentionally narrow
 * so that swap is a one-file change.
 */

const DEFAULT_LIMIT = 256 * 1024; // 256 KB — was 64 KB before this rework.

// CSI sync points: `\x1b[2J` followed (loosely) by a cursor-home. We accept
// the common variants emitted by Ink and stock terminal apps.
const CLEAR_SCREEN_PATTERN = /\x1b\[(?:2J|H\x1b\[2J|2J\x1b\[H|2J\x1b\[1;1H)/g;
const ALT_SCREEN_PATTERN = /\x1b\[\?1049[hl]/g;

/**
 * Returns the index just AFTER the latest synchronisation marker in `s`,
 * or -1 if none was found. The caller can `s.slice(idx)` to drop history
 * that the new screen state has invalidated.
 */
function latestSyncPoint(s: string): number {
  let best = -1;
  CLEAR_SCREEN_PATTERN.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = CLEAR_SCREEN_PATTERN.exec(s)); ) {
    const end = m.index + m[0].length;
    if (end > best) best = end;
  }
  ALT_SCREEN_PATTERN.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = ALT_SCREEN_PATTERN.exec(s)); ) {
    const end = m.index + m[0].length;
    if (end > best) best = end;
  }
  return best;
}

/**
 * Returns the smallest index `j ≥ desired` such that `s.slice(j)` does not
 * start inside an unterminated escape sequence or on a low surrogate. If no
 * such index exists below `s.length`, returns `s.length` (caller should keep
 * nothing — pathological case).
 */
function safeTrimIndex(s: string, desired: number): number {
  let j = Math.max(0, Math.min(desired, s.length));
  // 1. If we're sitting on a low surrogate, back up so its high surrogate
  //    is included with us (we're keeping the tail starting at j).
  while (j < s.length) {
    const code = s.charCodeAt(j);
    if (code >= 0xdc00 && code <= 0xdfff) {
      j++; // skip the orphan low surrogate
      continue;
    }
    break;
  }
  // 2. If `s.slice(j)` would start with an unterminated escape sequence
  //    prefix (`\x1b` or `\x1b[`), advance past it to the next byte that
  //    looks like a clean re-entry point. We approximate "clean" as any
  //    byte that is neither ESC nor a CSI parameter byte.
  while (j < s.length && s.charCodeAt(j) === 0x1b) {
    // Walk forward to the end of this CSI/OSC, then start replay AFTER it.
    const advanced = skipEscapeSequence(s, j);
    if (advanced === j) break; // not a known sequence, give up
    j = advanced;
  }
  return j;
}

/**
 * Given `s` and an index `i` pointing at `\x1b`, return the index just AFTER
 * the escape sequence (CSI ending in 0x40–0x7e, or OSC ending in BEL/ST).
 * Returns `i` unchanged if `s[i]` is not ESC or the sequence is incomplete.
 */
function skipEscapeSequence(s: string, i: number): number {
  if (s.charCodeAt(i) !== 0x1b) return i;
  if (i + 1 >= s.length) return i;
  const next = s.charCodeAt(i + 1);
  if (next === 0x5b /* [ */) {
    // CSI: ESC [ parameters intermediate final
    let j = i + 2;
    while (j < s.length) {
      const c = s.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) return j + 1;
      j++;
    }
    return i;
  }
  if (next === 0x5d /* ] */) {
    // OSC: ESC ] ... BEL (0x07) or ST (\x1b\x5c)
    let j = i + 2;
    while (j < s.length) {
      const c = s.charCodeAt(j);
      if (c === 0x07) return j + 1;
      if (c === 0x1b && j + 1 < s.length && s.charCodeAt(j + 1) === 0x5c) {
        return j + 2;
      }
      j++;
    }
    return i;
  }
  // Single-byte ESC sequence (ESC = c).
  return i + 2;
}

export interface ReplayBufferOptions {
  /** Hard size limit in UTF-16 code units. Defaults to 256 KB. */
  limit?: number;
}

export interface ReplayBuffer {
  /** Append a chunk to the buffer; trims internally to stay within the limit. */
  append(data: string): void;
  /** Return the current replay payload. Safe to send straight to xterm.js. */
  snapshot(): string;
  /** Drop everything. */
  clear(): void;
  /** Current size in UTF-16 code units. */
  readonly size: number;
}

export function createReplayBuffer(options: ReplayBufferOptions = {}): ReplayBuffer {
  const limit = options.limit ?? DEFAULT_LIMIT;
  let buffer = "";

  return {
    get size() {
      return buffer.length;
    },
    append(data: string) {
      if (data.length === 0) return;
      buffer += data;

      // Step 1: prefer dropping everything before the most recent screen
      // synchronisation marker — history before a clear-screen is
      // un-renderable anyway.
      const sync = latestSyncPoint(buffer);
      if (sync > 0 && sync < buffer.length) {
        buffer = buffer.slice(sync);
      }

      // Step 2: enforce size cap by trimming the front, snapping to a safe
      // boundary so we never start replay inside an escape sequence.
      if (buffer.length > limit) {
        const cutAt = safeTrimIndex(buffer, buffer.length - limit);
        buffer = buffer.slice(cutAt);
      }
    },
    snapshot() {
      return buffer;
    },
    clear() {
      buffer = "";
    },
  };
}
