/**
 * Sub-agent (Agent / Task tool-call) lifecycle status.
 *
 * Modeled on the Unix process state machine so the vocabulary maps cleanly
 * onto how operators already think about long-running children:
 *
 *  • running — the sub-agent is still executing. Reducer reports
 *      `tool.state === "running"`. This is the only state that should
 *      surface in BackgroundTaskBar's "what's still in flight" panel.
 *
 *  • exited  — the sub-agent has terminated and the parent has a usable
 *      exit status. Covers both the normal-completion case
 *      (`state === "completed" && result != null`) and the explicit
 *      failure case (`state === "error"`). The caller can dig into the
 *      ToolCall to distinguish success vs. error; for status-row display
 *      the existing `succeeded` / `failed` labels remain accurate.
 *
 *  • zombie  — the sub-agent has terminated but the parent never received
 *      a reapable status: `state === "completed"` with `result == null`.
 *      In practice this is what we saw with the 40 ms Explore crash —
 *      the sidechain died inside the harness's dispatch/schema phase
 *      before emitting anything, yet the reducer flipped to "completed".
 *      Showing this as success is misleading; callers should surface it
 *      as a distinct failure-ish state (we use the `noResult` label and
 *      the error color in ToolSimpleContent).
 *
 * Errors elsewhere in the stack — wrong tool name, malformed ToolCall —
 * should NOT silently fall into one of these buckets. `getSubagentStatus`
 * returns `null` for non-sub-agent tools so callers must opt in
 * explicitly via `isSubagentTool` first.
 */

import { ToolCall } from "@/sync/typesMessage";

export type SubagentStatus = "running" | "exited" | "zombie";

/** Sub-agents arrive under two tool names depending on the CLI / Codex path. */
export function isSubagentTool(tool: ToolCall): boolean {
    return tool.name === "Agent" || tool.name === "Task";
}

/**
 * Derive the sub-agent lifecycle status from a ToolCall.
 *
 * Returns `null` for tools that are not sub-agents — callers should
 * branch on this rather than coercing every Bash call into "exited".
 */
export function getSubagentStatus(tool: ToolCall): SubagentStatus | null {
    if (!isSubagentTool(tool)) return null;
    if (tool.state === "running") return "running";
    // `completed` with no payload is the zombie case: the child died
    // before publishing anything the parent can act on.
    if (tool.state === "completed" && tool.result == null) return "zombie";
    // Everything else — completed-with-result or explicit error — is a
    // normal terminated process the parent has reaped.
    return "exited";
}

// ---------------------------------------------------------------------------
// State machine — explicit transitions with validation
// ---------------------------------------------------------------------------
//
// Derivation from a ToolCall (above) is one half of the story — it answers
// "what state is the SDK reporting right now?". For ad-hoc tracking
// (tests, future runtime accounting, anywhere we want to walk the lifecycle
// without an SDK ToolCall in hand) we also expose the state machine itself:
//
//                         ┌──────┐
//                  ┌──────┤ exited
//                  │      └──────┘ (absorbing)
//   ┌─────────┐ ──┤
//   │ running │   │      ┌──────┐
//   └─────────┘ ──┴──────┤ zombie
//                        └──────┘ (absorbing)
//
// `running` is the only state with outgoing transitions. Once the sub-agent
// has terminated — whether cleanly (`exited`) or as the no-output crash case
// (`zombie`) — there's nowhere left to go; resurrecting a finished sub-agent
// is not a thing the SDK models, so neither do we.

/** Immutable container that pairs a status with the timestamp it was entered. */
export interface SubagentStateContainer {
    readonly status: SubagentStatus;
    /** Epoch milliseconds when `status` was entered. Useful for elapsed-time UI. */
    readonly enteredAt: number;
}

/** Pure predicate over the transition table. `false` is the safe answer. */
export function canTransitionSubagentStatus(
    from: SubagentStatus,
    to: SubagentStatus,
): boolean {
    if (from === "running") {
        return to === "exited" || to === "zombie";
    }
    // Terminal states have no outgoing edges, including no self-loop.
    return false;
}

/** Read the current status out of a container. Counterpart of `setSubagentState`. */
export function getSubagentState(container: SubagentStateContainer): SubagentStatus {
    return container.status;
}

/**
 * Transition to `next`, returning a fresh container. Throws on an illegal
 * transition rather than silently no-op'ing — silent illegal transitions
 * tend to mask reducer bugs.
 *
 * The original `container` is never mutated; callers should treat the
 * return value as canonical.
 *
 * @param now Epoch milliseconds for `enteredAt`. Optional so tests can pin
 *            the clock; defaults to `Date.now()`.
 */
export function setSubagentState(
    container: SubagentStateContainer,
    next: SubagentStatus,
    now: number = Date.now(),
): SubagentStateContainer {
    if (!canTransitionSubagentStatus(container.status, next)) {
        throw new Error(
            `Illegal SubagentStatus transition: ${container.status} → ${next}`,
        );
    }
    return { status: next, enteredAt: now };
}
