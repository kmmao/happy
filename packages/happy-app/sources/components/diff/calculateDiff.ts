import { diffLines, diffWordsWithSpace, diffChars } from "diff";

export interface DiffToken {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "normal";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  tokens?: DiffToken[]; // For inline highlighting
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  stats: {
    additions: number;
    deletions: number;
  };
}

interface LinePair {
  oldLine?: string;
  newLine?: string;
  oldIndex?: number;
  newIndex?: number;
}

/**
 * Calculate unified diff with inline highlighting
 * Similar to git diff algorithm
 */
export function calculateUnifiedDiff(
  oldText: string,
  newText: string,
  contextLines: number = 3,
): DiffResult {
  // First, get line-level changes
  const lineChanges = diffLines(oldText, newText);

  // Convert to our internal format and track line numbers
  const allLines: DiffLine[] = [];
  const linePairs: LinePair[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let additions = 0;
  let deletions = 0;

  // First pass: identify all lines and potential pairs
  let pendingRemovals: { line: string; lineNum: number; index: number }[] = [];

  lineChanges.forEach((change) => {
    const lines = change.value
      .split("\n")
      .filter((line, index, arr) => !(index === arr.length - 1 && line === ""));

    lines.forEach((line) => {
      if (change.removed) {
        pendingRemovals.push({
          line,
          lineNum: oldLineNum,
          index: allLines.length,
        });
        allLines.push({
          type: "remove",
          content: line,
          oldLineNumber: oldLineNum++,
        });
        deletions++;
      } else if (change.added) {
        // Try to pair with a removal for inline diff
        let paired = false;
        if (pendingRemovals.length > 0) {
          // Find best matching removal (simple heuristic: first one with some similarity)
          const removalIndex = findBestMatch(
            line,
            pendingRemovals.map((r) => r.line),
          );
          if (removalIndex !== -1) {
            const removal = pendingRemovals[removalIndex];
            pendingRemovals.splice(removalIndex, 1);

            // Calculate inline diff
            const tokens = calculateInlineDiff(removal.line, line);

            // Update the removal line with tokens
            allLines[removal.index].tokens = tokens.filter((t) => !t.added);

            // Add the addition line with tokens
            allLines.push({
              type: "add",
              content: line,
              newLineNumber: newLineNum++,
              tokens: tokens.filter((t) => !t.removed),
            });

            paired = true;
          }
        }

        if (!paired) {
          allLines.push({
            type: "add",
            content: line,
            newLineNumber: newLineNum++,
          });
        }
        additions++;
      } else {
        // Context line
        allLines.push({
          type: "normal",
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        });
      }
    });
  });

  // Create hunks with context
  const hunks = createHunks(allLines, contextLines);

  return {
    hunks,
    stats: { additions, deletions },
  };
}

/**
 * Calculate inline diff between two lines
 */
function calculateInlineDiff(oldLine: string, newLine: string): DiffToken[] {
  // Use word-level diff for better readability
  const wordDiff = diffWordsWithSpace(oldLine, newLine);

  return wordDiff.map((part) => ({
    value: part.value,
    added: part.added,
    removed: part.removed,
  }));
}

/**
 * Find best matching line from candidates
 * Returns index of best match or -1 if no good match
 */
function findBestMatch(target: string, candidates: string[]): number {
  if (candidates.length === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  const threshold = 0.3; // Minimum 30% similarity

  candidates.forEach((candidate, index) => {
    const score = calculateSimilarity(target, candidate);
    if (score > bestScore && score > threshold) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  // Simple character-based similarity
  const chars1 = str1.split("");
  const chars2 = str2.split("");
  const maxLen = Math.max(chars1.length, chars2.length);

  if (maxLen === 0) return 1;

  let matches = 0;
  const minLen = Math.min(chars1.length, chars2.length);

  for (let i = 0; i < minLen; i++) {
    if (chars1[i] === chars2[i]) matches++;
  }

  // Also check for common substrings
  const commonSubstrings = findCommonSubstrings(str1, str2);
  const substringBonus =
    commonSubstrings.reduce((sum, sub) => sum + sub.length, 0) / maxLen;

  return (matches / maxLen + substringBonus) / 2;
}

/**
 * Find common substrings between two strings
 */
function findCommonSubstrings(str1: string, str2: string): string[] {
  const minLength = 3; // Minimum substring length
  const substrings: string[] = [];

  for (let len = Math.min(str1.length, str2.length); len >= minLength; len--) {
    for (let i = 0; i <= str1.length - len; i++) {
      const sub = str1.substring(i, i + len);
      if (str2.includes(sub) && !substrings.some((s) => s.includes(sub))) {
        substrings.push(sub);
      }
    }
  }

  return substrings;
}

/**
 * Create hunks with context lines
 */
function createHunks(lines: DiffLine[], contextLines: number): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const changes = lines
    .map((line, index) => ({ ...line, index }))
    .filter((line) => line.type !== "normal");

  if (changes.length === 0) {
    // No changes, return single hunk with all lines if they exist
    if (lines.length > 0) {
      hunks.push({
        oldStart: 1,
        oldLines: lines.filter((l) => l.oldLineNumber).length,
        newStart: 1,
        newLines: lines.filter((l) => l.newLineNumber).length,
        lines: lines,
      });
    }
    return hunks;
  }

  // Group changes into hunks with context
  let currentHunk: DiffLine[] = [];
  let lastIncludedIndex = -1;

  changes.forEach((change, i) => {
    const startContext = Math.max(0, change.index - contextLines);
    const endContext = Math.min(lines.length - 1, change.index + contextLines);

    // Add lines from last included index to current hunk
    for (
      let j = Math.max(lastIncludedIndex + 1, startContext);
      j <= endContext;
      j++
    ) {
      currentHunk.push(lines[j]);
    }
    lastIncludedIndex = endContext;

    // Check if we should start a new hunk
    const nextChange = changes[i + 1];
    if (nextChange && nextChange.index - endContext > contextLines * 2) {
      // Finish current hunk
      if (currentHunk.length > 0) {
        const firstLine = currentHunk[0];
        hunks.push({
          oldStart: firstLine.oldLineNumber || 1,
          oldLines: currentHunk.filter((l) => l.oldLineNumber).length,
          newStart: firstLine.newLineNumber || 1,
          newLines: currentHunk.filter((l) => l.newLineNumber).length,
          lines: currentHunk,
        });
      }
      currentHunk = [];
    }
  });

  // Add remaining lines to last hunk
  if (currentHunk.length > 0) {
    const firstLine = currentHunk[0];
    hunks.push({
      oldStart: firstLine.oldLineNumber || 1,
      oldLines: currentHunk.filter((l) => l.oldLineNumber).length,
      newStart: firstLine.newLineNumber || 1,
      newLines: currentHunk.filter((l) => l.newLineNumber).length,
      lines: currentHunk,
    });
  }

  return hunks;
}

export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

/**
 * Convert unified diff lines into side-by-side split rows.
 * Paired remove/add lines (both with tokens) are placed on the same row.
 */
export function splitDiffLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "normal") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === "remove") {
      // Check if next line is a paired add (both have inline tokens)
      const next = i + 1 < lines.length ? lines[i + 1] : undefined;
      if (next?.type === "add" && line.tokens && line.tokens.length > 0) {
        rows.push({ left: line, right: next });
        i += 2;
      } else {
        rows.push({ left: line, right: undefined });
        i++;
      }
    } else {
      // add line without a paired remove
      rows.push({ left: undefined, right: line });
      i++;
    }
  }

  return rows;
}

/**
 * Format diff hunks as a standard unified diff text (git diff style).
 */
export function formatUnifiedDiffText(
  hunks: DiffHunk[],
  filePath?: string | null,
): string {
  const parts: string[] = [];

  if (filePath) {
    parts.push(`--- a/${filePath}`);
    parts.push(`+++ b/${filePath}`);
  }

  for (const hunk of hunks) {
    parts.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    for (const line of hunk.lines) {
      const prefix =
        line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      parts.push(`${prefix}${line.content}`);
    }
  }

  return parts.join("\n");
}

/**
 * Parse a unified diff patch (git diff output) into DiffHunk[] + stats.
 * Strips the file header lines (diff --git, index, ---, +++) and parses
 * @@ hunk headers plus their content lines.
 */
export function parseUnifiedPatch(patchText: string): DiffResult {
    const lines = patchText.split("\n");
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
        // Skip file-level headers
        if (
            line.startsWith("diff --git") ||
            line.startsWith("index ") ||
            line.startsWith("--- ") ||
            line.startsWith("+++ ") ||
            line.startsWith("new file mode") ||
            line.startsWith("deleted file mode") ||
            line.startsWith("old mode") ||
            line.startsWith("new mode") ||
            line.startsWith("similarity index") ||
            line.startsWith("rename from") ||
            line.startsWith("rename to") ||
            line.startsWith("Binary files")
        ) {
            continue;
        }

        // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
        const hunkMatch = line.match(
            /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
        );
        if (hunkMatch) {
            currentHunk = {
                oldStart: parseInt(hunkMatch[1], 10),
                oldLines: hunkMatch[2] != null ? parseInt(hunkMatch[2], 10) : 1,
                newStart: parseInt(hunkMatch[3], 10),
                newLines: hunkMatch[4] != null ? parseInt(hunkMatch[4], 10) : 1,
                lines: [],
            };
            hunks.push(currentHunk);
            oldLine = currentHunk.oldStart;
            newLine = currentHunk.newStart;
            continue;
        }

        if (!currentHunk) continue;

        if (line.startsWith("+")) {
            currentHunk.lines.push({
                type: "add",
                content: line.slice(1),
                newLineNumber: newLine++,
            });
            additions++;
        } else if (line.startsWith("-")) {
            currentHunk.lines.push({
                type: "remove",
                content: line.slice(1),
                oldLineNumber: oldLine++,
            });
            deletions++;
        } else if (line.startsWith(" ") || line === "") {
            // Context line (starts with space) or empty trailing line
            const content = line.startsWith(" ") ? line.slice(1) : line;
            // Only add as context if we're inside a hunk and it's a real context line
            if (line.startsWith(" ")) {
                currentHunk.lines.push({
                    type: "normal",
                    content,
                    oldLineNumber: oldLine++,
                    newLineNumber: newLine++,
                });
            }
        } else if (line.startsWith("\\")) {
            // "\ No newline at end of file" — skip
            continue;
        }
    }

    // Post-process: compute inline diff tokens for paired remove/add sequences
    for (const hunk of hunks) {
        const hunkLines = hunk.lines;
        let i = 0;
        while (i < hunkLines.length) {
            if (hunkLines[i].type === "remove") {
                // Collect consecutive removes
                const removeStart = i;
                while (i < hunkLines.length && hunkLines[i].type === "remove") i++;
                const removeEnd = i;

                // Collect consecutive adds
                const addStart = i;
                while (i < hunkLines.length && hunkLines[i].type === "add") i++;
                const addEnd = i;

                // Pair them up for inline diff
                const removeCount = removeEnd - removeStart;
                const addCount = addEnd - addStart;
                const pairCount = Math.min(removeCount, addCount);

                for (let p = 0; p < pairCount; p++) {
                    const removeLine = hunkLines[removeStart + p];
                    const addLine = hunkLines[addStart + p];
                    const inlineTokens = diffWordsWithSpace(
                        removeLine.content,
                        addLine.content,
                    ).map((part) => ({
                        value: part.value,
                        added: part.added,
                        removed: part.removed,
                    }));
                    removeLine.tokens = inlineTokens.filter((t) => !t.added);
                    addLine.tokens = inlineTokens.filter((t) => !t.removed);
                }
            } else {
                i++;
            }
        }
    }

    return { hunks, stats: { additions, deletions } };
}

/**
 * Export additional utilities
 */
export function getDiffStats(
  oldText: string,
  newText: string,
): { additions: number; deletions: number } {
  const result = calculateUnifiedDiff(oldText, newText);
  return result.stats;
}

/**
 * Lightweight diff stats calculation - only counts additions/deletions
 * without creating hunks or inline tokens. ~10x faster than calculateUnifiedDiff.
 */
export function getDiffStatsLight(
  oldText: string,
  newText: string,
): { additions: number; deletions: number } {
  const changes = diffLines(oldText, newText);
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    const lineCount = change.value
      .split("\n")
      .filter((line, i, arr) => !(i === arr.length - 1 && line === "")).length;
    if (change.added) additions += lineCount;
    else if (change.removed) deletions += lineCount;
  }
  return { additions, deletions };
}
