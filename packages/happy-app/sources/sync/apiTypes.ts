import { z } from "zod";
import {
  ApiMessageSchema,
  ApiUpdateMachineStateSchema,
  ApiUpdateNewMessageSchema,
  ApiUpdateSessionStateSchema,
  type ApiMessage,
} from "@kmmao/happy-wire";
import { GitHubProfileSchema, ImageRefSchema } from "./profile";
import { RelationshipStatusSchema, UserProfileSchema } from "./friendTypes";
import { FeedBodySchema } from "./feedTypes";

export {
  ApiMessageSchema,
  ApiUpdateMachineStateSchema,
  ApiUpdateNewMessageSchema,
  ApiUpdateSessionStateSchema,
};
export type { ApiMessage };

//
// Updates
//

export const ApiUpdateNewSessionSchema = z.object({
  t: z.literal("new-session"),
  id: z.string(), // Session ID
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ApiDeleteSessionSchema = z.object({
  t: z.literal("delete-session"),
  sid: z.string(), // Session ID
});

// Machine creation. Carries the per-machine data encryption key so an
// already-connected app can register encryption and decrypt this machine's
// metadata/daemonState without waiting for a full /v1/machines refetch.
export const ApiUpdateNewMachineSchema = z.object({
    t: z.literal("new-machine"),
    machineId: z.string(),
    seq: z.number(),
    metadata: z.string(),
    metadataVersion: z.number(),
    daemonState: z.string().nullish(),
    daemonStateVersion: z.number(),
    dataEncryptionKey: z.string().nullish(),
    active: z.boolean(),
    activeAt: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
});

export const ApiUpdateAccountSchema = z.object({
  t: z.literal("update-account"),
  id: z.string(),
  settings: z
    .object({
      value: z.string().nullish(),
      version: z.number(),
    })
    .nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  avatar: ImageRefSchema.nullish(),
  github: GitHubProfileSchema.nullish(),
});

// Artifact update schemas
export const ApiNewArtifactSchema = z.object({
  t: z.literal("new-artifact"),
  artifactId: z.string(),
  header: z.string(),
  headerVersion: z.number(),
  body: z.string().optional(),
  bodyVersion: z.number().optional(),
  dataEncryptionKey: z.string(),
  seq: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ApiUpdateArtifactSchema = z.object({
  t: z.literal("update-artifact"),
  artifactId: z.string(),
  header: z
    .object({
      value: z.string(),
      version: z.number(),
    })
    .optional(),
  body: z
    .object({
      value: z.string(),
      version: z.number(),
    })
    .optional(),
});

export const ApiDeleteArtifactSchema = z.object({
  t: z.literal("delete-artifact"),
  artifactId: z.string(),
});

// Relationship update schema
export const ApiRelationshipUpdatedSchema = z.object({
  t: z.literal("relationship-updated"),
  fromUserId: z.string(),
  toUserId: z.string(),
  status: RelationshipStatusSchema,
  action: z.enum(["created", "updated", "deleted"]),
  fromUser: UserProfileSchema.optional(),
  toUser: UserProfileSchema.optional(),
  timestamp: z.number(),
});

// Feed update schema
export const ApiNewFeedPostSchema = z.object({
  t: z.literal("new-feed-post"),
  id: z.string(),
  body: FeedBodySchema,
  cursor: z.string(),
  createdAt: z.number(),
  repeatKey: z.string().nullable(),
});

// KV batch update schema for real-time KV updates
export const ApiKvBatchUpdateSchema = z.object({
  t: z.literal("kv-batch-update"),
  changes: z.array(
    z.object({
      key: z.string(),
      value: z.string().nullable(),
      version: z.number(),
    }),
  ),
});

// Project update schemas
export const ApiNewProjectSchema = z.object({
  t: z.literal("new-project"),
  projectId: z.string(),
  machineId: z.string(),
  path: z.string(),
  repoUrl: z.string().nullable(),
  metadata: z.string().nullable(),
  metadataVersion: z.number(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ApiUpdateProjectSchema = z.object({
  t: z.literal("update-project"),
  projectId: z.string(),
  metadata: z
    .object({
      value: z.string().nullable(),
      version: z.number(),
    })
    .optional(),
  archived: z.boolean().optional(),
});

export const ApiDeleteProjectSchema = z.object({
  t: z.literal("delete-project"),
  projectId: z.string(),
});

// AgentLoop SyncUpdates — server already emits these from agentLoopEngine
// (every CRUD/iteration/pause/resume). Mirror the wire shape minimally
// (z.any() on the loop blob — actual fields are validated by
// SerializedAgentLoop downstream when useWorkflows merges them).
export const ApiAgentLoopUpdatedSchema = z.object({
  t: z.literal("agent-loop-updated"),
  loop: z.record(z.string(), z.any()),
});

export const ApiAgentLoopDeletedSchema = z.object({
  t: z.literal("agent-loop-deleted"),
  loopId: z.string(),
  projectId: z.string(),
});

// Use a plain union here to avoid runtime discriminator extraction issues
// when some schemas come from shared package exports.
export const ApiUpdateSchema = z.union([
  ApiUpdateNewMessageSchema,
  ApiUpdateNewSessionSchema,
  ApiDeleteSessionSchema,
  ApiUpdateSessionStateSchema,
  ApiUpdateAccountSchema,
  ApiUpdateMachineStateSchema,
  ApiUpdateNewMachineSchema,
  ApiNewArtifactSchema,
  ApiUpdateArtifactSchema,
  ApiDeleteArtifactSchema,
  ApiRelationshipUpdatedSchema,
  ApiNewFeedPostSchema,
  ApiKvBatchUpdateSchema,
  ApiNewProjectSchema,
  ApiUpdateProjectSchema,
  ApiDeleteProjectSchema,
  ApiAgentLoopUpdatedSchema,
  ApiAgentLoopDeletedSchema,
]);

export type ApiUpdateNewMessage = z.infer<typeof ApiUpdateNewMessageSchema>;
export type ApiRelationshipUpdated = z.infer<
  typeof ApiRelationshipUpdatedSchema
>;
export type ApiKvBatchUpdate = z.infer<typeof ApiKvBatchUpdateSchema>;
export type ApiUpdate = z.infer<typeof ApiUpdateSchema>;

//
// API update container
//

export const ApiUpdateContainerSchema = z.object({
  id: z.string(),
  seq: z.number(),
  body: ApiUpdateSchema,
  createdAt: z.number(),
});

export type ApiUpdateContainer = z.infer<typeof ApiUpdateContainerSchema>;

//
// Ephemeral update
//

export const ApiEphemeralActivityUpdateSchema = z.object({
  type: z.literal("activity"),
  id: z.string(),
  active: z.boolean(),
  activeAt: z.number(),
  thinking: z.boolean(),
  apiRetry: z
    .object({
      attempt: z.number(),
      maxRetries: z.number(),
      retryDelayMs: z.number(),
      errorStatus: z.number().nullable(),
    })
    .optional(),
});

export const ApiEphemeralUsageUpdateSchema = z.object({
  type: z.literal("usage"),
  id: z.string(),
  key: z.string(),
  timestamp: z.number(),
  tokens: z.object({
    total: z.number(),
    input: z.number(),
    output: z.number(),
    cache_creation: z.number(),
    cache_read: z.number(),
  }),
  cost: z.object({
    total: z.number(),
    input: z.number(),
    output: z.number(),
  }),
});

export const ApiEphemeralMachineActivityUpdateSchema = z.object({
  type: z.literal("machine-activity"),
  id: z.string(), // machine id
  active: z.boolean(),
  activeAt: z.number(),
});

export const ApiEphemeralRpcReadySchema = z.object({
  type: z.literal("rpc-ready"),
  scope: z.enum(["machine", "session"]),
  id: z.string(), // machineId or sessionId
  ready: z.boolean(),
});

export const ApiEphemeralWebhookIssueLinkSchema = z.object({
  type: z.literal("webhook-issue-linked"),
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueBody: z.string().default(""),
  issueAuthor: z.string().default(""),
  issueLabels: z.array(z.string()).default([]),
  issueUrl: z.string(),
  repoUrl: z.string(),
  repoPath: z.string(),
  machineId: z.string(),
  sessionId: z.string(),
});

export const ApiEphemeralWebhookPRMergedSchema = z.object({
  type: z.literal("webhook-pr-merged"),
  prNumber: z.number(),
  prUrl: z.string(),
  issueNumber: z.number(),
  sessionId: z.string(),
  machineId: z.string(),
  repoPath: z.string(),
});

export const ApiEphemeralSupervisorTriggerSchema = z.object({
  type: z.literal("supervisor-trigger"),
  projectId: z.string(),
  runId: z.string(),
  trigger: z.string(),
  machineId: z.string(),
  repoPath: z.string(),
});

export const ApiEphemeralSupervisorStatusSchema = z.object({
  type: z.literal("supervisor-status"),
  runId: z.string(),
  projectId: z.string(),
  status: z.string(),
  artifactId: z.string().optional(),
  errorMessage: z.string().optional(),
  currentDimension: z.string().optional(),
  dimensionIndex: z.number().optional(),
  totalDimensions: z.number().optional(),
});

export const ApiEphemeralSupervisorLoopStatusSchema = z.object({
  type: z.literal("supervisor-loop-status"),
  loopId: z.string(),
  projectId: z.string(),
  status: z.string(),
  currentIteration: z.number(),
  maxIterations: z.number(),
  currentPhase: z.string(),
  totalCostUsd: z.number(),
  totalActionsFound: z.number(),
  totalActionsFixed: z.number(),
  currentHealthScore: z.number().nullable(),
  initialHealthScore: z.number().nullable(),
  exitReason: z.string().nullable(),
  consecutiveFailures: z.number(),
});

// Supervisor-role loop brief, fired once on loop completion (ADR-0022).
// Distinct from `supervisor-loop-status` so the "completed" event is easy
// to subscribe to without filtering every iteration tick.
// ADR-0022 D-1 — fired on the autonomy server side when a standalone run
// completion crossed the project's healthScore threshold and a loop was
// auto-started. App-side toast lives in supervisor-settings.tsx for now;
// a global subscriber + inbox entry are a follow-up.
export const ApiEphemeralAutoLoopFiredSchema = z.object({
  type: z.literal("auto-loop-fired"),
  projectId: z.string(),
  loopId: z.string(),
  healthScore: z.number(),
  threshold: z.number(),
  firedAt: z.number(),
});
export type ApiEphemeralAutoLoopFired = z.infer<
  typeof ApiEphemeralAutoLoopFiredSchema
>;

export const ApiEphemeralSupervisorLoopBriefSchema = z.object({
  type: z.literal("supervisor-loop-brief"),
  loopId: z.string(),
  projectId: z.string(),
  status: z.string(),
  exitReason: z.string().nullable(),
  generatedAt: z.number(),
  currentIteration: z.number(),
  maxIterations: z.number(),
  initialHealthScore: z.number().nullable(),
  currentHealthScore: z.number().nullable(),
  healthDelta: z.number().nullable(),
  totalActionsFound: z.number(),
  totalActionsFixed: z.number(),
  consecutiveFailures: z.number(),
  totalCostUsd: z.number(),
  costCapUsd: z.number().nullable(),
  summary: z.string(),
});
export type ApiEphemeralSupervisorLoopBrief = z.infer<
  typeof ApiEphemeralSupervisorLoopBriefSchema
>;

export const ApiEphemeralKnowledgeCountSchema = z.object({
  type: z.literal("knowledge-count"),
  id: z.string(),  // sessionId
  count: z.number(),
});

export const ApiEphemeralKnowledgeAccessUpdateSchema = z.object({
  type: z.literal("knowledge-access-update"),
  sessionId: z.string(),
  at: z.number(),
  hit: z.number().optional(),
  miss: z.number().optional(),
  evicted: z.number().optional(),
});

export const ApiEphemeralTaskLogSchema = z.object({
    type: z.literal("task-log"),
    sessionId: z.string(),
    taskId: z.string(),
    outputFile: z.string(),
    chunk: z.string(),
    offset: z.number(),
});


export const ApiEphemeralTaskStatusChangedSchema = z.object({
    type: z.literal("task-status-changed"),
    taskId: z.string(),
    machineId: z.string().optional(),
    status: z.string(),
    sessionId: z.string().optional(),
    errorMessage: z.string().optional(),
    completedAt: z.number().optional(),
    triggerType: z.string().optional(),
});

export const ApiEphemeralInboxNewItemSchema = z.object({
    type: z.literal("inbox-new-item"),
    item: z.object({
        id: z.string(),
        category: z.string(),
        eventType: z.string(),
        severity: z.string(),
        title: z.string(),
        body: z.string().optional(),
        read: z.boolean(),
        referenceUrl: z.string().optional(),
        refType: z.string().optional(),
        refId: z.string().optional(),
        groupKey: z.string().optional(),
        createdAt: z.number(),
    }),
});

export const ApiEphemeralInboxUnreadCountSchema = z.object({
    type: z.literal("inbox-unread-count"),
    count: z.number(),
});

export const ApiEphemeralSessionEventCreatedSchema = z.object({
    type: z.literal("session-event-created"),
    event: z.object({
        id: z.string(),
        sessionId: z.string(),
        eventType: z.string(),
        summary: z.string(),
        detail: z.record(z.string(), z.unknown()).optional(),
        createdAt: z.number(),
    }),
});



export const ApiEphemeralInterAgentMessageSchema = z.object({
    type: z.literal("inter-agent-message"),
    fromSessionId: z.string(),
    toSessionId: z.string(),
    message: z.string(),
    sentAt: z.number(),
});
export type ApiEphemeralInterAgentMessage = z.infer<typeof ApiEphemeralInterAgentMessageSchema>;

export const ApiEphemeralWorldEventCreatedSchema = z.object({
    type: z.literal("world-event-created"),
    event: z.object({
        id: z.string(),
        eventType: z.string(),
        title: z.string(),
        summary: z.string(),
        occurredAt: z.number(),
        severity: z.enum(["info", "warning", "critical"]),
        source: z.object({
            type: z.string(),
            projectId: z.string().nullable().optional(),
            projectPath: z.string().nullable().optional(),
            machineId: z.string().nullable().optional(),
            sessionId: z.string().nullable().optional(),
        }),
        originalId: z.string(),
        parentTaskId: z.string().nullable().optional(),
    }),
});
export type ApiEphemeralWorldEventCreated = z.infer<typeof ApiEphemeralWorldEventCreatedSchema>;

export const ApiEphemeralUpdateSchema = z.union([
  ApiEphemeralActivityUpdateSchema,
  ApiEphemeralUsageUpdateSchema,
  ApiEphemeralMachineActivityUpdateSchema,
  ApiEphemeralRpcReadySchema,
  ApiEphemeralWebhookIssueLinkSchema,
  ApiEphemeralWebhookPRMergedSchema,
  ApiEphemeralSupervisorTriggerSchema,
  ApiEphemeralSupervisorStatusSchema,
  ApiEphemeralSupervisorLoopStatusSchema,
  ApiEphemeralSupervisorLoopBriefSchema,
  ApiEphemeralAutoLoopFiredSchema,
  ApiEphemeralKnowledgeCountSchema,
  ApiEphemeralKnowledgeAccessUpdateSchema,
  ApiEphemeralTaskLogSchema,
  ApiEphemeralTaskStatusChangedSchema,
  ApiEphemeralInboxNewItemSchema,
  ApiEphemeralInboxUnreadCountSchema,
  ApiEphemeralSessionEventCreatedSchema,
  ApiEphemeralInterAgentMessageSchema,
  ApiEphemeralWorldEventCreatedSchema,
]);

export type ApiEphemeralActivityUpdate = z.infer<
  typeof ApiEphemeralActivityUpdateSchema
>;
export type ApiEphemeralUpdate = z.infer<typeof ApiEphemeralUpdateSchema>;

// Machine metadata updates use Partial<MachineMetadata> from storageTypes
// This matches how session metadata updates work
