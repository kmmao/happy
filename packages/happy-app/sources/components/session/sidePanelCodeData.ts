import { getDiffStatsLight } from "@/components/diff/calculateDiff";
import { type FileChange } from "@/components/session/codeChangeTypes";
import {
  extractCodexCodeTabData,
  hasCodexCodeData,
} from "@/components/session/codex/codexCodeTabData";
import {
  createFileChangeEditEntry,
  type FileChangeEditEntry,
} from "@/components/tools/fileChangeEditKey";
import { Metadata } from "@/sync/storageTypes";
import { Message, ToolCallMessage } from "@/sync/typesMessage";
import { resolvePath } from "@/utils/pathUtils";
import { trimIdent } from "@/utils/trimIdent";

export type { FileChange } from "@/components/session/codeChangeTypes";

export function collectToolCalls(
  messages: readonly Message[],
): ToolCallMessage[] {
  const result: ToolCallMessage[] = [];
  for (const msg of messages) {
    if (msg.kind === "tool-call") {
      result.push(msg);
      if (msg.children.length > 0) {
        result.push(...collectToolCalls(msg.children));
      }
    }
  }
  return result;
}

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

function appendLegacyEditChange(
  changeMap: Map<string, FileChange>,
  msg: ToolCallMessage,
  metadata: Metadata | null,
): void {
  const input = msg.tool.input;
  if (!input || typeof input.file_path !== "string") {
    return;
  }

  const filePath = input.file_path;
  const displayPath = resolvePath(filePath, metadata);
  const name = msg.tool.name;

  if (name === "Edit" || name === "edit") {
    const oldStr = trimIdent(input.old_string || "");
    const newStr = trimIdent(input.new_string || "");
    if (!oldStr && !newStr) {
      return;
    }

    const stats = getDiffStatsLight(oldStr, newStr);
    appendFileChangeEdit(
      changeMap,
      filePath,
      displayPath,
      createFileChangeEditEntry(msg.id, "Edit", oldStr, newStr, 0),
      stats.additions,
      stats.deletions,
    );
    return;
  }

  if (name === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    for (const [index, edit] of edits.entries()) {
      const oldStr = trimIdent(edit.old_string || "");
      const newStr = trimIdent(edit.new_string || "");
      if (!oldStr && !newStr) {
        continue;
      }

      const stats = getDiffStatsLight(oldStr, newStr);
      appendFileChangeEdit(
        changeMap,
        filePath,
        displayPath,
        createFileChangeEditEntry(msg.id, "MultiEdit", oldStr, newStr, index),
        stats.additions,
        stats.deletions,
      );
    }
    return;
  }

  if (name === "Write") {
    const content = typeof input.content === "string" ? input.content : "";
    if (!content) {
      return;
    }

    const stats = getDiffStatsLight("", content);
    appendFileChangeEdit(
      changeMap,
      filePath,
      displayPath,
      createFileChangeEditEntry(msg.id, "Write", "", content, 0),
      stats.additions,
      stats.deletions,
    );
  }
}

function extractLegacyFileChanges(
  toolCalls: readonly ToolCallMessage[],
  metadata: Metadata | null,
): FileChange[] {
  const changeMap = new Map<string, FileChange>();

  for (const msg of toolCalls) {
    const tool = msg.tool;
    if (!tool || tool.state !== "completed") {
      continue;
    }

    if (
      tool.name === "Edit" ||
      tool.name === "edit" ||
      tool.name === "MultiEdit" ||
      tool.name === "Write"
    ) {
      appendLegacyEditChange(changeMap, msg, metadata);
    }
  }

  return Array.from(changeMap.values());
}

export function extractFileChanges(
  toolCalls: readonly ToolCallMessage[],
  metadata: Metadata | null,
): FileChange[] {
  if (hasCodexCodeData(toolCalls)) {
    return extractCodexCodeTabData(toolCalls, metadata).fileChanges;
  }

  return extractLegacyFileChanges(toolCalls, metadata);
}
