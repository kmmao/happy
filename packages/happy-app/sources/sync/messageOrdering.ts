import { Message } from "./typesMessage";

// Stable descending comparator for messages (the array is newest-first).
//
// The chat list renders INVERTED (see ChatList.tsx) — a HIGHER array index is
// drawn HIGHER up the screen. So to keep messages that share a `createdAt` in
// their natural reading order we rank them by kind: the kind with the LARGER
// priority number sorts toward the END of the descending array → higher index
// → nearer the top of the screen.
//
// Within a single assistant message the content order is text-then-tool_use,
// and both blocks inherit that message's `createdAt`. agent-text must therefore
// rank ABOVE (larger number than) tool-call; otherwise an AskUserQuestion /
// permission card renders above the sentence that introduced it.
//
// Resulting order, top → bottom on screen, for an identical createdAt:
//   agent-text  (3)  ← assistant prose
//   tool-call   (2)  ← tool / question cards it spawned
//   agent-event (1)  ← turn-end "ready" summary
//   user-text   (0)  ← the prompt that opened the turn
//
// The id string is the final tie-breaker to guarantee deterministic order.
export const MESSAGE_KIND_PRIORITY: Record<string, number> = {
    "user-text": 0,
    "agent-event": 1,
    "tool-call": 2,
    "agent-text": 3,
};

export function compareMessagesDesc(a: Message, b: Message): number {
    const dt = b.createdAt - a.createdAt;
    if (dt !== 0) return dt;
    const pa = MESSAGE_KIND_PRIORITY[a.kind] ?? 9;
    const pb = MESSAGE_KIND_PRIORITY[b.kind] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A session's message list paired with its id→message lookup, sorted newest-first. */
export interface SortedMessageList {
    /** Messages in descending {@link compareMessagesDesc} order (newest first). */
    messages: Message[];
    /** id → message, kept in sync with `messages`. */
    messagesMap: Record<string, Message>;
}

/**
 * Merge reducer-processed messages into an existing newest-first message list,
 * returning the next list + map.
 *
 * This concentrates the incremental-ordering strategy that the store applies on
 * every streaming update — previously duplicated, and already drifting, inside
 * two Zustand `set()` closures (the message apply path and the agentState
 * re-reduce path). The four outcomes form one invariant and live here so the
 * two call sites cannot disagree on it:
 *
 *  - **no-op** (`processedMessages` empty): the input is returned unchanged, so
 *    references are reused with zero allocation.
 *  - **in-place updates** (no new ids, not reordered): existing order is kept
 *    and only the changed message references are swapped.
 *  - **prepend batch** (new ids all at/after the newest existing message, not
 *    reordered): the new messages are sorted and prepended; the existing tail is
 *    re-mapped only if one of its messages was itself updated.
 *  - **full re-sort** (out-of-order timestamps, `reordered`, or first load):
 *    everything is re-sorted by {@link compareMessagesDesc}.
 *
 * The interface assumes two invariants the caller must uphold: `existing.messages`
 * is already newest-first sorted, and an existing message's `createdAt` is
 * immutable UNLESS `reordered` is true (which is exactly what the reducer's
 * `reordered` flag signals — e.g. re-anchoring a pending card below later prose).
 * When `reordered` is true the fast paths are bypassed for a full re-sort.
 */
export function mergeProcessedMessages(
    existing: SortedMessageList,
    processedMessages: Message[],
    reordered: boolean,
): SortedMessageList {
    // Nothing to merge — reuse the existing references entirely (zero allocation).
    if (processedMessages.length === 0) {
        return existing;
    }

    const newMessages = processedMessages.filter(
        (m) => !existing.messagesMap[m.id],
    );

    // Overlay the processed messages (new + updated) onto a fresh map copy.
    const messagesMap: Record<string, Message> = { ...existing.messagesMap };
    for (const message of processedMessages) {
        messagesMap[message.id] = message;
    }

    // Fast path: only in-place updates to existing messages — keep order, swap refs.
    if (newMessages.length === 0 && !reordered) {
        const messages = existing.messages.map((m) => messagesMap[m.id] ?? m);
        return { messages, messagesMap };
    }

    // Fast path: every new message is at/after the newest existing one — prepend
    // the sorted batch instead of re-sorting the whole list. Re-map the existing
    // tail only if one of its messages was itself updated.
    if (
        newMessages.length > 0 &&
        existing.messages.length > 0 &&
        !reordered &&
        newMessages.every(
            (m) => m.createdAt >= (existing.messages[0]?.createdAt ?? 0),
        )
    ) {
        const sortedNew = [...newMessages].sort(compareMessagesDesc);
        const tail = processedMessages.some((m) => existing.messagesMap[m.id])
            ? existing.messages.map((m) => messagesMap[m.id] ?? m)
            : existing.messages;
        return { messages: [...sortedNew, ...tail], messagesMap };
    }

    // Slow path: out-of-order timestamps, a reorder, or first load — full re-sort.
    const messages = Object.values(messagesMap).sort(compareMessagesDesc);
    return { messages, messagesMap };
}
