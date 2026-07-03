import { describe, it, expect } from "vitest";
import {
  classifyStrandTick,
  classifyOutputTick,
  decideStrandRedeliver,
  DEFAULT_STRAND_THRESHOLDS,
  type StrandTickSignals,
} from "./strandPolicy";

const T = DEFAULT_STRAND_THRESHOLDS;

function signals(partial: Partial<StrandTickSignals>): StrandTickSignals {
  return {
    idleMs: 0,
    elapsedMs: 0,
    turnProducedOutput: false,
    promptSubmissionConfirmed: false,
    inFlightIsSlashCommand: false,
    strandRecoveryInFlight: false,
    ...partial,
  };
}

describe("classifyStrandTick — slash-command exemption", () => {
  const confirmedSlash = { inFlightIsSlashCommand: true, promptSubmissionConfirmed: true };

  it("does nothing while idle is under the warn threshold", () => {
    expect(
      classifyStrandTick(signals({ ...confirmedSlash, idleMs: T.idleWarnMs - 1 }), T),
    ).toEqual({ action: "none" });
  });

  it("holds off (warn) between warn and the 10-min slash threshold — /compact stays alive", () => {
    // The pid-99141 regression: /compact silent 99s must NOT recover.
    const d = classifyStrandTick(
      signals({ ...confirmedSlash, idleMs: 99_000 }),
      T,
    );
    expect(d).toEqual({ action: "warn", kind: "slash-holdoff" });
  });

  it("recovers once the slash command crosses the 10-min threshold", () => {
    const d = classifyStrandTick(
      signals({ ...confirmedSlash, idleMs: T.slashCommandRecoverMs }),
      T,
    );
    expect(d).toEqual({ action: "recover", kind: "slash", basisMs: T.slashCommandRecoverMs });
  });

  it("does not recover past the threshold if a recovery is already in flight", () => {
    const d = classifyStrandTick(
      signals({ ...confirmedSlash, idleMs: T.slashCommandRecoverMs + 1, strandRecoveryInFlight: true }),
      T,
    );
    expect(d).toEqual({ action: "warn", kind: "slash-holdoff" });
  });

  it("does NOT apply the exemption when the slash paste is not yet confirmed", () => {
    // Unconfirmed slash at 90s idle, zero output → treated as a real wedge.
    const d = classifyStrandTick(
      signals({ inFlightIsSlashCommand: true, promptSubmissionConfirmed: false, idleMs: T.wedgeRecoverMs }),
      T,
    );
    expect(d).toEqual({ action: "recover", kind: "wedge", basisMs: T.wedgeRecoverMs });
  });
});

describe("classifyStrandTick — zero-output submission wedge", () => {
  it("recovers at the 90s wedge threshold when no output and PTY silent", () => {
    const d = classifyStrandTick(signals({ idleMs: T.wedgeRecoverMs, turnProducedOutput: false }), T);
    expect(d).toEqual({ action: "recover", kind: "wedge", basisMs: T.wedgeRecoverMs });
  });

  it("does not fast-wedge once the turn has produced output", () => {
    const d = classifyStrandTick(signals({ idleMs: T.wedgeRecoverMs, turnProducedOutput: true }), T);
    // Output produced + idle under IDLE_RECOVER → just a warn.
    expect(d).toEqual({ action: "warn", kind: "stranded" });
  });
});

describe("classifyStrandTick — elapsed wall-clock wedge (spinner masks idle)", () => {
  it("recovers at 45s elapsed when paste unconfirmed, even though PTY is 'alive'", () => {
    const d = classifyStrandTick(
      signals({ idleMs: 5_000, elapsedMs: T.elapsedWedgeRecoverMs, promptSubmissionConfirmed: false }),
      T,
    );
    expect(d).toEqual({
      action: "recover",
      kind: "elapsed-wedge",
      basisMs: T.elapsedWedgeRecoverMs,
      notifyUserSeconds: 45,
    });
  });

  it("does NOT trip on a legitimately slow first token once the paste is confirmed (Opus 超高)", () => {
    // The reported loop: confirmed paste, spinner alive (idle low), thinking 60s.
    const d = classifyStrandTick(
      signals({ idleMs: 5_000, elapsedMs: 60_000, promptSubmissionConfirmed: true }),
      T,
    );
    expect(d).toEqual({ action: "none" });
  });
});

describe("classifyStrandTick — general idle thresholds", () => {
  it("does nothing below the warn threshold", () => {
    expect(classifyStrandTick(signals({ idleMs: T.idleWarnMs - 1, turnProducedOutput: true }), T)).toEqual({
      action: "none",
    });
  });

  it("warns between warn and recover thresholds", () => {
    expect(classifyStrandTick(signals({ idleMs: T.idleWarnMs, turnProducedOutput: true }), T)).toEqual({
      action: "warn",
      kind: "stranded",
    });
  });

  it("recovers at the general idle-recover threshold", () => {
    expect(classifyStrandTick(signals({ idleMs: T.idleRecoverMs, turnProducedOutput: true }), T)).toEqual({
      action: "recover",
      kind: "idle",
      basisMs: T.idleRecoverMs,
    });
  });

  it("falls back to warn (not recover) when recovery is already in flight at the recover threshold", () => {
    expect(
      classifyStrandTick(
        signals({ idleMs: T.idleRecoverMs, turnProducedOutput: true, strandRecoveryInFlight: true }),
        T,
      ),
    ).toEqual({ action: "warn", kind: "stranded" });
  });
});

describe("classifyOutputTick", () => {
  it("counts output and refunds the redeliver budget after the grace window", () => {
    expect(classifyOutputTick(5_000, 5_000)).toEqual({
      countAsTurnOutput: true,
      rearmRedeliverBudget: true,
    });
    expect(classifyOutputTick(10_000, 5_000)).toEqual({
      countAsTurnOutput: true,
      rearmRedeliverBudget: true,
    });
  });

  it("treats a tick inside the grace window as a replay — neither counts nor refunds", () => {
    expect(classifyOutputTick(4_999, 5_000)).toEqual({
      countAsTurnOutput: false,
      rearmRedeliverBudget: false,
    });
    expect(classifyOutputTick(0, 5_000)).toEqual({
      countAsTurnOutput: false,
      rearmRedeliverBudget: false,
    });
  });

  it("with no grace window active (graceUntil=0) every tick is genuine output", () => {
    expect(classifyOutputTick(1, 0)).toEqual({
      countAsTurnOutput: true,
      rearmRedeliverBudget: true,
    });
  });
});

describe("decideStrandRedeliver", () => {
  const base = {
    exiting: false,
    turnProducedOutput: false,
    hasInFlightPrompt: true,
    redeliverCount: 0,
    promptIsSlashCommand: false,
  };

  it("re-delivers a prose prompt when the turn produced zero output", () => {
    expect(decideStrandRedeliver(base)).toEqual({ action: "redeliver" });
  });

  it("forces a cold restart for a slash command — never re-paste onto the same PTY", () => {
    expect(decideStrandRedeliver({ ...base, promptIsSlashCommand: true })).toEqual({
      action: "cold-restart",
    });
  });

  it("skips when the launcher is exiting", () => {
    expect(decideStrandRedeliver({ ...base, exiting: true })).toEqual({
      action: "skip",
      reason: "exiting",
    });
  });

  it("skips when the turn already produced output (double-execution risk)", () => {
    expect(decideStrandRedeliver({ ...base, turnProducedOutput: true })).toEqual({
      action: "skip",
      reason: "turn-produced-output",
    });
  });

  it("skips when no prompt was captured for this turn", () => {
    expect(decideStrandRedeliver({ ...base, hasInFlightPrompt: false })).toEqual({
      action: "skip",
      reason: "no-inflight-prompt",
    });
  });

  it("enforces the one-shot budget — a second strand does not re-deliver again", () => {
    expect(decideStrandRedeliver({ ...base, redeliverCount: 1 })).toEqual({
      action: "skip",
      reason: "budget-exhausted",
    });
  });

  it("budget check precedes the slash split — an exhausted slash prompt skips, not cold-restarts", () => {
    expect(
      decideStrandRedeliver({ ...base, redeliverCount: 1, promptIsSlashCommand: true }),
    ).toEqual({ action: "skip", reason: "budget-exhausted" });
  });
});
