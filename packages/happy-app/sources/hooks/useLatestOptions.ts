import { useMemo } from "react";
import { Message } from "@/sync/typesMessage";
import { parseMarkdown } from "@/components/markdown/parseMarkdown";

export interface LatestOptionsResult {
  sourceMessageId: string | null;
  items: string[];
}

function emptyResult(): LatestOptionsResult {
  return {
    sourceMessageId: null,
    items: [],
  };
}

export function extractLatestOptions(
  messages: Message[],
  anchorIndex = -1,
): LatestOptionsResult {
  if (messages.length === 0) return emptyResult();

  if (anchorIndex >= 0) {
    for (let i = anchorIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.kind === "user-text") break;
      if (msg.kind === "agent-text") {
        const blocks = parseMarkdown(msg.text);
        const optionsBlock = blocks.find((b) => b.type === "options");
        if (optionsBlock && optionsBlock.type === "options") {
          return {
            sourceMessageId: msg.id,
            items: optionsBlock.items,
          };
        }
      }
    }
    return emptyResult();
  }

  let seenUserText = false;
  for (const msg of messages) {
    if (msg.kind === "user-text") {
      if (seenUserText) break;
      seenUserText = true;
      continue;
    }
    if (msg.kind === "agent-text") {
      const blocks = parseMarkdown(msg.text);
      const optionsBlock = blocks.find((b) => b.type === "options");
      if (optionsBlock && optionsBlock.type === "options") {
        return {
          sourceMessageId: msg.id,
          items: optionsBlock.items,
        };
      }
    }
  }

  return emptyResult();
}

/**
 * Extracts options from AI responses in the message list.
 *
 * When anchorIndex is -1 (default): extracts from the latest AI turn.
 * When anchorIndex >= 0: extracts from the AI turn that follows the
 * user message at that index (in the inverted list, "follows" means
 * lower indices = visually below = AI response to that user message).
 */
export function useLatestOptions(
  messages: Message[],
  anchorIndex = -1,
): LatestOptionsResult {
  return useMemo(
    () => extractLatestOptions(messages, anchorIndex),
    [messages, anchorIndex],
  );
}
