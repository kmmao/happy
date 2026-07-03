import * as crypto from "node:crypto";
import * as privacyKit from "privacy-kit";
import { LRUCache } from "lru-cache";
import { log } from "@/utils/log";

interface TokenCacheEntry {
    userId: string;
    uuid?: string;
    extras?: any;
    cachedAt: number;
}

interface TaskResultTokenPayload {
    userId: string;
    taskId: string;
    scope: "task-result";
    expiresAt: number;
    jti?: string;
}

interface SupervisorCallbackTokenPayload {
    userId: string;
    projectId: string;
    machineId: string;
    scope: "supervisor-callback";
    purpose: "run-status" | "fix-status";
    runId?: string;
    actionId?: string;
    expiresAt: number;
    jti?: string;
}

interface AuthTokens {
    generator: Awaited<ReturnType<typeof privacyKit.createPersistentTokenGenerator>>;
    verifier: Awaited<ReturnType<typeof privacyKit.createPersistentTokenVerifier>>;
    githubVerifier: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenVerifier>>;
    githubGenerator: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenGenerator>>;
}

/**
 * Declares how to turn a verified, scope-matched, unexpired token into a typed
 * payload. The security-critical invariants shared by every scoped token —
 * signature/cache verification, `scope` discriminator match, and `expiresAt`
 * presence + expiry — live in `verifyScopedToken` and cannot be forgotten by a
 * spec. `build` only asserts the scope's own required fields and shapes the
 * result; return `null` to reject.
 */
interface ScopedTokenSpec<T> {
    scope: string;
    build: (ctx: {
        userId: string;
        uuid?: string;
        extras: Record<string, unknown>;
        expiresAt: number;
    }) => T | null;
}

const TOKEN_CACHE_MAX = 100_000;
const TOKEN_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

class AuthModule {
    private tokenCache: LRUCache<string, TokenCacheEntry>;
    private tokens: AuthTokens | null = null;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options?: { max?: number; ttl?: number }) {
        this.tokenCache = new LRUCache<string, TokenCacheEntry>({
            max: options?.max ?? TOKEN_CACHE_MAX,
            ttl: options?.ttl ?? TOKEN_CACHE_TTL,
        });
    }

    async init(): Promise<void> {
        if (this.tokens) {
            return;
        }

        log({ module: "auth" }, "Initializing auth module...");

        const generator = await privacyKit.createPersistentTokenGenerator({
            service: "handy",
            seed: process.env.HANDY_MASTER_SECRET!,
        });

        const verifier = await privacyKit.createPersistentTokenVerifier({
            service: "handy",
            publicKey: Uint8Array.from(generator.publicKey),
        });

        const githubGenerator = await privacyKit.createEphemeralTokenGenerator({
            service: "github-happy",
            seed: process.env.HANDY_MASTER_SECRET!,
            ttl: 5 * 60 * 1000,
        });

        const githubVerifier = await privacyKit.createEphemeralTokenVerifier({
            service: "github-happy",
            publicKey: Uint8Array.from(githubGenerator.publicKey),
        });

        this.tokens = { generator, verifier, githubVerifier, githubGenerator };
        this.startCleanupInterval();

        log({ module: "auth" }, "Auth module initialized");
    }

    async createToken(userId: string, extras?: any): Promise<string> {
        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }

        const payload: any = { user: userId };
        if (extras) {
            payload.extras = extras;
        }

        const token = await this.tokens.generator.new(payload);
        this.tokenCache.set(token, {
            userId,
            extras,
            cachedAt: Date.now(),
        });

        return token;
    }

    async verifyToken(token: string): Promise<{ userId: string; uuid?: string; extras?: any } | null> {
        const cached = this.tokenCache.get(token);
        if (cached) {
            return {
                userId: cached.userId,
                uuid: cached.uuid,
                extras: cached.extras,
            };
        }

        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }

        try {
            const verified = await this.tokens.verifier.verify(token);
            if (!verified) {
                return null;
            }

            const userId = verified.user as string;
            const uuid = verified.uuid ?? undefined;
            const extras = verified.extras;

            this.tokenCache.set(token, {
                userId,
                uuid,
                extras,
                cachedAt: Date.now(),
            });

            return { userId, uuid, extras };
        } catch (error) {
            log({ module: "auth", level: "error" }, `Token verification failed: ${error}`);
            return null;
        }
    }

    invalidateUserTokens(userId: string): void {
        const keysToDelete: string[] = [];
        for (const [token, entry] of this.tokenCache.entries()) {
            if (entry && entry.userId === userId) {
                keysToDelete.push(token);
            }
        }
        for (const key of keysToDelete) {
            this.tokenCache.delete(key);
        }

        log({ module: "auth" }, `Invalidated ${keysToDelete.length} tokens for user: ${userId}`);
    }

    invalidateToken(token: string): void {
        this.tokenCache.delete(token);
    }

    getCacheStats(): { size: number; oldestEntry: number | null } {
        if (this.tokenCache.size === 0) {
            return { size: 0, oldestEntry: null };
        }

        let oldest = Date.now();
        for (const entry of this.tokenCache.values()) {
            if (entry && entry.cachedAt < oldest) {
                oldest = entry.cachedAt;
            }
        }

        return {
            size: this.tokenCache.size,
            oldestEntry: oldest,
        };
    }

    async createTaskResultToken(input: {
        userId: string;
        taskId: string;
        expiresInMs?: number;
    }): Promise<string> {
        const expiresAt = Date.now() + (input.expiresInMs ?? 6 * 60 * 60 * 1000);
        return await this.createToken(input.userId, {
            purpose: "task-result",
            taskId: input.taskId,
            scope: "task-result",
            expiresAt,
        });
    }

    /**
     * The single seam every scoped-token verifier crosses. Owns the invariants
     * that must hold for ANY scoped token — verified signature (or cache hit),
     * matching `scope` discriminator, and a numeric `expiresAt` that is not in
     * the past — then delegates the scope's own field validation + shaping to
     * `spec.build`. Adding a new scoped token type means writing a spec, not
     * re-implementing this sequence.
     */
    private async verifyScopedToken<T>(token: string, spec: ScopedTokenSpec<T>): Promise<T | null> {
        const verified = await this.verifyToken(token);
        if (!verified) {
            return null;
        }

        const extras = verified.extras as Record<string, unknown> | undefined;
        if (!extras || extras.scope !== spec.scope) {
            return null;
        }
        if (typeof extras.expiresAt !== "number" || extras.expiresAt < Date.now()) {
            return null;
        }

        return spec.build({
            userId: verified.userId,
            uuid: verified.uuid,
            extras,
            expiresAt: extras.expiresAt,
        });
    }

    async verifyTaskResultToken(token: string): Promise<TaskResultTokenPayload | null> {
        return this.verifyScopedToken(token, {
            scope: "task-result",
            build: ({ userId, uuid, extras, expiresAt }) => {
                if (extras.purpose !== "task-result" || !extras.taskId || typeof extras.taskId !== "string") {
                    return null;
                }
                return {
                    userId,
                    taskId: extras.taskId,
                    scope: "task-result",
                    expiresAt,
                    jti: uuid ?? crypto.randomUUID(),
                };
            },
        });
    }

    async createSupervisorCallbackToken(input: {
        userId: string;
        projectId: string;
        machineId: string;
        purpose: "run-status" | "fix-status";
        runId?: string;
        actionId?: string;
        expiresInMs?: number;
    }): Promise<string> {
        const expiresAt = Date.now() + (input.expiresInMs ?? 6 * 60 * 60 * 1000);
        return await this.createToken(input.userId, {
            purpose: input.purpose,
            projectId: input.projectId,
            machineId: input.machineId,
            runId: input.runId,
            actionId: input.actionId,
            scope: "supervisor-callback",
            expiresAt,
        });
    }

    async verifySupervisorCallbackToken(token: string): Promise<SupervisorCallbackTokenPayload | null> {
        return this.verifyScopedToken(token, {
            scope: "supervisor-callback",
            build: ({ userId, uuid, extras, expiresAt }) => {
                const purpose = extras.purpose;
                if ((purpose !== "run-status" && purpose !== "fix-status") || !extras.projectId || !extras.machineId) {
                    return null;
                }
                if (purpose === "run-status" && !extras.runId) {
                    return null;
                }
                if (purpose === "fix-status" && !extras.actionId) {
                    return null;
                }
                return {
                    userId,
                    projectId: extras.projectId as string,
                    machineId: extras.machineId as string,
                    scope: "supervisor-callback",
                    purpose,
                    runId: extras.runId as string | undefined,
                    actionId: extras.actionId as string | undefined,
                    expiresAt,
                    jti: uuid,
                };
            },
        });
    }

    async createGithubToken(userId: string): Promise<string> {
        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }

        const payload = { user: userId, purpose: "github-oauth" };
        return await this.tokens.githubGenerator.new(payload);
    }

    async verifyGithubToken(token: string): Promise<{ userId: string } | null> {
        if (!this.tokens) {
            throw new Error("Auth module not initialized");
        }

        try {
            const verified = await this.tokens.githubVerifier.verify(token);
            if (!verified) {
                return null;
            }

            return { userId: verified.user as string };
        } catch (error) {
            log({ module: "auth", level: "error" }, `GitHub token verification failed: ${error}`);
            return null;
        }
    }

    cleanup(): void {
        this.tokenCache.purgeStale();
        const stats = this.getCacheStats();
        log({ module: "auth" }, `Token cache cleanup: ${stats.size} entries remaining`);
    }

    private startCleanupInterval(): void {
        if (this.cleanupTimer) {
            return;
        }
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
        this.cleanupTimer.unref();
    }

    stopCleanupInterval(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}

export const auth = new AuthModule();
export { AuthModule, TOKEN_CACHE_MAX, TOKEN_CACHE_TTL };
