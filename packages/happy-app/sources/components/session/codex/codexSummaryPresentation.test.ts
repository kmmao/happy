import { describe, expect, it } from "vitest";

import { buildCodexSummaryEntries } from "./codexSummaryPresentation";

describe("codexSummaryPresentation", () => {
  it("keeps goal and current focus together in display order", () => {
    expect(
      buildCodexSummaryEntries({
        goal: "  修复升级提示误报  ",
        currentFocus: "  排查前端触发与 CLI 校验路径  ",
      }),
    ).toEqual([
      {
        id: "goal",
        value: "修复升级提示误报",
      },
      {
        id: "currentFocus",
        value: "排查前端触发与 CLI 校验路径",
      },
    ]);
  });

  it("skips an empty current focus block", () => {
    expect(
      buildCodexSummaryEntries({
        goal: "压缩会话概要卡片视觉密度",
        currentFocus: "   ",
      }),
    ).toEqual([
      {
        id: "goal",
        value: "压缩会话概要卡片视觉密度",
      },
    ]);
  });
});
