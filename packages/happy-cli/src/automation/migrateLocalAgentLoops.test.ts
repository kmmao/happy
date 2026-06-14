/**
 * Unit tests for the one-shot CLI-local → server agent-loop migration.
 *
 * The migration module is fully injected — store / api / resolver are
 * all swapped for fakes here, so the tests verify orchestration
 * (idempotency, dry-run, error handling, long-tail field preservation)
 * without touching disk or network.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    migrateLocalAgentLoops,
    buildCreateBody,
    type MigrateApiClient,
    type MigrateProjectResolver,
    type MigrateLogger,
} from "./migrateLocalAgentLoops";
import { AgentLoopStore, type AgentLoopDefinition } from "./AgentLoopStore";
import type { SerializedAgentLoop } from "@kmmao/happy-wire";

function makeLoop(over: Partial<AgentLoopDefinition> = {}): AgentLoopDefinition {
    const now = Date.now();
    return {
        id: "local-1",
        prompt: "do the work",
        directory: "/tmp/proj",
        intervalMs: 60_000,
        enabled: true,
        createdAt: now,
        updatedAt: now,
        nextRunAt: now,
        iteration: 0,
        continuityKey: "agent-loop:local-1",
        agent: "claude",
        runtimeState: "idle",
        phase: "sleeping",
        phaseUpdatedAt: now,
        ...over,
    };
}

function makeServerLoop(id: string): SerializedAgentLoop {
    return {
        id,
        role: "generic",
        projectId: "server-proj-1",
        accountId: "acc-1",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function makeFakeResolver(
    map: Record<string, string | { error: string }>,
): MigrateProjectResolver {
    return {
        async resolveProjectId({ directory }) {
            const entry = map[directory];
            if (entry === undefined) {
                return { ok: false, error: `no mapping for ${directory}` };
            }
            if (typeof entry === "object") {
                return { ok: false, error: entry.error };
            }
            return { ok: true, projectId: entry };
        },
    };
}

function makeFakeApi(opts: {
    nextErrors?: Array<{ status?: number; error: string }>;
} = {}): MigrateApiClient & {
    calls: Array<{ projectId: string; body: unknown }>;
} {
    const calls: Array<{ projectId: string; body: unknown }> = [];
    const errors = [...(opts.nextErrors ?? [])];
    let counter = 0;
    return {
        calls,
        async createGenericAgentLoop({ projectId, body }) {
            calls.push({ projectId, body });
            const err = errors.shift();
            if (err) {
                return { ok: false, status: err.status, error: err.error };
            }
            counter++;
            return { ok: true, loop: makeServerLoop(`server-${counter}`) };
        },
    };
}

const silentLogger: MigrateLogger = {};

describe("migrateLocalAgentLoops.buildCreateBody", () => {
    it("uses cronExpression when present and skips intervalMs", () => {
        const body = buildCreateBody(
            makeLoop({ intervalMs: 60_000, cronExpression: "*/5 * * * *" }),
        );
        expect(body.cronExpression).toBe("*/5 * * * *");
        expect(body.intervalMs).toBeUndefined();
    });

    it("uses intervalMs when no cron present", () => {
        const body = buildCreateBody(makeLoop({ intervalMs: 60_000 }));
        expect(body.intervalMs).toBe(60_000);
        expect(body.cronExpression).toBeUndefined();
    });

    it("preserves long-tail fields under genericConfig", () => {
        const body = buildCreateBody(
            makeLoop({
                name: "nightly cleanup",
                environmentVariables: { FOO: "bar" },
                goal: "ship it",
                cooldownMs: 5000,
                maxAutoRunsPerDay: 10,
                downstreamLoopIds: ["loop-b"],
            }),
        );
        expect(body.genericConfig).toMatchObject({
            name: "nightly cleanup",
            environmentVariables: { FOO: "bar" },
            goal: "ship it",
            cooldownMs: 5000,
            maxAutoRunsPerDay: 10,
            downstreamLoopIds: ["loop-b"],
        });
    });

    it("does NOT migrate runtime state (iteration, nextRunAt, recentEvents)", () => {
        const body = buildCreateBody(
            makeLoop({
                iteration: 42,
                nextRunAt: 9999999999,
                recentEvents: [
                    {
                        id: "e1",
                        source: "file",
                        title: "x",
                        status: "pending",
                        createdAt: 1,
                    },
                ],
                runtimeState: "active",
                phase: "acting",
            }),
        );
        expect(body.genericConfig?.iteration).toBeUndefined();
        expect(body.genericConfig?.nextRunAt).toBeUndefined();
        expect(body.genericConfig?.recentEvents).toBeUndefined();
        expect(body.genericConfig?.runtimeState).toBeUndefined();
        expect(body.genericConfig?.phase).toBeUndefined();
    });

    it("omits genericConfig entirely when nothing to put there", () => {
        const body = buildCreateBody(makeLoop({}));
        expect(body.genericConfig).toBeUndefined();
    });
});

describe("migrateLocalAgentLoops orchestration", () => {
    let tmpDir: string;
    let storePath: string;
    let store: AgentLoopStore;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "migrate-loops-"));
        storePath = join(tmpDir, "agent-loops.json");
        store = new AgentLoopStore(storePath);
    });

    it("migrates an unmigrated loop and records the server id locally", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a" }));

        const api = makeFakeApi();
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        const summary = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
        });

        expect(summary).toMatchObject({
            total: 1,
            migrated: 1,
            skipped: 0,
            errored: 0,
            wouldMigrate: 0,
        });
        expect(api.calls).toHaveLength(1);
        expect(api.calls[0].projectId).toBe("proj-1");
        // Local row now carries the marker.
        const updated = store.get("loop-a");
        expect(updated?.migratedToServerLoopId).toBe("server-1");
    });

    it("is idempotent: a second run skips the already-migrated loop", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a" }));

        const api = makeFakeApi();
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        await migrateLocalAgentLoops({ store, api, resolver, logger: silentLogger });
        const second = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
        });

        expect(second).toMatchObject({
            total: 1,
            migrated: 0,
            skipped: 1,
            errored: 0,
        });
        // No additional API call on the second run.
        expect(api.calls).toHaveLength(1);
    });

    it("dry-run reports planned migrations but writes nothing", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a" }));
        await store.upsert(makeLoop({ id: "loop-b", continuityKey: "agent-loop:loop-b" }));

        const api = makeFakeApi();
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        const summary = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
            dryRun: true,
        });

        expect(summary).toMatchObject({ total: 2, wouldMigrate: 2, migrated: 0 });
        expect(api.calls).toHaveLength(0);
        // Re-load from disk: nothing was marked.
        const fresh = new AgentLoopStore(storePath);
        await fresh.load();
        expect(fresh.get("loop-a")?.migratedToServerLoopId).toBeUndefined();
        expect(fresh.get("loop-b")?.migratedToServerLoopId).toBeUndefined();
    });

    it("surfaces resolver failures without aborting other loops", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a", directory: "/tmp/proj" }));
        await store.upsert(makeLoop({ id: "loop-b", directory: "/unknown" }));

        const api = makeFakeApi();
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        const summary = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
        });

        expect(summary).toMatchObject({
            total: 2,
            migrated: 1,
            errored: 1,
        });
        const errorOutcome = summary.outcomes.find((o) => o.kind === "error");
        expect(errorOutcome?.localId).toBe("loop-b");
    });

    it("surfaces server rejections without marking the loop migrated", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a" }));

        const api = makeFakeApi({
            nextErrors: [{ status: 400, error: "invalid cron" }],
        });
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        const summary = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
        });

        expect(summary).toMatchObject({ migrated: 0, errored: 1 });
        expect(store.get("loop-a")?.migratedToServerLoopId).toBeUndefined();
    });

    it("respects skipDisabled — disabled loops do not migrate when flag set", async () => {
        await store.load();
        await store.upsert(makeLoop({ id: "loop-a", enabled: false }));
        await store.upsert(makeLoop({ id: "loop-b", enabled: true, continuityKey: "agent-loop:loop-b" }));

        const api = makeFakeApi();
        const resolver = makeFakeResolver({ "/tmp/proj": "proj-1" });

        const summary = await migrateLocalAgentLoops({
            store,
            api,
            resolver,
            logger: silentLogger,
            skipDisabled: true,
        });

        expect(summary).toMatchObject({ total: 2, migrated: 1, skipped: 1 });
    });

    // Final cleanup of the per-suite tmpdir is intentionally manual here:
    // each test creates its own under tmpDir via the beforeEach hook.
});

// Top-level cleanup: vitest tears down before the process exits, but we
// don't strictly need to clear tmp files — the OS reclaims them. Tests
// use unique mkdtempSync paths so they don't collide.
// (Left explicit here as a comment rather than an afterAll hook so the
//  file stays test-pure.)
