import * as z from "zod";

export const AGENT_MSG_TYPES = [
    "request",
    "report",
    "conflict",
    "law_suggestion",
    "dependency_blocked",
    "handoff",
    "review_request",
    "decision_request",
] as const;

export type AgentMsgType = typeof AGENT_MSG_TYPES[number];

export const AgentMsgTypeSchema = z.enum(AGENT_MSG_TYPES);

export const AGENT_MSG_STATUSES = ["unread", "read", "resolved"] as const;
export type AgentMsgStatus = typeof AGENT_MSG_STATUSES[number];

export const AGENT_MSG_PRIORITIES = ["urgent", "normal", "low"] as const;
export type AgentMsgPriority = typeof AGENT_MSG_PRIORITIES[number];

export const AgentMessageSummarySchema = z.object({
    id: z.string(),
    projectId: z.string(),
    fromRole: z.string(),
    toRole: z.string().nullable(),
    msgType: AgentMsgTypeSchema,
    content: z.string(),
    status: z.enum(AGENT_MSG_STATUSES),
    sessionId: z.string().nullable(),
    decisionId: z.string().nullable(),
    relatedGoalId: z.string().nullable(),
    relatedTaskId: z.string().nullable(),
    priority: z.enum(AGENT_MSG_PRIORITIES),
    createdAt: z.number(),
    updatedAt: z.number(),
});

export type AgentMessageSummary = z.infer<typeof AgentMessageSummarySchema>;
