import { describe, expect, it } from "vitest";
import { parseLegacyCodexPlanPreview } from "./codexPlanCompat";

describe("parseLegacyCodexPlanPreview", () => {
  it("parses codex plan updates into structured rows", () => {
    expect(
      parseLegacyCodexPlanPreview(
        [
          "Plan updated",
          "[completed] Inspect logs",
          "[in_progress] Patch parser",
          "[pending] Verify UI",
        ].join("\n"),
      ),
    ).toEqual({
      explanation: "Plan updated",
      items: [
        { status: "completed", text: "Inspect logs" },
        { status: "in_progress", text: "Patch parser" },
        { status: "pending", text: "Verify UI" },
      ],
    });
  });

  it("returns null when the message is not a codex plan preview", () => {
    expect(parseLegacyCodexPlanPreview("plain text")).toBeNull();
  });

  // Regression: MessageView renders the plan card INSTEAD of the markdown body,
  // so anything this parser claims but does not carry into `items` is deleted
  // from the user's view. A real answer quoting two vite HMR log lines used to
  // come back as a two-row plan whose explanation was the answer's first line —
  // table, prose, code fences and <options> all silently dropped.
  it("does not claim prose that merely quotes bracketed log lines", () => {
    const answer = [
      "排查完了。**双份 `routerContext` 假说 —— 证伪**，三层证据：",
      "",
      "| 层面 | 检查 | 结果 |",
      "|---|---|---|",
      "| 磁盘 | 物理副本 | 唯一 |",
      "",
      "**但日志里翻出了一条实锤线索**：",
      "",
      "```",
      "[vite] hmr invalidate /src/context/font-provider.tsx    Could not Fast Refresh (export removed)",
      "[vite] hmr invalidate /src/context/layout-provider.tsx  Could not Fast Refresh",
      "```",
      "",
      "四个文件都把组件和 hook 混在同一文件 export。",
      "",
      "<options>",
      "    <option>拆分 4 个 provider 的 hook 到独立文件</option>",
      "</options>",
    ].join("\n");

    expect(parseLegacyCodexPlanPreview(answer)).toBeNull();
  });

  it("rejects bracketed prefixes outside codex's plan status vocabulary", () => {
    expect(
      parseLegacyCodexPlanPreview(
        ["Build output", "[error] missing module", "[warn] deprecated flag"].join(
          "\n",
        ),
      ),
    ).toBeNull();
  });

  it("rejects a plan whose rows are interrupted by prose", () => {
    expect(
      parseLegacyCodexPlanPreview(
        [
          "Plan updated",
          "[completed] Inspect logs",
          "Actually, hold on — one more thought.",
          "[pending] Verify UI",
        ].join("\n"),
      ),
    ).toBeNull();
  });
});
