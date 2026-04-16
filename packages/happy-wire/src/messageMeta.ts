import * as z from 'zod';

export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'read-only', 'safe-yolo', 'yolo']).optional(),
  model: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  displayText: z.string().optional(),
  /**
   * When false, the message is appended to the transcript without triggering
   * an assistant turn. Requires @anthropic-ai/claude-agent-sdk 0.2.110+ on CLI.
   * Defaults to true when unset (normal turn-triggering message).
   */
  shouldQuery: z.boolean().optional(),
  requestDiagnostics: z
    .object({
      version: z.literal(1),
      requestId: z.string(),
      clientCreatedAtMs: z.number(),
    })
    .optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;
