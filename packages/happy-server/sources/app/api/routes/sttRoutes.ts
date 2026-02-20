import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

export function sttRoutes(app: Fastify) {
  // 音频转文字（调用 docker 内 stt 服务）
  app.post(
    "/v1/stt/transcribe",
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({
          audioBase64: z.string().min(1),
          fileName: z.string().optional(),
          mimeType: z.string().optional(),
          lang: z.string().optional(),
        }),
        response: {
          200: z.object({
            text: z.string(),
            language: z.string().optional(),
          }),
          400: z.object({ error: z.string() }),
          502: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { audioBase64, fileName, mimeType, lang } = request.body;
      const sttBaseUrl = process.env.STT_BASE_URL || "http://stt:8000";

      log({ module: "stt" }, `STT transcribe request from user ${userId}, lang=${lang ?? "auto"}`);

      try {
        const audio = Buffer.from(audioBase64, "base64");
        if (!audio.length) {
          return reply.code(400).send({ error: "Empty audio payload" });
        }

        const form = new FormData();
        const name = fileName || "audio.webm";
        const type = mimeType || "application/octet-stream";
        form.append("file", new Blob([audio], { type }), name);
        if (lang) {
          form.append("language", lang);
        }

        const sttResp = await fetch(`${sttBaseUrl}/transcribe`, {
          method: "POST",
          body: form,
        });

        if (!sttResp.ok) {
          const errText = await sttResp.text();
          log({ module: "stt" }, `STT backend error: ${sttResp.status} ${errText}`);
          return reply.code(502).send({ error: `STT backend error: ${sttResp.status}` });
        }

        const sttData = (await sttResp.json()) as any;
        const text = (sttData?.text || "").toString().trim();
        if (!text) {
          return reply.code(400).send({ error: "Empty transcript" });
        }

        return reply.send({ text, language: sttData?.language ?? lang ?? "auto" });
      } catch (error) {
        log({ module: "stt" }, `STT transcribe error: ${error}`);
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to transcribe audio" });
      }
    },
  );
}
