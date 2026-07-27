import { z } from 'zod';

/**
 * Subset of the OpenAI Realtime event protocol that the voice assistant acts on.
 *
 * The server emits many more event types than we handle; anything that does not
 * match one of these schemas is ignored rather than treated as an error.
 */

const FunctionCallArgumentsDoneSchema = z.object({
    type: z.literal('response.function_call_arguments.done'),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
});

const ErrorEventSchema = z.object({
    type: z.literal('error'),
    error: z.object({
        type: z.string().nullish(),
        code: z.string().nullish(),
        message: z.string().nullish(),
    }),
});

const PlainEventSchema = z.object({
    type: z.enum([
        'session.created',
        'session.updated',
        'input_audio_buffer.speech_started',
        'input_audio_buffer.speech_stopped',
        'output_audio_buffer.started',
        'output_audio_buffer.stopped',
        'output_audio_buffer.cleared',
        'response.created',
        'response.done',
    ]),
});

const ServerEventSchema = z.union([
    FunctionCallArgumentsDoneSchema,
    ErrorEventSchema,
    PlainEventSchema,
]);

export type RealtimeServerEvent = z.infer<typeof ServerEventSchema>;

/**
 * Parse a raw data channel payload, returning null for malformed frames and for
 * event types this client does not act on.
 */
export function parseServerEvent(raw: string): RealtimeServerEvent | null {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return null;
    }
    const parsed = ServerEventSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
}

/** Ask the model to produce a response with the current conversation state. */
export function responseCreateEvent(): Record<string, unknown> {
    return { type: 'response.create' };
}

/** Queue a user turn. Does not itself trigger a response. */
export function userTextItemEvent(text: string): Record<string, unknown> {
    return {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
        },
    };
}

/**
 * Queue background knowledge the assistant should have but must not answer to.
 * Sent without a following `response.create` so it never interrupts the user.
 */
export function contextItemEvent(text: string): Record<string, unknown> {
    return {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text }],
        },
    };
}

/** Return a client tool result for a pending function call. */
export function functionCallOutputEvent(callId: string, output: string): Record<string, unknown> {
    return {
        type: 'conversation.item.create',
        item: {
            type: 'function_call_output',
            call_id: callId,
            output,
        },
    };
}
