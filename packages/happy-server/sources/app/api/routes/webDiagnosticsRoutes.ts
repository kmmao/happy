import { z } from 'zod';
import { type Fastify } from '../types';

// Schema mirrors `Sample` in
// packages/happy-app/sources/sync/memoryWatchdog.ts. Keep in sync if that
// shape changes.
const MemwatchSampleSchema = z.object({
    t: z.number(),
    used: z.number(),
    limit: z.number(),
    ratio: z.number(),
    sessions: z.number(),
    msgs: z.number(),
    topId: z.string(),
    topMsgs: z.number(),
    contentMB: z.number().optional(),
    maxMsgKB: z.number().optional(),
    maxMsgKind: z.string().optional(),
});

// Schema mirrors `CrashRecord` in
// packages/happy-app/sources/components/web/WebErrorBoundary.tsx.
const CrashRecordSchema = z.object({
    t: z.number(),
    kind: z.enum(['render', 'error', 'unhandledrejection']),
    message: z.string(),
    stack: z.string().optional(),
});

/**
 * Receive a one-shot diagnostic upload from the happy-app web client on
 * startup: the previous run's memwatch trail (sampled heap usage every 15s)
 * plus any unreported crash records (React render errors, window.error,
 * unhandledrejection). Both batches are written verbatim to
 * .logs/web-diagnostics-YYYY-MM-DD.log (daily rotation, 14-day retention)
 * so we can tail/grep them for post-mortem after a renderer-OOM
 * ("Aw, Snap!", error 5) or any other browser crash.
 *
 * Not encrypted: the payload contains heap sizes, session-id prefixes,
 * message counts, and JS stack traces — no decrypted user content.
 * Authenticated via the standard Bearer token; userId is included in every
 * log line so multi-user instances stay greppable.
 */
export function webDiagnosticsRoutes(app: Fastify) {
    app.post('/v1/web-diagnostics/trail', {
        schema: {
            body: z.object({
                appVersion: z.string(),
                platform: z.string(),
                userAgent: z.string().max(1_000).optional(),
                memwatchTrail: z.array(MemwatchSampleSchema).max(200),
                crashRecords: z.array(CrashRecordSchema).max(50),
            }),
            response: {
                200: z.object({ success: z.literal(true) }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const { webDiagnosticsLogger, logger } = await import('@/utils/log');

        const { appVersion, platform, userAgent, memwatchTrail, crashRecords } = request.body;

        // Full payload to the dedicated file logger.
        webDiagnosticsLogger?.warn({
            userId,
            appVersion,
            platform,
            userAgent,
            memwatchSamples: memwatchTrail.length,
            crashCount: crashRecords.length,
            memwatchTrail,
            crashRecords,
        }, 'web-diag: trail received');

        // Lightweight summary to stdout so `dev` runs surface uploads
        // without having to tail the dedicated file.
        logger.warn({
            kind: 'web-diag',
            userId,
            appVersion,
            platform,
            samples: memwatchTrail.length,
            crashes: crashRecords.length,
        }, 'web-diag trail uploaded');

        return reply.send({ success: true });
    });
}
