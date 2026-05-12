import type { Metadata } from "@/api/types";
import { didChecklistTransitionToCompleted } from "@/utils/progressAutomation";
import {
  buildProgressStateFromLists,
  capProgressLists,
} from "@/utils/progressState";

type ProgressState = Metadata["progress"];
type ProgressCarrier = {
  progress?: ProgressState;
};

type ProgressList = NonNullable<NonNullable<ProgressState>["lists"]>[number];
type ProgressTodo = ProgressList["todos"][number];

export type CodexPlanStep = {
  title?: string | null;
  step?: string | null;
  status?: string | null;
};

export function getCodexPlanListId(turnId: string): string {
  return `codex-turn:${turnId}`;
}

function normalizeCodexPlanStatus(
  status: string | null | undefined,
): ProgressTodo["status"] {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "completed") {
    return "completed";
  }
  if (
    normalized === "in_progress" ||
    normalized === "inprogress" ||
    normalized === "in-progress"
  ) {
    return "in_progress";
  }
  if (normalized === "inprogress" || normalized === "inProgress") {
    return "in_progress";
  }
  return "pending";
}

function normalizeCodexPlanTodos(
  plan: readonly CodexPlanStep[],
): ProgressTodo[] {
  return plan
    .map((step) => {
      const content =
        (typeof step.title === "string" && step.title.trim().length > 0
          ? step.title.trim()
          : null) ??
        (typeof step.step === "string" && step.step.trim().length > 0
          ? step.step.trim()
          : null);

      if (!content) {
        return null;
      }

      return {
        content,
        status: normalizeCodexPlanStatus(step.status),
      } satisfies ProgressTodo;
    })
    .filter((todo): todo is ProgressTodo => todo !== null);
}

function deriveLabel(todos: readonly ProgressTodo[]): string | undefined {
  return todos[0]?.content;
}

type MirrorCodexPlanArgs = {
  turnId: string;
  plan: readonly CodexPlanStep[];
  now?: number;
};

export function mirrorCodexPlanToProgress<T extends ProgressCarrier>(
  metadata: T,
  args: MirrorCodexPlanArgs,
): {
  metadata: T & ProgressCarrier;
  wroteProgress: boolean;
  shouldTriggerAutoSummary: boolean;
} {
  const todos = normalizeCodexPlanTodos(args.plan);
  if (todos.length === 0) {
    return {
      metadata,
      wroteProgress: false,
      shouldTriggerAutoSummary: false,
    };
  }

  const now = args.now ?? Date.now();
  const targetId = getCodexPlanListId(args.turnId);
  const prior = metadata.progress;
  const lists = prior?.lists ? [...prior.lists] : [];
  const currentId = prior?.currentListId;
  const currentIdx = currentId
    ? lists.findIndex((list) => list.id === currentId)
    : -1;
  const targetIdx = lists.findIndex((list) => list.id === targetId);
  const label = deriveLabel(todos);

  let nextLists = lists;
  let shouldTriggerAutoSummary = false;

  if (targetIdx >= 0) {
    const target = lists[targetIdx]!;
    shouldTriggerAutoSummary = didChecklistTransitionToCompleted({
      priorTodos: target.todos,
      nextTodos: todos,
      alreadyGenerated: target.summaryGeneratedAt !== undefined,
    });
    nextLists = lists.map((list, index) => {
      if (index !== targetIdx) {
        return list;
      }
      const firstChanged =
        !!todos[0] &&
        !!list.todos[0] &&
        todos[0].content !== list.todos[0].content;
      return {
        ...list,
        todos,
        updatedAt: now,
        label: firstChanged ? label : (list.label ?? label),
        summaryGeneratedAt: shouldTriggerAutoSummary
          ? now
          : list.summaryGeneratedAt,
      };
    });
  } else {
    if (currentIdx >= 0) {
      nextLists = lists.map((list, index) =>
        index === currentIdx ? { ...list, archivedAt: now } : list,
      );
    }
    nextLists = [
      ...nextLists,
      {
        id: targetId,
        label,
        todos,
        startedAt: now,
        updatedAt: now,
      },
    ];
  }

  nextLists = capProgressLists(nextLists);

  return {
    wroteProgress: true,
    shouldTriggerAutoSummary,
    metadata: {
      ...metadata,
      progress: buildProgressStateFromLists({
        lists: nextLists,
        currentListId: targetId,
        updatedAt: now,
        fallbackTodos: todos,
      }),
    },
  };
}

type AppendToolCallArgs = {
  turnId: string;
  toolCallId: string;
  now?: number;
};

export function appendCodexToolCallIdToPlanList<T extends ProgressCarrier>(
  metadata: T,
  args: AppendToolCallArgs,
): T & ProgressCarrier {
  const prior = metadata.progress;
  const lists = prior?.lists;
  if (!lists || lists.length === 0) {
    return metadata;
  }

  const targetId = getCodexPlanListId(args.turnId);
  const targetIdx = lists.findIndex((list) => list.id === targetId);
  if (targetIdx < 0) {
    return metadata;
  }

  const target = lists[targetIdx]!;
  const existingToolCallIds = target.toolCallIds ?? [];
  if (existingToolCallIds.includes(args.toolCallId)) {
    return metadata;
  }

  const now = args.now ?? Date.now();
  const nextLists = lists.map((list, index) =>
    index === targetIdx
      ? {
          ...list,
          toolCallIds: [...existingToolCallIds, args.toolCallId],
          updatedAt: now,
        }
      : list,
  );

  return {
    ...metadata,
    progress: buildProgressStateFromLists({
      lists: nextLists,
      currentListId: prior?.currentListId,
      updatedAt: now,
      fallbackTodos: prior?.todos,
      fallbackCurrentStage: prior?.currentStage,
      fallbackBlockers: prior?.blockers,
    }),
  };
}
