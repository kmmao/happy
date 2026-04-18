import { type FileChange } from "@/components/session/codeChangeTypes";
import { type CodexCodeTabData } from "@/components/session/codex/codexCodeTabData";

export type CodexFileChangeKind = "add" | "modify" | "delete";

export function inferCodexFileChangeKind(
  change: FileChange,
): CodexFileChangeKind {
  const latestEdit = change.edits[change.edits.length - 1];
  if (!latestEdit) {
    return "modify";
  }

  if (!latestEdit.oldText && latestEdit.newText) {
    return "add";
  }

  if (latestEdit.oldText && !latestEdit.newText) {
    return "delete";
  }

  return "modify";
}

export function getCodexSourceLabelKey(
  source: CodexCodeTabData["source"],
): "tools.names.applyChanges" | "tools.names.viewDiff" {
  return source === "patch"
    ? "tools.names.applyChanges"
    : "tools.names.viewDiff";
}
