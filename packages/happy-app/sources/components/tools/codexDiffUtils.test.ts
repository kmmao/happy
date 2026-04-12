import { describe, expect, it } from "vitest";
import {
  getCodexDiffStats,
  parseCodexUnifiedDiff,
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
});
