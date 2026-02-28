import { z } from "zod";

// Shared message metadata schema
export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(), // Source identifier
  permissionMode: z.string().optional(), // Permission mode key for this message
  model: z.string().nullable().optional(), // Model name for this message (null = reset)
  fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
  customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
  appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
  allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
  disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
  autoApprovePlan: z.boolean().optional(), // Auto-approve ExitPlanMode without showing confirmation buttons
  displayText: z.string().optional(), // Optional text to display in UI instead of actual message text
  // SDK reasoning & budget controls (Phase 3A)
  maxBudgetUsd: z.number().nullable().optional(), // Max budget in USD for the session
  thinking: z
    .object({
      type: z.enum(["adaptive", "enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .nullable()
    .optional(), // Thinking configuration
  effort: z.enum(["low", "medium", "high", "max"]).nullable().optional(), // Reasoning effort level
  locale: z.string().optional(), // User's preferred UI language (e.g. 'en', 'zh-Hans', 'ja')
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;
