import { getDiffStatsLight } from "@/components/diff/calculateDiff";

export type ParsedCodexDiff = {
  oldText: string;
  newText: string;
  fileName?: string;
};

export type ParsedCodexDiffFile = ParsedCodexDiff & {
  rawDiff: string;
};

function normalizeDiffPath(line: string): string | undefined {
  const value = line.replace(/^(---|\+\+\+) /, "").trim();
  if (!value || value === "/dev/null") {
    return undefined;
  }
  return value.replace(/^[ab]\//, "");
}

function looksLikeUnifiedDiff(unifiedDiff: string): boolean {
  return (
    unifiedDiff.includes("\n@@") ||
    unifiedDiff.startsWith("@@") ||
    unifiedDiff.startsWith("diff --git ") ||
    unifiedDiff.startsWith("--- ") ||
    unifiedDiff.startsWith("+++ ")
  );
}

function splitRawDiffBlocks(unifiedDiff: string): string[] {
  if (!unifiedDiff.trim()) {
    return [];
  }

  const lines = unifiedDiff.split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      blocks.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks.map((block) => block.join("\n"));
}

function countUnifiedDiffLineStats(unifiedDiff: string): {
  additions: number;
  deletions: number;
} {
  const lines = unifiedDiff.split("\n");
  let additions = 0;
  let deletions = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export function parseCodexUnifiedDiff(
  unifiedDiff: string,
  fallbackFileName?: string,
): ParsedCodexDiff {
  const lines = unifiedDiff.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let fileName: string | undefined = fallbackFileName;
  let oldFileName: string | undefined;
  let newFileName: string | undefined;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        oldFileName = match[1];
        newFileName = match[2];
        fileName = newFileName || oldFileName || fallbackFileName;
      }
      continue;
    }

    if (line.startsWith("--- ")) {
      oldFileName = normalizeDiffPath(line);
      if (!fileName && oldFileName) {
        fileName = oldFileName;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      newFileName = normalizeDiffPath(line);
      fileName = newFileName ?? oldFileName ?? fallbackFileName;
      continue;
    }

    if (
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      newLines.push(line.substring(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.substring(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.substring(1));
      newLines.push(line.substring(1));
    } else if (line === "\\ No newline at end of file") {
      continue;
    } else if (line === "") {
      oldLines.push("");
      newLines.push("");
    }
  }

  return {
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
    fileName: newFileName ?? oldFileName ?? fileName,
  };
}

export function splitCodexUnifiedDiffByFile(
  unifiedDiff: string,
): ParsedCodexDiffFile[] {
  if (!unifiedDiff.trim()) {
    return [];
  }

  return splitRawDiffBlocks(unifiedDiff)
    .map((rawDiff) => {
      const parsed = parseCodexUnifiedDiff(rawDiff);
      if (!parsed.fileName || (!parsed.oldText && !parsed.newText)) {
        return null;
      }
      return {
        ...parsed,
        rawDiff,
      };
    })
    .filter((entry): entry is ParsedCodexDiffFile => entry !== null);
}

export function getCodexDiffStats(unifiedDiff: string): {
  additions: number;
  deletions: number;
} | null {
  if (!looksLikeUnifiedDiff(unifiedDiff)) {
    return null;
  }

  const totals = countUnifiedDiffLineStats(unifiedDiff);
  if (totals.additions === 0 && totals.deletions === 0) {
    const parsed = parseCodexUnifiedDiff(unifiedDiff);
    const stats = getDiffStatsLight(parsed.oldText, parsed.newText);
    if (stats.additions === 0 && stats.deletions === 0) {
      return null;
    }
    return stats;
  }

  return totals;
}
