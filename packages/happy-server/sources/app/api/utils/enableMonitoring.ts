import { db } from "@/storage/db";
import { redis } from "@/storage/redis";
import { s3client, s3bucket, isLocalStorage } from "@/storage/files";
import { Fastify } from "../types";
import { httpRequestsCounter, httpRequestDurationHistogram } from "@/app/monitoring/metrics2";
import { log } from "@/utils/log";

export function enableMonitoring(app: Fastify) {
    // Add metrics hooks
    app.addHook('onRequest', async (request, _reply) => {
        request.startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
        const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
        const method = request.method;
        // Use routeOptions.url for the route template, fallback to parsed URL path
        const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
        const status = reply.statusCode.toString();

        // Increment request counter
        httpRequestsCounter.inc({ method, route, status });

        // Record request duration
        httpRequestDurationHistogram.observe({ method, route, status }, duration);
    });

    app.get('/health', async (_request, reply) => {
        const failures: string[] = [];

        // Test database connectivity
        try {
            await db.$queryRaw`SELECT 1`;
        } catch (error) {
            log({ module: 'health', level: 'error' }, `Health check: database failed: ${error}`);
            failures.push('database');
        }

        // Test Redis connectivity
        try {
            await redis.ping();
        } catch (error) {
            log({ module: 'health', level: 'error' }, `Health check: redis failed: ${error}`);
            failures.push('redis');
        }

        // Test S3 connectivity (only when S3 is configured, not local storage)
        if (!isLocalStorage()) {
            try {
                await s3client.bucketExists(s3bucket);
            } catch (error) {
                log({ module: 'health', level: 'error' }, `Health check: s3 failed: ${error}`);
                failures.push('s3');
            }
        }

        if (failures.length > 0) {
            reply.code(503).send({
                status: 'error',
                timestamp: new Date().toISOString(),
                service: 'happy-server',
                failures,
            });
        } else {
            reply.send({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'happy-server'
            });
        }
    });
}