import { describe, it, expect } from "vitest";
import {
  calculateUnifiedDiff,
  parseUnifiedPatch,
  splitDiffLines,
  formatUnifiedDiffText,
  getDiffStats,
  getDiffStatsLight,
  type DiffLine,
  type DiffHunk,
} from "./calculateDiff";

describe("calculateUnifiedDiff", () => {
  it("reports no changes for identical text", () => {
    const r = calculateUnifiedDiff("a\nb\nc", "a\nb\nc");
    expect(r.stats).toEqual({ additions: 0, deletions: 0 });
  });

  it("counts a one-line modification as one addition and one deletion", () => {
    const r = calculateUnifiedDiff("a\nb\nc", "a\nB\nc");
    expect(r.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("counts a pure insertion", () => {
    const r = calculateUnifiedDiff("a\nc", "a\nb\nc");
    expect(r.stats).toEqual({ additions: 1, deletions: 0 });
  });
});

describe("getDiffStats vs getDiffStatsLight", () => {
  it("agree on additions/deletions", () => {
    const oldText = "x\ny\nz";
    const newText = "x\nY\nz\nw";
    expect(getDiffStatsLight(oldText, newText)).toEqual(getDiffStats(oldText, newText));
  });
});

describe("parseUnifiedPatch", () => {
  it("parses a hunk header and tallies additions/deletions", () => {
    const patch = ["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n");
    const r = parseUnifiedPatch(patch);
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 });
    expect(r.stats).toEqual({ additions: 1, deletions: 1 });
    expect(r.hunks[0].lines.map((l) => l.type)).toEqual(["normal", "remove", "add", "normal"]);
  });

  it("defaults the line count to 1 when the hunk header omits it", () => {
    const r = parseUnifiedPatch(["@@ -5 +6 @@", "-old", "+new"].join("\n"));
    expect(r.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1, oldStart: 5, newStart: 6 });
  });

  it("skips git file headers and the no-newline marker", () => {
    const patch = [
      "diff --git a/f.txt b/f.txt",
      "index 111..222 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "\\ No newline at end of file",
    ].join("\n");
    const r = parseUnifiedPatch(patch);
    expect(r.hunks).toHaveLength(1);
    expect(r.stats).toEqual({ additions: 1, deletions: 1 });
    // Header lines must not have leaked into the hunk content.
    expect(r.hunks[0].lines.every((l) => !l.content.startsWith("diff"))).toBe(true);
  });

  it("computes inline tokens for a paired remove/add", () => {
    const r = parseUnifiedPatch(["@@ -1 +1 @@", "-hello world", "+hello there"].join("\n"));
    const [removeLine, addLine] = r.hunks[0].lines;
    expect(removeLine.tokens).toBeDefined();
    expect(addLine.tokens).toBeDefined();
    // The shared "hello " survives on both sides; removed/added words don't cross.
    expect(removeLine.tokens!.some((t) => t.added)).toBe(false);
    expect(addLine.tokens!.some((t) => t.removed)).toBe(false);
  });

  it("tracks old/new line numbers across context and changes", () => {
    const r = parseUnifiedPatch(["@@ -10,2 +10,2 @@", " ctx", "-gone", "+added"].join("\n"));
    const lines = r.hunks[0].lines;
    expect(lines[0]).toMatchObject({ type: "normal", oldLineNumber: 10, newLineNumber: 10 });
    expect(lines[1]).toMatchObject({ type: "remove", oldLineNumber: 11 });
    expect(lines[2]).toMatchObject({ type: "add", newLineNumber: 11 });
  });
});

describe("splitDiffLines", () => {
  it("mirrors normal lines on both sides", () => {
    const rows = splitDiffLines([{ type: "normal", content: "x" }]);
    expect(rows).toEqual([{ left: { type: "normal", content: "x" }, right: { type: "normal", content: "x" } }]);
  });

  it("pairs a tokenized remove with the following add on one row", () => {
    const lines: DiffLine[] = [
      { type: "remove", content: "a", tokens: [{ value: "a", removed: true }] },
      { type: "add", content: "b" },
    ];
    const rows = splitDiffLines(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.type).toBe("remove");
    expect(rows[0].right?.type).toBe("add");
  });

  it("keeps an untokenized remove and an add on separate rows", () => {
    const lines: DiffLine[] = [
      { type: "remove", content: "a" }, // no tokens → not paired
      { type: "add", content: "b" },
    ];
    const rows = splitDiffLines(lines);
    expect(rows).toEqual([
      { left: { type: "remove", content: "a" }, right: undefined },
      { left: undefined, right: { type: "add", content: "b" } },
    ]);
  });
});

describe("formatUnifiedDiffText", () => {
  const hunk: DiffHunk = {
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    lines: [
      { type: "normal", content: "a" },
      { type: "remove", content: "b" },
      { type: "add", content: "B" },
    ],
  };

  it("emits a/ b/ headers when a file path is given and prefixes each line", () => {
    const text = formatUnifiedDiffText([hunk], "f.txt");
    expect(text).toContain("--- a/f.txt");
    expect(text).toContain("+++ b/f.txt");
    expect(text).toContain("@@ -1,2 +1,2 @@");
    expect(text).toContain("\n a");
    expect(text).toContain("\n-b");
    expect(text).toContain("\n+B");
  });

  it("omits file headers when no path is given", () => {
    const text = formatUnifiedDiffText([hunk]);
    expect(text.startsWith("@@ ")).toBe(true);
  });

  it("round-trips with parseUnifiedPatch on stats", () => {
    const text = formatUnifiedDiffText([hunk], "f.txt");
    expect(parseUnifiedPatch(text).stats).toEqual({ additions: 1, deletions: 1 });
  });
});
