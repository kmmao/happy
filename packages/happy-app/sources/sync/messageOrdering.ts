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
