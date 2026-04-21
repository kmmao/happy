import * as z from "zod";
import {
  CodexConfigModeSchema,
  CodexRequestedBackendSchema,
  CodexResolvedBackendSchema,
} from "./codexBackendSelection";

export {
  type CodexConfigMode,
  CodexConfigModeSchema,
  type CodexRequestedBackend,
  CodexRequestedBackendSchema,
  type CodexResolvedBackend,
  CodexResolvedBackendSchema,
} from "./codexBackendSelection";

export const CodexRuntimeConfigSchema = z.object({
  model: z.string().nullish(),
  profile: z.string().nullish(),
  approvalPolicy: z.string().nullish(),
  sandboxMode: z.string().nullish(),
  serviceTier: z.string().nullish(),
  reasoningEffort: z.string().nullish(),
  reasoningSummary: z.string().nullish(),
  verbosity: z.string().nullish(),
  webSearch: z.string().nullish(),
});

export type CodexRuntimeConfig = z.infer<typeof CodexRuntimeConfigSchema>;

export const CodexAccountSchema = z.object({
  type: z.enum(["apiKey", "chatgpt"]).nullable().optional(),
  email: z.string().nullish(),
  planType: z.string().nullish(),
  requiresOpenaiAuth: z.boolean().optional(),
});

export type CodexAccount = z.infer<typeof CodexAccountSchema>;

export const CodexRateLimitsSchema = z.object({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  planType: z.string().nullish(),
  hasCredits: z.boolean().optional(),
});

export type CodexRateLimits = z.infer<typeof CodexRateLimitsSchema>;

export const CodexExperimentalFeatureSchema = z.object({
  name: z.string(),
  stage: z.string(),
  enabled: z.boolean(),
  defaultEnabled: z.boolean(),
});

export type CodexExperimentalFeature = z.infer<
  typeof CodexExperimentalFeatureSchema
>;

export const CodexSkillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  enabled: z.boolean(),
});

export type CodexSkillSummary = z.infer<typeof CodexSkillSummarySchema>;

export const CodexPromptSummarySchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().nullish(),
});

export type CodexPromptSummary = z.infer<typeof CodexPromptSummarySchema>;

export const CodexAgentSummarySchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type CodexAgentSummary = z.infer<typeof CodexAgentSummarySchema>;

export const CodexMcpServerSummarySchema = z.object({
  name: z.string(),
  authStatus: z.string(),
  toolCount: z.number(),
});

export type CodexMcpServerSummary = z.infer<
  typeof CodexMcpServerSummarySchema
>;

export const CodexMetadataSchema = z.object({
  requestedBackend: CodexRequestedBackendSchema.optional(),
  resolvedBackend: CodexResolvedBackendSchema.optional(),
  configMode: CodexConfigModeSchema.optional(),
  fallbackReason: z.string().optional(),
  backendVersion: z.string().optional(),
  threadId: z.string().optional(),
  config: CodexRuntimeConfigSchema.optional(),
  account: CodexAccountSchema.optional(),
  rateLimits: CodexRateLimitsSchema.optional(),
  experimentalFeatures: z.array(CodexExperimentalFeatureSchema).optional(),
  skills: z.array(CodexSkillSummarySchema).optional(),
  prompts: z.array(CodexPromptSummarySchema).optional(),
  agents: z.array(CodexAgentSummarySchema).optional(),
  mcpServers: z.array(CodexMcpServerSummarySchema).optional(),
});

export type CodexMetadata = z.infer<typeof CodexMetadataSchema>;
