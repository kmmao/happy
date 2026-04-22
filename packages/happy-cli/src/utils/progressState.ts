import type { Metadata } from "@/api/types";

type ProgressState = NonNullable<Metadata["progress"]>;
export type ProgressList = NonNullable<ProgressState["lists"]>[number];
export type ProgressMirrorTodo = NonNullable<ProgressState["todos"]>[number];

export function resolveCurrentProgressList(
  lists: readonly ProgressList[],
  currentListId: string | undefined,
): ProgressList | undefined {
  if (currentListId) {
    const direct = lists.find((list) => list.id === currentListId);
    if (direct) {
      return direct;
    }
  }

  for (let index = lists.length - 1; index >= 0; index -= 1) {
    if (!lists[index]?.archivedAt) {
      return lists[index];
    }
  }

  return lists[lists.length - 1];
}

export function capProgressLists(
  lists: readonly ProgressList[],
  maxLists: number = 20,
): ProgressList[] {
  if (lists.length <= maxLists) {
    return [...lists];
  }

  const dropIdx = lists.findIndex((list) => list.archivedAt);
  if (dropIdx >= 0) {
    return lists.filter((_, index) => index !== dropIdx);
  }

  return lists.slice(-maxLists);
}

export function buildProgressStateFromLists(args: {
  lists: readonly ProgressList[];
  currentListId: string | undefined;
  updatedAt: number;
  fallbackTodos?: ProgressMirrorTodo[];
  fallbackCurrentStage?: string;
  fallbackBlockers?: string[];
}): ProgressState {
  const active = resolveCurrentProgressList(args.lists, args.currentListId);

  return {
    lists: [...args.lists],
    currentListId: args.currentListId,
    todos: active?.todos ?? args.fallbackTodos ?? [],
    currentStage: active?.currentStage ?? args.fallbackCurrentStage,
    blockers: active?.blockers ?? args.fallbackBlockers,
    updatedAt: args.updatedAt,
  };
}
