import { z } from "zod";
import { Fastify } from "../types";
import { kvGet } from "@/app/kv/kvGet";
import { kvMutate } from "@/app/kv/kvMutate";
import { log } from "@/utils/log";

const SUB2API_CONFIG_KEY = "sub2api-config";

const Sub2ApiConfigSchema = z.object({
    baseUrl: z.string(),
    email: z.string(),
    password: z.string(),
});

const UsageProgressSchema = z.object({
    utilization: z.number(),
    resets_at: z.string().optional(),
    remaining_seconds: z.number(),
    window_stats: z.object({
        requests: z.number(),
        tokens: z.number(),
        cost: z.number(),
        standard_cost: z.number().optional(),
        user_cost: z.number().optional(),
    }).optional(),
}).nullable();

const AccountUsageSchema = z.object({
    account: z.object({
        id: z.number(),
        name: z.string(),
        platform: z.string(),
        type: z.string(),
        status: z.string(),
    }),
    usage: z.object({
        updated_at: z.string().optional(),
        five_hour: UsageProgressSchema.optional(),
        seven_day: UsageProgressSchema.optional(),
        seven_day_sonnet: UsageProgressSchema.optional(),
    }),
});

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Login to sub2api and return JWT token.
 */
async function sub2apiLogin(baseUrl: string, email: string, password: string): Promise<string> {
    const resp = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) {
        const errBody: any = await resp.json().catch(() => ({}));
        throw new Error(errBody.message || `Login failed (${resp.status})`);
    }
    const json = await resp.json() as any;
    return json.data.access_token;
}

/**
 * List Anthropic accounts from sub2api admin API.
 */
async function sub2apiListAccounts(baseUrl: string, token: string) {
    const resp = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/admin/accounts?page=1&page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Failed to list accounts (${resp.status})`);
    const json = await resp.json() as any;
    const items = (json.data?.items ?? []) as Array<{
        id: number; name: string; platform: string; type: string; status: string;
        extra?: Record<string, any>;
    }>;
    return items.filter(a => a.status === "active");
}

/**
 * Get usage for a single account.
 */
async function sub2apiGetUsage(baseUrl: string, token: string, accountId: number) {
    const resp = await fetch(`${normalizeBaseUrl(baseUrl)}/api/v1/admin/accounts/${accountId}/usage`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Failed to get usage (${resp.status})`);
    const json = await resp.json() as any;
    return json.data;
}

export function sub2apiRoutes(app: Fastify) {
    // GET /v1/sub2api/config — check if config exists
    app.get("/v1/sub2api/config", {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    configured: z.boolean(),
                    baseUrl: z.string().optional(),
                    email: z.string().optional(),
                }),
                500: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        try {
            const result = await kvGet({ uid: request.userId }, SUB2API_CONFIG_KEY);
            if (!result) {
                return reply.send({ configured: false });
            }
            const config = JSON.parse(Buffer.from(result.value, "base64").toString("utf-8"));
            return reply.send({
                configured: true,
                baseUrl: config.baseUrl,
                email: config.email,
                // Never return password to client
            });
        } catch (error) {
            log({ module: "sub2api", level: "error" }, `Failed to get config: ${error}`);
            return reply.code(500).send({ error: "Failed to get config" });
        }
    });

    // POST /v1/sub2api/config — save config (with connectivity test)
    app.post("/v1/sub2api/config", {
        preHandler: app.authenticate,
        schema: {
            body: Sub2ApiConfigSchema,
            response: {
                200: z.object({ success: z.boolean() }),
                400: z.object({ error: z.string() }),
                500: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const { baseUrl, email, password } = request.body;

        // Test connectivity first
        try {
            await sub2apiLogin(baseUrl, email, password);
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || "Connection test failed" });
        }

        // Save to KV store
        try {
            const value = Buffer.from(JSON.stringify({ baseUrl, email, password })).toString("base64");
            const existing = await kvGet({ uid: request.userId }, SUB2API_CONFIG_KEY);
            const version = existing?.version ?? -1;

            await kvMutate({ uid: request.userId }, [
                { key: SUB2API_CONFIG_KEY, value, version },
            ]);
            return reply.send({ success: true });
        } catch (error) {
            log({ module: "sub2api", level: "error" }, `Failed to save config: ${error}`);
            return reply.code(500).send({ error: "Failed to save config" });
        }
    });

    // DELETE /v1/sub2api/config — clear config
    app.delete("/v1/sub2api/config", {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({ success: z.boolean() }),
                500: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        try {
            const existing = await kvGet({ uid: request.userId }, SUB2API_CONFIG_KEY);
            if (existing) {
                await kvMutate({ uid: request.userId }, [
                    { key: SUB2API_CONFIG_KEY, value: null, version: existing.version },
                ]);
            }
            return reply.send({ success: true });
        } catch (error) {
            log({ module: "sub2api", level: "error" }, `Failed to clear config: ${error}`);
            return reply.code(500).send({ error: "Failed to clear config" });
        }
    });

    // GET /v1/sub2api/usage — proxy: login → list accounts → fetch usage
    app.get("/v1/sub2api/usage", {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    accounts: z.array(AccountUsageSchema),
                }),
                404: z.object({ error: z.string() }),
                500: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        // Load config from KV
        const kvResult = await kvGet({ uid: request.userId }, SUB2API_CONFIG_KEY);
        if (!kvResult) {
            return reply.code(404).send({ error: "Sub2API not configured" });
        }

        let config: { baseUrl: string; email: string; password: string };
        try {
            config = JSON.parse(Buffer.from(kvResult.value, "base64").toString("utf-8"));
        } catch {
            return reply.code(500).send({ error: "Invalid config data" });
        }

        try {
            const token = await sub2apiLogin(config.baseUrl, config.email, config.password);
            const accounts = await sub2apiListAccounts(config.baseUrl, token);

            const results = await Promise.all(
                accounts.map(async (account) => {
                    let usage: any = {};
                    try {
                        usage = await sub2apiGetUsage(config.baseUrl, token, account.id);
                    } catch {
                        // usage stays empty
                    }

                    // Merge passive 7d data from account extra field (setup-token accounts)
                    const extra = account.extra;
                    if (extra && !usage.seven_day && extra.passive_usage_7d_utilization != null) {
                        const resetTs = extra.passive_usage_7d_reset as number | undefined;
                        const remainingSeconds = resetTs ? Math.max(0, resetTs - Math.floor(Date.now() / 1000)) : 0;
                        usage.seven_day = {
                            utilization: Math.round((extra.passive_usage_7d_utilization as number) * 100),
                            remaining_seconds: remainingSeconds,
                            ...(resetTs ? { resets_at: new Date(resetTs * 1000).toISOString() } : {}),
                        };
                    }

                    const { extra: _, ...accountSummary } = account;
                    return { account: accountSummary, usage };
                })
            );

            return reply.send({ accounts: results });
        } catch (error: any) {
            log({ module: "sub2api", level: "error" }, `Failed to fetch usage: ${error}`);
            return reply.code(500).send({ error: error.message || "Failed to fetch usage" });
        }
    });
}
