import { describe, expect, it, vi } from "vitest";
import { buildMachineRpcRoutes } from "./machineRpcRoutes";
import type { MachineRpcHandlers } from "./apiMachine";

function makeHandlers(): MachineRpcHandlers {
  const fn = () => vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  return {
    spawnSession: vi.fn(async () => ({ type: "success", sessionId: "s-1" })),
    stopSession: vi.fn(() => true),
    requestShutdown: vi.fn(),
    getAutomationStatus: vi.fn(() => ({ jobs: [], counts: {} })),
    cancelAutomationJob: fn(),
    retryAutomationJob: fn(),
    removeAutomationJob: fn(),
    clearAutomationJobs: fn(),
    clearAutomationGuardians: fn(),
    clearAutomationAudit: fn(),
    setKillswitch: vi.fn(async () => ({ success: true, killed: false })),
    getKillswitch: vi.fn(() => ({ killed: false })),
    listAgentLoops: vi.fn(async () => []),
    getAgentLoop: fn(),
    createAgentLoop: fn(),
    updateAgentLoop: fn(),
    pauseAgentLoop: fn(),
    resumeAgentLoop: fn(),
    runAgentLoopNow: fn(),
    removeAgentLoop: fn(),
    emitAgentLoopEvent: fn(),
    suggestAgentLoops: vi.fn(async () => []),
    listAgentLoopBootstrapProfiles: vi.fn(async () => []),
    getAgentLoopBootstrapProfile: fn(),
    createAgentLoopBootstrapProfile: fn(),
    updateAgentLoopBootstrapProfile: fn(),
    pauseAgentLoopBootstrapProfile: fn(),
    resumeAgentLoopBootstrapProfile: fn(),
    runAgentLoopBootstrapProfileNow: fn(),
    removeAgentLoopBootstrapProfile: fn(),
    listAutoDreamProfiles: vi.fn(async () => []),
    getAutoDreamProfile: fn(),
    createAutoDreamProfile: fn(),
    updateAutoDreamProfile: fn(),
    pauseAutoDreamProfile: fn(),
    resumeAutoDreamProfile: fn(),
    runAutoDreamProfileNow: fn(),
    removeAutoDreamProfile: fn(),
    listTrackedSessions: vi.fn(() => []),
    listStaleSessions: vi.fn(async () => ({ sessions: [] })),
    cleanStaleSessions: fn(),
  } as unknown as MachineRpcHandlers;
}

function route(handlers: MachineRpcHandlers, method: string) {
  const found = buildMachineRpcRoutes(handlers).find((r) => r.method === method);
  if (!found) throw new Error(`route ${method} not found`);
  return found;
}

describe("buildMachineRpcRoutes", () => {
  it("pins the exact server-observable method list (ADR-0021)", () => {
    const methods = buildMachineRpcRoutes(makeHandlers()).map((r) => r.method);
    expect(methods).toEqual([
      "spawn-happy-session",
      "stop-session",
      "automation-status",
      "automation-cancel",
      "automation-retry",
      "automation-remove",
      "automation-clear",
      "automation-guardian-clear",
      "automation-audit-clear",
      "doctor-clean",
      "list-tracked-sessions",
      "list-stale-sessions",
      "clean-stale-sessions",
      "killswitch-set",
      "killswitch-get",
      "loop-list",
      "loop-get",
      "loop-create",
      "loop-update",
      "loop-pause",
      "loop-resume",
      "loop-run-now",
      "loop-remove",
      "loop-event",
      "loop-suggest",
      "loop-suggest-ai",
      "loop-get-context",
      "bootstrap-profile-list",
      "bootstrap-profile-get",
      "bootstrap-profile-create",
      "bootstrap-profile-update",
      "bootstrap-profile-pause",
      "bootstrap-profile-resume",
      "bootstrap-profile-run-now",
      "bootstrap-profile-remove",
      "dream-profile-list",
      "dream-profile-get",
      "dream-profile-create",
      "dream-profile-update",
      "dream-profile-pause",
      "dream-profile-resume",
      "dream-profile-run-now",
      "dream-profile-remove",
      "stop-daemon",
      "upgrade-self",
    ]);
    // No duplicate registrations.
    expect(new Set(methods).size).toBe(methods.length);
  });

  it("id-scoped routes reject a missing id with the historical message", async () => {
    const handlers = makeHandlers();
    const cases: Array<[string, string]> = [
      ["stop-session", "Session ID is required"],
      ["automation-cancel", "Job ID is required"],
      ["loop-update", "Loop ID is required"],
      ["loop-event", "Loop ID is required"],
      ["bootstrap-profile-pause", "Profile ID is required"],
      ["dream-profile-remove", "Profile ID is required"],
      ["loop-get-context", "Directory is required"],
    ];
    for (const [method, message] of cases) {
      await expect(async () => route(handlers, method).handler({})).rejects.toThrow(message);
      await expect(async () => route(handlers, method).handler(undefined)).rejects.toThrow(message);
    }
  });

  it("forwards id + rest to the handler (loop-update)", async () => {
    const handlers = makeHandlers();
    await route(handlers, "loop-update").handler({ loopId: "L1", name: "n", intervalMs: 5 });
    expect(handlers.updateAgentLoop).toHaveBeenCalledWith("L1", { name: "n", intervalMs: 5 });
  });

  it("loop-event additionally requires a title", async () => {
    const handlers = makeHandlers();
    await expect(async () =>
      route(handlers, "loop-event").handler({ loopId: "L1" }),
    ).rejects.toThrow("Event title is required");
    await route(handlers, "loop-event").handler({ loopId: "L1", title: "t" });
    expect(handlers.emitAgentLoopEvent).toHaveBeenCalledWith("L1", { title: "t" });
  });

  it("clean-stale-sessions coerces and filters pids (integers > 1 only)", async () => {
    const handlers = makeHandlers();
    await route(handlers, "clean-stale-sessions").handler({
      pids: [42, "77", 1, 0, -5, 3.5, "abc", null],
    });
    expect(handlers.cleanStaleSessions).toHaveBeenCalledWith({ pids: [42, 77] });
  });

  it("killswitch-set coerces enabled to boolean", async () => {
    const handlers = makeHandlers();
    await route(handlers, "killswitch-set").handler({ enabled: "yes" });
    expect(handlers.setKillswitch).toHaveBeenCalledWith(true);
    await route(handlers, "killswitch-set").handler({});
    expect(handlers.setKillswitch).toHaveBeenCalledWith(false);
  });

  it("stop-session throws when the daemon reports failure", async () => {
    const handlers = makeHandlers();
    (handlers.stopSession as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await expect(async () =>
      route(handlers, "stop-session").handler({ sessionId: "s-9" }),
    ).rejects.toThrow("Session not found or failed to stop");
  });

  describe("spawn-happy-session", () => {
    it("requires a directory", async () => {
      const handlers = makeHandlers();
      await expect(async () =>
        route(handlers, "spawn-happy-session").handler({}),
      ).rejects.toThrow("Directory is required");
    });

    it("rejects an invalid runtime profile payload", async () => {
      const handlers = makeHandlers();
      await expect(async () =>
        route(handlers, "spawn-happy-session").handler({
          directory: "/tmp/x",
          runtimeProfile: { bogus: true },
        }),
      ).rejects.toThrow("Runtime profile payload is invalid or unsupported");
      expect(handlers.spawnSession).not.toHaveBeenCalled();
    });

    it("maps the success result to the wire shape", async () => {
      const handlers = makeHandlers();
      const result = await route(handlers, "spawn-happy-session").handler({
        directory: "/tmp/x",
      });
      expect(result).toEqual({ type: "success", sessionId: "s-1" });
    });

    it("passes the directory-approval request through", async () => {
      const handlers = makeHandlers();
      (handlers.spawnSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        type: "requestToApproveDirectoryCreation",
        directory: "/tmp/new",
      });
      const result = await route(handlers, "spawn-happy-session").handler({
        directory: "/tmp/new",
      });
      expect(result).toEqual({
        type: "requestToApproveDirectoryCreation",
        directory: "/tmp/new",
      });
    });

    it("re-throws a spawn error as an RPC error", async () => {
      const handlers = makeHandlers();
      (handlers.spawnSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        type: "error",
        errorMessage: "boom",
      });
      await expect(async () =>
        route(handlers, "spawn-happy-session").handler({ directory: "/tmp/x" }),
      ).rejects.toThrow("boom");
    });
  });
});
