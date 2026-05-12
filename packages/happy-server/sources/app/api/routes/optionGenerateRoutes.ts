import { z } from "zod";
import { Fastify } from "../types";
import { log } from "@/utils/log";
import { generateOptionsWithLLM } from "@/modules/optionGenerator";
import { detectProviderFromEnv } from "@/modules/optionScorer";
import { db } from "@/storage/db";
import { decryptAiBackendProfile } from "@/modules/aiBackendProfileCrypto";
import { getAiBackendProfileEnvironmentVariables } from "@/modules/aiBackendProfileEnv";

export function optionGenerateRoutes(app: Fastify) {
    app.post("/v1/options/generate", {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                contextSummary: z.string().max(2000),
                sessionTitle: z.string().max(200).nullable(),
                profileId: z.string().max(200).nullable(),
                modelOverride: z.string().max(500).nullable(),
            }),
            response: {
                200: z.object({
                    options: z.array(z.string()),
                    modelUsed: z.string(),
                    provider: z.string(),
                }),
                500: z.object({
                    error: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const { contextSummary, sessionTitle, profileId, modelOverride } = request.body;
        const accountId = request.userId;

        try {
            const credentials = await resolveCredentials(accountId, profileId);
            if (!credentials) {
                return reply.code(500).send({ error: "No LLM provider available for this profile" });
            }

            if (modelOverride) {
                try {
                    const overrides = JSON.parse(modelOverride) as Record<string, string>;
                    const override = overrides[credentials.provider];
                    if (override) credentials.model = override;
                } catch { /* ignore malformed override */ }
            }

            const result = await generateOptionsWithLLM(credentials, contextSummary, sessionTitle);
            return reply.send(result);
        } catch (error) {
            log({ module: "api", level: "warn" }, `Option generation failed: ${error}`);
            return reply.code(500).send({ error: "Option generation unavailable" });
        }
    });
}

async function resolveCredentials(accountId: string, profileId: string | null) {
    if (!profileId) return fallbackFromServerEnv();

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

    if (!rows[0]) return fallbackFromServerEnv();

    const profile = decryptAiBackendProfile(accountId, rows[0].profileKey, rows[0].encryptedPayload);
    const env = getAiBackendProfileEnvironmentVariables(profile);
    return detectProviderFromEnv(env) ?? fallbackFromServerEnv();
}

function fallbackFromServerEnv() {
    return detectProviderFromEnv({
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "",
        OLLAMA_URL: process.env.OLLAMA_URL ?? "",
    });
}
