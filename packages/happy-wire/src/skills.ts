import * as z from "zod";

// ===== Skill Summary (Server → App) =====
export const SkillSummarySchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  description: z.string().optional(),
  content: z.string(),
  attachments: z.array(z.string()),
  sourceKnowledgeId: z.string().optional(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  // ===== Front-matter routing (Phase 3) — parsed from `content` =====
  /** Short alias (haiku/sonnet/opus/fable) or raw model id to run this skill. */
  model: z.string().optional(),
  /** When false, only a user may trigger the skill; the model must not. */
  userInvocable: z.boolean().optional(),
  /** When true, the model must never auto-invoke the skill (Auto Mode included). */
  disableModelInvocation: z.boolean().optional(),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

// ===== Create Skill Body (App → Server) =====
export const CreateSkillBodySchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  content: z.string().min(1).max(50000),
  attachments: z.array(z.string()).max(10).default([]),
  sourceKnowledgeId: z.string().optional(),
});
export type CreateSkillBody = z.infer<typeof CreateSkillBodySchema>;

// ===== Update Skill Body =====
export const UpdateSkillBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  content: z.string().min(1).max(50000).optional(),
  attachments: z.array(z.string()).max(10).optional(),
  archived: z.boolean().optional(),
});
export type UpdateSkillBody = z.infer<typeof UpdateSkillBodySchema>;

// ===== Skill Content for Injection (included in TaskTriggerData) =====
export const SkillContentSchema = z.object({
  name: z.string(),
  content: z.string(),
  /** Resolved model id for this skill (from front-matter), if any. */
  model: z.string().optional(),
});
export type SkillContent = z.infer<typeof SkillContentSchema>;
