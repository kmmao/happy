/**
 * claudePtyController — getContextUsage + mcpServerStatus tests.
 *
 * Verifies that when a UsageSnapshot is provided the controller returns a
 * well-formed GetContextUsageResponse, and returns null when no snapshot
 * is available (PTY mode before the first assistant turn).
 *
 * Also verifies that mcpServerStatus() maps the launch-time mcpServers config
 * to a status list. PTY mode has no live MCP connection feedback, so every
 * non-disabled MCP is reported as "connected" optimistically; entries flagged
 * `disabled: true` are reported as "disabled".
 *
 * We use a minimal stub PTY handle so these tests never spawn a real process.
 */

import { describe, it, expect } from "vitest";
import { createClaudePtyController, type UsageSnapshot } from "./claudePtyController";
import type { ClaudePtyHandle } from "./claudePtyRuntime";

// ── Minimal stub PTY ──────────────────────────────────────────────────────────

function makeStubPty(): ClaudePtyHandle {
  return {
    get pid() { return 1234; },
    get cols() { return 80; },
    get rows() { return 24; },
    get exited() { return false; },
    write() {},
    resize() {},
    interrupt() {},
    kill() {},
    onData() { return () => undefined; },
    onExit() { return () => undefined; },
  };
}

/**
 * Stub PTY that records every `write()` call. Used to assert that
 * `approveExitPlan()` actually pushes the expected bytes to PTY stdin.
 */
function makeRecordingPty(): ClaudePtyHandle & { writes: string[] } {
  const writes: string[] = [];
  return {
    get pid() { return 1234; },
    get cols() { return 80; },
    get rows() { return 24; },
    get exited() { return false; },
    write(data: string) { writes.push(data); },
    resize() {},
    interrupt() {},
    kill() {},
    onData() { return () => undefined; },
    onExit() { return () => undefined; },
    writes,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createClaudePtyController — getContextUsage", () => {
  it("returns null when no usage snapshot is available", async () => {
    const controller = createClaudePtyController(makeStubPty(), () => null);
    const result = await controller.getContextUsage();
    expect(result).toBeNull();
  });

  it("computes totalTokens as sum of all three input buckets", async () => {
    const snapshot: UsageSnapshot = {
      model: "claude-opus-4-7",
      inputTokens: 100,
      cacheReadInputTokens: 50_000,
      cacheCreationInputTokens: 2_000,
      outputTokens: 800,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    // totalTokens = input + cacheRead + cacheCreate (NOT output)
    expect(result?.totalTokens).toBe(52_100);
  });

  it("derives maxTokens and percentage from model name", async () => {
    const snapshot: UsageSnapshot = {
      model: "claude-opus-4-7",
      inputTokens: 0,
      cacheReadInputTokens: 100_000,
      cacheCreationInputTokens: 0,
      outputTokens: 500,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    expect(result?.maxTokens).toBe(200_000);
    expect(result?.percentage).toBeCloseTo(50, 1);
  });

  it("maps apiUsage fields directly from the snapshot", async () => {
    const snapshot: UsageSnapshot = {
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      cacheReadInputTokens: 5_000,
      cacheCreationInputTokens: 200,
      outputTokens: 300,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    expect(result?.apiUsage).toEqual({
      input_tokens: 10,
      output_tokens: 300,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 5_000,
    });
  });

  it("returns a single 'Conversation' category covering all input tokens", async () => {
    const snapshot: UsageSnapshot = {
      model: "claude-haiku-4-5",
      inputTokens: 50,
      cacheReadInputTokens: 10_000,
      cacheCreationInputTokens: 500,
      outputTokens: 200,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    expect(result?.categories).toHaveLength(1);
    expect(result?.categories[0].name).toBe("Conversation");
    expect(result?.categories[0].tokens).toBe(10_550); // 50 + 10000 + 500
  });

  it("reflects the latest snapshot when the getter is updated after creation", async () => {
    let current: UsageSnapshot | null = null;
    const controller = createClaudePtyController(makeStubPty(), () => current);

    // Before first assistant turn: null
    expect(await controller.getContextUsage()).toBeNull();

    // Simulate first assistant turn arriving
    current = {
      model: "claude-opus-4-7",
      inputTokens: 5,
      cacheReadInputTokens: 20_000,
      cacheCreationInputTokens: 1_000,
      outputTokens: 400,
    };
    const result = await controller.getContextUsage();
    expect(result?.totalTokens).toBe(21_005);
  });
});

// ── mcpServerStatus tests ─────────────────────────────────────────────────────

describe("createClaudePtyController — mcpServerStatus", () => {
  it("returns empty list when no mcpServers provided", async () => {
    const controller = createClaudePtyController(makeStubPty());
    const result = await controller.mcpServerStatus();
    expect(result).toEqual([]);
  });

  it("marks happy and happy-knowledge as connected", async () => {
    const servers = {
      happy: { command: "node", args: ["happy-mcp.js"] },
      "happy-knowledge": { command: "node", args: ["knowledge-mcp.js"] },
    };
    const controller = createClaudePtyController(makeStubPty(), () => null, () => servers);
    const result = await controller.mcpServerStatus();

    const names = result.map((s) => s.name);
    expect(names).toContain("happy");
    expect(names).toContain("happy-knowledge");
    expect(result.find((s) => s.name === "happy")?.status).toBe("connected");
    expect(result.find((s) => s.name === "happy-knowledge")?.status).toBe("connected");
  });

  it("marks user / plugin servers as connected (PTY has no live status, so we report optimistically)", async () => {
    const servers = {
      "my-server": { command: "npx", args: ["-y", "@my/mcp"] },
      "plugin:context7:context7": { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      happy: { command: "node", args: ["happy.js"] },
    };
    const controller = createClaudePtyController(makeStubPty(), () => null, () => servers);
    const result = await controller.mcpServerStatus();

    expect(result.find((s) => s.name === "my-server")?.status).toBe("connected");
    expect(result.find((s) => s.name === "plugin:context7:context7")?.status).toBe("connected");
    expect(result.find((s) => s.name === "happy")?.status).toBe("connected");
  });

  it("marks servers with disabled:true as disabled (others stay connected)", async () => {
    const servers = {
      "off-server": { command: "npx", args: ["-y", "@off/mcp"], disabled: true },
      "on-server": { command: "npx", args: ["-y", "@on/mcp"] },
    };
    const controller = createClaudePtyController(makeStubPty(), () => null, () => servers);
    const result = await controller.mcpServerStatus();

    expect(result.find((s) => s.name === "off-server")?.status).toBe("disabled");
    expect(result.find((s) => s.name === "on-server")?.status).toBe("connected");
  });

  it("reflects updated server list when getter changes", async () => {
    let current: Record<string, any> = {};
    const controller = createClaudePtyController(makeStubPty(), () => null, () => current);

    expect(await controller.mcpServerStatus()).toEqual([]);

    current = { "new-server": { command: "npx", args: [] } };
    const result = await controller.mcpServerStatus();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("new-server");
    expect(result[0].status).toBe("connected");
  });
});

// ── approveExitPlan tests ─────────────────────────────────────────────────────

describe("createClaudePtyController — approveExitPlan", () => {
  it("writes '1\\r' to PTY stdin to confirm the plan-mode dialog", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    await controller.approveExitPlan();

    expect(pty.writes).toEqual(["1\r"]);
  });

  it("is idempotent across multiple calls — each emits one keystroke", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    await controller.approveExitPlan();
    await controller.approveExitPlan();

    expect(pty.writes).toEqual(["1\r", "1\r"]);
  });
});
