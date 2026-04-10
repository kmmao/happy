/**
 * Extracted helper functions for the message reducer.
 * These functions handle deeply nested permission and sidechain processing
 * to keep the main reducer function's nesting depth manageable.
 */

import { ToolCall } from "../typesMessage";
import { AgentEvent } from "../typesRaw";
import { MessageMeta } from "../typesMessageMeta";

export type ReducerMessage = {
    id: string;
    realID: string | null;
    createdAt: number;
    role: "user" | "agent";
    text: string | null;
    isThinking?: boolean;
    taskStatus?: {
        status: "start" | "progress" | "completed" | "failed" | "stopped";
        summary: string;
        metrics: string | null;
    };
    event: AgentEvent | null;
    tool: ToolCall | null;
    meta?: MessageMeta;
};

export type StoredPermission = {
    tool: string;
    arguments: any;
    createdAt: number;
    completedAt?: number;
    status: "pending" | "approved" | "denied" | "canceled";
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: "approved" | "approved_for_session" | "denied" | "abort";
};

export type ReducerMaps = {
    toolIdToMessageId: Map<string, string>;
    sidechainToolIdToMessageId: Map<string, string>;
    permissions: Map<string, StoredPermission>;
    messages: Map<string, ReducerMessage>;
};

let _idCounter = 0;
export function allocateId(): string {
    return Math.random().toString(36).substring(2, 15);
}

/**
 * Apply permission data from a tool result onto a ToolCall's permission field.
 * This pattern is repeated in Phase 3 (main) and Phase 4 (sidechain) processing.
 */
export function applyPermissionFromToolResult(
    tool: ToolCall,
    toolUseId: string,
    permissions: {
        result: string;
        date?: number;
        mode?: string;
        allowedTools?: string[];
        decision?: "approved" | "approved_for_session" | "denied" | "abort";
    },
): void {
    const status = permissions.result === "approved" ? "approved" : "denied" as const;
    if (tool.permission) {
        const existingDecision = tool.permission.decision;
        tool.permission = {
            ...tool.permission,
            id: toolUseId,
            status,
            date: permissions.date,
            mode: permissions.mode,
            allowedTools: permissions.allowedTools,
            decision: permissions.decision || existingDecision,
        };
    } else {
        tool.permission = {
            id: toolUseId,
            status,
            date: permissions.date,
            mode: permissions.mode,
            allowedTools: permissions.allowedTools,
            decision: permissions.decision,
        };
    }
}

/**
 * Update an existing tool message with completed permission data from AgentState.
 * Returns true if the message was changed.
 */
export type CompletedPermission = {
    tool: string;
    arguments: any;
    createdAt?: number | null;
    completedAt?: number | null;
    status: "canceled" | "denied" | "approved";
    reason?: string | null;
    mode?: string | null;
    allowedTools?: string[] | null;
    decision?: "approved" | "approved_for_session" | "denied" | "abort" | null;
    answers?: Record<string, string> | null;
};

export function updateMessageWithCompletedPermission(
    message: ReducerMessage,
    permId: string,
    completed: CompletedPermission,
): boolean {
    const tool = message.tool;
    if (!tool) return false;

    // Skip if tool has already started actual execution with approval
    if (tool.startedAt && tool.permission?.status === "approved") {
        return false;
    }

    // Skip if permission already has date (came from tool result - preferred over agentState)
    if (tool.permission?.date) {
        return false;
    }

    // Check if we need to update ANY field
    const needsUpdate =
        tool.permission?.status !== completed.status ||
        tool.permission?.reason !== completed.reason ||
        tool.permission?.mode !== completed.mode ||
        tool.permission?.allowedTools !== completed.allowedTools ||
        tool.permission?.decision !== completed.decision ||
        tool.permission?.answers !== completed.answers;

    if (!needsUpdate) return false;

    // Update permission status
    if (!tool.permission) {
        tool.permission = {
            id: permId,
            status: completed.status,
            mode: completed.mode || undefined,
            allowedTools: completed.allowedTools || undefined,
            decision: completed.decision || undefined,
            reason: completed.reason || undefined,
            answers: completed.answers || undefined,
        };
    } else {
        tool.permission.status = completed.status;
        tool.permission.mode = completed.mode || undefined;
        tool.permission.allowedTools = completed.allowedTools || undefined;
        tool.permission.decision = completed.decision || undefined;
        if (completed.reason) {
            tool.permission.reason = completed.reason;
        }
        if (completed.answers) {
            tool.permission.answers = completed.answers;
        }
    }

    // Update tool state based on permission status
    if (completed.status === "approved") {
        if (
            tool.state !== "completed" &&
            tool.state !== "error" &&
            tool.state !== "running"
        ) {
            tool.state = "running";
        }
    } else if (tool.state !== "error" && tool.state !== "completed") {
        // denied or canceled
        tool.state = "error";
        tool.completedAt = completed.completedAt || Date.now();
        if (!tool.result && completed.reason) {
            tool.result = { error: completed.reason };
        }
    }

    return true;
}

/**
 * Create a StoredPermission from a completed request.
 */
export function createStoredPermission(
    completed: CompletedPermission & { status: StoredPermission["status"] },
): StoredPermission {
    return {
        tool: completed.tool,
        arguments: completed.arguments,
        createdAt: completed.createdAt || Date.now(),
        completedAt: completed.completedAt || undefined,
        status: completed.status,
        reason: completed.reason || undefined,
        mode: completed.mode || undefined,
        allowedTools: completed.allowedTools || undefined,
        decision: completed.decision || undefined,
    };
}

/**
 * Process a tool-result content block within a sidechain, updating both the
 * sidechain tool message and the main permission message if they exist.
 * Returns set of changed message IDs.
 */
export function processSidechainToolResult(
    maps: ReducerMaps,
    c: { type: "tool-result"; tool_use_id: string; is_error: boolean; content: any; permissions?: any },
    msgCreatedAt: number,
): Set<string> {
    const changedIds = new Set<string>();

    // Update the sidechain tool message
    const sidechainMessageId = maps.sidechainToolIdToMessageId.get(c.tool_use_id);
    if (sidechainMessageId) {
        const sidechainMessage = maps.messages.get(sidechainMessageId);
        if (sidechainMessage?.tool?.state === "running") {
            sidechainMessage.tool.state = c.is_error ? "error" : "completed";
            sidechainMessage.tool.result = c.content;
            sidechainMessage.tool.completedAt = msgCreatedAt;
            if (c.permissions) {
                applyPermissionFromToolResult(sidechainMessage.tool, c.tool_use_id, c.permissions);
            }
        }
    }

    // Also update the main permission message if it exists
    const permissionMessageId = maps.toolIdToMessageId.get(c.tool_use_id);
    if (permissionMessageId) {
        const permissionMessage = maps.messages.get(permissionMessageId);
        if (permissionMessage?.tool?.state === "running") {
            permissionMessage.tool.state = c.is_error ? "error" : "completed";
            permissionMessage.tool.result = c.content;
            permissionMessage.tool.completedAt = msgCreatedAt;
            if (c.permissions) {
                applyPermissionFromToolResult(permissionMessage.tool, c.tool_use_id, c.permissions);
            }
            changedIds.add(permissionMessageId);
        }
    }

    return changedIds;
}

/**
 * Extract compact model usage data from a ready event's modelUsage field.
 * Returns { maxContextWindow, compactModelUsage } or undefined fields if not present.
 */
export function extractSdkResultData(
    modelUsage?: Record<string, any>,
): {
    maxContextWindow: number | undefined;
    compactModelUsage: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
    }> | undefined;
} {
    if (!modelUsage) {
        return { maxContextWindow: undefined, compactModelUsage: undefined };
    }

    const maxContextWindow = Math.max(
        0,
        ...Object.values(modelUsage).map(
            (m: { contextWindow: number }) => m.contextWindow,
        ),
    );

    const compactModelUsage = Object.fromEntries(
        Object.entries(modelUsage).map(([key, val]) => [
            key,
            {
                inputTokens: (val as { inputTokens: number }).inputTokens,
                outputTokens: (val as { outputTokens: number }).outputTokens,
                cacheReadInputTokens:
                    (val as { cacheReadInputTokens: number }).cacheReadInputTokens ?? 0,
                cacheCreationInputTokens:
                    (val as { cacheCreationInputTokens: number }).cacheCreationInputTokens ?? 0,
                costUSD: (val as { costUSD: number }).costUSD,
                contextWindow: (val as { contextWindow: number }).contextWindow,
            },
        ]),
    );

    return { maxContextWindow, compactModelUsage };
}
