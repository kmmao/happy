import { describe, expect, it } from "vitest";
import { shouldHideToolCall, isEffectivelyHiddenToolCall } from "./shouldHideToolCall";
import type { ToolCall } from "@/sync/typesMessage";

function createToolCall(overrides: Partial<ToolCall>): ToolCall {
  return {
    name: "Bash",
    state: "running",
    input: {},
    createdAt: 0,
    startedAt: 0,
    completedAt: null,
    description: null,
    ...overrides,
  };
}

describe("shouldHideToolCall", () => {
  it("hides successful Happy title updates", () => {
    expect(
      shouldHideToolCall(
        createToolCall({
          name: "mcp__happy__change_title",
          state: "completed",
          result: 'Successfully changed chat title to: "排查标题更新"',
        }),
      ),
    ).toBe(true);
  });

  it("hides in-flight Happy title updates once they are not awaiting permission", () => {
    expect(
      shouldHideToolCall(
        createToolCall({
          name: "change_title",
          state: "running",
        }),
      ),
    ).toBe(true);
  });

  it("keeps pending title permission requests visible", () => {
    expect(
      shouldHideToolCall(
        createToolCall({
          name: "happy__change_title",
          state: "running",
          permission: {
            id: "perm-1",
            status: "pending",
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps failed title updates visible", () => {
    expect(
      shouldHideToolCall(
        createToolCall({
          name: "mcp__happy__change_title",
          state: "error",
          result: { error: "title update failed" },
        }),
      ),
    ).toBe(false);
  });

  it("does not hide unrelated tools", () => {
    expect(
      shouldHideToolCall(
        createToolCall({
          name: "Bash",
          state: "completed",
        }),
      ),
    ).toBe(false);
  });
});

describe("isEffectivelyHiddenToolCall", () => {
  it("hides internal plumbing tools (isHiddenTool rule)", () => {
    // ToolSearch is never rendered but is NOT a Happy MCP tool, so only the
    // name-based rule catches it — the composite must still return true.
    expect(
      isEffectivelyHiddenToolCall(createToolCall({ name: "ToolSearch", state: "completed" })),
    ).toBe(true);
    // shouldHideToolCall alone does not hide it:
    expect(
      shouldHideToolCall(createToolCall({ name: "ToolSearch", state: "completed" })),
    ).toBe(false);
  });

  it("hides successful Happy MCP tools (shouldHideToolCall rule)", () => {
    expect(
      isEffectivelyHiddenToolCall(
        createToolCall({
          name: "mcp__happy__change_title",
          state: "completed",
          result: "Successfully changed chat title",
        }),
      ),
    ).toBe(true);
  });

  it("keeps ordinary and pending-permission tools visible", () => {
    expect(
      isEffectivelyHiddenToolCall(createToolCall({ name: "Bash", state: "completed" })),
    ).toBe(false);
    expect(
      isEffectivelyHiddenToolCall(
        createToolCall({
          name: "mcp__happy__change_title",
          state: "running",
          permission: { id: "perm-1", status: "pending" },
        }),
      ),
    ).toBe(false);
  });
});
