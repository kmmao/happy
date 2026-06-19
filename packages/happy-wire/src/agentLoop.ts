/**
 * AgentLoop wire schemas — Phase 3b + 4 of ADR-0022.
 *
 * Phase 3a (already landed) added 10 generic-role columns to the
 * AgentLoop table. Phase 3b moves definitions for `role: "generic"`
 * loops from CLI-local (`~/.happy/agent-loops.json`) to the server.
 * Phase 4 collapses the supervisor and agent routes into one
 * `/v1/projects/:projectId/agent-loops` family with a `role` filter.
 *
 * The wire schemas here are the single source of truth shared across
 * server / cli / agent / app. Until now each side hand-rolled its own
 * zod schemas; with three packages talking about the same domain
 * objects, drift is a question of when, not if.
 */

import * as z from "zod";
import { ResolvedRuntimeProfileSchema } from "./profile";

/**
 * `generic` is today's CLI-local AgentLoop (KAIROS-style persistent
 * agent over a prompt + working memory). `supervisor` is the existing
 * autopilot. New roles must be added explicitly per ADR-0022's
 * "role registry, not free-form strings" decision.
 */
export const AgentLoopRoleSchema = z.enum(["generic", "supervisor"]);
export type AgentLoopRole = z.infer<typeof AgentLoopRoleSchema>;

export const AgentLoopAgentSchema = z.enum(["claude", "codex", "gemini"]);
export type AgentLoopAgent = z.infer<typeof AgentLoopAgentSchema>;

/**
 * `genericConfig` carries the long-tail of CLI-local AgentLoopDefinition
 * fields the database doesn't promote to typed columns: file/CI/webhook
 * bridge toggles, environment variables, downstream cascade, notification
 * channels, quiet hours, daily budgets. Wire keeps this as a passthrough
 * record so the CLI can round-trip its richer struct without forcing
 * server-side type churn on every field addition.
 */
export const AgentLoopGenericConfigSchema = z.record(z.string(), z.unknown());
export type AgentLoopGenericConfig = z.infer<typeof AgentLoopGenericConfigSchema>;

/**
 * Shared status across both roles. Generic loops only use a subset
 * (running / paused / stopped) since their lifecycle isn't goal-bounded
 * like supervisor's completed/failed exit semantics.
 */
export const AgentLoopStatusSchema = z.enum([
    "running",
    "paused",
    "completed",
    "failed",
    "stopped",
]);
export type AgentLoopStatus = z.infer<typeof AgentLoopStatusSchema>;

// ============================================================
// Serialized AgentLoop (response shape)
// ============================================================

/**
 * Server response shape for an AgentLoop. Many fields are role-gated:
 * supervisor rows always populate the supervisor block and may leave the
 * generic block null; generic rows do the inverse. The unified consumer
 * (App) reads via the discriminator and ignores the role-irrelevant
 * fields.
 */
export const SerializedAgentLoopSchema = z.object({
    id: z.string(),
    role: AgentLoopRoleSchema,
    projectId: z.string(),
    accountId: z.string(),
    status: AgentLoopStatusSchema,
    activeRunId: z.string().nullable().optional(),
    exitReason: z.string().nullable().optional(),
    profileId: z.string().nullable().optional(),
    runtimeProfile: z.any().nullable().optional(),
    maxDurationMinutes: z.number().nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    completedAt: z.number().nullable().optional(),

    // Generic-role fields (null for supervisor rows)
    prompt: z.string().nullable().optional(),
    directory: z.string().nullable().optional(),
    agent: AgentLoopAgentSchema.nullable().optional(),
    intervalMs: z.number().nullable().optional(),
    cronExpression: z.string().nullable().optional(),
    // App model-mode KEY + reasoning effort for spawned iterations.
    modelMode: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    nextRunAt: z.number().nullable().optional(),
    continuityKey: z.string().nullable().optional(),
    iteration: z.number().optional(),
    genericConfig: AgentLoopGenericConfigSchema.nullable().optional(),

    // Supervisor-role fields (null for generic rows)
    currentPhase: z.string().nullable().optional(),
    currentIteration: z.number().nullable().optional(),
    maxIterations: z.number().nullable().optional(),
    costCapUsd: z.number().nullable().optional(),
    healthScoreTarget: z.number().nullable().optional(),
    autoApproveThreshold: z.number().nullable().optional(),
    maxConsecutiveFailures: z.number().nullable().optional(),
    emptyIterationsToConfirm: z.number().nullable().optional(),
    consecutiveEmptyIterations: z.number().nullable().optional(),
    initialHealthScore: z.number().nullable().optional(),
    currentHealthScore: z.number().nullable().optional(),
    totalCostUsd: z.number().nullable().optional(),
    totalTokens: z.number().nullable().optional(),
    totalActionsFound: z.number().nullable().optional(),
    totalActionsFixed: z.number().nullable().optional(),
    consecutiveFailures: z.number().nullable().optional(),
});
export type SerializedAgentLoop = z.infer<typeof SerializedAgentLoopSchema>;

// ============================================================
// CRUD request bodies
// ============================================================

/**
 * Create body for a generic-role AgentLoop. Supervisor-role creates
 * still go through the existing `/v1/projects/:id/supervisor/loop` POST
 * during Phase 3b; Phase 4 collapses both into this endpoint with
 * `role: "supervisor"` and the supervisor-specific config block.
 */
export const CreateGenericAgentLoopBodySchema = z.object({
    prompt: z.string().min(1).max(8192),
    directory: z.string().min(1),
    agent: AgentLoopAgentSchema.default("claude"),
    // Exactly one of intervalMs / cronExpression should be provided;
    // the server validates that constraint and rejects 400 otherwise.
    intervalMs: z.number().int().positive().optional(),
    cronExpression: z.string().optional(),
    enabled: z.boolean().default(true),
    continuityKey: z.string().optional(),
    profileId: z.string().nullable().optional(),
    runtimeProfile: ResolvedRuntimeProfileSchema.optional(),
    maxDurationMinutes: z.number().int().min(1).max(60 * 24).optional(),
    // App model-mode KEY + reasoning effort for spawned iterations.
    modelMode: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    /** Long-tail config (notification channels, file watchers, etc.). */
    genericConfig: AgentLoopGenericConfigSchema.optional(),
});
export type CreateGenericAgentLoopBody = z.infer<typeof CreateGenericAgentLoopBodySchema>;

/**
 * Update body — every field optional. The server treats undefined as
 * "no change", explicit null on nullable fields as "clear it".
 */
export const UpdateGenericAgentLoopBodySchema = z.object({
    prompt: z.string().min(1).max(8192).optional(),
    directory: z.string().min(1).optional(),
    agent: AgentLoopAgentSchema.optional(),
    intervalMs: z.number().int().positive().nullable().optional(),
    cronExpression: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    profileId: z.string().nullable().optional(),
    runtimeProfile: ResolvedRuntimeProfileSchema.optional(),
    maxDurationMinutes: z.number().int().min(1).max(60 * 24).nullable().optional(),
    // App model-mode KEY + reasoning effort for spawned iterations.
    modelMode: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    genericConfig: AgentLoopGenericConfigSchema.optional(),
});
export type UpdateGenericAgentLoopBody = z.infer<typeof UpdateGenericAgentLoopBodySchema>;

/** Querystring for the list endpoint. */
export const ListAgentLoopsQuerySchema = z.object({
    role: AgentLoopRoleSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    machineId: z.string().optional(),
    projectId: z.string().optional(),
});
export type ListAgentLoopsQuery = z.infer<typeof ListAgentLoopsQuerySchema>;

// ============================================================
// CLI ↔ Server ephemerals (mirror the existing supervisor-* family)
// ============================================================

/**
 * Server → CLI daemon. Tells the daemon "fire this loop now". Carries
 * the prompt + directory + agent + genericConfig so the daemon can
 * execute without round-tripping for the definition. Includes a
 * `callbackToken` the daemon uses to report iteration completion back
 * to `/v1/projects/:projectId/agent-loops/:loopId/iterations`.
 *
 * Routed via `machine-scoped-only` recipient filter — only the daemon
 * on the loop's target machine receives it.
 */
export const AgentLoopTriggerEphemeralSchema = z.object({
    t: z.literal("agent-loop-trigger"),
    loopId: z.string(),
    projectId: z.string(),
    machineId: z.string(),
    iteration: z.number().int().min(0),
    prompt: z.string(),
    directory: z.string(),
    agent: AgentLoopAgentSchema,
    continuityKey: z.string().optional(),
    profileId: z.string().nullable().optional(),
    runtimeProfile: ResolvedRuntimeProfileSchema.optional(),
    // App model-mode KEY + reasoning effort for the spawned iteration.
    modelMode: z.string().nullable().optional(),
    effort: z.string().nullable().optional(),
    genericConfig: AgentLoopGenericConfigSchema.optional(),
    /** Bearer token CLI presents on completion callback. */
    callbackToken: z.string(),
    /** Max iteration runtime; daemon should kill the session past this. */
    maxDurationMinutes: z.number().int().min(1).optional(),
});
export type AgentLoopTriggerEphemeral = z.infer<typeof AgentLoopTriggerEphemeralSchema>;

/**
 * CLI daemon → Server (or Server → App). Snapshot of the loop's
 * runtime state for low-latency UI updates. Routed user-scoped so
 * every App socket sees it.
 */
export const AgentLoopStatusEphemeralSchema = z.object({
    t: z.literal("agent-loop-status"),
    loopId: z.string(),
    projectId: z.string(),
    status: AgentLoopStatusSchema,
    iteration: z.number().int().min(0).optional(),
    nextRunAt: z.number().nullable().optional(),
    activeSessionId: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    lastBriefSummary: z.string().nullable().optional(),
    updatedAt: z.number(),
});
export type AgentLoopStatusEphemeral = z.infer<typeof AgentLoopStatusEphemeralSchema>;

/**
 * Server → User sockets. Fired when an iteration completes and produces
 * a brief (markdown summary of what happened). The brief itself goes via
 * a separate persistent SessionMessage / artifact; this ephemeral only
 * carries the headline + sessionId so the UI can pop a notification or
 * surface it in the inbox.
 */
export const AgentLoopBriefEphemeralSchema = z.object({
    t: z.literal("agent-loop-brief"),
    loopId: z.string(),
    projectId: z.string(),
    iteration: z.number().int().min(0),
    sessionId: z.string().nullable().optional(),
    headline: z.string(),
    /** "completed" | "failed" | "cancelled". */
    iterationStatus: z.string(),
    generatedAt: z.number(),
});
export type AgentLoopBriefEphemeral = z.infer<typeof AgentLoopBriefEphemeralSchema>;

// ============================================================
// SyncUpdate body (persistent — survives client reconnect)
// ============================================================

/**
 * Server → App. Persistent update emitted whenever an AgentLoop
 * definition or status row changes. Persistent (not ephemeral) so a
 * client that reconnects can replay missed updates from sync state
 * (per ADR-0013).
 */
export const AgentLoopUpdateSyncBodySchema = z.object({
    t: z.literal("agent-loop-updated"),
    loop: SerializedAgentLoopSchema,
});
export type AgentLoopUpdateSyncBody = z.infer<typeof AgentLoopUpdateSyncBodySchema>;

/**
 * Server → App. Persistent delete signal. The serialized loop's
 * `projectId` is included so the client can purge from its project
 * cache without an extra round-trip.
 */
export const AgentLoopDeleteSyncBodySchema = z.object({
    t: z.literal("agent-loop-deleted"),
    loopId: z.string(),
    projectId: z.string(),
});
export type AgentLoopDeleteSyncBody = z.infer<typeof AgentLoopDeleteSyncBodySchema>;

// ============================================================
// Iteration callback (CLI daemon → Server)
// ============================================================

/**
 * Body the daemon POSTs to
 *   /v1/projects/:projectId/agent-loops/:loopId/iterations
 * on iteration completion. The Bearer token from the trigger ephemeral
 * authorizes the call (server validates token, loops to matching loop).
 *
 * `status` mirrors the daemon's own AgentLoopJobOutcome — completed
 * means the session terminated normally; failed means an error during
 * spawn / execution; cancelled means user / killswitch.
 */
export const AgentLoopIterationReportSchema = z.object({
    iteration: z.number().int().min(0),
    sessionId: z.string().nullable().optional(),
    status: z.enum(["completed", "failed", "cancelled"]),
    errorMessage: z.string().optional(),
    /** Markdown brief — small enough to fit in a single request. */
    briefSummary: z.string().optional(),
    costUsd: z.number().nonnegative().optional(),
    tokens: z.number().int().nonnegative().optional(),
    nextRunAt: z.number().optional(),
});
export type AgentLoopIterationReport = z.infer<typeof AgentLoopIterationReportSchema>;
