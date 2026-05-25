import { describe, expect, it } from "vitest";
import {
  HAPPY_MCP_AUTO_APPROVE_TOOL_NAMES,
  HAPPY_MCP_SILENT_SUCCESS_TOOL_NAMES,
  HAPPY_MCP_TOOL_NAMES,
  HAPPY_MCP_TOOL_SPECS,
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

  it("allows update_session_summary to carry an optional requestId", () => {
    const schema = HAPPY_MCP_TOOL_SPECS.update_session_summary.inputSchema;

    expect(schema.requestId.safeParse(undefined).success).toBe(true);
    expect(schema.requestId.safeParse("summary-refresh_123").success).toBe(
      true,
    );
  });
});

describe("happyMcp array-arg coercion (LLM stringified arrays)", () => {
  const summary = HAPPY_MCP_TOOL_SPECS.update_session_summary.inputSchema;

  it("coerces a JSON-encoded string array back to a real array", () => {
    const r = summary.keyDecisions.safeParse('["a","b"]');
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual(["a", "b"]);
  });

  it("passes a real string array through unchanged", () => {
    const r = summary.impactScope.safeParse(["x", "y"]);
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual(["x", "y"]);
  });

  it("leaves optional string arrays omittable", () => {
    expect(summary.openQuestions.safeParse(undefined).success).toBe(true);
  });

  it("coerces a stringified object array and re-validates items", () => {
    const todos = HAPPY_MCP_TOOL_SPECS.update_progress.inputSchema.todos;
    const ok = todos.safeParse('[{"content":"do","status":"pending"}]');
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data).toEqual([
      { content: "do", status: "pending" },
    ]);
    // Malformed payload (bad status) is still rejected: we tolerate the
    // encoding mistake, not invalid data.
    const bad = todos.safeParse('[{"content":"do","status":"nope"}]');
    expect(bad.success).toBe(false);
  });

  it("coerces stringified ask_user questions including nested options", () => {
    const questions = HAPPY_MCP_TOOL_SPECS.ask_user.inputSchema.questions;
    const payload = JSON.stringify([
      {
        question: "Pick one",
        header: "Choice",
        options: [
          { label: "A", description: "first" },
          { label: "B", description: "second" },
        ],
        multiSelect: false,
      },
    ]);
    const r = questions.safeParse(payload);
    expect(r.success).toBe(true);
    const parsed = (r.success ? r.data : []) as Array<{ options: unknown[] }>;
    expect(parsed[0].options).toHaveLength(2);
  });
});
