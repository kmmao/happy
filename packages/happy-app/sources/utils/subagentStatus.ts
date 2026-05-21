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

// Note: there is no explicit state-machine API (container + set/get
// transition helpers) here, intentionally. Sub-agent status is purely
// derived from the underlying ToolCall on every read — we never store
// `SubagentStatus` as a mutable field anywhere. The parallel
// `BackgroundTaskEntry` *does* store its status (because BackgroundTask
// lifecycle is tracked in the reducer's own registry, separate from the
// tool-call message), which is why `backgroundTaskStatus.ts` exposes a
// container + transition adapter. If a future reducer change starts
// tracking sub-agents in their own Map<sidechainKey, SubagentEntry>
// registry, mirror the BackgroundTaskStatus shape at that point — not
// before. YAGNI.
