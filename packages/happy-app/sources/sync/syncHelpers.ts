import { storage } from "./storage";
import type { NormalizedMessage } from "./typesRaw";

/**
 * Heuristically determine whether the user needs to respond after a turn ends.
 *
 * Checks (in order):
 * 1. promptSuggestions / needsContinue signals from CLI
 * 2. The just-received message (passed in to avoid timing race with async enqueue)
 * 3. The most recent agent-text already in storage (fallback)
 *
 * Returns true (conservative) when no signal can be found.
 */
export function detectNeedsAttention(
    sessionId: string,
    incomingMessage: NormalizedMessage | null,
): boolean {
    const state = storage.getState();

    // CLI sent a prompt suggestion -> user should respond
    if (state.sessionPromptSuggestions[sessionId]) return true;

    // CLI signalled needs-continue (max turns reached) -> user should respond
    if (state.sessionNeedsContinue[sessionId]) return true;

    // Check the just-received message first (avoids timing race with enqueue)
    if (incomingMessage?.role === "agent") {
        for (let j = incomingMessage.content.length - 1; j >= 0; j--) {
            const block = incomingMessage.content[j];
            if (block.type === "text") {
                return textNeedsAttention(block.text);
            }
        }
    }

    // Fall back to stored messages (sorted descending: index 0 = newest)
    const sm = state.sessionMessages[sessionId];
    if (!sm?.messages?.length) return true; // no messages loaded, conservative

    for (let i = 0; i < sm.messages.length; i++) {
        const msg = sm.messages[i];
        // Skip thinking blocks -- only inspect visible assistant text
        if (msg.kind === "agent-text" && !msg.isThinking) {
            return textNeedsAttention(msg.text);
        }
        // Stop at the previous user message
        if (msg.kind === "user-text") break;
    }

    // No agent-text found, conservative
    return true;
}

/** Returns true when the text indicates the AI is asking the user something. */
export function textNeedsAttention(text: string): boolean {
    if (text.includes("<options>")) return true;
    const lastLine = text.trimEnd().split("\n").pop()?.trim() ?? "";
    if (lastLine.endsWith("?") || lastLine.endsWith("\uFF1F")) return true;
    return false;
}
