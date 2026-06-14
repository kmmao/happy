/**
 * One-shot migration — CLI-local `~/.happy/agent-loops.json` → server-side
 * generic AgentLoop table (ADR-0022 Phase 3b → Phase 4 prerequisite).
 *
 * The CLI has historically owned the AgentLoop definition entirely; Phase 3b
 * landed the server-side CRUD + scheduler so future loops live there. This
 * module migrates the historical local rows up to the server idempotently:
 *
 *   - Reads loops from {@link AgentLoopStore}.
 *   - Skips loops already marked `migratedToServerLoopId` (re-run safe).
 *   - Resolves each loop's `projectId` via an injected resolver — the
 *     caller (daemon CLI command) supplies the actual server lookup.
 *   - Maps the local definition into the wire `CreateGenericAgentLoopBody`
 *     shape; long-tail fields land in `genericConfig` so the server
 *     round-trips them via its JSON column.
 *   - POSTs once per loop, records the returned server id back on the
 *     local row, and surfaces a per-loop outcome to the caller.
 *
 * The module owns ONLY the orchestration — `apiClient` / `resolveProjectId`
 * are injected so production wiring (daemon) and unit tests (fakes) share
 * one code path. Dry-run mode short-circuits the POST and the local
 * upsert, so callers can preview the plan without touching the network.
 *
 * Migration is intentionally non-destructive: the local row is kept and
 * gains a marker. Removing the local row (or wiring AgentLoopCoordinator
 * to skip migrated rows so we don't double-run) is a follow-up patch the
 * Phase 4 batches will land.
 */

import type { AgentLoopStore, AgentLoopDefinition } from "./AgentLoopStore";
import type { CreateGenericAgentLoopBody, SerializedAgentLoop } from "@kmmao/happy-wire";

// ── Injected dependencies ──

/** Project resolver — turn a local loop's `directory` into a server projectId. */
export interface MigrateProjectResolver {
    resolveProjectId(opts: {
        directory: string;
        loop: AgentLoopDefinition;
    }): Promise<{ ok: true; projectId: string } | { ok: false; error: string }>;
}

/** Tiny API client shape — only the calls this module actually issues. */
export interface MigrateApiClient {
    createGenericAgentLoop(opts: {
        projectId: string;
        body: CreateGenericAgentLoopBody;
    }): Promise<
        | { ok: true; loop: SerializedAgentLoop }
        | { ok: false; status?: number; error: string }
    >;
}

/** Optional logger; defaults to no-op so callers can stay quiet. */
export interface MigrateLogger {
    info?(message: string, ...args: unknown[]): void;
    warn?(message: string, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
}

// ── Result shapes ──

export type MigrateOutcome =
    | { kind: "migrated"; localId: string; serverId: string }
    | { kind: "skipped"; localId: string; reason: "already-migrated" | "disabled-skipped" }
    | { kind: "would-migrate"; localId: string; projectId: string; body: CreateGenericAgentLoopBody }
    | { kind: "error"; localId: string; error: string };

export interface MigrateSummary {
    total: number;
    migrated: number;
    skipped: number;
    wouldMigrate: number;
    errored: number;
    outcomes: MigrateOutcome[];
}

export interface MigrateLocalAgentLoopsOptions {
    store: AgentLoopStore;
    api: MigrateApiClient;
    resolver: MigrateProjectResolver;
    logger?: MigrateLogger;
    /**
     * When true, no network or store writes happen. Each non-skipped loop
     * lands in `outcomes` as a `would-migrate` entry carrying the resolved
     * projectId + planned create body so the CLI can preview the plan.
     */
    dryRun?: boolean;
    /**
     * When true, disabled local loops are skipped instead of migrated. The
     * default (false) migrates them so the user keeps the row but the
     * server-side row starts in a disabled state too (see body.enabled).
     */
    skipDisabled?: boolean;
}

// ── Mapping ──

/**
 * Long-tail fields the wire schema doesn't promote to typed columns get
 * round-tripped through `genericConfig` (server stores as JSON, hands it
 * back to the daemon on every trigger ephemeral). We deliberately list
 * what we want to preserve here rather than spread everything — runtime
 * book-keeping (iteration, nextRunAt, recentEvents, runtimeState, phase)
 * MUST NOT migrate; the server owns those once the loop is server-side.
 */
const GENERIC_CONFIG_KEYS: ReadonlyArray<keyof AgentLoopDefinition> = [
    "name",
    "environmentVariables",
    "fileWatchEnabled",
    "githubBridgeEnabled",
    "ciBridgeEnabled",
    "eventSourceAllowlist",
    "eventKeywordFilters",
    "goal",
    "currentFocus",
    "workingMemory",
    "lastReflectionSummary",
    "maxConsecutiveFailures",
    "retryBackoffMs",
    "cooldownMs",
    "quietHoursStart",
    "quietHoursEnd",
    "maxAutoRunsPerDay",
    "maxIterations",
    "stopOnSuccess",
    "downstreamLoopIds",
    "downstreamTriggerOn",
    "notifyEvents",
    "notificationChannels",
    "notificationWebhookUrl",
    "maxUsdPerRun",
    "maxUsdPerDay",
    "roleId",
    "roleName",
    "roleType",
];

export function buildCreateBody(
    loop: AgentLoopDefinition,
): CreateGenericAgentLoopBody {
    const genericConfig: Record<string, unknown> = {};
    for (const key of GENERIC_CONFIG_KEYS) {
        const value = loop[key];
        if (value !== undefined) {
            genericConfig[key] = value;
        }
    }

    const body: CreateGenericAgentLoopBody = {
        prompt: loop.prompt,
        directory: loop.directory,
        agent: loop.agent,
        enabled: loop.enabled,
    };

    if (loop.cronExpression) {
        body.cronExpression = loop.cronExpression;
    } else if (loop.intervalMs > 0) {
        body.intervalMs = loop.intervalMs;
    }

    if (loop.continuityKey) body.continuityKey = loop.continuityKey;
    if (loop.profileId) body.profileId = loop.profileId;
    if (Object.keys(genericConfig).length > 0) body.genericConfig = genericConfig;

    return body;
}

// ── Migration orchestration ──

export async function migrateLocalAgentLoops(
    opts: MigrateLocalAgentLoopsOptions,
): Promise<MigrateSummary> {
    const { store, api, resolver, logger, dryRun = false, skipDisabled = false } = opts;

    await store.load();
    const loops = store.getAll();
    const outcomes: MigrateOutcome[] = [];

    let migrated = 0;
    let skipped = 0;
    let wouldMigrate = 0;
    let errored = 0;

    for (const loop of loops) {
        if (loop.migratedToServerLoopId) {
            outcomes.push({
                kind: "skipped",
                localId: loop.id,
                reason: "already-migrated",
            });
            skipped++;
            continue;
        }

        if (skipDisabled && !loop.enabled) {
            outcomes.push({
                kind: "skipped",
                localId: loop.id,
                reason: "disabled-skipped",
            });
            skipped++;
            continue;
        }

        const resolved = await resolver.resolveProjectId({
            directory: loop.directory,
            loop,
        });
        if (!resolved.ok) {
            outcomes.push({
                kind: "error",
                localId: loop.id,
                error: `project resolution failed: ${resolved.error}`,
            });
            errored++;
            logger?.warn?.(
                `[MIGRATE-AGENT-LOOP] Skipping ${loop.id}: project resolution failed (${resolved.error})`,
            );
            continue;
        }

        const body = buildCreateBody(loop);

        if (dryRun) {
            outcomes.push({
                kind: "would-migrate",
                localId: loop.id,
                projectId: resolved.projectId,
                body,
            });
            wouldMigrate++;
            logger?.info?.(
                `[MIGRATE-AGENT-LOOP] dry-run: would migrate ${loop.id} → project ${resolved.projectId}`,
            );
            continue;
        }

        const result = await api.createGenericAgentLoop({
            projectId: resolved.projectId,
            body,
        });
        if (!result.ok) {
            outcomes.push({
                kind: "error",
                localId: loop.id,
                error: `server rejected create: ${result.error}`,
            });
            errored++;
            logger?.warn?.(
                `[MIGRATE-AGENT-LOOP] Failed to migrate ${loop.id}: ${result.error}` +
                    (result.status ? ` (status ${result.status})` : ""),
            );
            continue;
        }

        const updated: AgentLoopDefinition = {
            ...loop,
            migratedToServerLoopId: result.loop.id,
        };
        await store.upsert(updated);

        outcomes.push({
            kind: "migrated",
            localId: loop.id,
            serverId: result.loop.id,
        });
        migrated++;
        logger?.info?.(
            `[MIGRATE-AGENT-LOOP] Migrated ${loop.id} → server loop ${result.loop.id}`,
        );
    }

    return {
        total: loops.length,
        migrated,
        skipped,
        wouldMigrate,
        errored,
        outcomes,
    };
}
