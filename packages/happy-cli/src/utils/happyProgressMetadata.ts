import { randomUUID } from "node:crypto";

import type { Metadata } from "@/api/types";
import { didChecklistTransitionToCompleted } from "@/utils/progressAutomation";
import { shouldStartNewProgressList } from "@/utils/progressListBoundary";
import {
  buildProgressStateFromLists,
  capProgressLists,
} from "@/utils/progressState";

type ProgressState = NonNullable<Metadata["progress"]>;
type ProgressList = NonNullable<ProgressState["lists"]>[number];
export type HappyProgressTodo = NonNullable<ProgressState["todos"]>[number];

export interface ApplyHappyProgressUpdateInput {
  todos: HappyProgressTodo[];
  currentStage?: string;
  blockers?: string[];
  listId?: string;
  label?: string;
  now?: number;
  createId?: () => string;
}

export interface ApplyHappyProgressUpdateResult<T extends Metadata> {
  metadata: T;
  shouldTriggerAutoSummary: boolean;
}

export function applyHappyProgressUpdate<T extends Metadata>(
  metadata: T,
  input: ApplyHappyProgressUpdateInput,
): ApplyHappyProgressUpdateResult<T> {
  const now = input.now ?? Date.now();
  const createId = input.createId ?? randomUUID;
  const prior = metadata.progress;
  const lists = prior?.lists ? [...prior.lists] : [];
  const priorCurrentId = prior?.currentListId;
  const currentIdx = priorCurrentId
    ? lists.findIndex((list) => list.id === priorCurrentId)
    : -1;
  const currentList = currentIdx >= 0 ? lists[currentIdx] : undefined;
  const implicitBoundary =
    !input.listId &&
    !!currentList &&
    shouldStartNewProgressList(currentList.todos, input.todos, {
      requirePriorCompleted: true,
    });

  let nextLists = lists;
  let targetId: string;
  let priorTargetTodos = prior?.todos ?? [];
  let priorTargetSummaryGeneratedAt: number | undefined;
  let targetCanTriggerSummary = false;

  if (input.listId === "new" || implicitBoundary) {
    if (priorCurrentId) {
      nextLists = nextLists.map((list) =>
        list.id === priorCurrentId ? { ...list, archivedAt: now } : list,
      );
    }
    targetId = createId();
    nextLists = [
      ...nextLists,
      {
        id: targetId,
        label: input.label,
        todos: input.todos,
        currentStage: input.currentStage,
        blockers: input.blockers,
        startedAt: now,
        updatedAt: now,
      },
    ];
  } else {
    const explicitIdx = input.listId
      ? nextLists.findIndex((list) => list.id === input.listId)
      : currentIdx;

    if (explicitIdx >= 0) {
      const target = nextLists[explicitIdx]!;
      targetId = target.id;
      priorTargetTodos = target.todos;
      priorTargetSummaryGeneratedAt = target.summaryGeneratedAt;
      targetCanTriggerSummary = targetId === priorCurrentId;
      nextLists = nextLists.map((list, index) =>
        index === explicitIdx
          ? {
              ...list,
              todos: input.todos,
              currentStage: input.currentStage ?? list.currentStage,
              blockers: input.blockers ?? list.blockers,
              label: input.label ?? list.label,
              updatedAt: now,
            }
          : list,
      );
    } else {
      targetId = createId();
      nextLists = [
        ...nextLists,
        {
          id: targetId,
          label: input.label,
          todos: input.todos,
          currentStage: input.currentStage,
          blockers: input.blockers,
          startedAt: now,
          updatedAt: now,
        },
      ];
    }
  }

  let shouldTriggerAutoSummary = false;
  if (
    targetCanTriggerSummary &&
    didChecklistTransitionToCompleted({
      priorTodos: priorTargetTodos,
      nextTodos: input.todos,
      alreadyGenerated: priorTargetSummaryGeneratedAt !== undefined,
    })
  ) {
    shouldTriggerAutoSummary = true;
    nextLists = nextLists.map((list) =>
      list.id === targetId ? { ...list, summaryGeneratedAt: now } : list,
    );
  }

  nextLists = capProgressLists(nextLists);

  return {
    shouldTriggerAutoSummary,
    metadata: {
      ...metadata,
      progress: buildProgressStateFromLists({
        lists: nextLists,
        currentListId: targetId,
        updatedAt: now,
        fallbackTodos: input.todos,
        fallbackCurrentStage: input.currentStage,
        fallbackBlockers: input.blockers,
      }),
    },
  };
}
