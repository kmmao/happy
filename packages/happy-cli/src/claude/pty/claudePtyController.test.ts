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

import { describe, it, expect, vi } from "vitest";
import { createClaudePtyController, type UsageSnapshot } from "./claudePtyController";
import type { ClaudePtyDataHandler, ClaudePtyHandle } from "./claudePtyRuntime";

// ── Minimal stub PTY ──────────────────────────────────────────────────────────

function makeStubPty(): ClaudePtyHandle {
  return {
    get pid() { return 1234; },
    get cols() { return 80; },
    get rows() { return 24; },
    get exited() { return false; },
    write() { return true; },
    resize() { return true; },
    interrupt() { return true; },
    kill() {},
    onData() { return () => undefined; },
    onExit() { return () => undefined; },
  };
}

/**
 * Stub PTY that records every `write()` call and exposes an `emitData()`
 * hook so tests can drive `onData` listeners synchronously. Used by both
 * `approveExitPlan` (writes-only) and `approveExitPlanWhenPickerReady`
 * (which needs to react to PTY output) tests.
 */
function makeRecordingPty(): ClaudePtyHandle & {
  writes: string[];
  emitData: (data: string) => void;
} {
  const writes: string[] = [];
  const dataHandlers = new Set<ClaudePtyDataHandler>();
  return {
    get pid() { return 1234; },
    get cols() { return 80; },
    get rows() { return 24; },
    get exited() { return false; },
    write(data: string) { writes.push(data); return true; },
    resize() { return true; },
    interrupt() { return true; },
    kill() {},
    onData(handler: ClaudePtyDataHandler) {
      dataHandlers.add(handler);
      return () => { dataHandlers.delete(handler); };
    },
    onExit() { return () => undefined; },
    writes,
    emitData(data: string) {
      // Iterate a copy so handlers that unsubscribe themselves (the
      // common case for one-shot picker detection) don't mutate the
      // set we're iterating over.
      for (const handler of [...dataHandlers]) handler(data);
    },
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

// ── approveExitPlanWhenPickerReady tests ──────────────────────────────────────

describe("createClaudePtyController — approveExitPlanWhenPickerReady", () => {
  it("sends '1\\r' as soon as the picker pattern appears in output", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    const approvePromise = controller.approveExitPlanWhenPickerReady();

    // Picker render with the canonical "❯ 1. Yes ..." shape.
    pty.emitData("\x1b[2J❯ 1. Yes, and auto-accept edits\r\n  2. No, keep planning\r\n");

    await approvePromise;
    expect(pty.writes).toEqual(["1\r"]);
  });

  it("tolerates ANSI escapes between the cursor and the option number", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    const approvePromise = controller.approveExitPlanWhenPickerReady();

    // Real TUI output has colour codes between the glyphs — verify the
    // 80-char gap absorbs them rather than matching the literal cursor
    // glyph only.
    pty.emitData("\x1b[0;90m❯\x1b[0m \x1b[1m1.\x1b[0m Yes, and auto-accept edits\r\n");

    await approvePromise;
    expect(pty.writes).toEqual(["1\r"]);
  });

  it("matches when the picker render is split across multiple data chunks", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    const approvePromise = controller.approveExitPlanWhenPickerReady();

    // Single chunk containing only the cursor — no match yet.
    pty.emitData("❯ ");
    expect(pty.writes).toEqual([]);

    // Next chunk completes the pattern — should fire now.
    pty.emitData("1. Yes, and auto-accept edits\r\n");

    await approvePromise;
    expect(pty.writes).toEqual(["1\r"]);
  });

  it("only writes once even if picker pattern matches multiple data chunks", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    const approvePromise = controller.approveExitPlanWhenPickerReady();

    pty.emitData("❯ 1. Yes, and auto-accept edits\r\n");
    // Picker re-render (e.g. cursor blink) after we already sent — must
    // not double-send into the next prompt.
    pty.emitData("❯ 1. Yes, and auto-accept edits\r\n");

    await approvePromise;
    expect(pty.writes).toEqual(["1\r"]);
  });

  it("ignores unrelated output that doesn't contain the picker pattern", async () => {
    vi.useFakeTimers();
    try {
      const pty = makeRecordingPty();
      const controller = createClaudePtyController(pty);

      const approvePromise = controller.approveExitPlanWhenPickerReady();

      // Noise: agent text, ANSI redraws, etc. — none of it should trigger
      // the keystroke before the 2 s fallback.
      pty.emitData("some agent output mentioning step 1. Yes we should...\r\n");
      pty.emitData("\x1b[H\x1b[2J");
      expect(pty.writes).toEqual([]);

      // Advance to the fallback boundary — keystroke must fire blindly.
      await vi.advanceTimersByTimeAsync(2000);
      await approvePromise;
      expect(pty.writes).toEqual(["1\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a blind '1\\r' after 2 s when the picker never appears", async () => {
    vi.useFakeTimers();
    try {
      const pty = makeRecordingPty();
      const controller = createClaudePtyController(pty);

      const approvePromise = controller.approveExitPlanWhenPickerReady();

      // No data emitted — covers the "picker drawn before subscribe" case
      // where the launcher's JSONL-driven detection ran late.
      expect(pty.writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(2000);
      await approvePromise;
      expect(pty.writes).toEqual(["1\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not match prose that looks superficially like a picker", async () => {
    vi.useFakeTimers();
    try {
      const pty = makeRecordingPty();
      const controller = createClaudePtyController(pty);

      const approvePromise = controller.approveExitPlanWhenPickerReady();

      // None of these should fire the immediate match — they're patterns
      // a plan or agent message could plausibly contain:
      //  - `Step 1.` prose without the picker cursor
      //  - the cursor glyph used as a list bullet without a numbered option
      //  - a decimal value `1.5kg`
      pty.emitData("Plan: Step 1. First, edit the file...\r\n");
      pty.emitData("❯ Now planning your refactor in detail...\r\n");
      pty.emitData("❯ 1.5kg of dependencies — not the picker\r\n");
      expect(pty.writes).toEqual([]);

      // Confirm the fallback still fires so the session isn't deadlocked
      // even though detection rejected everything.
      await vi.advanceTimersByTimeAsync(2000);
      await approvePromise;
      expect(pty.writes).toEqual(["1\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes from onData once the keystroke is sent", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    const approvePromise = controller.approveExitPlanWhenPickerReady();

    pty.emitData("❯ 1. Yes, and auto-accept edits\r\n");
    await approvePromise;

    // Subsequent picker-shaped output (e.g. a later, unrelated picker in
    // the same session) must not re-trigger a stale send.
    pty.emitData("❯ 1. Yes, and auto-accept edits\r\n");
    expect(pty.writes).toEqual(["1\r"]);
  });
});
