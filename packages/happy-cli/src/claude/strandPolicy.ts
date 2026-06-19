/**
 * strandPolicy — the pure decision policy for the remote launcher's per-turn
 * strand watchdog. The watchdog tick gathers timing/state signals and asks this
 * module "given these signals, what should happen?"; the module returns a
 * decision (do nothing / warn / recover) without touching any mutable state,
 * timers, the PTY, or the recovery machinery.
 *
 * Why this is its own seam: the threshold branching below is the distilled
 * result of a string of production strand incidents (false-positive aborts of
 * extended-thinking turns, lost-prompt submission wedges, /compact killed mid-
 * compaction). Each branch encodes a specific failure mode and its threshold.
 * Keeping the policy pure makes every one of those scenarios directly testable
 * — the interface is the test surface — without standing up a real PTY.
 *
 * The watchdog's OTHER concerns (the timer cadence, recovery tiers, prompt
 * redelivery, and the mutable liveness state) deliberately stay in
 * claudeRemoteLauncherCore: they touch real timers + a live Socket and carry
 * ordering invariants this pure module must not absorb.
 */

/**
 * Strand watchdog thresholds. The single source of truth for the magic numbers;
 * the rationale for each is hard-won from production incidents (PIDs / dates
 * below). Injected into {@link classifyStrandTick} so the policy stays pure and
 * tests can pin behaviour at exact boundaries.
 */
export interface StrandThresholds {
  /** log-only "looks stranded" warning threshold. */
  idleWarnMs: number;
  /** general auto-recovery threshold once a turn has already produced output. */
  idleRecoverMs: number;
  /** fast zero-output / zero-PTY-byte submission-wedge recovery threshold. */
  wedgeRecoverMs: number;
  /** confirmed-submitted slash-command (/compact …) recovery threshold. */
  slashCommandRecoverMs: number;
  /** wall-clock elapsed threshold for an unconfirmed-submission wedge. */
  elapsedWedgeRecoverMs: number;
}

export const DEFAULT_STRAND_THRESHOLDS: StrandThresholds = {
  // log-only "looks stranded" warning.
  idleWarnMs: 60_000,
  // general auto-recovery once a turn has produced output.
  idleRecoverMs: 120_000,
  // Fast path for a zero-output / zero-PTY-byte submission wedge (prompt never
  // submitted): the TUI sits idle forever with 0 PTY bytes and 0 JSONL records
  // (observed 2026-05-27 pid-36115 gen=5). Lower than the general threshold
  // because zero output makes re-delivery double-execution safe. 90s (was 30s)
  // gives Opus 4.x extended-thinking ("超高", [1m] budget) headroom for its
  // silent 60–90s first-token latency — the former 30s tripped mid-thinking and
  // re-delivered, surfacing as a duplicate response / spurious "Aborted"
  // (pid-47807: sdk_call→first_response=75022ms, false tier-1 recovery at 49s).
  wedgeRecoverMs: 90_000,
  // Confirmed-submitted slash command (/compact etc.) runs entirely inside the
  // TUI: no JSONL until compact_boundary fires at completion, no spinner bytes
  // during the internal API call. The standard wedge paths read that silence as
  // a strand and killed the in-flight command at 90s (pid-99141, 2026-06-19,
  // /compact at 13:02:26 aborted 13:04:05). Real compactions on a full 200K
  // context routinely take 60–180s+, so exempt confirmed slash commands and
  // only catch a truly dead session at 10 min.
  slashCommandRecoverMs: 600_000,
  // Wall-clock elapsed since turn start (independent of PTY idle, which the
  // startup spinner keeps refreshing — masking case (a) below). Catches the
  // lost-first-response wedge where the paste was dropped (prompt never
  // submitted, pid-88968: 110s silence, recovery re-delivered "hi", answered in
  // 6s). 45s: long enough a genuinely fast turn never trips it, short enough a
  // wedge recovers in ~45s instead of 110s. Gated in the classifier on
  // !promptSubmissionConfirmed so legitimately slow Opus 4.x 超高 first tokens
  // (echo confirmed, then thinking 60–90s) are NOT misread as a wedge.
  elapsedWedgeRecoverMs: 45_000,
};

/**
 * Effect of one arriving JSONL output tick on the per-turn liveness latches.
 * Both fields are decided here rather than inline in the launcher so the
 * cold-restart-grace invariant — "JSONL arriving inside the grace window is a
 * sessionScanner replay of pre-existing history (Claude rewrites the session
 * file with a fresh id on --resume), not this turn's real output" — is pinned
 * by a test instead of living as untested closure glue. Getting it wrong cost a
 * 138s freeze + silent message loss (see `coldRestartGraceUntil` in
 * claudeRemoteLauncherCore): a replay that flips `turnProducedOutput` masks a
 * real submission wedge from the 90s fast-wedge path and blocks prompt
 * redelivery; a replay that refunds the one-shot redeliver budget lets a
 * re-strand-loop push the same prompt twice.
 */
export interface OutputTickEffect {
  /** Flip the turn's "produced real output" latch true. */
  countAsTurnOutput: boolean;
  /** Refund the one-shot strand-redeliver budget (reset the counter to 0). */
  rearmRedeliverBudget: boolean;
}

/**
 * Decide how one JSONL output tick affects the per-turn liveness latches. A
 * tick at or after `coldRestartGraceUntil` is genuine post-grace output (counts
 * + refunds the budget); a tick before it is a cold-restart replay and does
 * neither. The two effects share the grace gate today but are distinct
 * decisions (output liveness vs. redeliver accounting), so each gets its own
 * field rather than one boolean the caller reuses.
 */
export function classifyOutputTick(
  nowMs: number,
  coldRestartGraceUntil: number,
): OutputTickEffect {
  const genuinePostGraceOutput = nowMs >= coldRestartGraceUntil;
  return {
    countAsTurnOutput: genuinePostGraceOutput,
    rearmRedeliverBudget: genuinePostGraceOutput,
  };
}

/** Timing + state signals sampled at one watchdog tick. */
export interface StrandTickSignals {
  /** ms since the last PTY byte / JSONL record (liveness). */
  idleMs: number;
  /** ms since turn start (wall clock; not reset by spinner bytes). */
  elapsedMs: number;
  /** whether this turn has emitted any real JSONL output yet. */
  turnProducedOutput: boolean;
  /** whether WRITE_VERIFY observed PTY echo proving the paste was accepted. */
  promptSubmissionConfirmed: boolean;
  /** whether the in-flight prompt is a slash command (/compact, /clear, …). */
  inFlightIsSlashCommand: boolean;
  /** whether a recovery is already running (suppresses re-triggering). */
  strandRecoveryInFlight: boolean;
}

/**
 * What the watchdog should do this tick. `recover` carries the basis duration
 * (idle or elapsed ms, for the diagnostic log) and a `kind` selecting the log
 * line; `notifyUserSeconds` (elapsed-wedge only) requests the user-facing
 * "re-sending your message…" session event before recovery.
 */
export type StrandTickDecision =
  | { action: "none" }
  | { action: "warn"; kind: "slash-holdoff" | "stranded" }
  | {
      action: "recover";
      kind: "slash" | "wedge" | "elapsed-wedge" | "idle";
      basisMs: number;
      notifyUserSeconds?: number;
    };

/**
 * Classify one watchdog tick. The caller is responsible for the pre-gates that
 * make a strand even possible (turn is "running", no active tool call or
 * pending elicitation) — this function assumes those held and decides purely on
 * the timing/state signals.
 *
 * The branch order is load-bearing and mirrors the historical watchdog exactly:
 * slash exemption is terminal; then the fast zero-output wedge; then the
 * wall-clock elapsed wedge (which falls through when it does not fire); then the
 * idle warn / recover thresholds.
 */
export function classifyStrandTick(
  s: StrandTickSignals,
  t: StrandThresholds,
): StrandTickDecision {
  const {
    idleMs,
    elapsedMs,
    turnProducedOutput,
    promptSubmissionConfirmed,
    inFlightIsSlashCommand,
    strandRecoveryInFlight,
  } = s;

  // Slash-command exemption (terminal once entered): a confirmed-submitted
  // /compact etc. is legitimately silent; hold off until the 10-min threshold.
  if (inFlightIsSlashCommand && promptSubmissionConfirmed) {
    if (idleMs < t.idleWarnMs) return { action: "none" };
    if (idleMs >= t.slashCommandRecoverMs && !strandRecoveryInFlight) {
      return { action: "recover", kind: "slash", basisMs: idleMs };
    }
    return { action: "warn", kind: "slash-holdoff" };
  }

  // Fast zero-output submission wedge: PTY fully silent since turn start.
  if (
    !turnProducedOutput &&
    idleMs >= t.wedgeRecoverMs &&
    !strandRecoveryInFlight
  ) {
    return { action: "recover", kind: "wedge", basisMs: idleMs };
  }

  // Lost-first-response by wall clock: spinner keeps the PTY "alive" (idle below
  // the wedge threshold) but no JSONL and the paste was never confirmed.
  if (!turnProducedOutput && idleMs < t.wedgeRecoverMs) {
    if (
      elapsedMs >= t.elapsedWedgeRecoverMs &&
      !strandRecoveryInFlight &&
      !promptSubmissionConfirmed
    ) {
      return {
        action: "recover",
        kind: "elapsed-wedge",
        basisMs: elapsedMs,
        notifyUserSeconds: Math.round(elapsedMs / 1000),
      };
    }
    // else: fall through to the idle thresholds below.
  }

  if (idleMs < t.idleWarnMs) return { action: "none" };
  if (idleMs >= t.idleRecoverMs && !strandRecoveryInFlight) {
    return { action: "recover", kind: "idle", basisMs: idleMs };
  }
  return { action: "warn", kind: "stranded" };
}
