import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

export function ttsRoutes(app: Fastify) {
  app.post(
    "/v1/tts/synthesize",
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({
          text: z.string().min(1).max(5000),
          voice: z
            .string()
            .regex(/^[a-zA-Z]{2,3}-[A-Z]{2}-[\w]+Neural$/)
            .optional(),
          rate: z
            .string()
            .regex(/^[+-]\d{1,3}%$/)
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { text, voice, rate } = request.body;
      const ttsBaseUrl = process.env.TTS_BASE_URL || "http://tts:8000";

      log(
        { module: "tts" },
        `TTS synthesize request from user ${userId}, voice=${voice ?? "default"}, text length=${text.length}`,
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      try {
        const ttsResp = await fetch(`${ttsBaseUrl}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, rate }),
          signal: controller.signal,
        });

        if (!ttsResp.ok) {
          const errText = await ttsResp.text();
          log(
            { module: "tts" },
            `TTS backend error: ${ttsResp.status} ${errText}`,
          );
          return reply
            .code(502)
            .send({ error: `TTS backend error: ${ttsResp.status}` });
        }

        const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
        return reply
          .header("Content-Type", "audio/mpeg")
          .header("Content-Disposition", "inline; filename=speech.mp3")
          .send(audioBuffer);
      } catch (error) {
        log({ module: "tts" }, `TTS synthesize error: ${error}`);
        return reply.code(502).send({
          error:
            error instanceof Error
              ? error.message
              : "Failed to synthesize audio",
        });
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
