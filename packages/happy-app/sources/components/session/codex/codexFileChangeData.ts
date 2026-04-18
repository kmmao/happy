import { type FileChange } from "@/components/session/codeChangeTypes";
import {
  createFileChangeEditEntry,
  type FileChangeEditEntry,
} from "@/components/tools/fileChangeEditKey";
import {
  getCodexDiffStats,
  splitCodexUnifiedDiffByFile,
} from "@/components/tools/codexDiffUtils";
import { getCodexPatchEntries } from "@/components/tools/codexPatchUtils";
import { Metadata } from "@/sync/storageTypes";
import { ToolCallMessage } from "@/sync/typesMessage";
import { resolvePath } from "@/utils/pathUtils";

function appendFileChangeEdit(
  changeMap: Map<string, FileChange>,
  filePath: string,
  displayPath: string,
  edit: FileChangeEditEntry,
  additions: number,
  deletions: number,
): void {
  const existing = changeMap.get(filePath);
  if (existing) {
    existing.edits.push(edit);
    existing.totalAdditions += additions;
    existing.totalDeletions += deletions;
    return;
  }

  changeMap.set(filePath, {
    filePath,
    displayPath,
    edits: [edit],
    totalAdditions: additions,
    totalDeletions: deletions,
  });
}

function isCompletedToolCall(msg: ToolCallMessage, toolName: string): boolean {
  return !!msg.tool && msg.tool.name === toolName && msg.tool.state === "completed";
}

function getLatestCompletedCodexDiff(
  toolCalls: readonly ToolCallMessage[],
): ToolCallMessage | null {
  let latest: ToolCallMessage | null = null;

  for (const msg of toolCalls) {
    if (!isCompletedToolCall(msg, "CodexDiff")) {
      continue;
    }
    if (!latest) {
      latest = msg;
      continue;
    }
    const latestTime =
      latest.tool.completedAt ?? latest.tool.startedAt ?? latest.tool.createdAt;
    const nextTime = msg.tool.completedAt ?? msg.tool.startedAt ?? msg.tool.createdAt;
    if (nextTime >= latestTime) {
      latest = msg;
    }
  }

  return latest;
}

export function hasCodexCodeToolCalls(
  toolCalls: readonly ToolCallMessage[],
): boolean {
  return toolCalls.some(
    (msg) =>
      msg.tool?.name === "CodexPatch" ||
      msg.tool?.name === "CodexDiff",
  );
}

export function extractCodexPatchFileChanges(
  toolCalls: readonly ToolCallMessage[],
  metadata: Metadata | null,
): FileChange[] {
  const changeMap = new Map<string, FileChange>();

  for (const msg of toolCalls) {
    if (!isCompletedToolCall(msg, "CodexPatch")) {
      continue;
    }

    const patchEntries = getCodexPatchEntries(msg.tool.input?.changes);
    for (const [index, entry] of patchEntries.entries()) {
      if (!entry.oldText && !entry.newText) {
        continue;
      }

      const filePath = entry.path;
      const displayPath = resolvePath(filePath, metadata);
      appendFileChangeEdit(
        changeMap,
        filePath,
        displayPath,
        createFileChangeEditEntry(
          msg.id,
          "CodexPatch",
          entry.oldText,
          entry.newText,
          index,
        ),
        entry.additions,
        entry.deletions,
      );
    }
  }

  return Array.from(changeMap.values());
}

export function extractCodexDiffFileChanges(
  toolCalls: readonly ToolCallMessage[],
  metadata: Metadata | null,
): FileChange[] {
  const latestDiff = getLatestCompletedCodexDiff(toolCalls);
  const unifiedDiff =
    latestDiff && typeof latestDiff.tool.input?.unified_diff === "string"
      ? latestDiff.tool.input.unified_diff
      : null;

  if (!latestDiff || !unifiedDiff) {
    return [];
  }

  const changeMap = new Map<string, FileChange>();
  const diffFiles = splitCodexUnifiedDiffByFile(unifiedDiff);

  for (const [index, diffFile] of diffFiles.entries()) {
    if (!diffFile.fileName || (!diffFile.oldText && !diffFile.newText)) {
      continue;
    }
    const filePath = diffFile.fileName;
    const displayPath = resolvePath(filePath, metadata);
    const stats =
      getCodexDiffStats(diffFile.rawDiff) ?? {
        additions: 0,
        deletions: 0,
      };

    appendFileChangeEdit(
      changeMap,
      filePath,
      displayPath,
      createFileChangeEditEntry(
        latestDiff.id,
        "CodexDiff",
        diffFile.oldText,
        diffFile.newText,
        index,
      ),
      stats.additions,
      stats.deletions,
    );
  }

  return Array.from(changeMap.values());
}
