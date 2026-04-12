import {
  SuggestionAcceptAuditSchema,
  SUGGESTION_AUTO_ACCEPT_FAILURE_DETAILS,
  SUGGESTION_AUTO_ACCEPT_REASON_CODES,
  SUGGESTION_AUTO_ACCEPT_STATUSES,
  getSuggestionPayloadSchema,
  type SuggestionAcceptAudit,
  type SuggestionAcceptSource,
  type SuggestionAutoAcceptFailureDetail,
  type SuggestionAutoAcceptReasonCode,
  type SuggestionAutoAcceptStatus,
  type SuggestionBucket,
  type SuggestionEvidence,
  type SuggestionPayload,
  type SuggestionSerialized,
  type SuggestionStatus,
  type SuggestionType,
} from "@kmmao/happy-wire";

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
  acceptSource?: SuggestionAcceptSource | null;
  acceptAudit?: string | null;
  autoAcceptStatus?: string | null;
  autoAcceptReasonCode?: string | null;
  autoAcceptFailureDetail?: string | null;
  createdAt: Date;
  actedAt: Date | null;
}): SuggestionSerialized {
  const evidence = safeParseJson(row.evidence, [] as SuggestionEvidence[]);
  const rawPayload = safeParseJson(row.payload, {} as Record<string, unknown>);
  const payload = normalizeSuggestionPayload({ type: row.type, title: row.title, rawPayload });
  const shared = {
    id: row.id,
    projectId: row.projectId,
    relatedGoalId: row.relatedGoalId,
    relatedTaskId: row.relatedTaskId,
    title: row.title,
    summary: row.summary,
    reason: row.reason,
    evidence,
    recommendedRole: row.recommendedRole,
    requiresHuman: row.requiresHuman,
    status: row.status,
    dedupeKey: row.dedupeKey,
    bucket: row.bucket ?? deriveSuggestionBucket({
      type: row.type,
      payload,
      evidence,
      requiresHuman: row.requiresHuman,
    }),
    acceptSource: row.acceptSource ?? null,
    acceptAudit: parseAcceptAudit(row.acceptAudit),
    autoAcceptStatus: parseAutoAcceptStatus(row.autoAcceptStatus),
    autoAcceptReasonCode: parseAutoAcceptReasonCode(row.autoAcceptReasonCode),
    autoAcceptFailureDetail: parseAutoAcceptFailureDetail(row.autoAcceptFailureDetail),
    createdAt: row.createdAt.getTime(),
    actedAt: row.actedAt?.getTime() ?? null,
  };

  if (row.type === "suggested_goal") {
    return {
      ...shared,
      type: row.type,
      payload: payload as { goal: NonNullable<SuggestionPayload extends infer T ? T : never> extends never ? never : any },
    } as SuggestionSerialized;
  }
  if (row.type === "suggested_task") {
    return {
      ...shared,
      type: row.type,
      payload: payload as { task: any },
    } as SuggestionSerialized;
  }
  if (row.type === "suggested_skill") {
    return {
      ...shared,
      type: row.type,
      payload: payload as { skill: any },
    } as SuggestionSerialized;
  }
  return {
    ...shared,
    type: row.type,
    payload: payload as { decision: any },
  } as SuggestionSerialized;
}

export function validateSuggestionPayload(input: {
  type: SuggestionType;
  rawPayload: Record<string, unknown>;
}): SuggestionPayload | null {
  const parsed = getSuggestionPayloadSchema(input.type).safeParse(input.rawPayload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data as SuggestionPayload;
}

export function normalizeSuggestionPayload(input: {
  type: SuggestionType;
  title: string;
  rawPayload: Record<string, unknown>;
}): SuggestionPayload {
  const validated = validateSuggestionPayload({ type: input.type, rawPayload: input.rawPayload });
  if (validated) {
    return validated;
  }
  if (input.type === "suggested_goal") {
    return { goal: { title: input.title } };
  }
  if (input.type === "suggested_task") {
    return { task: { title: input.title, prompt: input.title, priority: "user" } };
  }
  if (input.type === "suggested_skill") {
    return { skill: { title: input.title, content: input.title } };
  }
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

function parseAcceptAudit(raw: string | null | undefined): SuggestionAcceptAudit | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const result = SuggestionAcceptAuditSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseAutoAcceptStatus(raw: string | null | undefined): SuggestionAutoAcceptStatus | null {
  return raw && SUGGESTION_AUTO_ACCEPT_STATUSES.includes(raw as SuggestionAutoAcceptStatus)
    ? raw as SuggestionAutoAcceptStatus
    : null;
}

function parseAutoAcceptReasonCode(raw: string | null | undefined): SuggestionAutoAcceptReasonCode | null {
  return raw && SUGGESTION_AUTO_ACCEPT_REASON_CODES.includes(raw as SuggestionAutoAcceptReasonCode)
    ? raw as SuggestionAutoAcceptReasonCode
    : null;
}

function parseAutoAcceptFailureDetail(raw: string | null | undefined): SuggestionAutoAcceptFailureDetail | null {
  return raw && SUGGESTION_AUTO_ACCEPT_FAILURE_DETAILS.includes(raw as SuggestionAutoAcceptFailureDetail)
    ? raw as SuggestionAutoAcceptFailureDetail
    : null;
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
