import type { Metadata } from "@/api/types";
import {
  buildProgressStateFromLists,
  resolveCurrentProgressList,
} from "@/utils/progressState";

type ProgressState = Metadata["progress"];
type ProgressCarrier = {
  progress?: ProgressState;
};


type AppendArgs = {
  toolCallId: string;
  now?: number;
};

export function appendToolCallIdToCurrentProgressList<T extends ProgressCarrier>(
  metadata: T,
  args: AppendArgs,
): T & ProgressCarrier {
  const prior = metadata.progress;
  const lists = prior?.lists;
  if (!lists || lists.length === 0) {
    return metadata;
  }

  const targetList = resolveCurrentProgressList(lists, prior?.currentListId);
  const targetIdx = targetList
    ? lists.findIndex((list) => list.id === targetList.id)
    : -1;
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
