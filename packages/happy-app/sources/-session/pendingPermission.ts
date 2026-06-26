/**
 * Pending-permission resolution — pure policy extracted from SessionView.
 *
 * When a Session is in the `permission_required` state, the App must pick the
 * single permission request to surface in the permission sheet. The rule is:
 *
 *   1. Prefer `agentState.requests` — it is present even when the originating
 *      permission message has scrolled past the MAX_DISPLAY_MESSAGES pagination
 *      window, so it survives long Sessions. Within it, prefer an
 *      `AskUserQuestion` entry, else take the first entry.
 *   2. Fall back to searching the visible message tree for a tool-call whose
 *      permission is still `pending` (depth-first, parents before children).
 *
 * This lived inline in a `useMemo` with no test surface; the selection rule is
 * exactly the kind of policy that drifts. Keeping it here lets the rule be
 * tested directly against an agentState + message tree.
 */

import type { Message, ToolCall } from "@/sync/typesMessage";

export type PendingPermissionInfo = {
    toolName: string;
    toolInput: any;
    permission: NonNullable<ToolCall["permission"]>;
};

/** A single entry of `session.agentState.requests`. */
export interface AgentPermissionRequest {
    tool: string;
    arguments: unknown;
}

/** Depth-first search of the visible message tree for a pending tool permission. */
export function findPendingPermission(
    messages: readonly Message[],
): PendingPermissionInfo | null {
    for (const msg of messages) {
        if (msg.kind !== "tool-call") continue;
        const tool = msg.tool;
        if (tool.permission?.status === "pending") {
            return { toolName: tool.name, toolInput: tool.input, permission: tool.permission };
        }
        if (msg.children.length > 0) {
            const found = findPendingPermission(msg.children);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Pick the permission request to surface, following the two-step rule above.
 * Returns null when the Session is not awaiting a permission.
 */
export function resolvePendingPermission(input: {
    hasPendingPermission: boolean;
    requests: Record<string, AgentPermissionRequest> | null | undefined;
    messages: readonly Message[];
}): PendingPermissionInfo | null {
    const { hasPendingPermission, requests, messages } = input;
    if (!hasPendingPermission) return null;

    // Prefer agentState.requests — available even when the permission message
    // has scrolled past the MAX_DISPLAY_MESSAGES pagination window.
    if (requests) {
        const entries = Object.entries(requests);
        const entry =
            entries.find(([, req]) => req.tool === "AskUserQuestion") ?? entries[0];
        if (entry) {
            const [permId, req] = entry;
            return {
                toolName: req.tool,
                toolInput: req.arguments,
                permission: { id: permId, status: "pending" as const },
            };
        }
    }

    // Fallback: search the visible messages tree.
    return findPendingPermission(messages);
}
