/**
 * Background-task (Bash `run_in_background` subprocess) lifecycle status.
 *
 * Parallel to utils/subagentStatus but for real OS subprocesses rather than
 * sidechain sub-agents. The four states mirror what the SDK reports through
 * task-start / task-progress / task-end and what we already store on
 * `BackgroundTaskEntry.status`:
 *
 *                       ┌─────────────┐
 *               ┌──────►│  completed  │   exit 0
 *               │       └─────────────┘
 *               │
 *   ┌─────────┐ │       ┌─────────────┐
 *   │ running │─┼──────►│   failed    │   non-zero exit
 *   └─────────┘ │       └─────────────┘
 *               │
 *               │       ┌─────────────┐
 *               └──────►│   stopped   │   user / system killed it
 *                       └─────────────┘
 *
 * `running` is the only state with outgoing edges. `completed`, `failed`,
 * and `stopped` are all absorbing — once a process has exited, even an
 * incoming kill signal can't un-exit it. Self-loops are explicitly rejected
 * so callers don't accidentally "transition" a process to its own state.
 *
 * Why not just consume `BackgroundTaskEntry.status` directly? Two reasons:
 *
 *   1. Local accounting: places that track a task's lifecycle outside the
 *      reducer (sheets that survive task end, post-hoc stats, tests
 *      simulating exit sequences) need to express transitions as first-class
 *      operations, not as ad-hoc field assignments.
 *
 *   2. Bug containment: setBackgroundTaskState throws on illegal transitions,
 *      so a `completed → running` or `stopped → failed` race surfaces as a
 *      loud error during development rather than silently corrupting UI.
 */

export type BackgroundTaskStatus =
    | "running"
    | "completed"
    | "failed"
    | "stopped";

/** Immutable container that pairs a status with the timestamp it was entered. */
export interface BackgroundTaskStateContainer {
    readonly status: BackgroundTaskStatus;
    /** Epoch milliseconds when `status` was entered. Useful for elapsed-time UI. */
    readonly enteredAt: number;
}

/** Pure predicate over the transition table. `false` is the safe answer. */
export function canTransitionBackgroundTaskStatus(
    from: BackgroundTaskStatus,
    to: BackgroundTaskStatus,
): boolean {
    if (from === "running") {
        return to === "completed" || to === "failed" || to === "stopped";
    }
    // Terminal states have no outgoing edges, including no self-loop.
    return false;
}

/** True when `status` cannot transition anywhere — used to short-circuit polling loops. */
export function isTerminalBackgroundTaskStatus(
    status: BackgroundTaskStatus,
): boolean {
    return status !== "running";
}

/** Read the current status out of a container. Counterpart of `setBackgroundTaskState`. */
export function getBackgroundTaskState(
    container: BackgroundTaskStateContainer,
): BackgroundTaskStatus {
    return container.status;
}

/**
 * Transition to `next`, returning a fresh container. Throws on an illegal
 * transition rather than silently no-op'ing — silent illegal transitions
 * tend to mask reducer bugs and produce phantom "still running" tasks.
 *
 * The original `container` is never mutated; callers should treat the
 * return value as canonical.
 *
 * @param now Epoch milliseconds for `enteredAt`. Optional so tests can pin
 *            the clock; defaults to `Date.now()`.
 */
export function setBackgroundTaskState(
    container: BackgroundTaskStateContainer,
    next: BackgroundTaskStatus,
    now: number = Date.now(),
): BackgroundTaskStateContainer {
    if (!canTransitionBackgroundTaskStatus(container.status, next)) {
        throw new Error(
            `Illegal BackgroundTaskStatus transition: ${container.status} → ${next}`,
        );
    }
    return { status: next, enteredAt: now };
}

/**
 * Validate-and-transition adapter for callers that store the lifecycle status
 * directly on a richer record (e.g. the reducer's `BackgroundTaskEntry`, which
 * pairs the status with a `startedAt` rather than an `enteredAt`).
 *
 * Returns a fresh object with `status` overwritten; the input is never mutated.
 * Throws on illegal transitions — same loud-failure contract as
 * `setBackgroundTaskState`. Use this when adopting the state machine onto an
 * existing record shape would otherwise require restructuring storage just to
 * thread a container through.
 *
 * Generic over `E` so the returned object stays typed as the caller's record.
 */
export function transitionBackgroundTaskEntry<
    E extends { readonly status: BackgroundTaskStatus },
>(entry: E, next: BackgroundTaskStatus): E {
    if (!canTransitionBackgroundTaskStatus(entry.status, next)) {
        throw new Error(
            `Illegal BackgroundTaskStatus transition: ${entry.status} → ${next}`,
        );
    }
    return { ...entry, status: next };
}
