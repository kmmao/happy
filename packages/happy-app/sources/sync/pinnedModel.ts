import type { Session } from "./storageTypes";

type ModelMappingRecord = Record<string, string> | null | undefined;

export function resolvePinnedModelIdFromSelection(
  modelMode: string | null | undefined,
  modelMappings: ModelMappingRecord,
): string | null {
  if (!modelMode || modelMode === "default") {
    return null;
  }

  return modelMappings?.[modelMode] ?? modelMode;
}
