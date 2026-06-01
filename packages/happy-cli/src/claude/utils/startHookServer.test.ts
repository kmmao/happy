/**
 * startHookServer — typed dispatch coverage.
 *
 * The hook server is a thin HTTP receiver: it parses one JSON body per POST,
 * looks at `hook_event_name`, and calls one of the typed callbacks. These
 * tests pin that wiring so a future change to the dispatch table (e.g. a
 * forgotten event name) breaks loudly instead of silently routing through
 * the SessionStart fallback.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startHookServer, type HookServer, type HookServerOptions } from "./startHookServer";

let server: HookServer | null = null;

beforeEach(() => {
  server = null;
});

afterEach(() => {
  server?.stop();
});

type Calls = {
  sessionHook: Array<{ sessionId: string; event: string | undefined }>;
  stopFailure: number;
  cwdChanged: Array<{ old: string; next: string }>;
  fileChanged: Array<{ filePath: string; event: string }>;
  worktreeCreate: Array<{ name: string }>;
  worktreeRemove: Array<{ path: string }>;
  instructionsLoaded: Array<{ filePath: string; memoryType: string }>;
  permissionDenied: Array<{ toolName: string; reason: string }>;
  postToolBatch: Array<{ count: number }>;
};

function newCalls(): Calls {
  return {
    sessionHook: [],
    stopFailure: 0,
    cwdChanged: [],
    fileChanged: [],
    worktreeCreate: [],
    worktreeRemove: [],
    instructionsLoaded: [],
    permissionDenied: [],
    postToolBatch: [],
  };
}

function optionsFor(calls: Calls): HookServerOptions {
  return {
    onSessionHook: (sessionId, data) =>
      calls.sessionHook.push({ sessionId, event: data.hook_event_name }),
    onStopFailure: () => {
      calls.stopFailure += 1;
    },
    onCwdChanged: (data) =>
      calls.cwdChanged.push({ old: data.old_cwd, next: data.new_cwd }),
    onFileChanged: (data) =>
      calls.fileChanged.push({ filePath: data.file_path, event: data.event }),
    onWorktreeCreate: (data) =>
      calls.worktreeCreate.push({ name: data.name }),
    onWorktreeRemove: (data) =>
      calls.worktreeRemove.push({ path: data.worktree_path }),
    onInstructionsLoaded: (data) =>
      calls.instructionsLoaded.push({
        filePath: data.file_path,
        memoryType: data.memory_type,
      }),
    onPermissionDenied: (data) =>
      calls.permissionDenied.push({
        toolName: data.tool_name,
        reason: data.reason,
      }),
    onPostToolBatch: (data) =>
      calls.postToolBatch.push({ count: data.tool_calls.length }),
  };
}

async function postHook(port: number, body: Record<string, unknown>): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Drain so the socket can be reused / closed cleanly.
  await res.text();
  return res.status;
}

describe("startHookServer dispatch", () => {
  it("routes CwdChanged to onCwdChanged (NOT to onSessionHook fallback)", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    const status = await postHook(server.port, {
      hook_event_name: "CwdChanged",
      session_id: "s1",
      old_cwd: "/a",
      new_cwd: "/b",
    });

    expect(status).toBe(200);
    expect(calls.cwdChanged).toEqual([{ old: "/a", next: "/b" }]);
    expect(calls.sessionHook).toEqual([]); // critical: do not poison sessionId
  });

  it("routes FileChanged with each event variant", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    for (const event of ["change", "add", "unlink"] as const) {
      await postHook(server.port, {
        hook_event_name: "FileChanged",
        file_path: `/x/${event}.ts`,
        event,
      });
    }

    expect(calls.fileChanged).toEqual([
      { filePath: "/x/change.ts", event: "change" },
      { filePath: "/x/add.ts", event: "add" },
      { filePath: "/x/unlink.ts", event: "unlink" },
    ]);
    expect(calls.sessionHook).toEqual([]);
  });

  it("routes WorktreeCreate / WorktreeRemove to their distinct callbacks", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    await postHook(server.port, {
      hook_event_name: "WorktreeCreate",
      name: "feature-x",
    });
    await postHook(server.port, {
      hook_event_name: "WorktreeRemove",
      worktree_path: "/repos/foo/.worktrees/feature-x",
    });

    expect(calls.worktreeCreate).toEqual([{ name: "feature-x" }]);
    expect(calls.worktreeRemove).toEqual([
      { path: "/repos/foo/.worktrees/feature-x" },
    ]);
    expect(calls.sessionHook).toEqual([]);
  });

  it("routes InstructionsLoaded / PermissionDenied / PostToolBatch to their distinct callbacks (NOT the SessionStart fallback)", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    await postHook(server.port, {
      hook_event_name: "InstructionsLoaded",
      file_path: "/repo/CLAUDE.md",
      memory_type: "Project",
      load_reason: "session_start",
    });
    await postHook(server.port, {
      hook_event_name: "PermissionDenied",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
      tool_use_id: "tu_1",
      reason: "blocked by deny rule",
    });
    await postHook(server.port, {
      hook_event_name: "PostToolBatch",
      tool_calls: [
        { tool_name: "Read", tool_input: {}, tool_use_id: "a" },
        { tool_name: "Grep", tool_input: {}, tool_use_id: "b" },
      ],
    });

    expect(calls.instructionsLoaded).toEqual([
      { filePath: "/repo/CLAUDE.md", memoryType: "Project" },
    ]);
    expect(calls.permissionDenied).toEqual([
      { toolName: "Bash", reason: "blocked by deny rule" },
    ]);
    expect(calls.postToolBatch).toEqual([{ count: 2 }]);
    expect(calls.sessionHook).toEqual([]); // critical: do not poison sessionId
  });

  it("falls through unknown event names to SessionStart (forward-compatible)", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    await postHook(server.port, {
      hook_event_name: "SomeFutureEvent",
      session_id: "future-id",
    });

    expect(calls.sessionHook).toEqual([
      { sessionId: "future-id", event: "SomeFutureEvent" },
    ]);
  });

  it("StopFailure still routes to onStopFailure (regression guard)", async () => {
    const calls = newCalls();
    server = await startHookServer(optionsFor(calls));

    await postHook(server.port, {
      hook_event_name: "StopFailure",
      error: "rate_limit",
    });

    expect(calls.stopFailure).toBe(1);
    expect(calls.sessionHook).toEqual([]);
  });

  it("absent onCwdChanged is a no-op (does NOT fall back to onSessionHook)", async () => {
    // Optional callbacks staying unset must not silently re-route the event
    // to a different consumer — they should drop on the floor instead.
    const calls = newCalls();
    server = await startHookServer({
      onSessionHook: (sessionId, data) =>
        calls.sessionHook.push({ sessionId, event: data.hook_event_name }),
      // onCwdChanged is intentionally omitted
    });

    await postHook(server.port, {
      hook_event_name: "CwdChanged",
      session_id: "s2",
      old_cwd: "/a",
      new_cwd: "/b",
    });

    expect(calls.sessionHook).toEqual([]);
    expect(calls.cwdChanged).toEqual([]);
  });
});
