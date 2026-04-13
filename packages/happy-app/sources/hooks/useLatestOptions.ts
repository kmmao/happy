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

const EXIT_PLAN_TOOL_NAMES = new Set(["ExitPlanMode", "exit_plan_mode"]);

/** Try to extract options from a markdown string. */
function extractOptionsFromMarkdown(
  text: string,
): string[] | null {
  const blocks = parseMarkdown(text);
  const optionsBlock = blocks.find((b) => b.type === "options");
  if (optionsBlock && optionsBlock.type === "options" && optionsBlock.items.length > 0) {
    return optionsBlock.items;
  }
  return null;
}

/** Try to extract options from a tool-call message (e.g. ExitPlanMode plan field). */
function extractOptionsFromToolCall(
  msg: Message,
): string[] | null {
  if (msg.kind !== "tool-call") return null;
  if (!EXIT_PLAN_TOOL_NAMES.has(msg.tool.name)) return null;
  const plan = msg.tool.input?.plan;
  if (typeof plan !== "string") return null;
  return extractOptionsFromMarkdown(plan);
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
        const items = extractOptionsFromMarkdown(msg.text);
        if (items) {
          return { sourceMessageId: msg.id, items };
        }
      }
      // Check ExitPlanMode tool input for embedded options
      const toolItems = extractOptionsFromToolCall(msg);
      if (toolItems) {
        return { sourceMessageId: msg.id, items: toolItems };
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
      const items = extractOptionsFromMarkdown(msg.text);
      if (items) {
        return { sourceMessageId: msg.id, items };
      }
    }
    // Check ExitPlanMode tool input for embedded options
    const toolItems = extractOptionsFromToolCall(msg);
    if (toolItems) {
      return { sourceMessageId: msg.id, items: toolItems };
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
 *
 * Also checks ExitPlanMode tool inputs for embedded <options> blocks,
 * so plan proposals in YOLO mode surface interactive follow-up options.
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
