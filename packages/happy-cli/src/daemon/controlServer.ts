import fastify from "fastify";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { logger } from "@/ui/logger";
import { Metadata } from "@/api/types";
import { TrackedSession } from "./types";
import {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { AutomationJob, AutomationMutationResult } from "@/automation/types";
import type { AgentLoopDefinition } from "@/automation/AgentLoopStore";
import type { AgentLoopCreateInput, AgentLoopMutationResult, AgentLoopUpdateInput } from "@/automation/AgentLoopCoordinator";

const automationJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["supervisor", "webhook", "agent_loop"]),
  status: z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]),
  priority: z.enum(["urgent", "user", "background"]),
  dedupeKey: z.string(),
  attempt: z.number(),
  maxAttempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().optional(),
  dispatchedAt: z.number().optional(),
  completedAt: z.number().optional(),
  sessionId: z.string().optional(),
  completionMode: z.enum(["immediate", "session"]).optional(),
  label: z.string().optional(),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  loopId: z.string().optional(),
  loopIteration: z.number().optional(),
  continuityKey: z.string().optional(),
  errorMessage: z.string().optional(),
  recovered: z.boolean().optional(),
  payload: z.any(),
});

const automationGuardianSchema = z.object({
  key: z.string(),
  projectId: z.string(),
  loopId: z.string().optional(),
  sessionId: z.string(),
  updatedAt: z.number(),
  lastRunId: z.string().optional(),
  attached: z.boolean().optional(),
  recovered: z.boolean().optional(),
});

const automationGuardianUsageSchema = z.object({
  key: z.string(),
  projectId: z.string().optional(),
  loopId: z.string().optional(),
  reuseCount: z.number(),
  rememberCount: z.number(),
  resetCount: z.number(),
  lastUsedAt: z.number(),
  currentSessionId: z.string().optional(),
});

const automationAuditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  kind: z.string(),
  jobId: z.string().optional(),
  dedupeKey: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  loopId: z.string().optional(),
  trigger: z.string().optional(),
  status: z.string().optional(),
  guardianKey: z.string().optional(),
  guardianSessionId: z.string().optional(),
  message: z.string().optional(),
});

const automationAuditStatsSchema = z.object({
  totalEvents: z.number(),
  lastEventAt: z.number().optional(),
  queuedCount: z.number(),
  sessionStartedCount: z.number(),
  terminalCompletedCount: z.number(),
  terminalFailedCount: z.number(),
  terminalCancelledCount: z.number(),
  guardianReuseCount: z.number(),
  guardianRememberCount: z.number(),
  guardianResetCount: z.number(),
  sessionReattachedCount: z.number(),
  watchdogStopCount: z.number(),
  stopRequestCount: z.number(),
  guardianEligibleRunCount: z.number(),
  guardianReuseRate: z.number(),
  activeGuardianCount: z.number(),
});

const automationMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  job: automationJobSchema.optional(),
});

const automationGuardianMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

const agentLoopSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  prompt: z.string(),
  directory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number(),
  iteration: z.number(),
  continuityKey: z.string(),
  agent: z.enum(["claude", "codex", "gemini"]),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  lastEnqueuedAt: z.number().optional(),
  lastStartedAt: z.number().optional(),
  lastCompletedAt: z.number().optional(),
  lastSessionId: z.string().optional(),
  lastError: z.string().optional(),
});

const agentLoopMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  loop: agentLoopSchema.optional(),
});

const agentLoopCreateSchema = z.object({
  name: z.string().optional(),
  prompt: z.string(),
  directory: z.string(),
  intervalMs: z.number().positive(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  runNow: z.boolean().optional(),
});

const agentLoopUpdateSchema = z.object({
  loopId: z.string(),
  name: z.string().nullable().optional(),
  prompt: z.string().optional(),
  directory: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  environmentVariables: z.record(z.string(), z.string()).nullable().optional(),
});

export function startDaemonControlServer({
  getChildren,
  stopSession,
  spawnSession,
  requestShutdown,
  onHappySessionWebhook,
  getAutomationStatus,
  cancelAutomationJob,
  retryAutomationJob,
  clearAutomationJobs,
  clearAutomationGuardians,
  clearAutomationAudit,
  listAgentLoops,
  getAgentLoop,
  createAgentLoop,
  updateAgentLoop,
  pauseAgentLoop,
  resumeAgentLoop,
  runAgentLoopNow,
  removeAgentLoop,
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata) => void;
  getAutomationStatus: () => {
    jobs: AutomationJob[];
    counts: Record<string, number>;
    guardians?: Array<{
      key: string;
      projectId: string;
      loopId?: string;
      sessionId: string;
      updatedAt: number;
      lastRunId?: string;
      attached?: boolean;
      recovered?: boolean;
    }>;
    guardianUsage?: Array<{
      key: string;
      projectId?: string;
      loopId?: string;
      reuseCount: number;
      rememberCount: number;
      resetCount: number;
      lastUsedAt: number;
      currentSessionId?: string;
    }>;
    auditStats?: {
      totalEvents: number;
      lastEventAt?: number;
      queuedCount: number;
      sessionStartedCount: number;
      terminalCompletedCount: number;
      terminalFailedCount: number;
      terminalCancelledCount: number;
      guardianReuseCount: number;
      guardianRememberCount: number;
      guardianResetCount: number;
      sessionReattachedCount: number;
      watchdogStopCount: number;
      stopRequestCount: number;
      guardianEligibleRunCount: number;
      guardianReuseRate: number;
      activeGuardianCount: number;
    };
    recentAuditEvents?: Array<{
      id: string;
      occurredAt: number;
      kind: string;
      jobId?: string;
      dedupeKey?: string;
      sessionId?: string;
      projectId?: string;
      runId?: string;
      loopId?: string;
      trigger?: string;
      status?: string;
      guardianKey?: string;
      guardianSessionId?: string;
      message?: string;
    }>;
  };
  cancelAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  retryAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  clearAutomationJobs: () => Promise<AutomationMutationResult>;
  clearAutomationGuardians: (params?: { key?: string; sessionId?: string; clearAll?: boolean }) => Promise<{ success: boolean; errorMessage?: string }>;
  clearAutomationAudit: () => Promise<{ success: boolean; errorMessage?: string }>;
  listAgentLoops: () => Promise<AgentLoopDefinition[]>;
  getAgentLoop: (loopId: string) => Promise<AgentLoopDefinition | undefined>;
  createAgentLoop: (input: AgentLoopCreateInput) => Promise<AgentLoopMutationResult>;
  updateAgentLoop: (loopId: string, input: AgentLoopUpdateInput) => Promise<AgentLoopMutationResult>;
  pauseAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  resumeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  runAgentLoopNow: (loopId: string) => Promise<AgentLoopMutationResult>;
  removeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({ logger: false });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      "/session-started",
      {
        schema: {
          body: z.object({
            sessionId: z.string(),
            metadata: z.any(),
          }),
          response: {
            200: z.object({
              status: z.literal("ok"),
            }),
          },
        },
      },
      async (request) => {
        const { sessionId, metadata } = request.body;
        logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);
        onHappySessionWebhook(sessionId, metadata);
        return { status: "ok" as const };
      },
    );

    typed.post(
      "/list",
      {
        schema: {
          response: {
            200: z.object({
              children: z.array(
                z.object({
                  startedBy: z.string(),
                  happySessionId: z.string(),
                  pid: z.number(),
                }),
              ),
            }),
          },
        },
      },
      async () => {
        const children = getChildren();
        logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
        return {
          children: children
            .filter((child) => child.happySessionId !== undefined)
            .map((child) => ({
              startedBy: child.startedBy,
              happySessionId: child.happySessionId!,
              pid: child.pid,
            })),
        };
      },
    );

    typed.post(
      "/stop-session",
      {
        schema: {
          body: z.object({
            sessionId: z.string(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
            }),
          },
        },
      },
      async (request) => {
        const { sessionId } = request.body;
        logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
        return { success: stopSession(sessionId) };
      },
    );

    typed.post(
      "/spawn-session",
      {
        schema: {
          body: z.object({
            directory: z.string(),
            sessionId: z.string().optional(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
              sessionId: z.string().optional(),
              approvedNewDirectoryCreation: z.boolean().optional(),
            }),
            409: z.object({
              success: z.boolean(),
              requiresUserApproval: z.boolean().optional(),
              actionRequired: z.string().optional(),
              directory: z.string().optional(),
            }),
            500: z.object({
              success: z.boolean(),
              error: z.string().optional(),
            }),
          },
        },
      },
      async (request, reply) => {
        const { directory, sessionId } = request.body;
        logger.debug(
          `[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || "new"}`,
        );
        const result = await spawnSession({ directory, sessionId });

        switch (result.type) {
          case "success":
            if (!result.sessionId) {
              reply.code(500);
              return {
                success: false,
                error: "Failed to spawn session: no session ID returned",
              };
            }
            return {
              success: true,
              sessionId: result.sessionId,
              approvedNewDirectoryCreation: true,
            };
          case "requestToApproveDirectoryCreation":
            reply.code(409);
            return {
              success: false,
              requiresUserApproval: true,
              actionRequired: "CREATE_DIRECTORY",
              directory: result.directory,
            };
          case "error":
            reply.code(500);
            return {
              success: false,
              error: result.errorMessage,
            };
        }
      },
    );

    typed.post(
      "/automation-status",
      {
        schema: {
          response: {
            200: z.object({
              counts: z.record(z.string(), z.number()),
              jobs: z.array(automationJobSchema),
              guardians: z.array(automationGuardianSchema).optional(),
              guardianUsage: z.array(automationGuardianUsageSchema).optional(),
              auditStats: automationAuditStatsSchema.optional(),
              recentAuditEvents: z.array(automationAuditEventSchema).optional(),
            }),
          },
        },
      },
      async () => getAutomationStatus(),
    );

    typed.post(
      "/automation-cancel",
      {
        schema: {
          body: z.object({
            jobId: z.string(),
          }),
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async (request) => cancelAutomationJob(request.body.jobId),
    );

    typed.post(
      "/automation-retry",
      {
        schema: {
          body: z.object({
            jobId: z.string(),
          }),
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async (request) => retryAutomationJob(request.body.jobId),
    );

    typed.post(
      "/automation-clear",
      {
        schema: {
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async () => clearAutomationJobs(),
    );

    typed.post(
      "/automation-guardian-clear",
      {
        schema: {
          body: z.object({
            key: z.string().optional(),
            sessionId: z.string().optional(),
            clearAll: z.boolean().optional(),
          }).optional(),
          response: {
            200: automationGuardianMutationSchema,
          },
        },
      },
      async (request) => clearAutomationGuardians(request.body ?? {}),
    );

    typed.post(
      "/automation-audit-clear",
      {
        schema: {
          response: {
            200: automationGuardianMutationSchema,
          },
        },
      },
      async () => clearAutomationAudit(),
    );


    typed.post(
      "/loops",
      {
        schema: {
          response: {
            200: z.object({
              loops: z.array(agentLoopSchema),
            }),
          },
        },
      },
      async () => ({ loops: await listAgentLoops() }),
    );

    typed.post(
      "/loop-get",
      {
        schema: {
          body: z.object({
            loopId: z.string(),
          }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => ({ success: true, loop: await getAgentLoop(request.body.loopId) }),
    );

    typed.post(
      "/loop-create",
      {
        schema: {
          body: agentLoopCreateSchema,
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => createAgentLoop(request.body),
    );

    typed.post(
      "/loop-update",
      {
        schema: {
          body: agentLoopUpdateSchema,
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => {
        const { loopId, ...input } = request.body;
        return updateAgentLoop(loopId, input);
      },
    );

    typed.post(
      "/loop-pause",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => pauseAgentLoop(request.body.loopId),
    );

    typed.post(
      "/loop-resume",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => resumeAgentLoop(request.body.loopId),
    );

    typed.post(
      "/loop-run-now",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => runAgentLoopNow(request.body.loopId),
    );

    typed.post(
      "/loop-remove",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => removeAgentLoop(request.body.loopId),
    );

    typed.post(
      "/stop",
      {
        schema: {
          response: {
            200: z.object({
              status: z.string(),
            }),
          },
        },
      },
      async () => {
        logger.debug("[CONTROL SERVER] Stop daemon request received");
        setTimeout(() => {
          logger.debug("[CONTROL SERVER] Triggering daemon shutdown");
          requestShutdown();
        }, 50);
        return { status: "stopping" };
      },
    );

    app.listen({ port: 0, host: "127.0.0.1" }, (err, address) => {
      if (err) {
        logger.debug("[CONTROL SERVER] Failed to start:", err);
        throw err;
      }

      const port = parseInt(address.split(":").pop()!, 10);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug("[CONTROL SERVER] Stopping server");
          await app.close();
          logger.debug("[CONTROL SERVER] Server stopped");
        },
      });
    });
  });
}
