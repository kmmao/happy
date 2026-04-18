/**
 * Machine-related Zod schemas shared across CLI, Agent, and Server.
 *
 * Single source of truth for MachineMetadata, DaemonState,
 * and Tailscale types. All packages import from here.
 */

import * as z from "zod";

export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  happyCliVersion: z.string(),
  homeDir: z.string(),
  happyHomeDir: z.string(),
  happyLibDir: z.string(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

export const TailscaleServeEntrySchema = z.object({
  port: z.number(),
  path: z.string().optional(),
  protocol: z.string(),
  target: z.string(),
  funnel: z.boolean(),
  hostname: z.string(),
});

export type TailscaleServeEntry = z.infer<typeof TailscaleServeEntrySchema>;

export const TailscaleInfoSchema = z.object({
  status: z.enum(["connected", "disconnected", "not-installed"]),
  ipv4: z.string().optional(),
  ipv6: z.string().optional(),
  hostname: z.string().optional(),
  tailnetName: z.string().optional(),
  version: z.string().optional(),
  serves: z.array(TailscaleServeEntrySchema).optional(),
});

export type TailscaleInfo = z.infer<typeof TailscaleInfoSchema>;

export const TunnelEntrySchema = z.object({
  provider: z.string(),
  localPort: z.number(),
  remotePort: z.number().optional(),
  protocol: z.string(),
  path: z.string().optional(),
  target: z.string(),
  publicUrl: z.string().optional(),
  accessScope: z.enum(["public", "private", "tailnet"]),
  hostname: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type TunnelEntry = z.infer<typeof TunnelEntrySchema>;

export const TunnelProviderInfoSchema = z.object({
  provider: z.string(),
  status: z.enum(["available", "unavailable", "not-installed"]),
  version: z.string().optional(),
  entries: z.array(TunnelEntrySchema),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type TunnelProviderInfo = z.infer<typeof TunnelProviderInfoSchema>;

export const TunnelStateSchema = z.object({
  providers: z.array(TunnelProviderInfoSchema),
});

export type TunnelState = z.infer<typeof TunnelStateSchema>;

export const AutomationPrioritySchema = z.enum(["urgent", "user", "background"]);
export type AutomationPriority = z.infer<typeof AutomationPrioritySchema>;

export const AutomationJobKindSchema = z.enum(["supervisor", "webhook", "agent_loop", "task"]);
export type AutomationJobKind = z.infer<typeof AutomationJobKindSchema>;

export const AutomationJobStatusSchema = z.enum([
  "queued",
  "dispatching",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AutomationJobStatus = z.infer<typeof AutomationJobStatusSchema>;

export const AutomationJobSummarySchema = z.object({
  id: z.string(),
  kind: AutomationJobKindSchema,
  status: AutomationJobStatusSchema,
  priority: AutomationPrioritySchema,
  dedupeKey: z.string(),
  attempt: z.number(),
  maxAttempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  dispatchedAt: z.number().optional(),
  completedAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  sessionId: z.string().optional(),
  label: z.string().optional(),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  loopId: z.string().optional(),
  loopIteration: z.number().optional(),
  continuityKey: z.string().optional(),
  errorMessage: z.string().optional(),
  recovered: z.boolean().optional(),
});

export type AutomationJobSummary = z.infer<typeof AutomationJobSummarySchema>;

export const AutomationGuardianSummarySchema = z.object({
  key: z.string(),
  projectId: z.string(),
  loopId: z.string().optional(),
  sessionId: z.string(),
  updatedAt: z.number(),
  lastRunId: z.string().optional(),
  attached: z.boolean().optional(),
  recovered: z.boolean().optional(),
});

export type AutomationGuardianSummary = z.infer<typeof AutomationGuardianSummarySchema>;

export const AutomationGuardianUsageSummarySchema = z.object({
  key: z.string(),
  projectId: z.string().optional(),
  loopId: z.string().optional(),
  reuseCount: z.number(),
  rememberCount: z.number(),
  resetCount: z.number(),
  lastUsedAt: z.number(),
  currentSessionId: z.string().optional(),
});

export type AutomationGuardianUsageSummary = z.infer<typeof AutomationGuardianUsageSummarySchema>;

export const AutomationAuditEventSummarySchema = z.object({
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

export type AutomationAuditEventSummary = z.infer<typeof AutomationAuditEventSummarySchema>;

export const AutomationAuditStatsSchema = z.object({
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

export type AutomationAuditStats = z.infer<typeof AutomationAuditStatsSchema>;

export const AutomationCountsSchema = z.object({
  queued: z.number(),
  dispatching: z.number(),
  running: z.number(),
  completed: z.number(),
  failed: z.number(),
  cancelled: z.number(),
});

export type AutomationCounts = z.infer<typeof AutomationCountsSchema>;

export const AgentLoopSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  directory: z.string(),
  enabled: z.boolean(),
  intervalMs: z.number(),
  cronExpression: z.string().optional(),
  iteration: z.number(),
  nextRunAt: z.number(),
  runtimeState: z.string(),
  phase: z.string(),
  lastTriggerSource: z.string().optional(),
  lastBriefSummary: z.string().optional(),
  lastError: z.string().optional(),
  agent: z.string(),
});

export type AgentLoopSummary = z.infer<typeof AgentLoopSummarySchema>;

export const BootstrapProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  status: z.string(),
  statusUpdatedAt: z.number(),
  lastRunAt: z.number().optional(),
  lastRepoCount: z.number().optional(),
  lastSuggestionCount: z.number().optional(),
  lastError: z.string().optional(),
});

export type BootstrapProfileSummary = z.infer<typeof BootstrapProfileSummarySchema>;

export const AutoDreamProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  nextRunAt: z.number(),
  status: z.string(),
  stage: z.string(),
  statusUpdatedAt: z.number(),
  lastRunAt: z.number().optional(),
  lastMemoryFiles: z.number().optional(),
  lastError: z.string().optional(),
});

export type AutoDreamProfileSummary = z.infer<typeof AutoDreamProfileSummarySchema>;

export const AutomationStateSchema = z.object({
  updatedAt: z.number(),
  counts: AutomationCountsSchema,
  recentJobs: z.array(AutomationJobSummarySchema),
  guardians: z.array(AutomationGuardianSummarySchema).optional(),
  guardianUsage: z.array(AutomationGuardianUsageSummarySchema).optional(),
  auditStats: AutomationAuditStatsSchema.optional(),
  recentAuditEvents: z.array(AutomationAuditEventSummarySchema).optional(),
  loops: z.array(AgentLoopSummarySchema).optional(),
  bootstrapProfiles: z.array(BootstrapProfileSummarySchema).optional(),
  autoDreamProfiles: z.array(AutoDreamProfileSummarySchema).optional(),
});

export type AutomationState = z.infer<typeof AutomationStateSchema>;

export const BriefMessageSchema = z.object({
  loopId: z.string(),
  loopName: z.string().optional(),
  status: z.enum(["completed", "failed", "cancelled"]),
  summary: z.string(),
  detail: z.string(),
  generatedAt: z.number(),
  sessionId: z.string().optional(),
});

export type BriefMessage = z.infer<typeof BriefMessageSchema>;

export const CliInstallSourceSchema = z.enum([
  "npm-global",
  "local-source",
  "unknown",
]);

export type CliInstallSource = z.infer<typeof CliInstallSourceSchema>;

export const CliInstallInfoSchema = z.object({
  source: CliInstallSourceSchema,
  canSelfUpgrade: z.boolean(),
});

export type CliInstallInfo = z.infer<typeof CliInstallInfoSchema>;

export const DaemonStateSchema = z.object({
  status: z.union([
    z.enum(["running", "shutting-down"]),
    z.string(),
  ]),
  pid: z.number().optional(),
  httpPort: z.number().optional(),
  startTime: z.union([z.number(), z.string()]).optional(),
  startedAt: z.number().optional(),
  startedWithCliVersion: z.string().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource: z
    .union([
      z.enum(["mobile-app", "cli", "os-signal", "unknown"]),
      z.string(),
    ])
    .optional(),
  tailscale: TailscaleInfoSchema.optional(),
  tunnels: TunnelStateSchema.optional(),
  automation: AutomationStateSchema.optional(),
  recentBriefs: z.array(BriefMessageSchema).optional(),
  cliInstall: CliInstallInfoSchema.optional(),
  killed: z.boolean().optional(),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;
