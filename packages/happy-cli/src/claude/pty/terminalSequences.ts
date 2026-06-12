/**
 * Streaming OSC (Operating System Command) extractor for PTY output.
 *
 * Claude Code 2.1.139+ hooks can write terminal control sequences via the
 * `terminalSequence` hook output to set the window title, fire bells, or
 * emit iTerm2-style notifications. In PTY mode these bytes pass straight
 * through to our reverse server / xterm renderer (a feature, not a bug —
 * native terminals render them), but we never surface them to the App.
 *
 * This module is a *passive* observer: feed it PTY chunks and it yields
 * structured events. It does NOT mutate or strip bytes from the stream.
 *
 * Stream semantics:
 *   - OSC frames may straddle chunk boundaries — internal state buffers
 *     a partial sequence across `feed()` calls.
 *   - Terminators handled: BEL (0x07) and ST (ESC \ = 0x1b 0x5c).
 *   - Plain BEL (0x07) outside an OSC frame is yielded as a `bell` event.
 *   - Unknown OSC `Ps` codes are yielded as `other` so callers can decide.
 *
 * Wired up in `claudeRemote.ts`: one extractor per PTY registered against
 * `pty.onData()`, events forwarded by the launcher as `terminal-signal`
 * wire envelopes (see `claudeRemoteLauncherCore.ts` onTerminalSignal).
 */

export type TerminalProgressState =
  | "remove"
  | "normal"
  | "error"
  | "indeterminate"
  | "paused";

export type TerminalSequenceEvent =
  | { kind: "windowTitle"; title: string }
  // iTerm2 OSC 9 ; <message> BEL — a desktop notification request.
  | { kind: "notification"; body: string }
  // ConEmu OSC 9 ; 4 ; <st> ; <pr> — taskbar progress. st: 0 remove,
  // 1 normal (pr = 0–100), 2 error, 3 indeterminate, 4 paused.
  | { kind: "progress"; state: TerminalProgressState; value?: number }
  | { kind: "bell" }
  | { kind: "other"; ps: string; payload: string };

const CONEMU_PROGRESS_STATES: Record<string, TerminalProgressState> = {
  "0": "remove",
  "1": "normal",
  "2": "error",
  "3": "indeterminate",
  "4": "paused",
};

/**
 * Parse a ConEmu progress payload (the `Pt` after `9;`): `4;<st>[;<pr>]`.
 * Returns null when the payload is not a well-formed progress report so the
 * caller can fall back to treating it as a plain notification body.
 */
function classifyConEmuProgress(pt: string): TerminalSequenceEvent | null {
  const parts = pt.split(";");
  if (parts[0] !== "4") return null;
  const state = CONEMU_PROGRESS_STATES[parts[1] ?? ""];
  if (!state) return null;
  if (state === "normal" || state === "error" || state === "paused") {
    const raw = Number(parts[2]);
    const value = Number.isFinite(raw)
      ? Math.min(100, Math.max(0, raw))
      : undefined;
    return { kind: "progress", state, value };
  }
  return { kind: "progress", state };
}

const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;

interface ParserState {
  // When true we are inside an OSC, collecting payload bytes until BEL or ST.
  inOsc: boolean;
  // Did the last byte we saw look like the start of ST (ESC \)? If so the
  // next ESC followed by '\' terminates the frame.
  oscEscPending: boolean;
  // Accumulated OSC payload (Ps;Pt). Capped to avoid pathological growth.
  oscBuf: string;
  // Track the last byte processed across chunks so an ESC at the very end
  // of one chunk can pair with ']' at the start of the next.
  pendingEsc: boolean;
}

const MAX_OSC_PAYLOAD = 4096;

/**
 * Decode an OSC payload of the form `Ps;Pt` into a structured event.
 * Returns null for malformed frames (e.g. no `;` separator) so the parser
 * can drop them silently rather than yielding noise.
 */
function classify(payload: string): TerminalSequenceEvent | null {
  const semi = payload.indexOf(";");
  if (semi < 0) return null;
  const ps = payload.slice(0, semi);
  const pt = payload.slice(semi + 1);
  // Per xterm: OSC 0 = icon name + window title, 1 = icon name only,
  // 2 = window title only. We treat 0 and 2 as window title and ignore 1
  // (icon-name-only is meaningless to a remote App).
  if (ps === "0" || ps === "2") return { kind: "windowTitle", title: pt };
  if (ps === "9") {
    // OSC 9;4;… is the ConEmu progress sub-protocol; everything else under
    // OSC 9 is an iTerm2-style notification body.
    return classifyConEmuProgress(pt) ?? { kind: "notification", body: pt };
  }
  return { kind: "other", ps, payload: pt };
}

export interface TerminalSequenceExtractor {
  /** Feed PTY bytes; returns any events completed by this chunk. */
  feed(chunk: string): TerminalSequenceEvent[];
  /** Drop in-flight OSC state — call on PTY exit / re-spawn. */
  reset(): void;
}

export function createTerminalSequenceExtractor(): TerminalSequenceExtractor {
  const state: ParserState = {
    inOsc: false,
    oscEscPending: false,
    oscBuf: "",
    pendingEsc: false,
  };

  function reset(): void {
    state.inOsc = false;
    state.oscEscPending = false;
    state.oscBuf = "";
    state.pendingEsc = false;
  }

  function feed(chunk: string): TerminalSequenceEvent[] {
    if (chunk.length === 0) return [];
    const events: TerminalSequenceEvent[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk.charCodeAt(i);

      if (state.inOsc) {
        // Look for terminator. BEL ends immediately; ST is ESC \.
        if (byte === BEL) {
          const ev = classify(state.oscBuf);
          if (ev) events.push(ev);
          state.inOsc = false;
          state.oscBuf = "";
          state.oscEscPending = false;
          continue;
        }
        if (state.oscEscPending) {
          state.oscEscPending = false;
          if (byte === BACKSLASH) {
            const ev = classify(state.oscBuf);
            if (ev) events.push(ev);
            state.inOsc = false;
            state.oscBuf = "";
            continue;
          }
          // Lone ESC inside OSC — preserve it and keep collecting.
          if (state.oscBuf.length < MAX_OSC_PAYLOAD) {
            state.oscBuf += "\x1b";
          }
        }
        if (byte === ESC) {
          state.oscEscPending = true;
          continue;
        }
        if (state.oscBuf.length < MAX_OSC_PAYLOAD) {
          state.oscBuf += chunk[i];
        } else {
          // Runaway OSC — abandon and resync on the next ESC ].
          state.inOsc = false;
          state.oscBuf = "";
          state.oscEscPending = false;
        }
        continue;
      }

      // Not currently inside an OSC.
      if (state.pendingEsc) {
        state.pendingEsc = false;
        if (chunk[i] === "]") {
          state.inOsc = true;
          continue;
        }
        // ESC + other byte — not an OSC start; ignore (the byte itself is
        // still part of the PTY stream the renderer sees, so no event).
      }
      if (byte === ESC) {
        state.pendingEsc = true;
        continue;
      }
      if (byte === BEL) {
        events.push({ kind: "bell" });
        continue;
      }
      // Plain byte — nothing to do.
    }

    return events;
  }

  return { feed, reset };
}
