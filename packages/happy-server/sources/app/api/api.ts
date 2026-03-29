import fastify from "fastify";
import { log, logger } from "@/utils/log";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import { authRoutes } from "./routes/authRoutes";
import { pushRoutes } from "./routes/pushRoutes";
import { sessionRoutes } from "./routes/sessionRoutes";
import { connectRoutes } from "./routes/connectRoutes";
import { accountRoutes } from "./routes/accountRoutes";
import { startSocket } from "./socket";
import { machinesRoutes } from "./routes/machinesRoutes";
import { devRoutes } from "./routes/devRoutes";
import { versionRoutes } from "./routes/versionRoutes";
import { sttRoutes, setupSttWebSocket } from "./routes/sttRoutes";
import { ttsRoutes } from "./routes/ttsRoutes";
import { artifactsRoutes } from "./routes/artifactsRoutes";
import { accessKeysRoutes } from "./routes/accessKeysRoutes";
import { enableMonitoring } from "./utils/enableMonitoring";
import { enableErrorHandlers } from "./utils/enableErrorHandlers";
import { enableAuthentication } from "./utils/enableAuthentication";
import { userRoutes } from "./routes/userRoutes";
import { feedRoutes } from "./routes/feedRoutes";
import { kvRoutes } from "./routes/kvRoutes";
import { projectRoutes } from "./routes/projectRoutes";
import { supervisorRoutes } from "./routes/supervisorRoutes";
import { supervisorRunRoutes } from "./routes/supervisorRunRoutes";
import { supervisorReportRoutes } from "./routes/supervisorReportRoutes";
import { supervisorActionRoutes } from "./routes/supervisorActionRoutes";
import { supervisorAnalyticsRoutes } from "./routes/supervisorAnalyticsRoutes";
import { supervisorLoopRoutes } from "./routes/supervisorLoopRoutes";
import { v3SessionRoutes } from "./routes/v3SessionRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";
import { provisionRoutes } from "./routes/provisionRoutes";
import { knowledgeRoutes } from "./routes/knowledgeRoutes";
import { knowledgeSearchRoutes } from "./routes/knowledgeSearchRoutes";
import { voiceRoutes } from "./routes/voiceRoutes";
import { isLocalStorage, getLocalFilesDir } from "@/storage/files";
import * as path from "path";
import * as fs from "fs";

export async function startApi() {
  // Configure
  log("Starting API...");

  // Start API
  const app = fastify({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024 * 100, // 100MB
  });
  app.register(import("@fastify/cors"), {
    origin: "*",
    allowedHeaders: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  app.register(import("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max audio file
  });
  // NOTE: Do NOT register @fastify/websocket here.
  // It hijacks ALL WebSocket upgrade events and breaks Socket.IO (/v1/updates).
  // STT WebSocket is handled manually via setupSttWebSocket() below.
  app.get("/", function (request, reply) {
    reply.send("Welcome to Happy Server!");
  });

  // Create typed provider
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

  // Enable features
  enableMonitoring(typed);
  enableErrorHandlers(typed);
  enableAuthentication(typed);

  // Serve local files when using local storage
  if (isLocalStorage()) {
    app.get("/files/*", function (request, reply) {
      const filePath = (request.params as any)["*"];
      const baseDir = path.resolve(getLocalFilesDir());
      const fullPath = path.resolve(baseDir, filePath);
      if (!fullPath.startsWith(baseDir + path.sep)) {
        reply.code(403).send("Forbidden");
        return;
      }
      if (!fs.existsSync(fullPath)) {
        reply.code(404).send("Not found");
        return;
      }
      const stream = fs.createReadStream(fullPath);
      reply.send(stream);
    });
  }

  // Routes
  authRoutes(typed);
  pushRoutes(typed);
  sessionRoutes(typed);
  accountRoutes(typed);
  connectRoutes(typed);
  webhookRoutes(typed); // Must be after connectRoutes (reuses rawBody parser)
  machinesRoutes(typed);
  artifactsRoutes(typed);
  accessKeysRoutes(typed);
  devRoutes(typed);
  versionRoutes(typed);
  sttRoutes(typed);
  ttsRoutes(typed);
  userRoutes(typed);
  feedRoutes(typed);
  kvRoutes(typed);
  projectRoutes(typed);
  supervisorRoutes(typed);
  supervisorRunRoutes(typed);
  supervisorReportRoutes(typed);
  supervisorActionRoutes(typed);
  supervisorAnalyticsRoutes(typed);
  supervisorLoopRoutes(typed);
  v3SessionRoutes(typed);
  provisionRoutes(typed);
  knowledgeRoutes(typed);
  knowledgeSearchRoutes(typed);
  voiceRoutes(typed);

  // Start HTTP
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
  await app.listen({ port, host: "0.0.0.0" });
  onShutdown("api", async () => {
    await app.close();
  });

  // Start Socket
  startSocket(typed);

  // Start STT WebSocket proxy (raw ws, does not conflict with Socket.IO)
  setupSttWebSocket(app.server);

  // End
  log("API ready on port http://localhost:" + port);
}
