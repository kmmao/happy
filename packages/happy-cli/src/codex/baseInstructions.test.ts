import { describe, expect, it } from "vitest";

import { codexBaseInstructions } from "./baseInstructions";

describe("codexBaseInstructions", () => {
  it("tells Codex to maintain side-panel progress via Happy MCP tools", () => {
    expect(codexBaseInstructions).toContain("mcp__happy__update_progress");
    expect(codexBaseInstructions).toContain(
      "mcp__happy__update_session_summary",
    );
    expect(codexBaseInstructions).toContain("TodoWrite auto-mirror fallback");
  });
});
