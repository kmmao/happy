import { useMemo } from "react";
import { Message } from "@/sync/typesMessage";
import { parseMarkdown } from "@/components/markdown/parseMarkdown";

/**
 * Extracts options from AI responses in the message list.
 *
 * When anchorIndex is -1 (default): extracts from the latest AI turn.
 * When anchorIndex >= 0: extracts from the AI turn that follows the
 * user message at that index (in the inverted list, "follows" means
 * lower indices = visually below = AI response to that user message).
 *
 * Returns an empty array if no options are found.
 */
export function useLatestOptions(
  messages: Message[],
  anchorIndex = -1,
): string[] {
  return useMemo(() => {
    if (messages.length === 0) return [];

    if (anchorIndex >= 0) {
      // Navigate mode: find options in AI messages between this user
      // message and the previous one (lower index = newer in inverted list)
      for (let i = anchorIndex - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.kind === "user-text") break;
        if (msg.kind === "agent-text") {
          const blocks = parseMarkdown(msg.text);
          const optionsBlock = blocks.find((b) => b.type === "options");
          if (optionsBlock && optionsBlock.type === "options") {
            return optionsBlock.items;
          }
        }
      }
      return [];
    }

    // Default: search the latest AI turn for options.
    // If the latest message is user-text, also look at the previous AI turn
    // so that options remain accessible after the user sends a message
    // (they may not have picked an option yet).
    let seenUserText = false;
    for (const msg of messages) {
      if (msg.kind === "user-text") {
        if (seenUserText) break; // stop at the second user-text
        seenUserText = true;
        continue;
      }
      if (msg.kind === "agent-text") {
        const blocks = parseMarkdown(msg.text);
        const optionsBlock = blocks.find((b) => b.type === "options");
        if (optionsBlock && optionsBlock.type === "options") {
          return optionsBlock.items;
        }
      }
    }
    return [];
  }, [messages, anchorIndex]);
}
