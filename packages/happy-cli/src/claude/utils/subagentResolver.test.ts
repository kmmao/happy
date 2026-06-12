import { describe, expect, it } from "vitest";
import { createSubagentResolver } from "@/claude/utils/subagentResolver";
import type { RawJSONLines } from "@/claude/types";

function raw(record: Record<string, unknown>): RawJSONLines {
  return record as unknown as RawJSONLines;
}

describe("SubagentResolver", () => {
  it("resolves explicit parent_tool_use_id (and camelCase variant)", () => {
    const resolver = createSubagentResolver();
    expect(
      resolver.resolveProvider(raw({ type: "assistant", parent_tool_use_id: "task-1" })),
    ).toBe("task-1");
    expect(
      resolver.resolveProvider(raw({ type: "assistant", parentToolUseId: "task-2" })),
    ).toBe("task-2");
  });

  it("inherits the provider subagent from a remembered parent uuid on sidechain records", () => {
    const resolver = createSubagentResolver();
    resolver.rememberMessage(
      raw({ type: "assistant", uuid: "u-root" }),
      "task-1",
    );

    expect(
      resolver.resolveProvider(
        raw({ type: "assistant", isSidechain: true, parentUuid: "u-root" }),
      ),
    ).toBe("task-1");
    // Non-sidechain records never inherit
    expect(
      resolver.resolveProvider(
        raw({ type: "assistant", parentUuid: "u-root" }),
      ),
    ).toBeUndefined();
  });

  it("matches a sidechain root to its Task registration by prompt, FIFO per prompt", () => {
    const resolver = createSubagentResolver();
    resolver.registerTaskCall("task-a", { prompt: "find the bug" });
    resolver.registerTaskCall("task-b", { prompt: "find the bug" });

    const sidechainRoot = raw({
      type: "user",
      isSidechain: true,
      message: { role: "user", content: "find the bug" },
    });
    expect(resolver.resolveProvider(sidechainRoot)).toBe("task-a");
    expect(resolver.resolveProvider(sidechainRoot)).toBe("task-b");
    expect(resolver.resolveProvider(sidechainRoot)).toBeUndefined();
  });

  it("falls back to the single pending registration only when unambiguous", () => {
    const resolver = createSubagentResolver();
    resolver.registerTaskCall("task-a", { prompt: "alpha" });

    const orphanRoot = raw({
      type: "user",
      isSidechain: true,
      message: { role: "user", content: "completely different text" },
    });
    expect(resolver.resolveProvider(orphanRoot)).toBe("task-a");

    resolver.registerTaskCall("task-b", { prompt: "beta" });
    resolver.registerTaskCall("task-c", { prompt: "gamma" });
    expect(resolver.resolveProvider(orphanRoot)).toBeUndefined();
  });

  it("assigns one stable session id per provider subagent", () => {
    const resolver = createSubagentResolver();
    expect(resolver.sessionIdFor("task-1")).toBeUndefined();
    const id = resolver.ensureSessionId("task-1");
    expect(resolver.ensureSessionId("task-1")).toBe(id);
    expect(resolver.sessionIdFor("task-1")).toBe(id);
  });

  it("titles the Subagent from the Task call input, preferring description over prompt", () => {
    const resolver = createSubagentResolver();
    resolver.registerTaskCall("task-1", {
      prompt: "long prompt text",
      description: "Explore the repo",
    });
    resolver.registerTaskCall("task-2", { prompt: "prompt-only" });

    expect(resolver.titleFor(resolver.ensureSessionId("task-1"))).toBe(
      "Explore the repo",
    );
    expect(resolver.titleFor(resolver.ensureSessionId("task-2"))).toBe(
      "prompt-only",
    );
  });

  it("buffers and drains records per provider subagent", () => {
    const resolver = createSubagentResolver();
    const first = raw({ type: "assistant", uuid: "m1" });
    const second = raw({ type: "assistant", uuid: "m2" });
    resolver.buffer("task-1", first);
    resolver.buffer("task-1", second);

    expect(resolver.consumeBuffered("task-1")).toEqual([first, second]);
    expect(resolver.consumeBuffered("task-1")).toEqual([]);
  });

  it("clear() drops identity, registrations, titles, and buffers", () => {
    const resolver = createSubagentResolver();
    resolver.registerTaskCall("task-1", { prompt: "alpha" });
    const id = resolver.ensureSessionId("task-1");
    resolver.buffer("task-1", raw({ type: "assistant" }));
    resolver.rememberMessage(raw({ type: "assistant", uuid: "u1" }), "task-1");

    resolver.clear();

    expect(resolver.sessionIdFor("task-1")).toBeUndefined();
    expect(resolver.titleFor(id)).toBeUndefined();
    expect(resolver.consumeBuffered("task-1")).toEqual([]);
    expect(
      resolver.resolveProvider(
        raw({ type: "assistant", isSidechain: true, parentUuid: "u1" }),
      ),
    ).toBeUndefined();
  });
});
