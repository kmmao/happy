import type { Metadata } from "@/api/types";

type ProgressState = Metadata["progress"];
type ProgressCarrier = {
  progress?: ProgressState;
};

type ProgressList = NonNullable<NonNullable<ProgressState>["lists"]>[number];

type AppendArgs = {
  toolCallId: string;
  now?: number;
};

function resolveCurrentListIndex(
  lists: readonly ProgressList[],
  currentListId: string | undefined,
): number {
  if (currentListId) {
    const direct = lists.findIndex((list) => list.id === currentListId);
    if (direct >= 0) {
      return direct;
    }
  }

  for (let index = lists.length - 1; index >= 0; index -= 1) {
    if (!lists[index]?.archivedAt) {
      return index;
    }
  }

  return lists.length - 1;
}

export function appendToolCallIdToCurrentProgressList<T extends ProgressCarrier>(
  metadata: T,
  args: AppendArgs,
): T & ProgressCarrier {
  const prior = metadata.progress;
  const lists = prior?.lists;
  if (!lists || lists.length === 0) {
    return metadata;
  }

  const targetIdx = resolveCurrentListIndex(lists, prior?.currentListId);
  if (targetIdx < 0) {
    return metadata;
  }

  const target = lists[targetIdx];
  if (!target) {
    return metadata;
  }

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
    progress: {
      ...prior,
      lists: nextLists,
      updatedAt: now,
    },
  };
}
