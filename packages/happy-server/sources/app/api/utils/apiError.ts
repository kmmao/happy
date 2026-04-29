import { z } from "zod";

export const ErrorEnvelopeSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
    }),
});

export function apiError(code: string, message: string, details?: Record<string, unknown>) {
    const body: { code: string; message: string; details?: Record<string, unknown> } = { code, message };
    if (details !== undefined) body.details = details;
    return { error: body };
}
