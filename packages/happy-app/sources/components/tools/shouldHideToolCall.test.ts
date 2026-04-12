import { describe, expect, it } from "vitest";
import { shouldHideToolCall } from "./shouldHideToolCall";
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
