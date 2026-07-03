/**
 * Pure decision logic for the supervisor-role AgentLoop status × phase
 * machine (the loop cycles analyzing → deciding → fixing → analyzing …).
 *
 * ADR-0047 confirmed the engine / autoLoop / scheduler split is intentional
 * and `checkExitConditions` is already a centralized pure policy — this
 * module does NOT touch that split. What it owns is the OTHER half the
 * engine previously re-derived inline at 10+ sites: which (status, phase)
 * states a progression event may act from (the gates), and which
 * compare-and-swap conditions guard each transition (the optimistic-locking
 * rules the engine's header comment promises). Callers spread each decision
 * into ONE atomic updateMany; they must not re-derive `allowedFrom` inline.
 */

export type SupervisorLoopStatus =
    | "running"
    | "paused"
    | "completed"
    | "stopped";

export type SupervisorLoopPhase =
    | "analyzing"
    | "deciding"
    | "fixing"
    | "idle";

/**
 * Statuses that make a loop "active" — it holds the per-project mutual
 * exclusion (no second loop may start) and may still be stopped/completed.
 */
export const ACTIVE_LOOP_STATUSES = ["running", "paused"] as const;

/** Run statuses that hold the same mutual exclusion for one-off runs. */
export const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

/** The state a freshly started loop begins in. */
export const INITIAL_LOOP_STATE = {
    status: "running",
    currentPhase: "analyzing",
    currentIteration: 1,
} as const;

/** A run-completed report only progresses a loop that is actually running. */
export function canProgressAfterRun(loop: { status: string }): boolean {
    return loop.status === "running";
}

/**
 * A fix-completed report only progresses a loop that is running AND in the
 * fixing phase — a stale callback arriving after pause/stop/next-iteration
 * must be a no-op. The per-iteration fix watchdog acts under the SAME rule
 * (it force-fails fixes on behalf of missing callbacks), so it shares this
 * gate rather than re-deriving it.
 */
export function canProgressAfterFix(loop: {
    status: string;
    currentPhase: string;
}): boolean {
    return loop.status === "running" && loop.currentPhase === "fixing";
}

/**
 * On resume, a loop paused BETWEEN steps (deciding/idle) must be pushed
 * forward explicitly; a loop paused mid-run/mid-fix resumes naturally when
 * that run/fix completes (the progression handlers check for "running").
 */
export function shouldDecideOnResume(currentPhase: string): boolean {
    return currentPhase === "deciding" || currentPhase === "idle";
}

/** One optimistic-locking transition: CAS guard + the fields it writes. */
export type LoopTransitionDecision<From, Data> = {
    /** Status value(s) the CAS `where` must match for the write to apply. */
    allowedFrom: From;
    /** The status/phase fields of the transition (callers may add metrics). */
    data: Data;
};

export function decidePauseTransition(): LoopTransitionDecision<
    "running",
    { status: "paused" }
> {
    return { allowedFrom: "running", data: { status: "paused" } };
}

export function decideResumeTransition(): LoopTransitionDecision<
    "paused",
    { status: "running" }
> {
    return { allowedFrom: "paused", data: { status: "running" } };
}

export function decideStopTransition(): LoopTransitionDecision<
    readonly SupervisorLoopStatus[],
    { status: "stopped"; exitReason: "user_stopped" }
> {
    return {
        allowedFrom: ACTIVE_LOOP_STATUSES,
        data: { status: "stopped", exitReason: "user_stopped" },
    };
}

/**
 * Entering the fixing phase (auto-approved actions are about to be
 * dispatched) — only a running loop may advance its phase.
 */
export function decideEnterFixingTransition(): LoopTransitionDecision<
    "running",
    { currentPhase: "fixing" }
> {
    return { allowedFrom: "running", data: { currentPhase: "fixing" } };
}

/** Starting the next iteration's analysis — same running-only CAS. */
export function decideEnterAnalyzingTransition(
    nextIteration: number,
): LoopTransitionDecision<
    "running",
    { currentPhase: "analyzing"; currentIteration: number }
> {
    return {
        allowedFrom: "running",
        data: { currentPhase: "analyzing", currentIteration: nextIteration },
    };
}

/**
 * Terminal completion — applies from running OR paused (a paused loop whose
 * last fix lands still completes), parks the phase at idle, and stamps the
 * exit reason.
 */
export function decideCompleteTransition<R extends string>(
    reason: R,
): LoopTransitionDecision<
    readonly SupervisorLoopStatus[],
    { status: "completed"; currentPhase: "idle"; exitReason: R }
> {
    return {
        allowedFrom: ACTIVE_LOOP_STATUSES,
        data: { status: "completed", currentPhase: "idle", exitReason: reason },
    };
}
