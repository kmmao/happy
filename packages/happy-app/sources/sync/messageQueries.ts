import type { Message } from "@/sync/typesMessage";

/**
 * Pure predicates over a Session's Message tree.
 *
 * These encode domain rules about the conversation that more than one feature
 * asks — kept here, once, so the rule cannot drift between call sites (this file
 * exists because {@link hasPendingAskUserQuestion} was copy-pasted into both
 * SessionView and the AutoOptionSend service).
 */

/**
 * Whether the message tree contains an AskUserQuestion tool call that is still
 * awaiting the Account's answer (running + pending permission). Recurses into
 * Subagent children. Used to gate AutoOptionSend (don't auto-answer a question
 * the user is being asked) and the SessionView composer affordances.
 */
export function hasPendingAskUserQuestion(messages: readonly Message[]): boolean {
    for (const msg of messages) {
        if (msg.kind === "tool-call") {
            if (
                msg.tool.name === "AskUserQuestion" &&
                msg.tool.state === "running" &&
                msg.tool.permission?.status === "pending"
            ) {
                return true;
            }
            if (msg.children.length > 0 && hasPendingAskUserQuestion(msg.children)) {
                return true;
            }
        }
    }
    return false;
}
