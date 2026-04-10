import { z } from "zod";

// --- Enums ---

export const SUGGESTION_TYPES = ["suggested_goal", "suggested_task", "suggested_skill", "suggested_decision"] as const;
export type SuggestionType = typeof SUGGESTION_TYPES[number];

export const SUGGESTION_STATUSES = ["open", "processing", "accepted", "suspended", "dismissed", "expired"] as const;
export type SuggestionStatus = typeof SUGGESTION_STATUSES[number];

export const EVIDENCE_KINDS = ["goal", "task", "decision", "message", "narrative"] as const;

// --- Zod Schemas ---

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

export const SuggestionTaskPayloadSchema = z.object({
    title: z.string(),
    prompt: z.string(),
    roleType: z.string().optional(),
    goalId: z.string().optional(),
    priority: z.string().optional(),
});

export const SuggestionSkillPayloadSchema = z.object({
    title: z.string(),
    content: z.string(),
    sourceTaskId: z.string().optional(),
});

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

export const SuggestionPayloadSchema = z.object({
    goal: SuggestionGoalPayloadSchema.optional(),
    task: SuggestionTaskPayloadSchema.optional(),
    skill: SuggestionSkillPayloadSchema.optional(),
    decision: SuggestionDecisionPayloadSchema.optional(),
});
export type SuggestionPayload = z.infer<typeof SuggestionPayloadSchema>;

export const AcceptBodySchema = z.object({
    machineId: z.string().optional(),
    priorityOverride: z.string().optional(),
    roleOverride: z.string().optional(),
});
export type AcceptBody = z.infer<typeof AcceptBodySchema>;

// --- Serialized output ---

export interface SuggestionSerialized {
    id: string;
    projectId: string;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: string;
    title: string;
    summary: string;
    reason: string;
    evidence: SuggestionEvidence[];
    recommendedRole: string | null;
    payload: SuggestionPayload;
    requiresHuman: boolean;
    status: string;
    dedupeKey: string;
    createdAt: number;
    actedAt: number | null;
}

export function serializeSuggestion(row: {
    id: string;
    projectId: string;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: string;
    title: string;
    summary: string;
    reason: string;
    evidence: string;
    recommendedRole: string | null;
    payload: string;
    requiresHuman: boolean;
    status: string;
    dedupeKey: string;
    createdAt: Date;
    actedAt: Date | null;
}): SuggestionSerialized {
    return {
        id: row.id,
        projectId: row.projectId,
        relatedGoalId: row.relatedGoalId,
        relatedTaskId: row.relatedTaskId,
        type: row.type,
        title: row.title,
        summary: row.summary,
        reason: row.reason,
        evidence: safeParseJson(row.evidence, []),
        recommendedRole: row.recommendedRole,
        payload: safeParseJson(row.payload, {}),
        requiresHuman: row.requiresHuman,
        status: row.status,
        dedupeKey: row.dedupeKey,
        createdAt: row.createdAt.getTime(),
        actedAt: row.actedAt?.getTime() ?? null,
    };
}

function safeParseJson<T>(raw: string, fallback: T): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}
