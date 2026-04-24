/**
 * HappyObserverSessionStore — prototype SessionStore (@alpha) adapter.
 *
 * Scope
 *   Observability-only. Wraps the SDK's bundled `InMemorySessionStore` and
 *   emits a `logger.debug` line per method call so we can study the real
 *   call cadence / batch size / entry-type distribution before committing
 *   to a production-grade (server-backed) implementation.
 *
 *   The SDK dual-writes — subprocess still persists to CLAUDE_CONFIG_DIR
 *   locally AND emits entries here. So enabling this adapter is side-effect
 *   free: no data loss if we crash, no behavior change for existing session
 *   scanners / JSONL consumers.
 *
 * Activation
 *   Gated entirely by the env var `HAPPY_USE_SESSION_STORE`. When unset (the
 *   production default) `createSessionStoreAdapter` returns `undefined` and
 *   no adapter is attached to the SDK query. Opt-in via:
 *
 *       HAPPY_USE_SESSION_STORE=1 happy
 *
 *   Once we've gathered enough observational data, replace
 *   `InMemorySessionStore` with a real backend (e.g. the Happy server's
 *   session-message store) — the adapter shape stays the same.
 *
 * @alpha
 */

import {
    InMemorySessionStore,
    type SessionKey,
    type SessionStore,
    type SessionStoreEntry,
    type SessionSummaryEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { logger } from "@/ui/logger";

const ENV_FLAG = "HAPPY_USE_SESSION_STORE";

function formatKey(key: SessionKey): string {
    const base = `project=${key.projectKey} session=${key.sessionId}`;
    return key.subpath ? `${base} subpath=${key.subpath}` : `${base} (main)`;
}

function summarizeTypes(entries: SessionStoreEntry[]): string {
    if (entries.length === 0) return "(empty)";
    const counts = new Map<string, number>();
    for (const e of entries) {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([t, n]) => `${t}:${n}`)
        .join(",");
}

/**
 * Prototype adapter. Delegates to an in-memory backing store; wraps each
 * method with structured debug logging for call-pattern analysis.
 */
class HappyObserverSessionStore implements SessionStore {
    private readonly inner = new InMemorySessionStore();

    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
        const t0 = Date.now();
        await this.inner.append(key, entries);
        logger.debug(
            `[sessionStore] append ${formatKey(key)} batch=${entries.length} types={${summarizeTypes(entries)}} elapsed=${Date.now() - t0}ms`,
        );
    }

    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
        const t0 = Date.now();
        const result = await this.inner.load(key);
        logger.debug(
            `[sessionStore] load ${formatKey(key)} found=${result?.length ?? "null"} elapsed=${Date.now() - t0}ms`,
        );
        return result;
    }

    async listSessions(
        projectKey: string,
    ): Promise<Array<{ sessionId: string; mtime: number }>> {
        const t0 = Date.now();
        const sessions = await this.inner.listSessions(projectKey);
        logger.debug(
            `[sessionStore] listSessions project=${projectKey} count=${sessions.length} elapsed=${Date.now() - t0}ms`,
        );
        return sessions;
    }

    async listSessionSummaries(
        projectKey: string,
    ): Promise<SessionSummaryEntry[]> {
        const t0 = Date.now();
        const summaries = await this.inner.listSessionSummaries(projectKey);
        logger.debug(
            `[sessionStore] listSessionSummaries project=${projectKey} count=${summaries.length} elapsed=${Date.now() - t0}ms`,
        );
        return summaries;
    }

    async delete(key: SessionKey): Promise<void> {
        const t0 = Date.now();
        await this.inner.delete(key);
        logger.debug(
            `[sessionStore] delete ${formatKey(key)} elapsed=${Date.now() - t0}ms`,
        );
    }

    async listSubkeys(key: {
        projectKey: string;
        sessionId: string;
    }): Promise<string[]> {
        const t0 = Date.now();
        const subkeys = await this.inner.listSubkeys(key);
        logger.debug(
            `[sessionStore] listSubkeys project=${key.projectKey} session=${key.sessionId} subkeys=${subkeys.length} elapsed=${Date.now() - t0}ms`,
        );
        return subkeys;
    }
}

/**
 * Factory used by claudeRemote.ts. Returns a singleton adapter when the
 * env flag is set, otherwise `undefined` (no adapter → SDK default
 * behavior — local JSONL only).
 *
 * The returned instance is intentionally process-scoped: all queries in
 * the same CLI process share one in-memory backing store so subagent
 * transcripts and main transcripts co-exist across turns.
 */
let singleton: HappyObserverSessionStore | null = null;

export function createSessionStoreAdapter(): SessionStore | undefined {
    if (process.env[ENV_FLAG] !== "1") return undefined;
    if (!singleton) {
        singleton = new HappyObserverSessionStore();
        logger.debug(
            `[sessionStore] HappyObserverSessionStore enabled via ${ENV_FLAG}=1`,
        );
    }
    return singleton;
}
