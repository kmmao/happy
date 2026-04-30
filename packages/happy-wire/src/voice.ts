import * as z from 'zod';

export const VoiceTokenAllowedSchema = z.object({
    allowed: z.literal(true),
    token: z.string(),
    agentId: z.string(),
    elevenUserId: z.string(),
    usedSeconds: z.number(),
    limitSeconds: z.number(),
});

export const VoiceTokenDeniedSchema = z.object({
    allowed: z.literal(false),
    reason: z.enum(['voice_limit_reached', 'subscription_required']),
    usedSeconds: z.number(),
    limitSeconds: z.number(),
    agentId: z.string(),
});

export const VoiceTokenResponseSchema = z.discriminatedUnion('allowed', [
    VoiceTokenAllowedSchema,
    VoiceTokenDeniedSchema,
]);

export const LiveKitTokenResponseSchema = z.object({
    token: z.string(),
    url: z.string(),
    roomName: z.string(),
});

export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponseSchema>;
export type LiveKitTokenResponse = z.infer<typeof LiveKitTokenResponseSchema>;
