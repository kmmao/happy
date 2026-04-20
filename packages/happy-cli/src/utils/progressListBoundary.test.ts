import { describe, expect, it } from "vitest";

import { shouldStartNewProgressList } from "./progressListBoundary";

describe("shouldStartNewProgressList", () => {
  it("starts a new list when the prior checklist is completed and overlap is low", () => {
    expect(
      shouldStartNewProgressList(
        [
          { content: "查看参考图并提炼收缩态目标样式", status: "completed" },
          {
            content: "定位 happy-app 中输入框收缩态相关组件与样式",
            status: "completed",
          },
          {
            content: "实现模型选择、RPC 就绪与统计信息的布局优化",
            status: "completed",
          },
          { content: "运行相关检查并确认没有明显回归", status: "completed" },
        ],
        [
          { content: "把会话状态文案从收缩态信息卡片中抽离", status: "in_progress" },
          { content: "将收缩态底部按钮行改为右对齐", status: "pending" },
          { content: "运行相关检查并确认没有明显回归", status: "pending" },
        ],
        { requirePriorCompleted: true },
      ),
    ).toBe(true);
  });

  it("does not start a new list while the prior checklist is still in progress", () => {
    expect(
      shouldStartNewProgressList(
        [
          { content: "定位现有组件", status: "completed" },
          { content: "修改布局", status: "in_progress" },
          { content: "运行相关检查并确认没有明显回归", status: "pending" },
        ],
        [
          { content: "梳理误报条件", status: "in_progress" },
          { content: "修复判断逻辑", status: "pending" },
          { content: "运行相关检查并确认没有明显回归", status: "pending" },
        ],
        { requirePriorCompleted: true },
      ),
    ).toBe(false);
  });

  it("does not start a new list when the overlap ratio stays high", () => {
    expect(
      shouldStartNewProgressList(
        [
          { content: "定位现有组件", status: "completed" },
          { content: "修改布局", status: "completed" },
          { content: "补验证", status: "completed" },
        ],
        [
          { content: "修改布局", status: "in_progress" },
          { content: "补验证", status: "pending" },
          { content: "整理说明", status: "pending" },
        ],
        { requirePriorCompleted: true },
      ),
    ).toBe(false);
  });
});

