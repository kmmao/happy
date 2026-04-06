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
import { artifactsRoutes } from "./routes/artifactsRoutes";
import { accessKeysRoutes } from "./routes/accessKeysRoutes";
import { enableMonitoring } from "./utils/enableMonitoring";
import { enableErrorHandlers } from "./utils/enableErrorHandlers";
import { enableAuthentication } from "./utils/enableAuthentication";
import { enableRateLimit } from "./utils/enableRateLimit";
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
import { knowledgeConfigRoutes } from "./routes/knowledgeConfigRoutes";
import { knowledgeLifecycleRoutes } from "./routes/knowledgeLifecycleRoutes";
import { voiceRoutes } from "./routes/voiceRoutes";
import { sub2apiRoutes } from "./routes/sub2apiRoutes";
import { taskRoutes } from "./routes/taskRoutes";
import { skillRoutes } from "./routes/skillRoutes";
import { triggerScheduleRoutes } from "./routes/triggerScheduleRoutes";
import { webhookTriggerRoutes } from "./routes/webhookTriggerRoutes";
import { inboxRoutes } from "./routes/inboxRoutes";
import { agentRoleRoutes } from "./routes/agentRoleRoutes";
import { decisionRoutes } from "./routes/decisionRoutes";
import { goalRoutes } from "./routes/goalRoutes";
import { worldDashboardRoutes } from "./routes/worldDashboardRoutes";
import { agentMessageRoutes } from "./routes/agentMessageRoutes";
import { sessionEventRoutes } from "./routes/sessionEventRoutes";
import { isLocalStorage, getLocalFilesDir } from "@/storage/files";
import { startKnowledgeLifecycleScheduler, stopKnowledgeLifecycleScheduler } from "@/modules/knowledgeLifecycleScheduler";
import { startTaskStaleReaper, stopTaskStaleReaper } from "@/modules/taskStaleReaper";
import * as path from "path";
import * as fs from "fs";

export async function startApi() {
  // Configure
  log("Starting API...");

  // Production safety: block dangerous debug logging flag
  if (process.env.NODE_ENV === "production" && process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    throw new Error("DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING must not be enabled in production");
  }

  // Start API
  const app = fastify({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024, // 1MB default
  });
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:8081"];
  app.register(import("@fastify/cors"), {
    origin: allowedOrigins,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  app.register(import("@fastify/helmet"), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
    },
    frameguard: { action: "deny" },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  app.register(import("@fastify/multipart"), {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max audio file
  });
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
  await enableRateLimit(typed);

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
  knowledgeConfigRoutes(typed);
  knowledgeLifecycleRoutes(typed);
  voiceRoutes(typed);
  sub2apiRoutes(typed);
  taskRoutes(typed);
  skillRoutes(typed);
  triggerScheduleRoutes(typed);
  webhookTriggerRoutes(typed);
  inboxRoutes(typed);
  sessionEventRoutes(typed);
  agentRoleRoutes(typed);
  decisionRoutes(typed);
  goalRoutes(typed);
  worldDashboardRoutes(typed);
  agentMessageRoutes(typed);

  // Start HTTP
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
  await app.listen({ port, host: "0.0.0.0" });
  onShutdown("api", async () => {
    await app.close();
  });

  // Start Socket
  startSocket(typed);

  // Start knowledge lifecycle scheduler (decay/merge jobs)
  startKnowledgeLifecycleScheduler();
  onShutdown("knowledge-lifecycle", async () => {
    stopKnowledgeLifecycleScheduler();
  });

  // Start stale task reaper (server-side timeout safety net)
  startTaskStaleReaper();
  onShutdown("task-reaper", async () => {
    stopTaskStaleReaper();
  });

  // End
  log("API ready on port http://localhost:" + port);
}
