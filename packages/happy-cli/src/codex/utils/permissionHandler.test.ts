import { describe, expect, it, vi } from "vitest";
import type { AgentState } from "@/api/types";
import { CodexPermissionHandler } from "./permissionHandler";

function createMockSession() {
  let agentState: AgentState = {};

  const session = {
    rpcHandlerManager: {
      registerHandler: vi.fn(),
    },
    updateAgentState(handler: (state: AgentState) => AgentState) {
      agentState = handler(agentState);
    },
  } as any;

  return {
    session,
    getAgentState: () => agentState,
  };
}

describe("CodexPermissionHandler", () => {
  it("auto-approves Happy title updates in default mode", async () => {
    const { session, getAgentState } = createMockSession();
    const handler = new CodexPermissionHandler(session);

    const result = await handler.handleToolCall(
      "title-call-1",
      "mcp__happy__change_title",
      { title: "修复标题自动更新" },
    );

    expect(result).toEqual({ decision: "approved" });
    expect(getAgentState().completedRequests?.["title-call-1"]).toMatchObject({
      tool: "mcp__happy__change_title",
      status: "approved",
      decision: "approved",
    });
    expect(getAgentState().requests).toBeUndefined();
  });

  it("auto-approves generic permission requests for Happy title updates", async () => {
    const { session, getAgentState } = createMockSession();
    const handler = new CodexPermissionHandler(session);

    const result = await handler.handleToolCall(
      "perm-title-1",
      "CodexPermissions",
      {
        itemId: "mcp-title-1",
        reason: "Allow Happy MCP title updates",
        permissions: {
          network: { enabled: true },
        },
      },
    );

    expect(result).toEqual({ decision: "approved" });
    expect(getAgentState().completedRequests?.["perm-title-1"]).toMatchObject({
      tool: "CodexPermissions",
      status: "approved",
      decision: "approved",
    });
  });

  it("auto-approves generic permissions in yolo mode for the whole session", async () => {
    const { session, getAgentState } = createMockSession();
    const handler = new CodexPermissionHandler(session);
    handler.setPermissionMode("yolo");

    const result = await handler.handleToolCall(
      "perm-yolo-1",
      "CodexPermissions",
      {
        itemId: "mcp-any-1",
        reason: "Need extra filesystem access",
        permissions: {
          fileSystem: {
            write: ["/tmp/worktree"],
          },
        },
      },
    );

    expect(result).toEqual({ decision: "approved_for_session" });
    expect(getAgentState().completedRequests?.["perm-yolo-1"]).toMatchObject({
      tool: "CodexPermissions",
      status: "approved",
      decision: "approved_for_session",
    });
  });
});
