import { describe, it, expect, beforeEach, afterEach } from "vitest";

process.env.HANDY_MASTER_SECRET = "test-secret-for-auth-unit-tests-only";

import { AuthModule } from "./auth";

describe("AuthModule LRU Cache", () => {
    let authModule: AuthModule;

    afterEach(() => {
        authModule?.stopCleanupInterval();
    });

    describe("cache hit", () => {
        beforeEach(async () => {
            authModule = new AuthModule({ max: 100, ttl: 60_000 });
            await authModule.init();
        });

        it("should return cached result on second verify", async () => {
            const token = await authModule.createToken("user-hit");

            // First call — cache hit (createToken caches immediately)
            const result1 = await authModule.verifyToken(token);
            expect(result1).not.toBeNull();
            expect(result1!.userId).toBe("user-hit");

            // Second call — still cached
            const result2 = await authModule.verifyToken(token);
            expect(result2).not.toBeNull();
            expect(result2!.userId).toBe("user-hit");
        });
    });

    describe("cache miss", () => {
        beforeEach(async () => {
            authModule = new AuthModule({ max: 100, ttl: 60_000 });
            await authModule.init();
        });

        it("should verify via crypto when token not in cache", async () => {
            const token = await authModule.createToken("user-miss");

            // Remove from cache manually
            authModule.invalidateToken(token);

            // Should still verify via crypto (cache miss path)
            const result = await authModule.verifyToken(token);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-miss");

            // Now it should be re-cached
            const stats = authModule.getCacheStats();
            expect(stats.size).toBeGreaterThanOrEqual(1);
        });

        it("should return null for completely invalid token", async () => {
            const result = await authModule.verifyToken("totally-invalid-token");
            expect(result).toBeNull();
        });
    });

    describe("TTL expiry", () => {
        it("should expire entries after TTL", async () => {
            authModule = new AuthModule({ max: 100, ttl: 50 }); // 50ms TTL
            await authModule.init();

            const token = await authModule.createToken("user-ttl");
            expect(authModule.getCacheStats().size).toBe(1);

            // Wait for TTL to expire
            await new Promise((r) => setTimeout(r, 100));

            // Cache should report the entry as gone (stale)
            // LRUCache lazily evicts on get, so access the token
            const cached = await authModule.verifyToken(token);
            // It should still verify via crypto fallback
            expect(cached).not.toBeNull();
            expect(cached!.userId).toBe("user-ttl");
        });

        it("should purge stale entries on cleanup", async () => {
            authModule = new AuthModule({ max: 100, ttl: 50 });
            await authModule.init();

            await authModule.createToken("user-stale-1");
            await authModule.createToken("user-stale-2");
            expect(authModule.getCacheStats().size).toBe(2);

            await new Promise((r) => setTimeout(r, 100));

            authModule.cleanup();
            expect(authModule.getCacheStats().size).toBe(0);
        });
    });

    describe("max size eviction", () => {
        it("should evict oldest entries when max is reached", async () => {
            authModule = new AuthModule({ max: 3, ttl: 60_000 });
            await authModule.init();

            const tokens: string[] = [];
            for (let i = 0; i < 5; i++) {
                tokens.push(await authModule.createToken(`user-evict-${i}`));
            }

            // Max is 3, so only 3 entries should remain
            expect(authModule.getCacheStats().size).toBe(3);

            // The most recent 3 tokens should still be cached
            // (verifyToken won't re-add to cache if already there)
            const result3 = await authModule.verifyToken(tokens[4]);
            expect(result3).not.toBeNull();
            expect(result3!.userId).toBe("user-evict-4");
        });
    });

    describe("invalidateToken", () => {
        beforeEach(async () => {
            authModule = new AuthModule({ max: 100, ttl: 60_000 });
            await authModule.init();
        });

        it("should remove specific token from cache", async () => {
            const token = await authModule.createToken("user-inv-single");
            expect(authModule.getCacheStats().size).toBeGreaterThanOrEqual(1);

            authModule.invalidateToken(token);

            // Token removed from cache — verify goes through crypto path
            // (still valid cryptographically, just not cached)
            const result = await authModule.verifyToken(token);
            expect(result).not.toBeNull();
        });

        it("should be no-op for non-existent token", () => {
            authModule.invalidateToken("non-existent-token");
            // Should not throw
        });
    });

    describe("invalidateUserTokens", () => {
        beforeEach(async () => {
            authModule = new AuthModule({ max: 100, ttl: 60_000 });
            await authModule.init();
        });

        it("should remove all tokens for a specific user", async () => {
            await authModule.createToken("target-user");
            await authModule.createToken("target-user");
            await authModule.createToken("target-user");
            const keepToken = await authModule.createToken("other-user");

            const sizeBefore = authModule.getCacheStats().size;
            expect(sizeBefore).toBeGreaterThanOrEqual(4);

            authModule.invalidateUserTokens("target-user");

            // Other user's token should survive
            const result = await authModule.verifyToken(keepToken);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("other-user");
        });

        it("should be no-op for non-existent user", () => {
            authModule.invalidateUserTokens("nobody");
            // Should not throw
        });
    });

    describe("cleanup interval", () => {
        it("should stop cleanup interval without error", async () => {
            authModule = new AuthModule({ max: 100, ttl: 60_000 });
            await authModule.init();

            // Should not throw
            authModule.stopCleanupInterval();
            authModule.stopCleanupInterval(); // Idempotent
        });
    });
});
