import { describe, expect, it } from "vitest";
import {
  buildRpcSummaryText,
  getRpcSummaryStatusLabel,
  getRpcSummaryVisualState,
} from "./rpcSummaryVisualState";

const colors = {
  accentOrange: "#FF9500",
  success: "#34C759",
  divider: "#D1D1D6",
  surfacePressed: "#F2F2F7",
  text: "#111111",
  textSecondary: "#6B7280",
  shadow: {
    color: "#000000",
  },
};

const translate = (key: string) => key;

describe("rpcSummaryVisualState", () => {
  it("为 rpcReady 返回成功态视觉色板", () => {
    expect(getRpcSummaryVisualState("rpcReady", colors)).toEqual({
      borderColor: "#34C75945",
      backgroundColor: "#34C75910",
      glowColor: "#34C759",
      pillBackgroundColor: "#34C75918",
      pillTextColor: "#34C759",
      pillDotColor: "#34C759",
      summaryTextColor: "#111111",
    });
  });

  it("为 rpcPending 返回警告态视觉色板", () => {
    expect(getRpcSummaryVisualState("rpcPending", colors)).toEqual({
      borderColor: "#FF950055",
      backgroundColor: "#FF950012",
      glowColor: "#FF9500",
      pillBackgroundColor: "#FF950018",
      pillTextColor: "#FF9500",
      pillDotColor: "#FF9500",
      summaryTextColor: "#111111",
    });
  });

  it("为 disconnected 返回灰阶视觉色板", () => {
    expect(getRpcSummaryVisualState("disconnected", colors)).toEqual({
      borderColor: "#D1D1D6",
      backgroundColor: "#F2F2F7",
      glowColor: "#6B7280",
      pillBackgroundColor: "#6B728014",
      pillTextColor: "#6B7280",
      pillDotColor: "#6B7280",
      summaryTextColor: "#6B7280",
    });
  });

  it("返回 rpc 状态标签", () => {
    expect(getRpcSummaryStatusLabel({ rpcState: "rpcReady", translate })).toBe("agentInput.rpcState.rpcReady");
    expect(getRpcSummaryStatusLabel({ rpcState: "rpcPending", translate })).toBe("agentInput.rpcState.rpcPending");
    expect(getRpcSummaryStatusLabel({ rpcState: "reconnecting", translate })).toBe("agentInput.rpcState.reconnecting");
    expect(getRpcSummaryStatusLabel({ rpcState: "disconnected", translate })).toBe("agentInput.rpcState.disconnected");
    expect(getRpcSummaryStatusLabel({ rpcState: null, translate })).toBeNull();
  });

  it("按展开态顺序拼接权限、模型和 effort 标签", () => {
    expect(
      buildRpcSummaryText({
        permissionLabel: "CLI 设置",
        modelLabel: "GPT-5.4",
        reasoningLabels: ["超高"],
      }),
    ).toBe("CLI 设置 · GPT-5.4 · 超高");
  });

  it("忽略空标签，避免出现脏分隔符", () => {
    expect(
      buildRpcSummaryText({
        permissionLabel: "CLI 设置",
        modelLabel: "",
        reasoningLabels: ["", null, "超高"],
      }),
    ).toBe("CLI 设置 · 超高");

    expect(
      buildRpcSummaryText({
        permissionLabel: null,
        modelLabel: undefined,
        reasoningLabels: [null, undefined],
      }),
    ).toBeNull();
  });
});
