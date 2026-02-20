import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";

async function polishText(text: string, lang?: string) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY not configured on the server");
  }

  const systemPrompt = lang?.startsWith("zh")
    ? `你是一个语音识别后处理助手。用户通过语音输入的文字可能有以下问题：
- 缺少标点符号
- 中英文混合时英文单词拼写或分词错误
- 语音识别产生的错别字或谐音字
- 缺少必要的换行或分段

请修正以上问题，输出润色后的文本。要求：
1. 保持原意不变，不要添加、删除或改写任何内容的含义
2. 添加适当的标点符号（逗号、句号、问号等）
3. 修正明显的语音识别错误（错别字、谐音字）
4. 中英文混合时，英文使用正确的大小写和拼写
5. 只输出润色后的文本，不要解释、不要前缀`
    : `You are a speech-to-text post-processing assistant. The user's voice input may have:
- Missing punctuation
- Misspelled words from speech recognition errors
- Mixed language segments with incorrect word boundaries
- Missing necessary line breaks

Fix these issues and output the polished text. Requirements:
1. Preserve the original meaning — do not add, remove, or rewrite content
2. Add appropriate punctuation (commas, periods, question marks, etc.)
3. Fix obvious speech recognition errors (homophones, misspellings)
4. For mixed-language text, use correct casing and spelling
5. Output ONLY the polished text — no explanations, no prefixes`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as any;
  const polished = data.choices?.[0]?.message?.content?.trim();
  if (!polished) {
    throw new Error("Empty response from OpenAI");
  }

  return polished;
}

export function sttRoutes(app: Fastify) {
  // 文本后处理（保留原接口）
  app.post(
    "/v1/stt/polish",
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({
          text: z.string().min(1).max(5000),
          lang: z.string().optional(),
        }),
        response: {
          200: z.object({
            text: z.string(),
          }),
          400: z.object({
            error: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { text, lang } = request.body;

      log(
        { module: "stt" },
        `STT polish request from user ${userId}, lang=${lang ?? "auto"}, length=${text.length}`,
      );

      try {
        const polished = await polishText(text, lang);
        log({ module: "stt" }, `STT polished for user ${userId}: ${text.length} -> ${polished.length} chars`);
        return reply.send({ text: polished });
      } catch (error) {
        log({ module: "stt" }, `STT polish error: ${error}`);
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to polish text" });
      }
    },
  );

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
          polish: z.boolean().optional(),
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
      const { audioBase64, fileName, mimeType, lang, polish } = request.body;
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
        const rawText = (sttData?.text || "").toString();
        if (!rawText.trim()) {
          return reply.code(400).send({ error: "Empty transcript" });
        }

        const finalText = polish === false ? rawText.trim() : await polishText(rawText, lang);
        return reply.send({ text: finalText, language: lang || "auto" });
      } catch (error) {
        log({ module: "stt" }, `STT transcribe error: ${error}`);
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Failed to transcribe audio" });
      }
    },
  );
}
