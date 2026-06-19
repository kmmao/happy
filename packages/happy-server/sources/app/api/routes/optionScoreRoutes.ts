import { z } from "zod";
import { Fastify } from "../types";
import { log } from "@/utils/log";
import { scoreOptionsWithLLM, detectProviderFromEnv } from "@/modules/optionScorer";
import { getAiBackendProfileEnvironmentVariables } from "@/modules/aiBackendProfileEnv";
import { loadDecryptedProfile, serverEnvScoringCredentials } from "@/modules/scoringCredentials";

export function optionScoreRoutes(app: Fastify) {
    app.post("/v1/options/score", {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                options: z.array(z.string().max(2000)).min(1).max(10),
                contextSummary: z.string().max(2000),
                sessionTitle: z.string().max(200).nullable(),
                profileId: z.string().max(200).nullable(),
                modelOverride: z.string().max(500).nullable(),
            }),
            response: {
                200: z.object({
                    scores: z.array(z.number()),
                    cached: z.boolean(),
                    modelUsed: z.string(),
                    provider: z.string(),
                }),
                500: z.object({
                    error: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const { options, contextSummary, sessionTitle, profileId, modelOverride } = request.body;
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
                    if (override) {
                        credentials.model = override;
                    }
                } catch { /* ignore malformed override */ }
            }

            const result = await scoreOptionsWithLLM(credentials, options, contextSummary, sessionTitle);
            return reply.send(result);
        } catch (error) {
            log({ module: "api", level: "warn" }, `Option scoring failed: ${error}`);
            return reply.code(500).send({ error: "Option scoring unavailable" });
        }
    });
}

async function resolveCredentials(accountId: string, profileId: string | null) {
    if (!profileId) return serverEnvScoringCredentials();

    const profile = await loadDecryptedProfile(accountId, profileId);
    if (!profile) return serverEnvScoringCredentials();

    const env = getAiBackendProfileEnvironmentVariables(profile);
    // Scoring tolerates a profile with no usable provider — fall back to the
    // server env so scoring still works (caller-owned policy, ADR-0036).
    return detectProviderFromEnv(env) ?? serverEnvScoringCredentials();
}
