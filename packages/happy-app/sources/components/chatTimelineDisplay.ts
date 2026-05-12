import type {
  AgentTextMessage,
  Message,
  ModeSwitchMessage,
  ToolCallMessage,
} from "@/sync/typesMessage";
import { parseLegacyCodexPlanPreview } from "./tools/codexPlanCompat";
import { summarizeHappyProgressInput } from "./tools/views/happyProgressViewData";

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
        result.push({ kind: "turn-start-separator", id: `turn-start:${item.id}` });
      }
    }
    result.push(item);
  }
  return result;
}
