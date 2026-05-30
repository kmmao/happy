import rateLimit from "@fastify/rate-limit";
import { log } from "@/utils/log";
import type { Fastify } from "../types";

// Default enabled — explicit opt-out requires RATE_LIMIT_ENABLED="false".
// Previously defaulted to disabled which made every downstream rate-limit ineffective in production.
const RATE_LIMIT_ENABLED = (process.env.RATE_LIMIT_ENABLED ?? "true") === "true";
const GLOBAL_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "600", 10);
const GLOBAL_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW ?? "60000", 10);

export const AUTH_RATE_LIMIT = { max: 10, timeWindow: 60_000 };
export const WEBHOOK_INBOUND_RATE_LIMIT = { max: 30, timeWindow: 60_000 };

export async function enableRateLimit(app: Fastify) {
    if (!RATE_LIMIT_ENABLED) {
        log({ module: "rate-limit" }, "Global rate limiting disabled (RATE_LIMIT_ENABLED != true)");
        return;
    }

    const redisUrl = process.env.REDIS_URL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let redisClient: any;

    if (redisUrl) {
        try {
            const { Redis } = await import("ioredis");
            redisClient = new Redis(redisUrl);
            log({ module: "rate-limit" }, "Using Redis store for rate limiting");
        } catch {
            log({ module: "rate-limit" }, "Redis unavailable, falling back to in-memory store");
        }
    }

    await app.register(rateLimit, {
        global: true,
        max: GLOBAL_MAX,
        timeWindow: GLOBAL_WINDOW_MS,
        ...(redisClient ? { redis: redisClient } : {}),
        allowList: (request: any) => request.method === "OPTIONS",
        keyGenerator: (request: any) => {
            return request.userId ?? request.ip;
        },
        errorResponseBuilder: (_request: any, context: any) => ({
            error: "Too Many Requests",
            message: `Rate limit exceeded, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
            statusCode: 429,
        }),
    });

    log({ module: "rate-limit" }, `Global rate limiting enabled: ${GLOBAL_MAX} req / ${GLOBAL_WINDOW_MS}ms per user`);
}
