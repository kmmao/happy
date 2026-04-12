import { getDiffStatsLight } from "@/components/diff/calculateDiff";

export type ParsedCodexDiff = {
  oldText: string;
  newText: string;
  fileName?: string;
};

export function parseCodexUnifiedDiff(unifiedDiff: string): ParsedCodexDiff {
  const lines = unifiedDiff.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let fileName: string | undefined;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      fileName = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
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
    fileName,
  };
}

export function getCodexDiffStats(unifiedDiff: string): {
  additions: number;
  deletions: number;
} | null {
  const parsed = parseCodexUnifiedDiff(unifiedDiff);
  const stats = getDiffStatsLight(parsed.oldText, parsed.newText);
  if (stats.additions === 0 && stats.deletions === 0) {
    return null;
  }
  return stats;
}
