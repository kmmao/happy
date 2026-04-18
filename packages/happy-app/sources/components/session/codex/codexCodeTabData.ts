import { type FileChange } from "@/components/session/codeChangeTypes";
import {
  extractCodexDiffFileChanges,
  extractCodexPatchFileChanges,
  hasCodexCodeToolCalls,
} from "@/components/session/codex/codexFileChangeData";
import { Metadata } from "@/sync/storageTypes";
import { ToolCallMessage } from "@/sync/typesMessage";

export interface CodexCodeTabData {
  fileChanges: FileChange[];
  source: "patch" | "diff" | "none";
}

export function hasCodexCodeData(
  toolCalls: readonly ToolCallMessage[],
): boolean {
  return hasCodexCodeToolCalls(toolCalls);
}

export function extractCodexCodeTabData(
  toolCalls: readonly ToolCallMessage[],
  metadata: Metadata | null,
): CodexCodeTabData {
  const patchChanges = extractCodexPatchFileChanges(toolCalls, metadata);
  if (patchChanges.length > 0) {
    return {
      fileChanges: patchChanges,
      source: "patch",
    };
  }

  const diffChanges = extractCodexDiffFileChanges(toolCalls, metadata);
  if (diffChanges.length > 0) {
    return {
      fileChanges: diffChanges,
      source: "diff",
    };
  }

  return {
    fileChanges: [],
    source: "none",
  };
}
