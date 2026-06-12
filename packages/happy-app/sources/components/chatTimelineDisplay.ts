import type {
  AgentTextMessage,
  Message,
  ModeSwitchMessage,
  ToolCallMessage,
} from "@/sync/typesMessage";
import { parseLegacyCodexPlanPreview } from "./tools/codexPlanCompat";
import { parseLegacyCodexDiffPreview } from "./tools/codexDiffCompat";
import { isToolVisibleWithoutInline } from "./tools/toolVisibility";
import { summarizeHappyProgressInput } from "./tools/views/happyProgressViewData";
import type { ToolGroupItem } from "@/hooks/useGroupedMessages";

export interface TurnTimelineThinkingStep {
  readonly kind: "thinking";
  readonly message: AgentTextMessage;
}

export interface TurnTimelineToolStep {
  readonly kind: "tool-call";
  readonly message: ToolCallMessage;
}

export type TurnTimelineStep =
  | TurnTimelineThinkingStep
  | TurnTimelineToolStep;

export interface TurnTimelineDisplayItem {
  readonly kind: "turn-timeline";
  readonly id: string;
  readonly readyMessage: ModeSwitchMessage;
  readonly steps: readonly TurnTimelineStep[];
}

export interface TurnStartSeparatorItem {
  readonly kind: "turn-start-separator";
  readonly id: string;
}

export function isTurnStartSeparator(item: ChatDisplayItem): item is TurnStartSeparatorItem {
  return (item as TurnStartSeparatorItem).kind === "turn-start-separator";
}

export type ChatDisplayItem = Message | TurnTimelineDisplayItem | TurnStartSeparatorItem;

export interface CollapsedTimelineSteps {
  readonly visibleSteps: readonly TurnTimelineStep[];
  readonly hiddenCount: number;
  readonly didCollapse: boolean;
}

function isReadyMessage(message: Message): message is ModeSwitchMessage {
  return message.kind === "agent-event" && message.event.type === "ready";
}

function isThinkingMessage(message: Message): message is AgentTextMessage {
  return message.kind === "agent-text" && message.isThinking === true;
}

function isToolCallMessage(message: Message): message is ToolCallMessage {
  return message.kind === "tool-call";
}

export function isTurnTimelineDisplayItem(
  item: ChatDisplayItem,
): item is TurnTimelineDisplayItem {
  return item.kind === "turn-timeline";
}

export function collapseTurnTimelineSteps(
  steps: readonly TurnTimelineStep[],
  maxVisible = 4,
): CollapsedTimelineSteps {
  if (steps.length <= maxVisible) {
    return {
      visibleSteps: steps,
      hiddenCount: 0,
      didCollapse: false,
    };
  }

  let requiredVisible = maxVisible;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (
      step.kind === "tool-call" &&
      step.message.tool.state !== "completed"
    ) {
      requiredVisible = Math.max(requiredVisible, index + 1);
    }
  }

  const visibleCount = Math.min(requiredVisible, steps.length);
  const hiddenCount = Math.max(0, steps.length - visibleCount);

  return {
    visibleSteps: steps.slice(0, visibleCount),
    hiddenCount,
    didCollapse: hiddenCount > 0,
  };
}

type ProgressPreviewAnalysis = {
  readonly hiddenPreviewIds: Set<string>;
  readonly progressExplanationByToolId: Map<string, string>;
};

function withDerivedExplanation(
  message: ToolCallMessage,
  explanation: string | undefined,
): ToolCallMessage {
  if (!explanation) {
    return message;
  }
  return {
    ...message,
    tool: {
      ...message.tool,
      input: {
        ...(message.tool.input && typeof message.tool.input === "object"
          ? message.tool.input
          : {}),
        _derivedExplanation: explanation,
      },
    },
  };
}

function normalizeChecklistText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function shouldHidePlanPreviewForProgressTool(
  message: AgentTextMessage,
  toolMessage: ToolCallMessage,
): boolean {
  if (toolMessage.tool.name !== "mcp__happy__update_progress") {
    return false;
  }

  const preview = parseLegacyCodexPlanPreview(message.text);
  if (!preview || preview.items.length === 0) {
    return false;
  }

  const progressSummary = summarizeHappyProgressInput(toolMessage.tool.input);
  if (progressSummary.todos.length === 0) {
    return false;
  }

  const previewItems = new Set(
    preview.items.map((item) => normalizeChecklistText(item.text)),
  );
  const todoItems = new Set(
    progressSummary.todos.map((todo) => normalizeChecklistText(todo.content)),
  );

  let overlap = 0;
  for (const todo of todoItems) {
    if (previewItems.has(todo)) {
      overlap += 1;
    }
  }

  if (overlap === 0) {
    return false;
  }

  if (previewItems.size === todoItems.size && overlap === todoItems.size) {
    return true;
  }

  const focus = normalizeChecklistText(
    progressSummary.currentStage ?? progressSummary.label,
  );
  const explanation = normalizeChecklistText(preview.explanation);

  return (
    overlap >= Math.min(previewItems.size, todoItems.size) &&
    focus.length > 0 &&
    explanation.includes(focus)
  );
}

function collectRedundantProgressPreviewIds(
  messages: readonly Message[],
): ProgressPreviewAnalysis {
  const hiddenIds = new Set<string>();
  const progressExplanationByToolId = new Map<string, string>();
  let currentSegment: Message[] = [];

  const flushSegment = () => {
    if (currentSegment.length === 0) {
      return;
    }

    const progressTools = currentSegment.filter(
      (message): message is ToolCallMessage =>
        message.kind === "tool-call" &&
        message.tool.name === "mcp__happy__update_progress",
    );
    const hasReplacementProcessContent = currentSegment.some(
      (message) =>
        (message.kind === "agent-text" && message.isThinking === true) ||
        (message.kind === "tool-call" &&
          message.tool.name !== "mcp__happy__update_progress"),
    );
    const planPreviewMessages = currentSegment.filter(
      (message): message is AgentTextMessage =>
        message.kind === "agent-text" &&
        !message.isThinking &&
        parseLegacyCodexPlanPreview(message.text) !== null,
    );

    if (
      progressTools.length === 0 ||
      planPreviewMessages.length === 0 ||
      !hasReplacementProcessContent
    ) {
      currentSegment = [];
      return;
    }

    for (const previewMessage of planPreviewMessages) {
      const matchingProgressTool = progressTools.find((toolMessage) =>
        shouldHidePlanPreviewForProgressTool(previewMessage, toolMessage),
      );
      if (matchingProgressTool) {
        hiddenIds.add(previewMessage.id);
        const preview = parseLegacyCodexPlanPreview(previewMessage.text);
        const explanation = normalizeChecklistText(preview?.explanation)
          ? preview?.explanation?.trim()
          : undefined;
        if (
          explanation &&
          !progressExplanationByToolId.has(matchingProgressTool.id)
        ) {
          progressExplanationByToolId.set(matchingProgressTool.id, explanation);
        }
      }
    }

    currentSegment = [];
  };

  for (const message of messages) {
    if (message.kind === "user-text") {
      flushSegment();
      continue;
    }
    currentSegment.push(message);
  }

  flushSegment();
  return { hiddenPreviewIds: hiddenIds, progressExplanationByToolId };
}

export function buildChatDisplayItems(
  messages: readonly Message[],
  options: {
    showThinkingTimeline: boolean;
  },
): ChatDisplayItem[] {
  const analysis = collectRedundantProgressPreviewIds(messages);
  const sourceMessages = messages.map((message) => {
    if (
      message.kind === "tool-call" &&
      message.tool.name === "mcp__happy__update_progress"
    ) {
      return withDerivedExplanation(
        message,
        analysis.progressExplanationByToolId.get(message.id),
      );
    }
    return message;
  });

  if (!options.showThinkingTimeline) {
    const filtered = sourceMessages.filter(
      (message) => !analysis.hiddenPreviewIds.has(message.id),
    );
    return injectTurnStartSeparators(filtered);
  }

  const bundlesByAnchorId = new Map<string, TurnTimelineDisplayItem>();
  const skippedIds = new Set<string>();

  for (let index = 0; index < sourceMessages.length; index += 1) {
    const message = sourceMessages[index];
    if (analysis.hiddenPreviewIds.has(message.id)) {
      continue;
    }
    if (isReadyMessage(message)) {
      const timelineSteps: TurnTimelineStep[] = [];
      let anchorMessageId: string | null = null;

      for (let scan = index + 1; scan < sourceMessages.length; scan += 1) {
        const candidate = sourceMessages[scan];
        if (analysis.hiddenPreviewIds.has(candidate.id)) {
          continue;
        }
        if (candidate.kind === "user-text" || isReadyMessage(candidate)) {
          break;
        }
        if (isThinkingMessage(candidate)) {
          timelineSteps.push({ kind: "thinking", message: candidate });
          anchorMessageId = candidate.id;
          continue;
        }
        if (isToolCallMessage(candidate)) {
          timelineSteps.push({ kind: "tool-call", message: candidate });
          anchorMessageId = candidate.id;
        }
      }

      const hasThinking = timelineSteps.some((step) => step.kind === "thinking");
      const hasToolCalls = timelineSteps.some((step) => step.kind === "tool-call");

      if (hasThinking && hasToolCalls) {
        const sortedSteps = [...timelineSteps].sort(
          (left, right) => left.message.createdAt - right.message.createdAt,
        );
        skippedIds.add(message.id);
        for (const step of sortedSteps) {
          skippedIds.add(step.message.id);
        }
        if (!anchorMessageId) {
          continue;
        }
        bundlesByAnchorId.set(anchorMessageId, {
          kind: "turn-timeline",
          id: `turn-timeline:${message.id}`,
          readyMessage: message,
          steps: sortedSteps,
        });
      }
    }
  }

  const rawItems: ChatDisplayItem[] = [];
  for (const message of sourceMessages) {
    const bundle = bundlesByAnchorId.get(message.id);
    if (bundle) {
      rawItems.push(bundle);
      continue;
    }
    if (analysis.hiddenPreviewIds.has(message.id)) {
      continue;
    }
    if (skippedIds.has(message.id)) {
      continue;
    }
    rawItems.push(message);
  }

  return injectTurnStartSeparators(rawItems);
}

// Injects a separator item before each user-text message that is preceded by
// agent content (newest-first list, so "preceded" means lower array index).
// Also fixes mis-sorted ready events: when a ready event (turn-end) from the
// previous turn has a createdAt newer than the user-text that starts the next
// turn (clock skew / network delay), move it after the user-text so the stats
// visually stay with the turn they belong to.
function injectTurnStartSeparators(items: ChatDisplayItem[]): ChatDisplayItem[] {
  const result: ChatDisplayItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (
      item.kind === "user-text" &&
      i > 0
    ) {
      const prev = items[i - 1]!;
      const prevKind = (prev as ChatDisplayItem).kind;
      if (prevKind !== "user-text" && prevKind !== "turn-start-separator") {
        // A ready event immediately before a user-text with no agent content
        // in between means the ready belongs to a PREVIOUS turn but landed
        // here due to timestamp skew. Move it after the user-text.
        if (isReadyDisplayItem(prev) && !hasAgentContentBetween(items, i)) {
          const readyItem = result.pop()!;
          result.push({ kind: "turn-start-separator", id: `turn-start:${item.id}` });
          result.push(item);
          result.push(readyItem);
          continue;
        }
        result.push({ kind: "turn-start-separator", id: `turn-start:${item.id}` });
      }
    }
    result.push(item);
  }
  return result;
}

function isReadyDisplayItem(item: ChatDisplayItem): boolean {
  return item.kind === "agent-event" && (item as ModeSwitchMessage).event.type === "ready";
}

// In the newest-first array, check whether any agent content (thinking/tool-call/
// agent-text) exists between the ready event at items[userIdx-1] and the next
// older ready or user-text. If agent content exists, the ready belongs to this
// turn (normal). If not, it's a stray from a previous turn.
function hasAgentContentBetween(items: ChatDisplayItem[], userIdx: number): boolean {
  for (let j = userIdx - 2; j >= 0; j--) {
    const scan = items[j]!;
    if (scan.kind === "user-text") break;
    if (isReadyDisplayItem(scan)) break;
    if (scan.kind === "agent-text" || scan.kind === "tool-call") return true;
    if (scan.kind === "turn-timeline") return true;
  }
  return false;
}

// ─── Full render-list pipeline ──────────────────────────────────────────────
// ChatList delegates every display decision (visibility, legacy dedup, turn
// grouping, tool grouping) to this module; the component owns only
// memoization and timing. Keeping the stages here makes the whole
// Message[] → render-list contract testable without React.

export type FinalChatDisplayItem = ChatDisplayItem | ToolGroupItem;

function isToolCallVisibleWithoutInline(msg: Message): boolean {
  if (msg.kind !== "tool-call") return true;
  if (msg.tool.permission?.status === "pending") return true;
  return isToolVisibleWithoutInline(msg.tool.name);
}

// Legacy Codex streams emit the same diff preview twice as consecutive
// agent-text messages; drop the duplicate.
function dedupeLegacyCodexDiffPreviews(messages: readonly Message[]): Message[] {
  const deduped: Message[] = [];
  for (const msg of messages) {
    if (msg.kind === "agent-text") {
      const preview = parseLegacyCodexDiffPreview(msg.text);
      const lastMessage = deduped[deduped.length - 1];
      if (preview && lastMessage?.kind === "agent-text") {
        const lastPreview = parseLegacyCodexDiffPreview(lastMessage.text);
        if (
          lastPreview &&
          lastPreview.unifiedDiff === preview.unifiedDiff &&
          (lastPreview.prefixMarkdown ?? "") === (preview.prefixMarkdown ?? "")
        ) {
          continue;
        }
      }
    }
    deduped.push(msg);
  }
  return deduped;
}

/**
 * Stage 1-3 of the render list: visibility filtering (viewInline off hides
 * non-essential tool calls), legacy Codex diff dedup, then
 * {@link buildChatDisplayItems} (turn timelines + separators).
 */
export function buildVisibleChatDisplayItems(
  messages: readonly Message[],
  options: {
    viewInline: boolean;
    showThinkingTimeline: boolean;
  },
): ChatDisplayItem[] {
  const visibleMessages = options.viewInline
    ? messages
    : messages.filter(isToolCallVisibleWithoutInline);
  const dedupedMessages = dedupeLegacyCodexDiffPreviews(visibleMessages);
  return buildChatDisplayItems(dedupedMessages, {
    showThinkingTimeline: options.showThinkingTimeline,
  });
}

/**
 * Stage 4: group consecutive non-standalone messages (tool calls, thinking,
 * empty agent text) between standalone items into collapsible ToolGroupItems.
 * Turn timelines and separators flush the open group and pass through.
 */
export function groupToolCallItems(
  items: readonly ChatDisplayItem[],
): FinalChatDisplayItem[] {
  const result: FinalChatDisplayItem[] = [];
  let toolBuffer: Message[] = [];

  const flushBuffer = () => {
    if (toolBuffer.length === 0) return;
    const hasRunning = toolBuffer.some(
      (m) => m.kind === "tool-call" && m.tool.state === "running",
    );
    result.push({
      type: "tool-group",
      id: `group-${toolBuffer[toolBuffer.length - 1].id}`,
      messages: [...toolBuffer],
      hasRunning,
    });
    toolBuffer = [];
  };

  for (const item of items) {
    // Turn timeline and separator items pass through as-is
    if (isTurnTimelineDisplayItem(item) || isTurnStartSeparator(item)) {
      flushBuffer();
      result.push(item);
      continue;
    }
    // item is a Message
    const msg = item as Message;
    const isStandalone =
      msg.kind === "user-text" ||
      msg.kind === "agent-event" ||
      (msg.kind === "agent-text" && !msg.isThinking && msg.text.trim().length > 0);
    const isFileAttachment = msg.kind === "tool-call" && msg.tool.name === "file";

    if (isStandalone || isFileAttachment) {
      flushBuffer();
      result.push(item);
    } else {
      toolBuffer.push(msg);
    }
  }
  flushBuffer();
  return result;
}
