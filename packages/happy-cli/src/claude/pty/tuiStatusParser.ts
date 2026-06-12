/**
 * Streaming parser for the Claude TUI's *rendered* status surface.
 *
 * Where `terminalSequences.ts` decodes deliberate control frames (OSC), this
 * module watches the visible text the TUI paints — the animated status line
 * and interactive pickers — and turns them into structured events the
 * launcher can mirror to the App as `terminal-signal` wire events:
 *
 *   - `activity`: the spinner status line, e.g. `✶ Reasoning… (12s · 1.2k
 *     tokens · esc to interrupt)`. Gives the App a live verb + counters far
 *     earlier than JSONL records land on disk.
 *   - `picker`: a numbered selection dialog (`❯ 1. …`) is on screen and the
 *     TUI is blocked on keyboard input. Lets the App show "waiting for
 *     choice" instead of an eternal spinner.
 *
 * Like the OSC extractor this is a passive observer over `pty.onData()`
 * chunks: it never mutates the stream. State is a small sliding window of
 * ANSI-stripped text, so frames that straddle chunk boundaries still match.
 *
 * Emission is debounced internally (the TUI redraws the spinner several
 * times per second): an `activity` event fires only when the verb changes,
 * or when counters change and ≥1 s has passed since the last emit. A
 * `picker` event fires on the absent→present transition of the picker
 * pattern within the window.
 */

export type TuiStatusEvent =
  | { kind: "activity"; verb: string; tokens?: number; seconds?: number }
  | { kind: "picker"; snippet: string };

export interface TuiStatusParser {
  /** Feed raw PTY bytes; returns any events this chunk completed. */
  feed(chunk: string): TuiStatusEvent[];
  /** Drop window + debounce state — call on PTY exit / re-spawn. */
  reset(): void;
}

// CSI (colour/cursor), OSC (title/notification), and other ESC-prefixed
// control sequences, plus stray C0 control bytes except \n.
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|[\x00-\x08\x0b-\x1f]/g;

/**
 * The TUI status line: a spinner glyph, a present-participle verb ending in
 * an ellipsis, then a parenthesised counter group. The verb is captured
 * loosely (any letters incl. CJK, spaces) so new TUI verbs keep matching.
 */
const STATUS_LINE_PATTERN =
  /[✻✳✶✽✢·∗✺✹✸✷*+]\s{1,3}([A-Za-zÀ-ɏ一-鿿][A-Za-zÀ-ɏ一-鿿 ]{1,40}?)(?:…|\.\.\.)\s*\(([^)]*)\)/;

const TOKENS_PATTERN = /([\d.,]+)\s*k?\s*tokens/i;
const TOKENS_K_PATTERN = /([\d.,]+)k\s*tokens/i;
const SECONDS_PATTERN = /(\d+)\s*s\b/;

// Same shape as claudePtyController's plan-picker pattern, applied to the
// ANSI-stripped window: cursor glyph, then a numbered first option.
const PICKER_PATTERN = /❯[\s\S]{0,40}?\b1\.\s/;

const WINDOW_MAX = 4096;
const ACTIVITY_MIN_INTERVAL_MS = 1000;
const PICKER_SNIPPET_MAX = 240;

function parseTokenCount(stripped: string): number | undefined {
  const kMatch = TOKENS_K_PATTERN.exec(stripped);
  if (kMatch) {
    const n = Number(kMatch[1].replace(/,/g, ""));
    return Number.isFinite(n) ? Math.round(n * 1000) : undefined;
  }
  const match = TOKENS_PATTERN.exec(stripped);
  if (!match) return undefined;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function createTuiStatusParser(
  now: () => number = () => Date.now(),
): TuiStatusParser {
  let window = "";
  let lastVerb: string | null = null;
  let lastTokens: number | undefined;
  let lastSeconds: number | undefined;
  let lastActivityEmitAt = 0;
  let pickerVisible = false;

  function reset(): void {
    window = "";
    lastVerb = null;
    lastTokens = undefined;
    lastSeconds = undefined;
    lastActivityEmitAt = 0;
    pickerVisible = false;
  }

  function feed(chunk: string): TuiStatusEvent[] {
    if (chunk.length === 0) return [];
    window += chunk.replace(ANSI_PATTERN, "");
    if (window.length > WINDOW_MAX) {
      window = window.slice(window.length - WINDOW_MAX);
    }

    const events: TuiStatusEvent[] = [];

    // ── Activity (status line) ──────────────────────────────────────────
    // Match the LAST occurrence in the window — the TUI repaints the line
    // in place, so the freshest render is the one nearest the tail.
    let statusMatch: RegExpExecArray | null = null;
    const globalStatus = new RegExp(STATUS_LINE_PATTERN.source, "g");
    for (let m = globalStatus.exec(window); m; m = globalStatus.exec(window)) {
      statusMatch = m;
    }
    if (statusMatch) {
      const verb = statusMatch[1].trim();
      const counters = statusMatch[2];
      const tokens = parseTokenCount(counters);
      const secondsMatch = SECONDS_PATTERN.exec(counters);
      const seconds = secondsMatch ? Number(secondsMatch[1]) : undefined;

      const verbChanged = verb !== lastVerb;
      const countersChanged = tokens !== lastTokens || seconds !== lastSeconds;
      const intervalOk = now() - lastActivityEmitAt >= ACTIVITY_MIN_INTERVAL_MS;
      if (verbChanged || (countersChanged && intervalOk)) {
        lastVerb = verb;
        lastTokens = tokens;
        lastSeconds = seconds;
        lastActivityEmitAt = now();
        events.push({ kind: "activity", verb, tokens, seconds });
      }
    }

    // ── Picker (numbered selection dialog) ──────────────────────────────
    const pickerMatch = PICKER_PATTERN.exec(window);
    if (pickerMatch && !pickerVisible) {
      pickerVisible = true;
      // Snippet: from a little before the cursor glyph to the window tail,
      // collapsed to single-spaced text so the App renders one clean line.
      const start = Math.max(0, pickerMatch.index - 160);
      const snippet = window
        .slice(start, pickerMatch.index + PICKER_SNIPPET_MAX)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, PICKER_SNIPPET_MAX);
      events.push({ kind: "picker", snippet });
    } else if (!pickerMatch && pickerVisible) {
      // Picker text scrolled out of the window (a choice was made or the
      // dialog was dismissed) — re-arm detection for the next dialog.
      pickerVisible = false;
    }

    return events;
  }

  return { feed, reset };
}
