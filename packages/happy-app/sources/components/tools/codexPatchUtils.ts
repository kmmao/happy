import { getDiffStatsLight } from "@/components/diff/calculateDiff";

export type CodexPatchEntry = {
  path: string;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
  changeType: "add" | "modify" | "delete" | "unknown";
};

type RawCodexPatchChange = {
  add?: { content?: string | null } | null;
  modify?: { old_content?: string | null; new_content?: string | null } | null;
  delete?: { content?: string | null } | null;
};

export function getCodexPatchEntries(
  changes: unknown,
): CodexPatchEntry[] {
  if (!changes || typeof changes !== "object") {
    return [];
  }

  return Object.entries(changes as Record<string, RawCodexPatchChange>).map(
    ([path, change]) => {
      let oldText = "";
      let newText = "";
      let changeType: CodexPatchEntry["changeType"] = "unknown";

      if (change?.modify) {
        oldText = change.modify.old_content ?? "";
        newText = change.modify.new_content ?? "";
        changeType = "modify";
      } else if (change?.add) {
        oldText = "";
        newText = change.add.content ?? "";
        changeType = "add";
      } else if (change?.delete) {
        oldText = change.delete.content ?? "";
        newText = "";
        changeType = "delete";
      }

      const stats = getDiffStatsLight(oldText, newText);

      return {
        path,
        oldText,
        newText,
        additions: stats.additions,
        deletions: stats.deletions,
        changeType,
      };
    },
  );
}

export function getCodexPatchTotals(
  entries: readonly CodexPatchEntry[],
): { additions: number; deletions: number } | null {
  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return { additions, deletions };
}
