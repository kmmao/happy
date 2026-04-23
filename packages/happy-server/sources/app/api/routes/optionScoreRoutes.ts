import { z } from "zod";
import { Fastify } from "../types";
import { log } from "@/utils/log";
import { scoreOptionsWithLLM } from "@/modules/optionScorer";

export function optionScoreRoutes(app: Fastify) {
    app.post("/v1/options/score", {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                options: z.array(z.string().max(200)).min(1).max(10),
                contextSummary: z.string().max(2000),
                sessionTitle: z.string().max(200).nullable(),
            }),
            response: {
                200: z.object({
                    scores: z.array(z.number()),
                    cached: z.boolean(),
                }),
                500: z.object({
                    error: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const { options, contextSummary, sessionTitle } = request.body;

        try {
            const result = await scoreOptionsWithLLM(options, contextSummary, sessionTitle);
            return reply.send(result);
        } catch (error) {
            log({ module: "api", level: "warn" }, `Option scoring failed: ${error}`);
            return reply.code(500).send({ error: "Option scoring unavailable" });
        }
    });
}
