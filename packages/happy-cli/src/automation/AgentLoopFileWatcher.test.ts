import { describe, expect, it } from "vitest";
import { shouldIgnoreWatchedPath, summarizeFileChanges } from "./AgentLoopFileWatcher";

describe("AgentLoopFileWatcher", () => {
  it("ignores common noisy directories", () => {
    expect(shouldIgnoreWatchedPath("src/index.ts")).toBe(false);
    expect(shouldIgnoreWatchedPath(".git/HEAD")).toBe(true);
    expect(shouldIgnoreWatchedPath("node_modules/react/index.js")).toBe(true);
    expect(shouldIgnoreWatchedPath(".happy/agent-loops/x/memory.md")).toBe(true);
  });

  it("summarizes unique changed files compactly", () => {
    expect(summarizeFileChanges(["b.ts", "a.ts", "a.ts"])) .toBe("a.ts, b.ts");
    expect(summarizeFileChanges([])).toBeUndefined();
    expect(summarizeFileChanges(["1","2","3","4","5","6","7","8","9","10","11"]))
      .toBe("1, 10, 11, 2, 3, 4, 5, 6, 7, 8 (+1 more)");
  });
});
