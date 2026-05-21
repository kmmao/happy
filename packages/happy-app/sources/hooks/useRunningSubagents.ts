/**
 * Derives the list of sub-agents (Agent/Task tool calls) that are currently
 * running in this session, so the floating BackgroundTaskBar can surface them
 * alongside Bash background tasks.
 *
 * Why this exists: backgroundTaskEntries only tracks Bash `run_in_background`
 * tasks (those emitting task-start / task-progress / task-end via SDK events).
 * Sub-agents launched through the Agent/Task tool live in the regular message
 * stream as sidechain tool-calls, so the bar never saw them — even when one
 * had been spinning for minutes the user got no top-level signal.
 *
 * This hook walks the rendered message tree (including children, since
 * sub-agents themselves can spawn nested sub-agents) and collects any
 * tool-call whose lifecycle status is "running" (see utils/subagentStatus).
 */

import * as React from "react";
import { Message } from "@/sync/typesMessage";
import { getSubagentStatus } from "@/utils/subagentStatus";

export type RunningSubagent = {
    readonly kind: "subagent";
    /** tool.id — stable across reducer reruns, used for chip key */
    readonly toolUseId: string;
    /** outer message id — used to scroll the chat list to the agent card */
    readonly messageId: string;
    /** Display name. From input.subagent_type if present, else tool.name. */
    readonly subagentType: string;
    /** Short description from input.description, if any. */
    readonly description: string;
    /** When the sub-agent appeared in the timeline. */
    readonly startedAt: number;
};

const EMPTY: readonly RunningSubagent[] = [];

export function useRunningSubagents(
    messages: readonly Message[],
    isConnected: boolean = true,
): readonly RunningSubagent[] {
    return React.useMemo(() => {
        if (!isConnected) return EMPTY;
        const result: RunningSubagent[] = [];

        const visit = (msg: Message): void => {
            if (msg.kind !== "tool-call") return;
            // Use the shared status helper so "what counts as running" is
            // defined in one place (utils/subagentStatus). Non-sub-agent
            // tools return null and fall through to the recursion below.
            if (getSubagentStatus(msg.tool) === "running") {
                const input = (msg.tool.input ?? {}) as Record<string, unknown>;
                const subagentType =
                    typeof input.subagent_type === "string" && input.subagent_type.length > 0
                        ? input.subagent_type
                        : msg.tool.name;
                const inputDescription =
                    typeof input.description === "string" ? input.description : "";
                const toolDescription =
                    typeof msg.tool.description === "string" ? msg.tool.description : "";
                const description = inputDescription || toolDescription;
                // tool.id may be undefined for locally-synthesized tool calls
                // (e.g. permission-request stubs); fall back to message id which
                // is always present and unique enough for React key usage.
                const toolUseId = msg.tool.id ?? msg.id;
                result.push({
                    kind: "subagent",
                    toolUseId,
                    messageId: msg.id,
                    subagentType,
                    description,
                    startedAt: msg.tool.startedAt ?? msg.tool.createdAt,
                });
            }
            // Recurse — sub-agents can nest, and an inner Agent may still be
            // running while its parent is also marked running.
            for (const child of msg.children) visit(child);
        };

        for (const m of messages) visit(m);

        if (result.length === 0) return EMPTY;
        return result;
    }, [messages, isConnected]);
}
