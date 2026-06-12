/**
 * MCP Server routes — CRUD endpoints for the persistent MCP server registry.
 *
 * Wraps the KV-based MCP registry with server-side validation and
 * MCP-specific semantics. The registry lives as a single JSON blob under
 * `mcp:servers` in UserKVStore, giving us account-scoped, encrypted,
 * version-controlled persistence without a dedicated Prisma model.
 *
 * Routes:
 *   POST   /v1/mcp/servers          — register (upsert) a server
 *   GET    /v1/mcp/servers          — list all servers
 *   GET    /v1/mcp/servers/:name    — get a single server
 *   PATCH  /v1/mcp/servers/:name    — update server metadata
 *   DELETE /v1/mcp/servers/:name    — unregister a server
 *   POST   /v1/mcp/servers/:name/toggle — toggle enabled/disabled
 */

import { type Fastify } from "../types";
import { z } from "zod";
import { kvGet } from "@/app/kv/kvGet";
import { kvMutate } from "@/app/kv/kvMutate";
import {
    McpTransportConfigSchema,
    McpRegistrySchema,
    parseMcpRegistry,
    createEmptyMcpRegistry,
    MCP_REGISTRY_KV_KEY,
    type McpRegistry,
    type McpRegistryEntry,
} from "@kmmao/happy-wire";
import { log } from "@/utils/log";
import * as privacyKit from "privacy-kit";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Load the registry blob from KV, returning the parsed object and version. */
async function loadRegistry(uid: string): Promise<{ registry: McpRegistry; version: number }> {
    const item = await kvGet({ uid }, MCP_REGISTRY_KV_KEY);
    if (!item) {
        return { registry: createEmptyMcpRegistry(), version: -1 };
    }
    const bytes = privacyKit.decodeBase64(item.value);
    const jsonStr = new TextDecoder().decode(bytes);
    return { registry: parseMcpRegistry(jsonStr), version: item.version };
}

/** Save the registry blob to KV with optimistic concurrency. */
async function saveRegistry(
    uid: string,
    registry: McpRegistry,
    version: number,
): Promise<{ version: number }> {
    const value = JSON.stringify(McpRegistrySchema.parse(registry));
    const bytes = new TextEncoder().encode(value);
    const base64 = privacyKit.encodeBase64(bytes);
    const result = await kvMutate({ uid }, [
        { key: MCP_REGISTRY_KV_KEY, value: base64, version },
    ]);
    if (!result.success) {
        throw new VersionConflictError(result.errors![0].version);
    }
    return { version: result.results![0].version };
}

class VersionConflictError extends Error {
    serverVersion: number;
    constructor(serverVersion: number) {
        super("version-conflict");
        this.serverVersion = serverVersion;
    }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const RegisterBodySchema = z.object({
    name: z.string().min(1).max(128),
    transport: McpTransportConfigSchema,
    enabled: z.boolean().default(true),
    machineId: z.string().optional(),
    description: z.string().max(512).optional(),
    category: z.string().max(64).optional(),
    icon: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    packageName: z.string().max(256).optional(),
    version: z.string().max(64).optional(),
    author: z.string().max(128).optional(),
    homepage: z.string().max(512).optional(),
}).strict();

const UpdateBodySchema = z.object({
    transport: McpTransportConfigSchema.optional(),
    enabled: z.boolean().optional(),
    machineId: z.string().nullable().optional(),
    description: z.string().max(512).nullable().optional(),
    category: z.string().max(64).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    tags: z.array(z.string().max(64)).max(20).nullable().optional(),
    packageName: z.string().max(256).nullable().optional(),
    version: z.string().max(64).nullable().optional(),
    author: z.string().max(128).nullable().optional(),
    homepage: z.string().max(512).nullable().optional(),
    toolInventory: z.array(z.string().max(128)).max(200).nullable().optional(),
    lastConnectedAt: z.string().nullable().optional(),
    connectionCount: z.number().int().nonnegative().nullable().optional(),
}).strict();

const ListQuerySchema = z.object({
    machineId: z.string().optional(),
    category: z.string().optional(),
    enabled: z.preprocess(
        (v) => v === "true" ? true : v === "false" ? false : undefined,
        z.boolean().optional(),
    ),
});

export const ServerEntryResponseSchema = z.object({
    name: z.string(),
    transport: z.object({
        type: z.string(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
    }),
    enabled: z.boolean(),
    machineId: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    icon: z.string().optional(),
    tags: z.array(z.string()).optional(),
    packageName: z.string().optional(),
    version: z.string().optional(),
    author: z.string().optional(),
    homepage: z.string().optional(),
    toolInventory: z.array(z.string()).optional(),
    lastConnectedAt: z.string().optional(),
    connectionCount: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export function mcpServerRoutes(app: Fastify) {

    // POST /v1/mcp/servers — register (upsert) a server
    app.post(
        "/v1/mcp/servers",
        {
            preHandler: app.authenticate,
            schema: { body: RegisterBodySchema },
        },
        async (request, reply) => {
            const body = request.body;
            const now = new Date().toISOString();

            try {
                const { registry, version } = await loadRegistry(request.userId);
                const existing = registry.servers[body.name];

                const entry: McpRegistryEntry = {
                    ...body,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                };

                const updated: McpRegistry = {
                    ...registry,
                    servers: { ...registry.servers, [body.name]: entry },
                };

                const { version: newVersion } = await saveRegistry(request.userId, updated, version);

                log({ module: "mcp" }, `MCP server registered: "${body.name}" (${body.transport.type})`);
                return reply.code(existing ? 200 : 201).send({
                    server: entry,
                    registryVersion: newVersion,
                });
            } catch (e) {
                if (e instanceof VersionConflictError) {
                    return reply.code(409).send({ error: "version-conflict", serverVersion: e.serverVersion });
                }
                throw e;
            }
        },
    );

    // GET /v1/mcp/servers — list all servers
    app.get(
        "/v1/mcp/servers",
        {
            preHandler: app.authenticate,
            schema: { querystring: ListQuerySchema },
        },
        async (request, reply) => {
            const { machineId, category, enabled } = request.query;
            const { registry, version } = await loadRegistry(request.userId);

            let entries = Object.values(registry.servers);

            // Filter by machineId: show account-wide + matching machine
            if (machineId) {
                entries = entries.filter(
                    (e) => !e.machineId || e.machineId === machineId,
                );
            }

            // Filter by category
            if (category) {
                entries = entries.filter((e) => e.category === category);
            }

            // Filter by enabled
            if (enabled !== undefined) {
                entries = entries.filter((e) => e.enabled === enabled);
            }

            return reply.send({
                servers: entries,
                total: entries.length,
                registryVersion: version,
            });
        },
    );

    // GET /v1/mcp/servers/:name — get single server
    app.get(
        "/v1/mcp/servers/:name",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ name: z.string().min(1).max(128) }),
            },
        },
        async (request, reply) => {
            const { registry } = await loadRegistry(request.userId);
            const entry = registry.servers[request.params.name];
            if (!entry) {
                return reply.code(404).send({ error: "Server not found" });
            }
            return reply.send({ server: entry });
        },
    );

    // PATCH /v1/mcp/servers/:name — update server metadata
    app.patch(
        "/v1/mcp/servers/:name",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ name: z.string().min(1).max(128) }),
                body: UpdateBodySchema,
            },
        },
        async (request, reply) => {
            const { name } = request.params;
            const updates = request.body;
            const now = new Date().toISOString();

            try {
                const { registry, version } = await loadRegistry(request.userId);
                const existing = registry.servers[name];
                if (!existing) {
                    return reply.code(404).send({ error: "Server not found" });
                }

                // Merge: null values clear the field, undefined values are skipped
                const merged: McpRegistryEntry = { ...existing, updatedAt: now };
                for (const [key, value] of Object.entries(updates)) {
                    if (value === undefined) continue;
                    if (value === null) {
                        delete (merged as Record<string, unknown>)[key];
                    } else {
                        (merged as Record<string, unknown>)[key] = value;
                    }
                }

                const updated: McpRegistry = {
                    ...registry,
                    servers: { ...registry.servers, [name]: merged },
                };

                const { version: newVersion } = await saveRegistry(request.userId, updated, version);

                log({ module: "mcp" }, `MCP server updated: "${name}"`);
                return reply.send({ server: merged, registryVersion: newVersion });
            } catch (e) {
                if (e instanceof VersionConflictError) {
                    return reply.code(409).send({ error: "version-conflict", serverVersion: e.serverVersion });
                }
                throw e;
            }
        },
    );

    // DELETE /v1/mcp/servers/:name — unregister a server
    app.delete(
        "/v1/mcp/servers/:name",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ name: z.string().min(1).max(128) }),
            },
        },
        async (request, reply) => {
            const { name } = request.params;

            try {
                const { registry, version } = await loadRegistry(request.userId);
                if (!(name in registry.servers)) {
                    // Idempotent — already gone
                    return reply.send({ deleted: true });
                }

                const { [name]: _, ...remaining } = registry.servers;
                const updated: McpRegistry = { ...registry, servers: remaining };

                await saveRegistry(request.userId, updated, version);

                log({ module: "mcp" }, `MCP server unregistered: "${name}"`);
                return reply.send({ deleted: true });
            } catch (e) {
                if (e instanceof VersionConflictError) {
                    return reply.code(409).send({ error: "version-conflict", serverVersion: e.serverVersion });
                }
                throw e;
            }
        },
    );

    // POST /v1/mcp/servers/:name/toggle — toggle enabled/disabled
    app.post(
        "/v1/mcp/servers/:name/toggle",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ name: z.string().min(1).max(128) }),
                body: z.object({ enabled: z.boolean() }).strict(),
            },
        },
        async (request, reply) => {
            const { name } = request.params;
            const { enabled } = request.body;

            try {
                const { registry, version } = await loadRegistry(request.userId);
                const existing = registry.servers[name];
                if (!existing) {
                    return reply.code(404).send({ error: "Server not found" });
                }

                const merged: McpRegistryEntry = {
                    ...existing,
                    enabled,
                    updatedAt: new Date().toISOString(),
                };

                const updated: McpRegistry = {
                    ...registry,
                    servers: { ...registry.servers, [name]: merged },
                };

                const { version: newVersion } = await saveRegistry(request.userId, updated, version);

                log({ module: "mcp" }, `MCP server toggled: "${name}" enabled=${enabled}`);
                return reply.send({ server: merged, registryVersion: newVersion });
            } catch (e) {
                if (e instanceof VersionConflictError) {
                    return reply.code(409).send({ error: "version-conflict", serverVersion: e.serverVersion });
                }
                throw e;
            }
        },
    );
}
