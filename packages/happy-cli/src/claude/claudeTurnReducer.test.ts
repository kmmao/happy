import { describe, expect, it } from "vitest";

import {
  createClaudeTurnReducer,
  initialReducerState,
  reduceTurn,
  type ReducerOutput,
} from "./claudeTurnReducer";

// These tests pin the auto-compact protocol invariants that previously
// lived as two `let` flags inside a 1647-line closure with zero coverage.
// The four bugs the recent /compact-loop fix touched (echo-retry concat,
// missing no-op event, misleading watchdog text, cooldown miss) all
// belonged to this slice. The reducer is the seam those invariants now
// live behind; deleting it would push the same scatter back into the
// closure, which is why deepening earns its keep here.

describe("reduceTurn", () => {
  it("emits 'Compaction completed' and no cooldown when compact_boundary fires before turn-end", () => {
    const { dispatch } = createClaudeTurnReducer();

    expect(dispatch({ t: "promptIsCompact" })).toEqual([]);
    expect(dispatch({ t: "turnStart" })).toEqual([]);
    expect(dispatch({ t: "compactBoundary" })).toEqual([]);
    const outputs = dispatch({ t: "turnEnd" });

    expect(outputs).toEqual<ReducerOutput[]>([
      { t: "emitCompletion", text: "Compaction completed" },
    ]);
  });

  it("emits 'Compaction skipped' when turn ends without compact_boundary", () => {
    // Pre-0.100.7 this slice also emitted `armCooldown` to gate the next
    // auto-push of `/compact`. With auto-push removed (the threshold now
    // only surfaces a hint via runClaude's onAutoCompactRequest), no
    // cooldown is needed — the user-typed `/compact` no-op just needs the
    // truthful "skipped" status so the user knows to act.
    const { dispatch } = createClaudeTurnReducer();

    dispatch({ t: "promptIsCompact" });
    const outputs = dispatch({ t: "turnEnd" });

    expect(outputs).toEqual<ReducerOutput[]>([
      {
        t: "emitCompletion",
        text: "Compaction skipped — TUI did not compact this turn",
      },
    ]);
  });

  it("ignores turnEnd for a non-compact turn (no output, no state change)", () => {
    const { dispatch, state } = createClaudeTurnReducer();

    expect(dispatch({ t: "turnEnd" })).toEqual([]);
    expect(state()).toEqual(initialReducerState);
  });

  it("ignores compact_boundary when no /compact prompt is in flight", () => {
    // Defensive: a stray boundary JSONL must not flip state if the
    // launcher didn't actually push /compact this turn (spurious or
    // late-arriving JSONL from a prior session, race on cold restart, etc.).
    const { dispatch, state } = createClaudeTurnReducer();

    expect(dispatch({ t: "compactBoundary" })).toEqual([]);
    expect(state().compactBoundaryObserved).toBe(false);
  });

  it("is idempotent on double compact_boundary", () => {
    // The TUI normally emits exactly one boundary record per /compact, but
    // we don't want behaviour to depend on that assumption. Two boundaries
    // ⇒ still one "Compaction completed", still no cooldown.
    const { dispatch } = createClaudeTurnReducer();

    dispatch({ t: "promptIsCompact" });
    dispatch({ t: "compactBoundary" });
    dispatch({ t: "compactBoundary" });
    const outputs = dispatch({ t: "turnEnd" });

    expect(outputs).toEqual<ReducerOutput[]>([
      { t: "emitCompletion", text: "Compaction completed" },
    ]);
  });

  it("resets state on turnEnd so a subsequent non-compact turn stays quiet", () => {
    const { dispatch } = createClaudeTurnReducer();

    dispatch({ t: "promptIsCompact" });
    dispatch({ t: "compactBoundary" });
    dispatch({ t: "turnEnd" });

    // Next turn is a normal user message. No /compact intent. turnEnd
    // must not re-emit anything.
    expect(dispatch({ t: "turnStart" })).toEqual([]);
    expect(dispatch({ t: "turnEnd" })).toEqual([]);
  });

  // Bug pinned (2026-06-19): strand recovery may redeliver `/compact` via
  // the queue after a tier-1 wedge — claudeRemote.handleResult re-detects
  // the slash command and MUST dispatch promptIsCompact again so the
  // reducer is armed for THIS turn's compact_boundary. Pre-fix this
  // dispatch was missing: a successful redelivery still emitted no
  // "Compaction completed", and the user saw only the initial-turn's
  // "Compaction started" hint followed by silence after recovery.
  it("redelivered /compact arms the reducer just like the initial one", () => {
    const { dispatch } = createClaudeTurnReducer();

    // Initial turn: /compact wedges, no boundary arrives, turn ends.
    dispatch({ t: "promptIsCompact" });
    expect(dispatch({ t: "turnEnd" })).toEqual<ReducerOutput[]>([
      {
        t: "emitCompletion",
        text: "Compaction skipped — TUI did not compact this turn",
      },
    ]);

    // Strand-recovery redelivers /compact onto a fresh PTY (cold restart),
    // claudeRemote.handleResult re-dispatches promptIsCompact, the TUI
    // actually compacts this time, turn ends — completed must fire.
    dispatch({ t: "promptIsCompact" });
    dispatch({ t: "compactBoundary" });
    expect(dispatch({ t: "turnEnd" })).toEqual<ReducerOutput[]>([
      { t: "emitCompletion", text: "Compaction completed" },
    ]);
  });

  it("a fresh promptIsCompact clears prior compactBoundaryObserved", () => {
    // Strand recovery edge case — turnEnd never fired for the prior
    // /compact, so the observation flag was left set. The next
    // /compact must start from a clean slate.
    const { dispatch, state } = createClaudeTurnReducer();

    dispatch({ t: "promptIsCompact" });
    dispatch({ t: "compactBoundary" });
    // ↑ turnEnd skipped — simulates a strand that never finished.

    dispatch({ t: "promptIsCompact" });
    expect(state()).toEqual({
      isCompactCommand: true,
      compactBoundaryObserved: false,
    });

    // No boundary observed for THIS turn → skipped path.
    const outputs = dispatch({ t: "turnEnd" });
    expect(outputs).toEqual<ReducerOutput[]>([
      {
        t: "emitCompletion",
        text: "Compaction skipped — TUI did not compact this turn",
      },
    ]);
  });
});

// The pure function is the contract; the driver is a convenience. Pin
// once that the driver is a faithful state-threading wrapper so callers
// who want determinism can use `reduceTurn` directly without surprise.
describe("reduceTurn (pure form)", () => {
  it("returns next state without mutating the input", () => {
    const before = initialReducerState;
    const { next } = reduceTurn(before, { t: "promptIsCompact" });
    expect(before).toEqual(initialReducerState);
    expect(next).not.toBe(before);
    expect(next.isCompactCommand).toBe(true);
  });
});
