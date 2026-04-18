import { describe, expect, it } from "vitest";
import {
  HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES,
  HAPPY_MCP_SILENT_SUCCESS_TOOL_NAMES,
  HAPPY_MCP_TOOL_NAMES,
  getHappyMcpToolAction,
  getHappyMcpToolAliases,
  getHappyMcpToolTitle,
  isHappyMcpToolAlias,
  normalizeHappyMcpToolName,
  shouldAutoApproveHappyMcpReason,
} from "./happyMcp";

describe("happyMcp", () => {
  it("normalizes happy tool aliases back to canonical names", () => {
    expect(normalizeHappyMcpToolName("mcp__happy__update_progress")).toBe(
      "update_progress",
    );
    expect(normalizeHappyMcpToolName("happy__change_title")).toBe(
      "change_title",
    );
    expect(normalizeHappyMcpToolName("CodexPatch")).toBeNull();
  });

  it("derives aliases and titles from the shared tool spec", () => {
    expect(getHappyMcpToolAliases("change_title")).toEqual([
      "change_title",
      "happy__change_title",
      "mcp__happy__change_title",
    ]);
    expect(getHappyMcpToolTitle("mcp__happy__update_session_summary")).toBe(
      "Update Session Summary",
    );
    expect(
      getHappyMcpToolAction("happy__query_project_knowledge", "dynamic"),
    ).toBe("Searching project knowledge");
  });

  it("keeps policy-oriented subsets in sync with the shared spec", () => {
    expect(HAPPY_MCP_TOOL_NAMES).toContain("update_progress");
    expect(HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES).toEqual([
      "change_title",
      "update_progress",
      "update_session_summary",
    ]);
    expect(HAPPY_MCP_SILENT_SUCCESS_TOOL_NAMES).toEqual(["change_title"]);
    expect(
      isHappyMcpToolAlias("mcp__happy__update_progress", "update_progress"),
    ).toBe(true);
  });

  it("auto-approves only blessed happy reason phrases", () => {
    expect(
      shouldAutoApproveHappyMcpReason("Allow Happy MCP title updates"),
    ).toBe(true);
    expect(
      shouldAutoApproveHappyMcpReason("Allow Happy MCP session summary write"),
    ).toBe(true);
    expect(
      shouldAutoApproveHappyMcpReason("Allow Happy MCP project knowledge lookup"),
    ).toBe(false);
  });
});
