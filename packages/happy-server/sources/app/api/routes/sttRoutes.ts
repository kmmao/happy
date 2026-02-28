import { z } from "zod";
import WebSocket from "ws";
import type { IncomingMessage } from "http";
import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { type Fastify } from "../types";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { sttCorrectionPrompt } from "./_prompts";

/**
 * Set up STT WebSocket proxy on the raw HTTP server.
 * Uses native ws module instead of @fastify/websocket to avoid
 * hijacking Socket.IO's upgrade handler for /v1/updates.
 */
export function setupSttWebSocket(server: HttpServer) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (url.pathname !== "/v1/stt/stream") {
        return; // Let Socket.IO handle /v1/updates, ignore others
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleSttConnection(ws, url);
      });
    },
  );
}

async function handleSttConnection(socket: WebSocket, url: URL) {
  const token = url.searchParams.get("token");
  const lang = url.searchParams.get("lang") || undefined;

  if (!token) {
    socket.send(JSON.stringify({ type: "error", message: "Missing token" }));
    socket.close(4001, "Missing token");
    return;
  }

  const verified = await auth.verifyToken(token);
  if (!verified) {
    socket.send(
      JSON.stringify({
        type: "error",
        message: "Invalid token",
      }),
    );
    socket.close(4001, "Invalid token");
    return;
  }

  const userId = verified.userId;
  log(
    { module: "stt" },
    `STT stream connected: user=${userId}, lang=${lang ?? "auto"}`,
  );

  // Connect to upstream RealtimeSTT WebSocket
  const sttWsUrl = process.env.STT_WS_URL || "ws://stt:8001/ws";
  const upstreamUrl = lang
    ? `${sttWsUrl}?lang=${encodeURIComponent(lang)}`
    : sttWsUrl;

  let upstream: WebSocket | null = null;
  try {
    upstream = new WebSocket(upstreamUrl);
  } catch (error) {
    log({ module: "stt" }, `Failed to connect upstream STT: ${error}`);
    socket.send(
      JSON.stringify({
        type: "error",
        message: "STT service unavailable",
      }),
    );
    socket.close(1011, "Upstream unavailable");
    return;
  }

  // Timeout: if upstream doesn't open within 10s, close everything
  const openTimeout = setTimeout(() => {
    if (upstream && upstream.readyState !== WebSocket.OPEN) {
      upstream.terminate();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "STT service timeout",
          }),
        );
        socket.close(1011, "Upstream timeout");
      }
    }
  }, 10_000);

  upstream.on("open", () => {
    clearTimeout(openTimeout);
    socket.send(JSON.stringify({ type: "connected" }));
  });

  upstream.on("message", (data: Buffer | string) => {
    // Forward upstream JSON responses to client
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data.toString());
    }
  });

  upstream.on("error", (error: Error) => {
    log({ module: "stt" }, `Upstream STT error: ${error}`);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: "STT backend error",
        }),
      );
    }
  });

  upstream.on("close", () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "Upstream closed");
    }
  });

  // Forward client audio/control messages to upstream
  socket.on("message", (data: Buffer | string) => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      return;
    }
    // Binary = audio frames, string = control messages
    upstream.send(data);
  });

  socket.on("close", () => {
    log({ module: "stt" }, `STT stream disconnected: user=${userId}`);
    if (upstream) {
      upstream.close();
      upstream = null;
    }
  });

  socket.on("error", (error: Error) => {
    log({ module: "stt" }, `STT stream client error: ${error}`);
    if (upstream) {
      upstream.close();
      upstream = null;
    }
  });
}

export function sttRoutes(app: Fastify) {
  // === HTTP 音频转文字（保留向后兼容）===
  // 调用 docker 内 stt 服务
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
            return reply.code(400).send({ error: "No file uploaded" });
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
            return reply.code(400).send({ error: "Missing audioBase64 field" });
          }

          audio = Buffer.from(body.audioBase64, "base64");
          fileName = body.fileName || "audio.webm";
          fileType = body.mimeType || "application/octet-stream";
          lang = body.lang;
        }

        if (!audio.length) {
          return reply.code(400).send({ error: "Empty audio payload" });
        }

        log(
          { module: "stt" },
          `STT transcribe request from user ${userId}, lang=${lang ?? "auto"}, size=${audio.length}`,
        );

        const form = new FormData();
        form.append("file", new Blob([audio], { type: fileType }), fileName);
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
          return reply.code(502).send({
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

  // === Haiku STT 纠错 ===
  app.post(
    "/v1/stt/correct",
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({
          text: z.string().min(1).max(2000),
          lang: z.string().optional(),
        }),
        response: {
          200: z.object({
            correctedText: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { text, lang } = request.body;
      log(
        { module: "stt" },
        `STT correct request: text="${text}", lang=${lang}`,
      );

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // No API key configured — return original text
        return reply.send({ correctedText: text });
      }

      const prompt = sttCorrectionPrompt(text, lang);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      try {
        const apiBase = (
          process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
        ).replace(/\/$/, "");
        const response = await fetch(`${apiBase}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 200,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          log(
            { module: "stt", level: "error" },
            `Haiku correction API error: ${response.status} ${errBody}`,
          );
          return reply.send({ correctedText: text });
        }

        const data = (await response.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };

        const corrected = data.content?.[0]?.text?.trim();
        log(
          { module: "stt" },
          `STT correct result: input="${text}" → output="${corrected}"`,
        );
        return reply.send({
          correctedText: corrected || text,
        });
      } catch (error) {
        log(
          { module: "stt" },
          `Haiku correction failed (fallback to original): ${error}`,
        );
        return reply.send({ correctedText: text });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}
