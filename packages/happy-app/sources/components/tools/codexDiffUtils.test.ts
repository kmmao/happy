import { describe, expect, it } from "vitest";
import {
  getCodexDiffStats,
  parseCodexUnifiedDiff,
  splitCodexUnifiedDiffByFile,
} from "./codexDiffUtils";

describe("codexDiffUtils", () => {
  const unifiedDiff = [
    "diff --git a/backlog.md b/backlog.md",
    "--- a/backlog.md",
    "+++ b/backlog.md",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+new line",
    " context line",
  ].join("\n");

  it("parses filename and old/new content from unified diff", () => {
    expect(parseCodexUnifiedDiff(unifiedDiff)).toEqual({
      fileName: "backlog.md",
      oldText: "old line\ncontext line",
      newText: "new line\ncontext line",
    });
  });

  it("computes diff stats from unified diff", () => {
    expect(getCodexDiffStats(unifiedDiff)).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("uses fallback path for hunk-only diffs without file headers", () => {
    expect(
      parseCodexUnifiedDiff(
        [
          "@@ -1,2 +1,3 @@",
          " const stable = true;",
          '-const status = "old";',
          '+const status = "new";',
          '+const extra = true;',
        ].join("\n"),
        "src/status.ts",
      ),
    ).toEqual({
      fileName: "src/status.ts",
      oldText: 'const stable = true;\nconst status = "old";',
      newText: 'const stable = true;\nconst status = "new";\nconst extra = true;',
    });
  });

  it("splits multi-file turn diffs into per-file parsed blocks", () => {
    const multiFileDiff = [
      "diff --git a/src/one.ts b/src/one.ts",
      "--- a/src/one.ts",
      "+++ b/src/one.ts",
      "@@ -1 +1 @@",
      '-console.log("old one");',
      '+console.log("new one");',
      "diff --git a/src/two.ts b/src/two.ts",
      "--- a/src/two.ts",
      "+++ b/src/two.ts",
      "@@ -1 +1,2 @@",
      ' export const count = 1;',
      '+export const label = "two";',
    ].join("\n");

    expect(splitCodexUnifiedDiffByFile(multiFileDiff)).toEqual([
      {
        fileName: "src/one.ts",
        oldText: 'console.log("old one");',
        newText: 'console.log("new one");',
        rawDiff: [
          "diff --git a/src/one.ts b/src/one.ts",
          "--- a/src/one.ts",
          "+++ b/src/one.ts",
          "@@ -1 +1 @@",
          '-console.log("old one");',
          '+console.log("new one");',
        ].join("\n"),
      },
      {
        fileName: "src/two.ts",
        oldText: "export const count = 1;",
        newText: 'export const count = 1;\nexport const label = "two";',
        rawDiff: [
          "diff --git a/src/two.ts b/src/two.ts",
          "--- a/src/two.ts",
          "+++ b/src/two.ts",
          "@@ -1 +1,2 @@",
          ' export const count = 1;',
          '+export const label = "two";',
        ].join("\n"),
      },
    ]);
  });

  it("aggregates stats across multi-file turn diffs", () => {
    const multiFileDiff = [
      "diff --git a/src/one.ts b/src/one.ts",
      "--- a/src/one.ts",
      "+++ b/src/one.ts",
      "@@ -1 +1 @@",
      '-console.log("old one");',
      '+console.log("new one");',
      "diff --git a/src/two.ts b/src/two.ts",
      "--- a/src/two.ts",
      "+++ b/src/two.ts",
      "@@ -1 +1,2 @@",
      ' export const count = 1;',
      '+export const label = "two";',
    ].join("\n");

    expect(getCodexDiffStats(multiFileDiff)).toEqual({
      additions: 2,
      deletions: 1,
    });
  });
});
