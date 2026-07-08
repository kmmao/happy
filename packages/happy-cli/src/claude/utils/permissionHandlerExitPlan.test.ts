import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionHandler } from "./permissionHandler";
import type { Session } from "../session";

// Coverage for the new ExitPlanMode picker bridge (`registerExitPlanApproval`
// + its RPC-response wiring). The classic canCallTool flow is exercised
// elsewhere; here we only check the parts the plan-mode 429 mitigation
// adds — approve, reject with reason, timeout, and session-reset drain.
//
// The permissionHandler owns wire-format details (agentState.requests id
// shape, PLAN_FAKE_RESTART unshift), so we assert on the effects visible
// through the mocked Session rather than reaching into private state.

interface Captured {
  requests: Map<string, unknown>;
  completedRequests: Map<string, unknown>;
  pushCalls: Array<{ title: string; body: string; data: unknown }>;
  // Captured RPC "permission" handler so the test can synthesize an
  // App-side response.
  rpcHandler: ((msg: {
    id: string;
    approved: boolean;
    mode?: string;
    reason?: string;
    allowTools?: string[];
    answers?: Record<string, string>;
    clearContext?: boolean;
  }) => Promise<void>) | null;
}

function makeSession(): { session: Session; captured: Captured } {
  const captured: Captured = {
    requests: new Map(),
    completedRequests: new Map(),
    pushCalls: [],
    rpcHandler: null,
  };

  // Minimal agentState shape — a live-updated object the client mutator sees.
  const state: {
    requests?: Record<string, unknown>;
    completedRequests?: Record<string, unknown>;
    [k: string]: unknown;
  } = {};

  const client = {
    sessionId: "test-session-id",
    updateAgentState: (fn: (s: typeof state) => typeof state) => {
      const next = fn(state);
      // Persist mutations back to `state` so subsequent calls see the
      // accumulated agentState — mirrors the real ApiSessionClient.
      Object.keys(state).forEach((k) => delete state[k]);
      Object.assign(state, next);
      // Snapshot into captured Maps for assertions.
      captured.requests.clear();
      captured.completedRequests.clear();
      for (const [k, v] of Object.entries(state.requests ?? {})) {
        captured.requests.set(k, v);
      }
      for (const [k, v] of Object.entries(state.completedRequests ?? {})) {
        captured.completedRequests.set(k, v);
      }
    },
    rpcHandlerManager: {
      registerHandler: (
        _name: string,
        handler: Captured["rpcHandler"],
      ) => {
        captured.rpcHandler = handler;
      },
    },
  };

  const api = {
    push: () => ({
      sendToAllDevices: (title: string, body: string, data: unknown) => {
        captured.pushCalls.push({ title, body, data });
      },
    }),
  };

  const session = {
    client,
    api,
  } as unknown as Session;

  return { session, captured };
}

describe("PermissionHandler.registerExitPlanApproval", () => {
  let ph: PermissionHandler;
  let captured: Captured;
  let session: Session;

  beforeEach(() => {
    const built = makeSession();
    session = built.session;
    captured = built.captured;
    ph = new PermissionHandler(session);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes an ExitPlanMode entry into agentState.requests with a stable prefix", async () => {
    void ph.registerExitPlanApproval({ plan: "hello" }, 60_000);
    // Let microtasks flush so updateAgentState runs.
    await Promise.resolve();

    expect(captured.requests.size).toBe(1);
    const [id, entry] = [...captured.requests.entries()][0];
    expect(id).toMatch(/^exit-plan-/);
    expect(entry).toMatchObject({
      tool: "ExitPlanMode",
      arguments: { plan: "hello" },
    });
    expect(captured.pushCalls).toHaveLength(1);
    expect(captured.pushCalls[0].title).toBe("Plan ready to review");
  });

  it("resolves as approved with the picked mode when the App RPC returns approved", async () => {
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({
      id,
      approved: true,
      mode: "bypassPermissions",
    });

    await expect(promise).resolves.toEqual({
      approved: true,
      mode: "bypassPermissions",
      updatedInput: { plan: "hi" },
      clearContext: false,
    });
    // Request migrated from `requests` → `completedRequests`.
    expect(captured.requests.size).toBe(0);
    expect(captured.completedRequests.size).toBe(1);
    expect([...captured.completedRequests.values()][0]).toMatchObject({
      status: "approved",
    });
  });

  it("preserves the current permission mode when the App sends mode=undefined (Yolo user pressing plain 'Approve Plan' stays in Yolo)", async () => {
    // Regression for the code-review Finding #1: `?? "default"` silently
    // downgraded Yolo sessions. Fix: registerExitPlanApproval falls back
    // to `this.permissionMode` (the session's live mode) when the App
    // didn't pick one, matching the auto-approve path's behaviour.
    ph.handleModeChange("bypassPermissions");
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({ id, approved: true }); // mode omitted

    await expect(promise).resolves.toMatchObject({
      approved: true,
      mode: "bypassPermissions", // NOT "default"
    });
  });

  it("rejects a non-whitelist mode value from the App and falls back to current mode", async () => {
    // Defense-in-depth: if the App (or a mis-shaped future version) sends
    // an unrecognised mode string, treat it as unset — never propagate it
    // into `--permission-mode <garbage>` at spawn time.
    ph.handleModeChange("bypassPermissions");
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({
      id,
      approved: true,
      mode: "yolo-lite" as string, // not in the whitelist
    });

    await expect(promise).resolves.toMatchObject({
      approved: true,
      mode: "bypassPermissions", // fell back, garbage stripped
    });
  });

  it.each([
    ["default"],
    ["acceptEdits"],
    ["bypassPermissions"],
    ["auto"],
    ["dontAsk"],
  ])("accepts whitelisted mode %j verbatim", async (mode) => {
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({ id, approved: true, mode });
    await expect(promise).resolves.toMatchObject({ approved: true, mode });
  });

  it("forwards clearContext:true into the result (Layer 0 fresh-context opt-in)", async () => {
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({ id, approved: true, clearContext: true });

    await expect(promise).resolves.toMatchObject({
      approved: true,
      clearContext: true,
    });
  });

  it("defaults clearContext to false when the App omits it (classic continue path)", async () => {
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({ id, approved: true }); // no clearContext

    await expect(promise).resolves.toMatchObject({
      approved: true,
      clearContext: false,
    });
  });

  it("resolves as denied with reason when the App RPC returns approved=false", async () => {
    const promise = ph.registerExitPlanApproval({ plan: "hi" }, 60_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];
    await captured.rpcHandler!({
      id,
      approved: false,
      reason: "not detailed enough",
    });

    await expect(promise).resolves.toEqual({
      approved: false,
      reason: "not detailed enough",
    });
    expect([...captured.completedRequests.values()][0]).toMatchObject({
      status: "denied",
      reason: "not detailed enough",
    });
  });

  it("times out with 'Approval timeout' after the given timeoutMs", async () => {
    vi.useFakeTimers();
    const promise = ph.registerExitPlanApproval({ plan: "x" }, 10_000);
    await Promise.resolve();
    // Approaching but not crossing — still pending.
    await vi.advanceTimersByTimeAsync(9_999);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toEqual({ approved: false, reason: "Approval timeout" });
    expect([...captured.completedRequests.values()][0]).toMatchObject({
      status: "denied",
      reason: "Approval timeout",
    });
  });

  it("late RPC response after timeout is ignored (no double-resolve)", async () => {
    vi.useFakeTimers();
    const promise = ph.registerExitPlanApproval({ plan: "x" }, 5_000);
    await Promise.resolve();
    const [id] = [...captured.requests.keys()];

    await vi.advanceTimersByTimeAsync(5_000);
    await promise; // resolved as timeout

    // A late App click shouldn't throw or mutate state.
    await expect(
      captured.rpcHandler!({ id, approved: true, mode: "default" }),
    ).resolves.toBeUndefined();
  });

  it("routes only exit-plan- prefixed responses to the exit-plan pending map", async () => {
    // A random id that doesn't collide with the exit-plan prefix must
    // fall into the classic pendingRequests branch (which is empty in
    // this test) and log-skip cleanly.
    await expect(
      captured.rpcHandler!({ id: "random-uuid", approved: true }),
    ).resolves.toBeUndefined();
  });

  it("session reset resolves pending approvals as denied and clears the map", async () => {
    const promise = ph.registerExitPlanApproval({ plan: "x" }, 60_000);
    await Promise.resolve();

    ph.reset("Session ended");
    const result = await promise;
    expect(result).toEqual({ approved: false, reason: "Session ended" });
  });
});
