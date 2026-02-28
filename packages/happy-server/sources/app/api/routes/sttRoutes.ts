import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

export function sttRoutes(app: Fastify) {
    // 音频转文字（调用 docker 内 stt 服务）
    // Supports both multipart/form-data (preferred) and legacy JSON base64
    app.post(
        "/v1/stt/transcribe",
        {
            preHandler: app.authenticate,
            schema: {
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
            const sttBaseUrl = process.env.STT_BASE_URL || "http://stt:8000";
            const contentType = request.headers["content-type"] ?? "";

            let audio: Buffer;
            let fileName: string;
            let fileType: string;
            let lang: string | undefined;

            try {
                if (contentType.includes("multipart/form-data")) {
                    // New path: multipart/form-data — direct file upload
                    const data = await request.file();
                    if (!data) {
                        return reply
                            .code(400)
                            .send({ error: "No file uploaded" });
                    }

                    audio = await data.toBuffer();
                    fileName = data.filename || "audio.webm";
                    fileType = data.mimetype || "application/octet-stream";

                    // Extract lang from multipart fields
                    const fields = data.fields;
                    const langField = fields?.lang;
                    if (
                        langField &&
                        "value" in langField &&
                        typeof langField.value === "string"
                    ) {
                        lang = langField.value;
                    }
                } else {
                    // Legacy path: JSON body with base64 audio
                    const body = request.body as {
                        audioBase64?: string;
                        fileName?: string;
                        mimeType?: string;
                        lang?: string;
                    };

                    if (!body?.audioBase64) {
                        return reply
                            .code(400)
                            .send({ error: "Missing audioBase64 field" });
                    }

                    audio = Buffer.from(body.audioBase64, "base64");
                    fileName = body.fileName || "audio.webm";
                    fileType = body.mimeType || "application/octet-stream";
                    lang = body.lang;
                }

                if (!audio.length) {
                    return reply
                        .code(400)
                        .send({ error: "Empty audio payload" });
                }

                log(
                    { module: "stt" },
                    `STT transcribe request from user ${userId}, lang=${lang ?? "auto"}, size=${audio.length}`,
                );

                const form = new FormData();
                form.append(
                    "file",
                    new Blob([audio], { type: fileType }),
                    fileName,
                );
                if (lang) {
                    form.append("language", lang);
                }

                const sttResp = await fetch(`${sttBaseUrl}/transcribe`, {
                    method: "POST",
                    body: form,
                });

                if (!sttResp.ok) {
                    const errText = await sttResp.text();
                    log(
                        { module: "stt" },
                        `STT backend error: ${sttResp.status} ${errText}`,
                    );
                    return reply
                        .code(502)
                        .send({
                            error: `STT backend error: ${sttResp.status}`,
                        });
                }

                const sttData = (await sttResp.json()) as any;
                const text = (sttData?.text || "").toString().trim();

                return reply.send({
                    text,
                    language: sttData?.language ?? lang ?? "auto",
                });
            } catch (error) {
                log({ module: "stt" }, `STT transcribe error: ${error}`);
                return reply.code(400).send({
                    error:
                        error instanceof Error
                            ? error.message
                            : "Failed to transcribe audio",
                });
            }
        },
    );
}
