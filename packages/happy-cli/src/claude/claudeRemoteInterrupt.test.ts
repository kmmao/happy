import { describe, expect, it } from "vitest";

import { canProcessTurnResult, interruptTurnResult } from "./claudeRemote";

// Regression coverage for the "plan mode hangs after interrupt" wedge.
//
// Repro (daemon log PID 33211, session 7d7334ec):
//   1. Yolo + plan mode → ExitPlanMode approved → Happy auto-sends the
//      PLAN_FAKE_RESTART continuation ("PlEaZe Continue with plan.") and the
//      new turn spins up a mid-turn drain.
//   2. The user, seeing the odd auto-continuation, taps interrupt (RPC).
//   3. A graceful Esc stops the TUI mid-turn but emits NO `turn_duration`
//      marker, so `handleResult` — the only caller of `nextMessage()` after
//      the first — never fired. The `for await` parked, the drain stayed
//      alive, and the next queued user message hit `cold hash mismatch` and
//      flipped the execution guard to `restarting` with nobody to service it
//      → `[STALLED] Queue has 1 message(s) waiting` after 300s.
//
// The fix nudges the loop forward on interrupt by synthesizing an
// interrupted-turn result (`interruptTurnResult`) and feeding it to
// `handleResult`, which reaches `nextMessage()` (stopping the stale drain and
// servicing the queue through the normal restart/dispatch machinery). These
// two exported helpers encode the safety invariants that keep that nudge
// correct.

describe("canProcessTurnResult — interrupt loop nudge guard", () => {
  it("advances the loop when a turn is genuinely running (interrupted turn)", () => {
    // The interrupted-turn case: no result mid-flight, run still live → the
    // synthetic result is allowed through so the loop reaches nextMessage().
    expect(canProcessTurnResult(/* resultInFlight */ false, /* aborted */ false)).toBe(true);
  });

  it("is a no-op while a real result is already in flight (prevents double-consume)", () => {
    // The loop just finished a real turn and is idle-waiting inside
    // nextMessage(); resultInFlight is still latched true. A concurrent
    // interrupt must NOT start a second handleResult or two consumers would
    // race to dequeue the same message.
    expect(canProcessTurnResult(/* resultInFlight */ true, /* aborted */ false)).toBe(false);
  });

  it("is a no-op once the run is aborted (PTY already torn down)", () => {
    expect(canProcessTurnResult(/* resultInFlight */ false, /* aborted */ true)).toBe(false);
    expect(canProcessTurnResult(/* resultInFlight */ true, /* aborted */ true)).toBe(false);
  });
});

describe("interruptTurnResult — synthetic result shape", () => {
  it("is a bare interrupted-turn result with no side-effecting fields", () => {
    const result = interruptTurnResult();
    expect(result.type).toBe("result");
    expect(result.subtype).toBe("interrupted");
  });

  it("omits num_turns / cost / modelUsage so handleResult runs only the loop-advancing tail", () => {
    // These are the exact fields handleResult branches on. Their ABSENCE is
    // what keeps the interrupt nudge free of the local-command forward
    // (num_turns === 0 && result), onMaxTurnsReached (subtype
    // "error_max_turns"), and onResult cost reporting (total_cost_usd /
    // modelUsage). If a future edit adds any of them the interrupt would start
    // emitting spurious turn-end side effects — pin them out here.
    const result = interruptTurnResult() as Record<string, unknown>;
    expect(result.num_turns).toBeUndefined();
    expect(result.total_cost_usd).toBeUndefined();
    expect(result.modelUsage).toBeUndefined();
    expect(result.result).toBeUndefined();
    expect(result.subtype).not.toBe("error_max_turns");
  });
});
