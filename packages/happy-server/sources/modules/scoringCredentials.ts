import { db } from "@/storage/db";
import { decryptAiBackendProfile } from "@/modules/aiBackendProfileCrypto";
import { detectProviderFromEnv, type ScoringCredentials } from "@/modules/optionScorer";
import type { AIBackendProfile } from "@/types/aiBackendProfile";

/**
 * The two zero-variance pieces every LLM-scoring route used to inline.
 *
 * Four routes (options/score, options/generate, agent-loops/suggest,
 * supervisor dimension) each carried a byte-for-byte copy of the
 * "load the account's stored profile row → decrypt it" lookup and the
 * "build credentials from the server's own env vars" fallback. A field that
 * drifts in the SQL filter (e.g. the `archivedAt IS NULL` guard) or a new
 * provider env var added to only some copies would silently diverge. These
 * are the invariant, policy-free pieces single-sourced here.
 *
 * What stays caller-owned (per ADR-0036): the no-row policy and whether a
 * profile that resolves to no provider falls back to the server env. Those
 * differ per route and remain inline at each call site.
 */

/**
 * Load and decrypt an account's stored AiBackendProfile by id. Returns null
 * when no live (non-archived) row exists for (accountId, profileId).
 */
export async function loadDecryptedProfile(
    accountId: string,
    profileId: string,
): Promise<AIBackendProfile | null> {
    const rows = await db.$queryRaw<Array<{
        profileKey: string;
        encryptedPayload: Uint8Array<ArrayBuffer>;
    }>>`
        SELECT "profileKey", "encryptedPayload"
        FROM "AiBackendProfile"
        WHERE "profileKey" = ${profileId}
          AND "accountId" = ${accountId}
          AND "archivedAt" IS NULL
        LIMIT 1
    `;
    if (!rows[0]) return null;
    return decryptAiBackendProfile(accountId, rows[0].profileKey, rows[0].encryptedPayload);
}

/**
 * Scoring credentials derived from the server's own environment variables —
 * the shared fallback when no account profile is bound (or yields no provider,
 * per the call site's policy). Returns null when the server env names no
 * provider either.
 */
export function serverEnvScoringCredentials(): ScoringCredentials | null {
    return detectProviderFromEnv({
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "",
        OLLAMA_URL: process.env.OLLAMA_URL ?? "",
    });
}
