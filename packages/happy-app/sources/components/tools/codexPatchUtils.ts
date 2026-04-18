import { getDiffStatsLight } from "@/components/diff/calculateDiff";
import {
  getCodexDiffStats,
  parseCodexUnifiedDiff,
} from "@/components/tools/codexDiffUtils";

export type CodexPatchEntry = {
  path: string;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
  changeType: "add" | "modify" | "delete" | "unknown";
  rawDiff?: string;
};

type RawCodexPatchChange = {
  path?: string | null;
  add?: { content?: string | null } | null;
  modify?: { old_content?: string | null; new_content?: string | null } | null;
  delete?: { content?: string | null } | null;
  changeType?: string | null;
  kind?: { type?: string | null } | string | null;
  type?: string | null;
  diff?: string | null;
  unified_diff?: string | null;
  content?: string | null;
  oldContent?: string | null;
  newContent?: string | null;
  old_content?: string | null;
  new_content?: string | null;
  oldText?: string | null;
  newText?: string | null;
};

type NormalizedPatchChange = Pick<
  CodexPatchEntry,
  "oldText" | "newText" | "changeType" | "rawDiff"
> | null;

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeChangeType(
  value: unknown,
): CodexPatchEntry["changeType"] {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.toLowerCase();
  if (normalized === "add" || normalized === "create") {
    return "add";
  }
  if (
    normalized === "modify" ||
    normalized === "update" ||
    normalized === "replace"
  ) {
    return "modify";
  }
  if (normalized === "delete" || normalized === "remove") {
    return "delete";
  }
  return "unknown";
}

function getExplicitChangeType(
  change: RawCodexPatchChange,
): CodexPatchEntry["changeType"] {
  if (change.modify) {
    return "modify";
  }
  if (change.add) {
    return "add";
  }
  if (change.delete) {
    return "delete";
  }

  const kindType =
    typeof change.kind === "string"
      ? change.kind
      : typeof change.kind?.type === "string"
        ? change.kind.type
        : null;

  for (const candidate of [change.changeType, change.type, kindType]) {
    const normalized = normalizeChangeType(candidate);
    if (normalized !== "unknown") {
      return normalized;
    }
  }

  return "unknown";
}

function normalizeFlatChange(
  change: RawCodexPatchChange,
): Pick<CodexPatchEntry, "oldText" | "newText" | "changeType"> | null {
  const oldText =
    coerceString(change.oldContent) ||
    coerceString(change.old_content) ||
    coerceString(change.oldText);
  const newText =
    coerceString(change.newContent) ||
    coerceString(change.new_content) ||
    coerceString(change.newText);
  const content = coerceString(change.content);

  const explicitType = getExplicitChangeType(change);
  if (explicitType === "modify" && (oldText || newText)) {
    return {
      oldText,
      newText,
      changeType: "modify",
    };
  }

  if (explicitType === "add" && (newText || content)) {
    return {
      oldText: "",
      newText: newText || content,
      changeType: "add",
    };
  }

  if (explicitType === "delete" && (oldText || content)) {
    return {
      oldText: oldText || content,
      newText: "",
      changeType: "delete",
    };
  }

  if (oldText || newText) {
    return {
      oldText,
      newText,
      changeType: oldText && newText ? "modify" : oldText ? "delete" : "add",
    };
  }

  if (content) {
    return {
      oldText: "",
      newText: content,
      changeType: "add",
    };
  }

  return null;
}

function normalizeDiffBackedChange(
  path: string,
  change: RawCodexPatchChange,
): NormalizedPatchChange {
  const rawDiff = coerceString(change.unified_diff) || coerceString(change.diff);
  if (!rawDiff) {
    return null;
  }

  const explicitType = getExplicitChangeType(change);

  if (explicitType === "add") {
    return {
      oldText: "",
      newText: rawDiff,
      changeType: "add",
      rawDiff,
    };
  }

  if (explicitType === "delete") {
    return {
      oldText: rawDiff,
      newText: "",
      changeType: "delete",
      rawDiff,
    };
  }

  const parsed = parseCodexUnifiedDiff(rawDiff, path);
  if (parsed.oldText || parsed.newText) {
    return {
      oldText: parsed.oldText,
      newText: parsed.newText,
      changeType: explicitType === "unknown" ? "modify" : explicitType,
      rawDiff,
    };
  }

  return null;
}

function normalizePatchChange(
  path: string,
  change: RawCodexPatchChange,
): NormalizedPatchChange {
  if (change?.modify) {
    return {
      oldText: change.modify.old_content ?? "",
      newText: change.modify.new_content ?? "",
      changeType: "modify",
    };
  }
  if (change?.add) {
    return {
      oldText: "",
      newText: change.add.content ?? "",
      changeType: "add",
    };
  }
  if (change?.delete) {
    return {
      oldText: change.delete.content ?? "",
      newText: "",
      changeType: "delete",
    };
  }

  const flat = normalizeFlatChange(change);
  if (flat) {
    return flat;
  }

  return normalizeDiffBackedChange(path, change);
}

export function getCodexPatchEntries(
  changes: unknown,
): CodexPatchEntry[] {
  if (!changes || typeof changes !== "object") {
    return [];
  }

  return Object.entries(changes as Record<string, RawCodexPatchChange>).map(
    ([pathKey, change]) => {
      const path = coerceString(change?.path) || pathKey;
      const normalized = normalizePatchChange(path, change ?? {});

      const oldText = normalized?.oldText ?? "";
      const newText = normalized?.newText ?? "";
      const changeType = normalized?.changeType ?? "unknown";
      const stats =
        normalized?.rawDiff
          ? getCodexDiffStats(normalized.rawDiff) ??
            getDiffStatsLight(oldText, newText)
          : getDiffStatsLight(oldText, newText);

      return {
        path,
        oldText,
        newText,
        additions: stats.additions,
        deletions: stats.deletions,
        changeType,
        ...(normalized?.rawDiff ? { rawDiff: normalized.rawDiff } : {}),
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
