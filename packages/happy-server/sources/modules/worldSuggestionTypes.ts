import { z } from "zod";

// --- Enums ---

export const SUGGESTION_TYPES = ["suggested_goal", "suggested_task", "suggested_skill", "suggested_decision"] as const;
export type SuggestionType = typeof SUGGESTION_TYPES[number];

export const SUGGESTION_STATUSES = ["open", "processing", "accepted", "suspended", "dismissed", "expired"] as const;
export type SuggestionStatus = typeof SUGGESTION_STATUSES[number];

export const SUGGESTION_BUCKETS = ["next_step", "needs_decision", "needs_human_input"] as const;
export type SuggestionBucket = typeof SUGGESTION_BUCKETS[number];

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

export interface SuggestionSerialized {
    id: string;
    projectId: string;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: SuggestionType;
    title: string;
    summary: string;
    reason: string;
    evidence: SuggestionEvidence[];
    recommendedRole: string | null;
    payload: SuggestionPayload;
    requiresHuman: boolean;
    status: SuggestionStatus;
    dedupeKey: string;
    bucket: SuggestionBucket;
    createdAt: number;
    actedAt: number | null;
}

export function serializeSuggestion(row: {
    id: string;
    projectId: string;
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: SuggestionType;
    title: string;
    summary: string;
    reason: string;
    evidence: string;
    recommendedRole: string | null;
    payload: string;
    requiresHuman: boolean;
    status: SuggestionStatus;
    dedupeKey: string;
    bucket?: SuggestionBucket | null;
    createdAt: Date;
    actedAt: Date | null;
}): SuggestionSerialized {
    const evidence = safeParseJson(row.evidence, [] as SuggestionEvidence[]);
    const rawPayload = safeParseJson(row.payload, {} as Record<string, unknown>);
    const payload = row.type === "suggested_goal"
        ? normalizeSuggestionPayload({ type: row.type, title: row.title, rawPayload })
        : row.type === "suggested_task"
            ? normalizeSuggestionPayload({ type: row.type, title: row.title, rawPayload })
            : row.type === "suggested_skill"
                ? normalizeSuggestionPayload({ type: row.type, title: row.title, rawPayload })
                : normalizeSuggestionPayload({ type: row.type, title: row.title, rawPayload });
    return {
        id: row.id,
        projectId: row.projectId,
        relatedGoalId: row.relatedGoalId,
        relatedTaskId: row.relatedTaskId,
        type: row.type,
        title: row.title,
        summary: row.summary,
        reason: row.reason,
        evidence,
        recommendedRole: row.recommendedRole,
        payload,
        requiresHuman: row.requiresHuman,
        status: row.status,
        dedupeKey: row.dedupeKey,
        bucket: row.bucket ?? deriveSuggestionBucket({
            type: row.type,
            payload,
            evidence,
            requiresHuman: row.requiresHuman,
        }),
        createdAt: row.createdAt.getTime(),
        actedAt: row.actedAt?.getTime() ?? null,
    };
}

export function normalizeSuggestionPayload(input: {
    type: "suggested_goal";
    title: string;
    rawPayload: Record<string, unknown>;
}): { goal: SuggestionGoalPayload };
export function normalizeSuggestionPayload(input: {
    type: "suggested_task";
    title: string;
    rawPayload: Record<string, unknown>;
}): { task: SuggestionTaskPayload };
export function normalizeSuggestionPayload(input: {
    type: "suggested_skill";
    title: string;
    rawPayload: Record<string, unknown>;
}): { skill: SuggestionSkillPayload };
export function normalizeSuggestionPayload(input: {
    type: "suggested_decision";
    title: string;
    rawPayload: Record<string, unknown>;
}): { decision: SuggestionDecisionPayload };
export function normalizeSuggestionPayload(input: {
    type: SuggestionType;
    title: string;
    rawPayload: Record<string, unknown>;
}): SuggestionPayload {
    if (input.type === "suggested_goal") {
        const parsed = z.object({ goal: SuggestionGoalPayloadSchema }).safeParse(input.rawPayload);
        if (parsed.success) return parsed.data;
        return { goal: { title: input.title } };
    }
    if (input.type === "suggested_task") {
        const parsed = z.object({ task: SuggestionTaskPayloadSchema }).safeParse(input.rawPayload);
        if (parsed.success) return parsed.data;
        return { task: { title: input.title, prompt: input.title, priority: "user" } };
    }
    if (input.type === "suggested_skill") {
        const parsed = z.object({ skill: SuggestionSkillPayloadSchema }).safeParse(input.rawPayload);
        if (parsed.success) return parsed.data;
        return { skill: { title: input.title, content: input.title } };
    }
    const parsed = z.object({ decision: SuggestionDecisionPayloadSchema }).safeParse(input.rawPayload);
    if (parsed.success) return parsed.data;
    return {
        decision: {
            question: input.title,
            options: [
                { id: "option_a", description: "Option A" },
                { id: "option_b", description: "Option B" },
            ],
        },
    };
}

export function deriveSuggestionBucket(input: {
    type: SuggestionType;
    payload: SuggestionPayload;
    evidence: SuggestionEvidence[];
    requiresHuman: boolean;
}): SuggestionBucket {
    if (input.type === "suggested_decision" || "decision" in input.payload) {
        return "needs_decision";
    }
    if (input.evidence.some((item) => item.kind === "message")) {
        return "needs_human_input";
    }
    if (input.requiresHuman && input.type === "suggested_goal") {
        return "needs_human_input";
    }
    return "next_step";
}

function safeParseJson<T>(raw: string, fallback: T): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}
