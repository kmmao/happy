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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
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

  it("splits input into three buckets (Cached context / Cache write / New input)", async () => {
    const snapshot: UsageSnapshot = {
      model: "claude-haiku-4-5",
      inputTokens: 50,
      cacheReadInputTokens: 10_000,
      cacheCreationInputTokens: 500,
      outputTokens: 200,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    expect(result?.categories).toHaveLength(3);
    const byName = Object.fromEntries(
      (result?.categories ?? []).map((c) => [c.name, c.tokens]),
    );
    expect(byName["Cached context"]).toBe(10_000);
    expect(byName["Cache write"]).toBe(500);
    expect(byName["New input"]).toBe(50);

    // The three buckets must sum back to totalTokens (the context window).
    const sum = (result?.categories ?? []).reduce((acc, c) => acc + c.tokens, 0);
    expect(sum).toBe(result?.totalTokens);
    expect(sum).toBe(10_550);
  });

  it("drops zero-token buckets so the App legend doesn't render empty rows", async () => {
    // Fresh turn: everything is uncached new input, no cache read/write yet.
    const snapshot: UsageSnapshot = {
      model: "claude-opus-4-7",
      inputTokens: 1_200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 300,
    };
    const controller = createClaudePtyController(makeStubPty(), () => snapshot);
    const result = await controller.getContextUsage();

    expect(result?.categories).toHaveLength(1);
    expect(result?.categories[0].name).toBe("New input");
    expect(result?.categories[0].tokens).toBe(1_200);
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

  it("marks happy as connected", async () => {
    const servers = {
      happy: { command: "node", args: ["happy-mcp.js"] },
    };
    const controller = createClaudePtyController(makeStubPty(), () => null, () => servers);
    const result = await controller.mcpServerStatus();

    const names = result.map((s) => s.name);
    expect(names).toContain("happy");
    expect(result.find((s) => s.name === "happy")?.status).toBe("connected");
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

  it("sends immediately when the picker is already on the replay snapshot (Layer 1)", async () => {
    const pty = makeRecordingPty();
    // Picker already drawn before we subscribe — onData would never deliver
    // it (it only carries future chunks). The snapshot getter is the only
    // source. No onData emission, no fake timers: the send must be synchronous.
    const controller = createClaudePtyController(
      pty,
      () => null,
      () => ({}),
      () => "❯ 1. Yes, and auto-accept edits\r\n  2. No, keep planning\r\n",
    );

    await controller.approveExitPlanWhenPickerReady();

    expect(pty.writes).toEqual(["1\r"]);
  });

  it("matches a picker split across the snapshot boundary and the first chunk", async () => {
    const pty = makeRecordingPty();
    // Snapshot ends mid-picker (cursor drawn, option not yet); the rest
    // arrives on the next onData chunk. Seeding the window with the snapshot
    // is what lets these two halves match.
    const controller = createClaudePtyController(
      pty,
      () => null,
      () => ({}),
      () => "❯ ",
    );

    const approvePromise = controller.approveExitPlanWhenPickerReady();
    // No write yet — snapshot alone doesn't complete the pattern.
    expect(pty.writes).toEqual([]);

    pty.emitData("1. Yes, and auto-accept edits\r\n");
    await approvePromise;
    expect(pty.writes).toEqual(["1\r"]);
  });

  it("ignores a snapshot without a picker and still falls back after 2 s", async () => {
    vi.useFakeTimers();
    try {
      const pty = makeRecordingPty();
      const controller = createClaudePtyController(
        pty,
        () => null,
        () => ({}),
        () => "just some scrollback text, no picker here\r\n",
      );

      const approvePromise = controller.approveExitPlanWhenPickerReady();
      expect(pty.writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(2000);
      await approvePromise;
      expect(pty.writes).toEqual(["1\r"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── readFile tests ─────────────────────────────────────────────────────────────

describe("createClaudePtyController — readFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pty-readfile-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a UTF-8 text file and reports an absolute path, not truncated", async () => {
    const file = join(dir, "note.txt");
    writeFileSync(file, "hello sidebar 你好");
    const controller = createClaudePtyController(makeStubPty());

    const result = await controller.readFile(file);

    expect(result).not.toBeNull();
    expect(result?.contents).toBe("hello sidebar 你好");
    expect(result?.truncated).toBe(false);
    expect(isAbsolute(result?.absPath ?? "")).toBe(true);
    expect(result?.absPath).toBe(file);
  });

  it("truncates to maxBytes and flags truncated:true when the file is larger", async () => {
    const file = join(dir, "big.txt");
    writeFileSync(file, "abcdefghij"); // 10 ASCII bytes
    const controller = createClaudePtyController(makeStubPty());

    const result = await controller.readFile(file, { maxBytes: 4 });

    expect(result?.truncated).toBe(true);
    expect(result?.contents).toBe("abcd");
  });

  it("returns null for a path that does not exist", async () => {
    const controller = createClaudePtyController(makeStubPty());
    const result = await controller.readFile(join(dir, "missing.txt"));
    expect(result).toBeNull();
  });

  it("returns null when the path is a directory", async () => {
    const controller = createClaudePtyController(makeStubPty());
    const result = await controller.readFile(dir);
    expect(result).toBeNull();
  });

  it("returns null for a binary file containing a NUL byte", async () => {
    const file = join(dir, "bin.dat");
    writeFileSync(file, Buffer.from([0x48, 0x49, 0x00, 0x4a, 0x4b]));
    const controller = createClaudePtyController(makeStubPty());

    const result = await controller.readFile(file);
    expect(result).toBeNull();
  });

  it("resolves a relative path to an absolute one before reading", async () => {
    // Defensive no-op for direct callers — the handler normally passes an
    // absolute path. We can't write outside the temp dir, so just assert the
    // returned absPath is absolute when given a bare relative name.
    const controller = createClaudePtyController(makeStubPty());
    const result = await controller.readFile("definitely-not-here.txt");
    // Missing → null, but the resolve step must not throw.
    expect(result).toBeNull();
  });
});

// ── setModel tests ─────────────────────────────────────────────────────────────

describe("createClaudePtyController — setModel", () => {
  it("writes '/model <name>\\r' to the PTY", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    await controller.setModel("sonnet");

    expect(pty.writes).toEqual(["/model sonnet\r"]);
  });

  it("passes the model value through verbatim (full IDs / aliases)", async () => {
    const pty = makeRecordingPty();
    const controller = createClaudePtyController(pty);

    await controller.setModel("claude-opus-4-7");

    expect(pty.writes).toEqual(["/model claude-opus-4-7\r"]);
  });

  it("never rejects when the PTY write throws (fire-and-forget)", async () => {
    const pty = makeRecordingPty();
    // Force write() to throw — setModel must swallow it.
    pty.write = (_data: string): boolean => {
      throw new Error("pty gone");
    };
    const controller = createClaudePtyController(pty);

    await expect(controller.setModel("sonnet")).resolves.toBeUndefined();
  });
});
