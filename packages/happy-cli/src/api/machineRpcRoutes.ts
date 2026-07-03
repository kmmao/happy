/**
 * machineRpcRoutes — the declarative RPC surface of the machine daemon.
 *
 * ApiMachineClient's setRPCHandlers used to register ~45 handlers inline —
 * each a mechanical wrapper (extract params, validate the required id,
 * forward to the daemon-injected handler). That made the daemon's RPC
 * surface unreviewable as a whole and untestable without a socket. This
 * module owns the mapping as DATA: method name → wrapper, built purely from
 * the injected MachineRpcHandlers, so the route list is one greppable/
 * snapshot-testable table (ADR-0021 makes method names server-observable —
 * the test pins the exact list) and every wrapper's param validation is unit
 * tested.
 *
 * Only routes that need NO ApiMachineClient instance state live here. The
 * tunnel / terminal / PTY handlers read `this.tunnelManager` /
 * `this.terminalManager` and stay in the class.
 */

import { logger } from "@/ui/logger";
import { normalizeResolvedRuntimeProfile } from "@kmmao/happy-wire";
import { suggestAgentLoopsWithAI, gatherProjectContext } from "@/automation/AgentLoopSuggestionAI";
import { killRunawayHappyProcesses } from "@/daemon/doctor";
import { upgradeSelf } from "@/daemon/upgradeSelf";
import type { MachineRpcHandlers } from "./apiMachine";

export interface MachineRpcRoute {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any) => unknown;
}

/**
 * Wrap a handler that requires one non-empty id field: extracts it, throws
 * the route's historical error message when missing, forwards id + rest.
 */
function requireId(
  key: string,
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (id: string, rest: any) => unknown,
): MachineRpcRoute["handler"] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (params: any) => {
    const { [key]: id, ...rest } = params || {};
    if (!id) throw new Error(`${label} is required`);
    return fn(id, rest);
  };
}

export function buildMachineRpcRoutes(
  handlers: MachineRpcHandlers,
): MachineRpcRoute[] {
  const h = handlers;

  return [
    {
      method: "spawn-happy-session",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const {
          directory,
          sessionId,
          machineId,
          approvedNewDirectoryCreation,
          agent,
          token,
          environmentVariables,
          happySessionId,
          forkSourceId,
          profileId,
          runtimeProfile,
        } = params || {};
        const safeParams = {
          ...params,
          token: typeof token === "string" ? "[REDACTED]" : token,
          environmentVariables: environmentVariables ? "[REDACTED_ENV_VARS]" : environmentVariables,
          runtimeProfile: runtimeProfile ? "[REDACTED_RUNTIME_PROFILE]" : runtimeProfile,
        };
        logger.debug(
          `[API MACHINE] Spawning session with params: ${JSON.stringify(safeParams)}`,
        );

        if (!directory) {
          throw new Error("Directory is required");
        }

        const normalizedRuntimeProfile = normalizeResolvedRuntimeProfile(
          runtimeProfile,
        );
        if (runtimeProfile && !normalizedRuntimeProfile) {
          throw new Error("Runtime profile payload is invalid or unsupported");
        }

        const result = await h.spawnSession({
          directory,
          sessionId,
          machineId,
          approvedNewDirectoryCreation,
          agent,
          token,
          environmentVariables,
          happySessionId,
          forkSourceId,
          profileId: profileId ?? normalizedRuntimeProfile?.profileId,
          runtimeProfile: normalizedRuntimeProfile,
        });

        switch (result.type) {
          case "success":
            logger.debug(`[API MACHINE] Spawned session ${result.sessionId}`);
            return { type: "success", sessionId: result.sessionId };

          case "requestToApproveDirectoryCreation":
            logger.debug(
              `[API MACHINE] Requesting directory creation approval for: ${result.directory}`,
            );
            return {
              type: "requestToApproveDirectoryCreation",
              directory: result.directory,
            };

          case "error":
            throw new Error(result.errorMessage);
        }
      },
    },
    {
      method: "stop-session",
      handler: requireId("sessionId", "Session ID", (sessionId) => {
        const success = h.stopSession(sessionId);
        if (!success) {
          throw new Error("Session not found or failed to stop");
        }
        logger.debug(`[API MACHINE] Stopped session ${sessionId}`);
        return { message: "Session stopped" };
      }),
    },

    // ── Automation jobs ──
    { method: "automation-status", handler: async () => h.getAutomationStatus() },
    {
      method: "automation-cancel",
      handler: requireId("jobId", "Job ID", (jobId) => h.cancelAutomationJob(jobId)),
    },
    {
      method: "automation-retry",
      handler: requireId("jobId", "Job ID", (jobId) => h.retryAutomationJob(jobId)),
    },
    {
      method: "automation-remove",
      handler: requireId("jobId", "Job ID", (jobId) => h.removeAutomationJob(jobId)),
    },
    { method: "automation-clear", handler: async () => h.clearAutomationJobs() },
    {
      method: "automation-guardian-clear",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => h.clearAutomationGuardians(params || {}),
    },
    { method: "automation-audit-clear", handler: async () => h.clearAutomationAudit() },
    {
      method: "doctor-clean",
      handler: async () => {
        const result = await killRunawayHappyProcesses();
        return {
          success: true,
          killed: result.killed,
          errors: result.errors,
        };
      },
    },

    // ── Session tracking / stale cleanup ──
    // List all daemon-tracked sessions (PID → Happy session ID mapping).
    // Used by diagnostics page to associate processes that were spawned fresh
    // (without --happy-session-id in their command line) with their Happy session.
    { method: "list-tracked-sessions", handler: () => ({ sessions: h.listTrackedSessions() }) },
    // List daemon-tracked sessions whose heartbeat has gone silent or whose
    // pid is dead. Does not kill anything — the App should show the list,
    // confirm, then call clean-stale-sessions with the chosen pids.
    { method: "list-stale-sessions", handler: async () => h.listStaleSessions() },
    // Kill specific pids that the App confirmed as stale. The handler
    // validates each pid against its own tracked-session map before killing,
    // so an attacker cannot use this to kill arbitrary pids on the machine.
    {
      method: "clean-stale-sessions",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const rawPids = Array.isArray(params?.pids) ? params.pids : [];
        const pids = rawPids
          .map((p: unknown) => (typeof p === "number" ? p : Number(p)))
          .filter((p: number) => Number.isInteger(p) && p > 1);
        return h.cleanStaleSessions({ pids });
      },
    },

    // ── Killswitch ──
    {
      method: "killswitch-set",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const { enabled } = params || {};
        return h.setKillswitch(Boolean(enabled));
      },
    },
    { method: "killswitch-get", handler: async () => h.getKillswitch() },

    // ── Agent loops ──
    { method: "loop-list", handler: async () => ({ loops: await h.listAgentLoops() }) },
    {
      method: "loop-get",
      handler: requireId("loopId", "Loop ID", async (loopId) => ({
        success: true,
        loop: await h.getAgentLoop(loopId),
      })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "loop-create", handler: async (params: any) => h.createAgentLoop(params) },
    {
      method: "loop-update",
      handler: requireId("loopId", "Loop ID", (loopId, input) => h.updateAgentLoop(loopId, input)),
    },
    {
      method: "loop-pause",
      handler: requireId("loopId", "Loop ID", (loopId) => h.pauseAgentLoop(loopId)),
    },
    {
      method: "loop-resume",
      handler: requireId("loopId", "Loop ID", (loopId) => h.resumeAgentLoop(loopId)),
    },
    {
      method: "loop-run-now",
      handler: requireId("loopId", "Loop ID", (loopId) => h.runAgentLoopNow(loopId)),
    },
    {
      method: "loop-remove",
      handler: requireId("loopId", "Loop ID", (loopId) => h.removeAgentLoop(loopId)),
    },
    {
      method: "loop-event",
      handler: requireId("loopId", "Loop ID", (loopId, input) => {
        if (!input?.title) throw new Error("Event title is required");
        return h.emitAgentLoopEvent(loopId, input);
      }),
    },
    {
      method: "loop-suggest",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const input = params || {};
        if (!input.directory) throw new Error("Directory is required");
        return { suggestions: await h.suggestAgentLoops(input) };
      },
    },
    {
      method: "loop-suggest-ai",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const input = params || {};
        if (!input.directory) throw new Error("Directory is required");
        return { suggestions: await suggestAgentLoopsWithAI(input) };
      },
    },
    {
      method: "loop-get-context",
      handler: requireId("directory", "Directory", async (directory) => {
        const context = await gatherProjectContext(directory.trim());
        return { context };
      }),
    },

    // ── Bootstrap profiles ──
    {
      method: "bootstrap-profile-list",
      handler: async () => ({ profiles: await h.listAgentLoopBootstrapProfiles() }),
    },
    {
      method: "bootstrap-profile-get",
      handler: requireId("profileIdValue", "Profile ID", async (profileIdValue) => ({
        success: true,
        profile: await h.getAgentLoopBootstrapProfile(profileIdValue),
      })),
    },
    {
      method: "bootstrap-profile-create",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => h.createAgentLoopBootstrapProfile(params),
    },
    {
      method: "bootstrap-profile-update",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue, input) =>
        h.updateAgentLoopBootstrapProfile(profileIdValue, input)),
    },
    {
      method: "bootstrap-profile-pause",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.pauseAgentLoopBootstrapProfile(profileIdValue)),
    },
    {
      method: "bootstrap-profile-resume",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.resumeAgentLoopBootstrapProfile(profileIdValue)),
    },
    {
      method: "bootstrap-profile-run-now",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.runAgentLoopBootstrapProfileNow(profileIdValue)),
    },
    {
      method: "bootstrap-profile-remove",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.removeAgentLoopBootstrapProfile(profileIdValue)),
    },

    // ── Auto-Dream profiles ──
    {
      method: "dream-profile-list",
      handler: async () => ({ profiles: await h.listAutoDreamProfiles() }),
    },
    {
      method: "dream-profile-get",
      handler: requireId("profileIdValue", "Profile ID", async (profileIdValue) => ({
        success: true,
        profile: await h.getAutoDreamProfile(profileIdValue),
      })),
    },
    {
      method: "dream-profile-create",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => h.createAutoDreamProfile(params),
    },
    {
      method: "dream-profile-update",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue, input) =>
        h.updateAutoDreamProfile(profileIdValue, input)),
    },
    {
      method: "dream-profile-pause",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.pauseAutoDreamProfile(profileIdValue)),
    },
    {
      method: "dream-profile-resume",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.resumeAutoDreamProfile(profileIdValue)),
    },
    {
      method: "dream-profile-run-now",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.runAutoDreamProfileNow(profileIdValue)),
    },
    {
      method: "dream-profile-remove",
      handler: requireId("profileIdValue", "Profile ID", (profileIdValue) =>
        h.removeAutoDreamProfile(profileIdValue)),
    },

    // ── Daemon lifecycle ──
    {
      method: "stop-daemon",
      handler: () => {
        logger.debug("[API MACHINE] Received stop-daemon RPC request");

        // Trigger shutdown callback after a delay
        setTimeout(() => {
          logger.debug("[API MACHINE] Initiating daemon shutdown from RPC");
          h.requestShutdown();
        }, 100);

        return {
          message:
            "Daemon stop request acknowledged, starting shutdown sequence...",
        };
      },
    },
    {
      method: "upgrade-self",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (params: any) => {
        const { targetVersion } = params || {};
        logger.debug("[API MACHINE] Received upgrade-self RPC request", {
          targetVersion,
        });

        return upgradeSelf({ targetVersion });
      },
    },
  ];
}
