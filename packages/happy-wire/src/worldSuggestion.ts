import { z } from "zod";

export const SUGGESTION_TYPES = ["suggested_goal", "suggested_task", "suggested_skill", "suggested_decision"] as const;
export type SuggestionType = typeof SUGGESTION_TYPES[number];

export const SUGGESTION_STATUSES = ["open", "processing", "accepted", "suspended", "dismissed", "expired"] as const;
export type SuggestionStatus = typeof SUGGESTION_STATUSES[number];

export const SUGGESTION_BUCKETS = ["next_step", "needs_decision", "needs_human_input"] as const;
export type SuggestionBucket = typeof SUGGESTION_BUCKETS[number];

export const SUGGESTION_ACCEPT_SOURCES = ["human", "system_auto"] as const;
export type SuggestionAcceptSource = typeof SUGGESTION_ACCEPT_SOURCES[number];

export const SUPERVISOR_MODES = ["disabled", "suggest", "semi-auto", "auto"] as const;
export type SupervisorMode = typeof SUPERVISOR_MODES[number];

export const WorldAutonomyPolicySchema = z.object({
  level: z.enum(SUPERVISOR_MODES),
  maxAutoAcceptsPerDay: z.number().int().positive().nullable(),
  maxConcurrentAutoTasks: z.number().int().positive().nullable(),
  autoTaskTypes: z.array(z.string()),
});
export type WorldAutonomyPolicy = z.infer<typeof WorldAutonomyPolicySchema>;

export const SUGGESTION_ACCEPT_AUDIT_RULES = [
  "safe_suggested_task_auto_accept",
  "retryable_failed_task_auto_accept",
  "blocked_goal_supplement_auto_accept",
] as const;
export type SuggestionAcceptAuditRule = typeof SUGGESTION_ACCEPT_AUDIT_RULES[number];

export const SuggestionAcceptAuditSchema = z.object({
  rule: z.enum(SUGGESTION_ACCEPT_AUDIT_RULES),
  checks: z.array(z.string()).min(1),
});
export type SuggestionAcceptAudit = z.infer<typeof SuggestionAcceptAuditSchema>;

export const SUGGESTION_AUTO_ACCEPT_STATUSES = ["skipped", "failed"] as const;
export type SuggestionAutoAcceptStatus = typeof SUGGESTION_AUTO_ACCEPT_STATUSES[number];

export const SUGGESTION_AUTO_ACCEPT_REASON_CODES = [
  "quota_exhausted",
  "already_acted",
  "accept_failed",
  "concurrency_exceeded",
  "mode_disabled",
] as const;
export type SuggestionAutoAcceptReasonCode = typeof SUGGESTION_AUTO_ACCEPT_REASON_CODES[number];

export const SUGGESTION_AUTO_ACCEPT_FAILURE_DETAILS = [
  "dispatch_failed",
  "payload_invalid",
  "auto_accept_failed",
] as const;
export type SuggestionAutoAcceptFailureDetail = typeof SUGGESTION_AUTO_ACCEPT_FAILURE_DETAILS[number];

export const EVIDENCE_KINDS = ["goal", "task", "decision", "message", "narrative"] as const;

export const SuggestionEvidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  id: z.string().optional(),
  label: z.string(),
});
export type SuggestionEvidence = z.infer<typeof SuggestionEvidenceSchema>;

export const SuggestionGoalPayloadSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
  priority: z.string().optional(),
});
export type SuggestionGoalPayload = z.infer<typeof SuggestionGoalPayloadSchema>;

export const SuggestionTaskPayloadSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  roleType: z.string().optional(),
  goalId: z.string().optional(),
  priority: z.string().optional(),
});
export type SuggestionTaskPayload = z.infer<typeof SuggestionTaskPayloadSchema>;

export const SuggestionSkillPayloadSchema = z.object({
  title: z.string(),
  content: z.string(),
  sourceTaskId: z.string().optional(),
});
export type SuggestionSkillPayload = z.infer<typeof SuggestionSkillPayloadSchema>;

export const SuggestionDecisionPayloadSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  goalId: z.string().optional(),
  existingDecisionId: z.string().optional(),
  options: z.array(z.object({
    id: z.string(),
    description: z.string(),
    pros: z.string().optional(),
    cons: z.string().optional(),
  })).min(2).max(10),
  precedentKey: z.string().optional(),
});
export type SuggestionDecisionPayload = z.infer<typeof SuggestionDecisionPayloadSchema>;

export function getSuggestionPayloadSchema(type: SuggestionType) {
  if (type === "suggested_goal") {
    return z.object({ goal: SuggestionGoalPayloadSchema });
  }
  if (type === "suggested_task") {
    return z.object({ task: SuggestionTaskPayloadSchema });
  }
  if (type === "suggested_skill") {
    return z.object({ skill: SuggestionSkillPayloadSchema });
  }
  return z.object({ decision: SuggestionDecisionPayloadSchema });
}

export type SuggestionPayload =
  | { goal: SuggestionGoalPayload }
  | { task: SuggestionTaskPayload }
  | { skill: SuggestionSkillPayload }
  | { decision: SuggestionDecisionPayload };

export const SuggestionPayloadSchema = z.union([
  z.object({ goal: SuggestionGoalPayloadSchema }),
  z.object({ task: SuggestionTaskPayloadSchema }),
  z.object({ skill: SuggestionSkillPayloadSchema }),
  z.object({ decision: SuggestionDecisionPayloadSchema }),
]);

export const AcceptBodySchema = z.object({
  machineId: z.string().optional(),
  priorityOverride: z.string().optional(),
  roleOverride: z.string().optional(),
});
export type AcceptBody = z.infer<typeof AcceptBodySchema>;

export const WorldSuggestionUpdatedSchema = z.object({
  type: z.literal("world-suggestion-updated"),
  projectId: z.string(),
  suggestionId: z.string(),
  status: z.enum(SUGGESTION_STATUSES),
});
export type WorldSuggestionUpdated = z.infer<typeof WorldSuggestionUpdatedSchema>;

export type SuggestionSerialized =
  | {
      id: string;
      projectId: string;
      relatedGoalId: string | null;
      relatedTaskId: string | null;
      type: "suggested_goal";
      title: string;
      summary: string;
      reason: string;
      evidence: SuggestionEvidence[];
      recommendedRole: string | null;
      payload: { goal: SuggestionGoalPayload };
      requiresHuman: boolean;
      status: SuggestionStatus;
      dedupeKey: string;
      bucket: SuggestionBucket;
      createdAt: number;
      actedAt: number | null;
      acceptSource?: SuggestionAcceptSource | null;
      acceptAudit?: SuggestionAcceptAudit | null;
      autoAcceptStatus?: SuggestionAutoAcceptStatus | null;
      autoAcceptReasonCode?: SuggestionAutoAcceptReasonCode | null;
      autoAcceptFailureDetail?: SuggestionAutoAcceptFailureDetail | null;
    }
  | {
      id: string;
      projectId: string;
      relatedGoalId: string | null;
      relatedTaskId: string | null;
      type: "suggested_task";
      title: string;
      summary: string;
      reason: string;
      evidence: SuggestionEvidence[];
      recommendedRole: string | null;
      payload: { task: SuggestionTaskPayload };
      requiresHuman: boolean;
      status: SuggestionStatus;
      dedupeKey: string;
      bucket: SuggestionBucket;
      createdAt: number;
      actedAt: number | null;
      acceptSource?: SuggestionAcceptSource | null;
      acceptAudit?: SuggestionAcceptAudit | null;
      autoAcceptStatus?: SuggestionAutoAcceptStatus | null;
      autoAcceptReasonCode?: SuggestionAutoAcceptReasonCode | null;
      autoAcceptFailureDetail?: SuggestionAutoAcceptFailureDetail | null;
    }
  | {
      id: string;
      projectId: string;
      relatedGoalId: string | null;
      relatedTaskId: string | null;
      type: "suggested_skill";
      title: string;
      summary: string;
      reason: string;
      evidence: SuggestionEvidence[];
      recommendedRole: string | null;
      payload: { skill: SuggestionSkillPayload };
      requiresHuman: boolean;
      status: SuggestionStatus;
      dedupeKey: string;
      bucket: SuggestionBucket;
      createdAt: number;
      actedAt: number | null;
      acceptSource?: SuggestionAcceptSource | null;
      acceptAudit?: SuggestionAcceptAudit | null;
      autoAcceptStatus?: SuggestionAutoAcceptStatus | null;
      autoAcceptReasonCode?: SuggestionAutoAcceptReasonCode | null;
      autoAcceptFailureDetail?: SuggestionAutoAcceptFailureDetail | null;
    }
  | {
      id: string;
      projectId: string;
      relatedGoalId: string | null;
      relatedTaskId: string | null;
      type: "suggested_decision";
      title: string;
      summary: string;
      reason: string;
      evidence: SuggestionEvidence[];
      recommendedRole: string | null;
      payload: { decision: SuggestionDecisionPayload };
      requiresHuman: boolean;
      status: SuggestionStatus;
      dedupeKey: string;
      bucket: SuggestionBucket;
      createdAt: number;
      actedAt: number | null;
      acceptSource?: SuggestionAcceptSource | null;
      acceptAudit?: SuggestionAcceptAudit | null;
      autoAcceptStatus?: SuggestionAutoAcceptStatus | null;
      autoAcceptReasonCode?: SuggestionAutoAcceptReasonCode | null;
      autoAcceptFailureDetail?: SuggestionAutoAcceptFailureDetail | null;
    };

export type SuggestionSummary = SuggestionSerialized;

export const AutonomyStatsRecentActionSchema = z.object({
  suggestionId: z.string(),
  title: z.string(),
  type: z.enum(SUGGESTION_TYPES),
  acceptedAt: z.number(),
  rule: z.string(),
});

export const AutonomyStatsSchema = z.object({
  mode: z.enum(SUPERVISOR_MODES),
  todayAutoAccepted: z.number().int(),
  todayQuota: z.number().int().nullable(),
  concurrentAutoTasks: z.number().int(),
  maxConcurrent: z.number().int().nullable(),
  recentAutoActions: z.array(AutonomyStatsRecentActionSchema),
});
export type AutonomyStats = z.infer<typeof AutonomyStatsSchema>;

