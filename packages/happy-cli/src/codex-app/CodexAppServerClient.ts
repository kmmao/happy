import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { logger } from "@/ui/logger";
import type { CodexSessionConfig, CodexToolResponse } from "@/codex/types";
import type { CodexPermissionHandler } from "@/codex/utils/permissionHandler";
import type { SandboxConfig } from "@/persistence";
import { initializeSandbox, wrapForMcpTransport } from "@/sandbox/manager";

type JsonRpcRequest = {
  id?: string | number;
  method: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string } | unknown;
};

type AppServerQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

type AppServerElicitationRequest = {
  serverName: string;
  message: string;
  mode: "form" | "url";
  url?: string | null;
  requestedSchema?: Record<string, unknown> | null;
};

type AppServerElicitationResult = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};

type AppServerDynamicToolCallRequest = {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
};

type AppServerDynamicToolCallResult = {
  contentItems: Array<
    { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
  >;
  success: boolean;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type DynamicToolMetadata = {
  toolName: string;
  arguments: Record<string, unknown>;
};

type TurnWaiter = {
  turnId: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

type AppServerModel = {
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: Array<{ value: string; label: string }>;
  isDefault: boolean;
  supportsPersonality: boolean;
};

type AppServerCapabilities = {
  models: AppServerModel[];
  config: {
    model: string | null;
    profile: string | null;
    approvalPolicy: string | null;
    sandboxMode: string | null;
    serviceTier: string | null;
    reasoningEffort: string | null;
    reasoningSummary: string | null;
    verbosity: string | null;
    webSearch: string | null;
  } | null;
  account: {
    type: "apiKey" | "chatgpt" | null;
    email: string | null;
    planType: string | null;
    requiresOpenaiAuth: boolean;
  } | null;
  rateLimits: {
    limitId: string | null;
    limitName: string | null;
    planType: string | null;
    hasCredits: boolean;
  } | null;
  experimentalFeatures: Array<{
    name: string;
    stage: string;
    enabled: boolean;
    defaultEnabled: boolean;
  }>;
  skills: Array<{
    name: string;
    description: string;
    path: string;
    enabled: boolean;
  }>;
  mcpServers: Array<{
    name: string;
    authStatus: string;
    toolCount: number;
  }>;
};

type RawSupportedReasoningEffort =
  | { value?: string; label?: string }
  | { reasoningEffort?: string; description?: string };

function normalizeSupportedReasoningEfforts(
  efforts: RawSupportedReasoningEffort[] | null | undefined,
): Array<{ value: string; label: string }> {
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return [];
  }

  return efforts
    .map((effort) => {
      const value =
        ("value" in effort && typeof effort.value === "string"
          ? effort.value
          : null) ??
        ("reasoningEffort" in effort &&
        typeof effort.reasoningEffort === "string"
          ? effort.reasoningEffort
          : null);

      if (!value) {
        return null;
      }

      const label =
        ("label" in effort && typeof effort.label === "string"
          ? effort.label
          : null) ??
        ("description" in effort && typeof effort.description === "string"
          ? effort.description
          : null) ??
        value;

      return { value, label };
    })
    .filter((effort): effort is { value: string; label: string } => effort !== null);
}

function createAbortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function parseError(payload: unknown, fallbackMessage: string): Error {
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return new Error((payload as { message: string }).message);
  }
  return new Error(fallbackMessage);
}

function formatPlanLine(step: {
  title?: string | null;
  step?: string | null;
  status?: string | null;
}): string {
  const text =
    (typeof step.title === "string" && step.title.trim().length > 0
      ? step.title.trim()
      : null) ??
    (typeof step.step === "string" && step.step.trim().length > 0
      ? step.step.trim()
      : null) ??
    "Untitled step";

  const status =
    typeof step.status === "string" && step.status.length > 0
      ? `[${step.status}] `
      : "";

  return `${status}${text}`;
}

function stringifyUnknownValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return null;
  }

  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && json.length > 0 ? json : null;
  } catch {
    return null;
  }
}

function extractDynamicToolCallText(
  contentItems: unknown,
  fallback?: string,
): string | null {
  if (!Array.isArray(contentItems)) {
    return fallback ?? null;
  }

  const parts = contentItems
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      if (
        (item as { type?: unknown }).type === "inputText" &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        const text = (item as { text: string }).text.trim();
        return text.length > 0 ? text : null;
      }
      if (
        (item as { type?: unknown }).type === "inputImage" &&
        typeof (item as { imageUrl?: unknown }).imageUrl === "string"
      ) {
        const imageUrl = (item as { imageUrl: string }).imageUrl.trim();
        return imageUrl.length > 0 ? `[image] ${imageUrl}` : null;
      }
      return stringifyUnknownValue(item);
    })
    .filter((part): part is string => typeof part === "string" && part.length > 0);

  if (parts.length > 0) {
    return parts.join("\n");
  }

  return fallback ?? null;
}

function extractMcpToolCallText(
  result: unknown,
  error: unknown,
  fallback?: string,
): string | null {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const message = (error as { message: string }).message.trim();
    if (message.length > 0) {
      return message;
    }
  }

  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const parts = (result as { content: unknown[] }).content
      .map((item) => {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { type?: unknown }).type === "string" &&
          (item as { type: string }).type === "text" &&
          typeof (item as { text?: unknown }).text === "string"
        ) {
          const text = (item as { text: string }).text.trim();
          return text.length > 0 ? text : null;
        }
        return stringifyUnknownValue(item);
      })
      .filter((part): part is string => typeof part === "string" && part.length > 0);

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return fallback ?? null;
}

function formatMcpToolName(server: unknown, tool: unknown): string {
  const serverName =
    typeof server === "string" && server.trim().length > 0
      ? server.trim()
      : "unknown";
  const toolName =
    typeof tool === "string" && tool.trim().length > 0 ? tool.trim() : "unknown";
  return `mcp__${serverName}__${toolName}`;
}

function extractMcpToolNameFromApprovalRequest(
  params: Record<string, unknown>,
): string | null {
  const meta =
    params._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : null;
  const approvalKind =
    typeof meta?.codex_approval_kind === "string"
      ? meta.codex_approval_kind
      : null;
  if (approvalKind !== "mcp_tool_call") {
    return null;
  }

  const serverName =
    typeof params.serverName === "string" && params.serverName.trim().length > 0
      ? params.serverName.trim()
      : null;
  if (!serverName) {
    return null;
  }

  const toolNameFromMeta =
    typeof meta?.tool_name === "string" && meta.tool_name.trim().length > 0
      ? meta.tool_name.trim()
      : null;
  if (toolNameFromMeta) {
    return formatMcpToolName(serverName, toolNameFromMeta);
  }

  const message =
    typeof params.message === "string" ? params.message.trim() : "";
  const match = message.match(/run tool "([^"]+)"/i);
  if (match?.[1]) {
    return formatMcpToolName(serverName, match[1]);
  }

  return null;
}

function mapElicitationDecision(
  decision: "approved" | "approved_for_session" | "denied" | "abort",
): "accept" | "decline" | "cancel" {
  switch (decision) {
    case "approved":
    case "approved_for_session":
      return "accept";
    case "denied":
      return "decline";
    case "abort":
    default:
      return "cancel";
  }
}

function buildSandboxPolicy(
  sandbox: CodexSessionConfig["sandbox"] | undefined,
  cwd: string,
): Record<string, unknown> | undefined {
  switch (sandbox) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "read-only":
      return {
        type: "readOnly",
        access: { type: "fullAccess" },
        networkAccess: true,
      };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [cwd],
        readOnlyAccess: { type: "fullAccess" },
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    default:
      return undefined;
  }
}

function buildElicitationSchema(
  questions: AppServerQuestion[],
): Record<string, unknown> {
  const properties = Object.fromEntries(
    questions.map((question) => [
      question.id,
      {
        type: "string",
        title: question.header,
        description: question.question,
        ...(question.options
          ? {
              oneOf: question.options.map((option) => ({
                const: option.label,
                title: option.label,
                description: option.description,
              })),
            }
          : {}),
        "x-happy-other": question.isOther,
        "x-happy-secret": question.isSecret,
      },
    ]),
  );

  return {
    type: "object",
    required: questions.map((question) => question.id),
    properties,
  };
}

function mapPermissionDecision(
  decision: "approved" | "approved_for_session" | "denied" | "abort",
): "accept" | "acceptForSession" | "decline" | "cancel" {
  switch (decision) {
    case "approved":
      return "accept";
    case "approved_for_session":
      return "acceptForSession";
    case "denied":
      return "decline";
    case "abort":
    default:
      return "cancel";
  }
}

function mapLegacyReviewDecision(
  decision: "approved" | "approved_for_session" | "denied" | "abort",
): "approved" | "approved_for_session" | "denied" | "abort" {
  return decision;
}

function buildGrantedPermissions(
  permissions: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!permissions || typeof permissions !== "object") {
    return {};
  }

  const result: Record<string, unknown> = {};
  const network = permissions.network;
  const fileSystem = permissions.fileSystem;

  if (network && typeof network === "object") {
    const enabled = (network as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean" || enabled === null) {
      result.network = { enabled };
    }
  }

  if (fileSystem && typeof fileSystem === "object") {
    const read = (fileSystem as { read?: unknown }).read;
    const write = (fileSystem as { write?: unknown }).write;
    if (Array.isArray(read) || Array.isArray(write)) {
      result.fileSystem = {
        ...(Array.isArray(read) ? { read } : {}),
        ...(Array.isArray(write) ? { write } : {}),
      };
    }
  }

  return result;
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadLineInterface | null = null;
  private connected = false;
  private nextRequestId = 1;
  private pendingCalls = new Map<string, PendingCall>();
  private handler: ((event: any) => void) | null = null;
  private permissionHandler: CodexPermissionHandler | null = null;
  private elicitationHandler:
    | ((
        request: AppServerElicitationRequest,
        options: { signal: AbortSignal },
      ) => Promise<AppServerElicitationResult>)
    | null = null;
  private dynamicToolHandler:
    | ((request: AppServerDynamicToolCallRequest) => Promise<AppServerDynamicToolCallResult>)
    | null = null;
  private chatGptAuthTokensProvider:
    | (() => Promise<{
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      } | null>)
    | null = null;
  private sandboxConfig?: SandboxConfig;
  private sandboxCleanup: (() => Promise<void>) | null = null;
  private turnWaiters = new Map<string, TurnWaiter>();
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private currentModel: string | null = null;
  private capabilities: AppServerCapabilities | null = null;
  private capabilitiesRefresh: Promise<void> | null = null;
  private mcpToolNames = new Map<string, string>();
  private dynamicToolMetadata = new Map<string, DynamicToolMetadata>();
  private lastDiffPreview: string | null = null;
  public sandboxEnabled = false;
  public readonly supportsModeHotSwap = true;
  public readonly backendKind = "codex-app-server" as const;

  constructor(sandboxConfig?: SandboxConfig) {
    this.sandboxConfig = sandboxConfig;
  }

  setHandler(handler: ((event: any) => void) | null): void {
    this.handler = handler;
  }

  setPermissionHandler(handler: CodexPermissionHandler): void {
    this.permissionHandler = handler;
  }

  setElicitationHandler(
    handler:
      | ((
          request: AppServerElicitationRequest,
          options: { signal: AbortSignal },
        ) => Promise<AppServerElicitationResult>)
      | null,
  ): void {
    this.elicitationHandler = handler;
  }

  setDynamicToolHandler(
    handler:
      | ((request: AppServerDynamicToolCallRequest) => Promise<AppServerDynamicToolCallResult>)
      | null,
  ): void {
    this.dynamicToolHandler = handler;
  }

  setChatGptAuthTokensProvider(
    provider:
      | (() => Promise<{
          accessToken: string;
          chatgptAccountId: string;
          chatgptPlanType?: string | null;
        } | null>)
      | null,
  ): void {
    this.chatGptAuthTokensProvider = provider;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    let command = "codex";
    let args = ["app-server"];
    this.sandboxEnabled = false;

    if (this.sandboxConfig?.enabled) {
      if (process.platform === "win32") {
        logger.warn(
          "[CodexAppServer] Sandbox is not supported on Windows; continuing without sandbox.",
        );
      } else {
        try {
          this.sandboxCleanup = await initializeSandbox(
            this.sandboxConfig,
            process.cwd(),
          );
          const wrappedTransport = await wrapForMcpTransport("codex", [
            "app-server",
          ]);
          command = wrappedTransport.command;
          args = wrappedTransport.args;
          this.sandboxEnabled = true;
        } catch (error) {
          logger.warn(
            "[CodexAppServer] Failed to initialize sandbox; continuing without sandbox.",
            error,
          );
          this.sandboxCleanup = null;
        }
      }
    }

    const env = Object.keys(process.env).reduce(
      (acc, key) => {
        const value = process.env[key];
        if (typeof value === "string") {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, string>,
    );
    const rolloutListFilter = "codex_core::rollout::list=off";
    const existingRustLog = env.RUST_LOG?.trim();
    if (!existingRustLog) {
      env.RUST_LOG = rolloutListFilter;
    } else if (!existingRustLog.includes("codex_core::rollout::list=")) {
      env.RUST_LOG = `${existingRustLog},${rolloutListFilter}`;
    }
    if (this.sandboxEnabled) {
      env.CODEX_SANDBOX = "seatbelt";
    }

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: process.cwd(),
    });

    this.stdoutReader = createInterface({ input: this.process.stdout });
    this.stdoutReader.on("line", (line) => {
      void this.handleStdoutLine(line);
    });

    this.process.stderr.on("data", (data) => {
      logger.debug(`[CodexAppServer][stderr] ${data.toString()}`);
    });

    this.process.on("exit", (code, signal) => {
      const error = new Error(
        `Codex app-server exited with code ${code ?? "unknown"}${
          signal ? ` (signal ${signal})` : ""
        }`,
      );
      for (const pending of this.pendingCalls.values()) {
        pending.reject(error);
      }
      this.pendingCalls.clear();
      for (const waiter of this.turnWaiters.values()) {
        waiter.reject(error);
      }
      this.turnWaiters.clear();
      this.connected = false;
      this.activeTurnId = null;
    });

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "happy_codex_app_server",
        title: "Happy Codex App Server",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.sendNotification("initialized");

    this.capabilities = await this.loadCapabilities();
    this.connected = true;
  }

  async loadCapabilities(): Promise<AppServerCapabilities> {
    const safeRequest = async <T>(method: string, params: unknown): Promise<T | null> => {
      try {
        return (await this.sendRequest(method, params)) as T;
      } catch (error) {
        logger.debug(`[CodexAppServer] Optional capability request failed: ${method}`, error);
        return null;
      }
    };

    const modelsResult = (await this.sendRequest("model/list", {
      includeHidden: false,
    })) as {
      data?: Array<{
        model: string;
        displayName: string;
        description: string;
        supportedReasoningEfforts?: RawSupportedReasoningEffort[];
        isDefault?: boolean;
        supportsPersonality?: boolean;
      }>;
    };
    const configResult = (await this.sendRequest("config/read", {
      includeLayers: false,
      cwd: process.cwd(),
    })) as {
      config?: {
        model?: string | null;
        profile?: string | null;
        approval_policy?: string | null;
        sandbox_mode?: string | null;
        service_tier?: string | null;
        model_reasoning_effort?: string | null;
        model_reasoning_summary?: string | null;
        model_verbosity?: string | null;
        web_search?: string | null;
      };
    };
    const [accountResult, rateLimitsResult, experimentalFeaturesResult, skillsResult, mcpServersResult] =
      (await Promise.all([
        safeRequest<{
          account?: { type: "apiKey" } | { type: "chatgpt"; email?: string; planType?: string };
          requiresOpenaiAuth?: boolean;
        }>("account/read", {
          refreshToken: false,
        }),
        safeRequest<{
          rateLimits?: {
            limitId?: string | null;
            limitName?: string | null;
            planType?: string | null;
            credits?: unknown;
          };
        }>("account/rateLimits/read", undefined),
        safeRequest<{
          data?: Array<{
            name: string;
            stage: string;
            enabled: boolean;
            defaultEnabled: boolean;
          }>;
        }>("experimentalFeature/list", {}),
        safeRequest<{
          data?: Array<{
            skills?: Array<{
              name: string;
              description: string;
              path: string;
              enabled: boolean;
            }>;
          }>;
        }>("skills/list", {}),
        safeRequest<{
          data?: Array<{
            name: string;
            authStatus: string;
            tools?: Record<string, unknown>;
          }>;
        }>("mcpServerStatus/list", {}),
      ])) as [
        {
          account?: { type: "apiKey" } | { type: "chatgpt"; email?: string; planType?: string };
          requiresOpenaiAuth?: boolean;
        },
        {
          rateLimits?: {
            limitId?: string | null;
            limitName?: string | null;
            planType?: string | null;
            credits?: unknown;
          };
        },
        {
          data?: Array<{
            name: string;
            stage: string;
            enabled: boolean;
            defaultEnabled: boolean;
          }>;
        },
        {
          data?: Array<{
            skills?: Array<{
              name: string;
              description: string;
              path: string;
              enabled: boolean;
            }>;
          }>;
        },
        {
          data?: Array<{
            name: string;
            authStatus: string;
            tools?: Record<string, unknown>;
          }>;
        },
      ];

    return {
      models: (modelsResult.data || []).map((model) => ({
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        supportedReasoningEfforts: normalizeSupportedReasoningEfforts(
          model.supportedReasoningEfforts,
        ),
        isDefault: model.isDefault === true,
        supportsPersonality: model.supportsPersonality === true,
      })),
      config: configResult.config
        ? {
            model: configResult.config.model ?? null,
            profile: configResult.config.profile ?? null,
            approvalPolicy: configResult.config.approval_policy ?? null,
            sandboxMode: configResult.config.sandbox_mode ?? null,
            serviceTier: configResult.config.service_tier ?? null,
            reasoningEffort:
              configResult.config.model_reasoning_effort ?? null,
            reasoningSummary:
              configResult.config.model_reasoning_summary ?? null,
            verbosity: configResult.config.model_verbosity ?? null,
            webSearch: configResult.config.web_search ?? null,
          }
        : null,
      account: accountResult?.account
        ? {
            type: accountResult.account.type,
            email:
              accountResult.account.type === "chatgpt"
                ? accountResult.account.email ?? null
                : null,
            planType:
              accountResult.account.type === "chatgpt"
                ? accountResult.account.planType ?? null
                : null,
            requiresOpenaiAuth: accountResult?.requiresOpenaiAuth === true,
          }
        : {
            type: null,
            email: null,
            planType: null,
            requiresOpenaiAuth: accountResult?.requiresOpenaiAuth === true,
          },
      rateLimits: rateLimitsResult?.rateLimits
        ? {
            limitId: rateLimitsResult.rateLimits.limitId ?? null,
            limitName: rateLimitsResult.rateLimits.limitName ?? null,
            planType: rateLimitsResult.rateLimits.planType ?? null,
            hasCredits: rateLimitsResult.rateLimits.credits != null,
          }
        : null,
      experimentalFeatures: (experimentalFeaturesResult?.data || []).map(
        (feature) => ({
          name: feature.name,
          stage: feature.stage,
          enabled: feature.enabled,
          defaultEnabled: feature.defaultEnabled,
        }),
      ),
      skills: (skillsResult?.data || []).flatMap((entry) =>
        (entry.skills || []).map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: skill.path,
          enabled: skill.enabled,
        })),
      ),
      mcpServers: (mcpServersResult?.data || []).map((server) => ({
        name: server.name,
        authStatus: server.authStatus,
        toolCount: Object.keys(server.tools || {}).length,
      })),
    };
  }

  getCapabilities(): AppServerCapabilities | null {
    return this.capabilities;
  }

  private async refreshCapabilitiesAndNotify(): Promise<void> {
    if (this.capabilitiesRefresh) {
      await this.capabilitiesRefresh;
      return;
    }

    this.capabilitiesRefresh = (async () => {
      this.capabilities = await this.loadCapabilities();
      this.handler?.({
        type: "metadata_refresh",
        capabilities: this.capabilities,
      });
    })();

    try {
      await this.capabilitiesRefresh;
    } finally {
      this.capabilitiesRefresh = null;
    }
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
    await this.sendRequest("account/login/start", {
      type: "apiKey",
      apiKey,
    });
    this.capabilities = await this.loadCapabilities();
  }

  async loginWithChatGptAuthTokens(params: {
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
  }): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
    await this.sendRequest("account/login/start", {
      type: "chatgptAuthTokens",
      accessToken: params.accessToken,
      chatgptAccountId: params.chatgptAccountId,
      chatgptPlanType: params.chatgptPlanType ?? null,
    });
    this.capabilities = await this.loadCapabilities();
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  async startSession(
    config: CodexSessionConfig,
    options?: { signal?: AbortSignal },
  ): Promise<CodexToolResponse> {
    if (!this.connected) {
      await this.connect();
    }

    const threadResponse = (await this.sendRequest("thread/start", {
      model: config.model ?? null,
      cwd: config.cwd ?? process.cwd(),
      approvalPolicy: config["approval-policy"] ?? null,
      baseInstructions: config["base-instructions"] ?? null,
      sandbox: config.sandbox ?? null,
      config: {
        ...(config.config ?? {}),
        ...(config.profile ? { profile: config.profile } : {}),
        ...(config.verbosity ? { model_verbosity: config.verbosity } : {}),
        ...(config.webSearch ? { web_search: config.webSearch } : {}),
      },
      serviceName: "happy",
      serviceTier: config.serviceTier ?? null,
      personality: config.personality ?? null,
      sessionStartSource: "startup",
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })) as {
      thread: { id: string };
      model?: string;
    };

    this.threadId = threadResponse.thread.id;
    this.currentModel = threadResponse.model ?? config.model ?? null;

    await this.startTurn(config.prompt, {
      signal: options?.signal,
      model: config.model ?? undefined,
      approvalPolicy: config["approval-policy"] ?? undefined,
      sandbox: config.sandbox ?? undefined,
      serviceTier: config.serviceTier ?? undefined,
      reasoningEffort: config.reasoningEffort ?? undefined,
      reasoningSummary: config.reasoningSummary ?? undefined,
      verbosity: config.verbosity ?? undefined,
      personality: config.personality ?? undefined,
      webSearch: config.webSearch ?? undefined,
    });

    return { content: [] };
  }

  async continueSession(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      model?: string;
      approvalPolicy?: CodexSessionConfig["approval-policy"];
      sandbox?: CodexSessionConfig["sandbox"];
      serviceTier?: string;
      reasoningEffort?: string;
      reasoningSummary?: string;
      verbosity?: string;
      personality?: string;
      webSearch?: "disabled" | "cached" | "live";
    },
  ): Promise<CodexToolResponse> {
    if (!this.threadId) {
      throw new Error("No active Codex app-server thread");
    }

    if (this.activeTurnId) {
      this.handler?.({
        type: "service_message",
        text: "Steering active Codex turn...",
      });
      await this.sendRequest("turn/steer", {
        threadId: this.threadId,
        input: [{ type: "text", text: prompt }],
        expectedTurnId: this.activeTurnId,
      });
      await this.waitForTurnCompletion(this.activeTurnId, options?.signal);
      return { content: [] };
    }

    await this.startTurn(prompt, options);
    return { content: [] };
  }

  async resumeThread(params: {
    threadId: string;
    model?: string;
    approvalPolicy?: CodexSessionConfig["approval-policy"];
    baseInstructions?: CodexSessionConfig["base-instructions"];
    sandbox?: CodexSessionConfig["sandbox"];
    profile?: string;
    serviceTier?: string;
    personality?: string;
    verbosity?: string;
    webSearch?: "disabled" | "cached" | "live";
  }): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const response = (await this.sendRequest("thread/resume", {
      threadId: params.threadId,
      model: params.model ?? null,
      cwd: process.cwd(),
      approvalPolicy: params.approvalPolicy ?? null,
      baseInstructions: params.baseInstructions ?? null,
      sandbox: params.sandbox ?? null,
      serviceTier: params.serviceTier ?? null,
      personality: params.personality ?? null,
      config: {
        ...(params.profile ? { profile: params.profile } : {}),
        ...(params.verbosity ? { model_verbosity: params.verbosity } : {}),
        ...(params.webSearch ? { web_search: params.webSearch } : {}),
      },
      persistExtendedHistory: true,
    })) as {
      thread: { id: string };
      model?: string;
    };

    this.threadId = response.thread.id;
    this.currentModel = response.model ?? params.model ?? this.currentModel;
  }

  private async startTurn(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      model?: string;
      approvalPolicy?: CodexSessionConfig["approval-policy"];
      sandbox?: CodexSessionConfig["sandbox"];
      serviceTier?: string;
      reasoningEffort?: string;
      reasoningSummary?: string;
      verbosity?: string;
      personality?: string;
      webSearch?: "disabled" | "cached" | "live";
    },
  ): Promise<void> {
    if (!this.threadId) {
      throw new Error("No active Codex app-server thread");
    }

    const result = (await this.sendRequest("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      cwd: process.cwd(),
      approvalPolicy: options?.approvalPolicy ?? null,
      sandboxPolicy: buildSandboxPolicy(options?.sandbox, process.cwd()) ?? null,
      model: options?.model ?? null,
      serviceTier: options?.serviceTier ?? null,
      effort: options?.reasoningEffort ?? null,
      summary: options?.reasoningSummary ?? null,
      personality: options?.personality ?? null,
    })) as {
      turn: { id: string };
    };

    this.activeTurnId = result.turn.id;
    await this.waitForTurnCompletion(result.turn.id, options?.signal);
  }

  private async waitForTurnCompletion(
    turnId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const waiter: TurnWaiter = { turnId, resolve, reject };
      this.turnWaiters.set(turnId, waiter);

      if (!signal) {
        return;
      }

      const abortHandler = () => {
        void this.interruptActiveTurn().catch((error) => {
          logger.debug("[CodexAppServer] Failed to interrupt active turn", error);
        });
        this.turnWaiters.delete(turnId);
        reject(createAbortError());
      };

      signal.addEventListener("abort", abortHandler, { once: true });
      const originalResolve = waiter.resolve;
      const originalReject = waiter.reject;
      waiter.resolve = () => {
        signal.removeEventListener("abort", abortHandler);
        originalResolve();
      };
      waiter.reject = (error) => {
        signal.removeEventListener("abort", abortHandler);
        originalReject(error);
      };
    });
  }

  private async interruptActiveTurn(): Promise<void> {
    if (!this.threadId || !this.activeTurnId) {
      return;
    }

    await this.sendRequest("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    });
  }

  getSessionId(): string | null {
    return this.threadId;
  }

  hasActiveSession(): boolean {
    return this.threadId !== null;
  }

  clearSession(): void {
    this.threadId = null;
    this.activeTurnId = null;
    this.currentModel = null;
  }

  storeSessionForResume(): string | null {
    return this.threadId;
  }

  async forceCloseSession(): Promise<void> {
    await this.disconnect();
    this.clearSession();
  }

  async disconnect(): Promise<void> {
    this.stdoutReader?.close();
    this.stdoutReader = null;

    if (this.process && !this.process.killed) {
      this.process.kill("SIGKILL");
    }
    this.process = null;
    this.connected = false;

    if (this.sandboxCleanup) {
      try {
        await this.sandboxCleanup();
      } finally {
        this.sandboxCleanup = null;
      }
    }
    this.sandboxEnabled = false;
  }

  private async handleStdoutLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let payload: JsonRpcRequest;
    try {
      payload = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (error) {
      logger.debug("[CodexAppServer] Failed to parse stdout line", error, line);
      return;
    }

    if (
      payload.id !== undefined &&
      (Object.prototype.hasOwnProperty.call(payload, "result") ||
        Object.prototype.hasOwnProperty.call(payload, "error")) &&
      !payload.method
    ) {
      this.resolvePendingCall(payload);
      return;
    }

    if (payload.method && payload.id !== undefined) {
      await this.handleServerRequest(payload);
      return;
    }

    if (payload.method) {
      this.handleNotification(payload.method, payload.params);
    }
  }

  private resolvePendingCall(payload: JsonRpcRequest): void {
    const key = String(payload.id);
    const pending = this.pendingCalls.get(key);
    if (!pending) {
      return;
    }
    this.pendingCalls.delete(key);
    if (payload.error !== undefined) {
      pending.reject(parseError(payload.error, "Codex app-server request failed"));
      return;
    }
    pending.resolve(payload.result);
  }

  private async handleServerRequest(payload: JsonRpcRequest): Promise<void> {
    const requestId = payload.id!;
    const requestKey = String(requestId);
    const method = payload.method;
    const params = (payload.params || {}) as Record<string, unknown>;

    try {
      if (method === "item/commandExecution/requestApproval") {
        const decision = this.permissionHandler
          ? mapPermissionDecision(
              (
                await this.permissionHandler.handleToolCall(requestKey, "CodexBash", {
                  command: params.command,
                  cwd: params.cwd,
                  reason: params.reason,
                  availableDecisions: params.availableDecisions,
                })
              ).decision,
            )
          : "cancel";
        this.sendResponse(requestId, { decision });
        return;
      }

      if (method === "execCommandApproval") {
        const permissionId =
          typeof params.callId === "string" && params.callId.length > 0
            ? params.callId
            : requestKey;
        const decision = this.permissionHandler
          ? mapLegacyReviewDecision(
              (
                await this.permissionHandler.handleToolCall(permissionId, "CodexBash", {
                  command: params.command,
                  cwd: params.cwd,
                  reason: params.reason,
                  parsedCmd: params.parsedCmd,
                  approvalId: params.approvalId,
                })
              ).decision,
            )
          : "abort";
        this.sendResponse(requestId, { decision });
        return;
      }

      if (method === "item/fileChange/requestApproval") {
        const decision = this.permissionHandler
          ? mapPermissionDecision(
              (
                await this.permissionHandler.handleToolCall(requestKey, "CodexPatch", {
                  reason: params.reason,
                  grantRoot: params.grantRoot,
                })
              ).decision,
            )
          : "cancel";
        this.sendResponse(requestId, { decision });
        return;
      }

      if (method === "applyPatchApproval") {
        const permissionId =
          typeof params.callId === "string" && params.callId.length > 0
            ? params.callId
            : requestKey;
        const decision = this.permissionHandler
          ? mapLegacyReviewDecision(
              (
                await this.permissionHandler.handleToolCall(permissionId, "CodexPatch", {
                  reason: params.reason,
                  grantRoot: params.grantRoot,
                  fileChanges: params.fileChanges,
                })
              ).decision,
            )
          : "abort";
        this.sendResponse(requestId, { decision });
        return;
      }

      if (method === "item/permissions/requestApproval") {
        const permissionId =
          typeof params.itemId === "string" && params.itemId.length > 0
            ? params.itemId
            : requestKey;
        const requestedToolName =
          typeof params.itemId === "string" && params.itemId.length > 0
            ? this.mcpToolNames.get(params.itemId) ?? null
            : null;
        const decision = this.permissionHandler
          ? (
              await this.permissionHandler.handleToolCall(
                permissionId,
                requestedToolName ?? "CodexPermissions",
                {
                  itemId: params.itemId,
                  reason: params.reason,
                  permissions: params.permissions,
                  ...(requestedToolName
                    ? { requestedToolName }
                    : {}),
                },
              )
            ).decision
          : "abort";

        if (decision === "approved" || decision === "approved_for_session") {
          this.sendResponse(requestId, {
            permissions: buildGrantedPermissions(
              params.permissions as Record<string, unknown> | undefined,
            ),
            scope: decision === "approved_for_session" ? "session" : "turn",
          });
          return;
        }

        this.sendResponse(requestId, {
          permissions: {},
          scope: "turn",
        });
        return;
      }

      if (method === "item/tool/call") {
        const dynamicCallId = String(params.callId ?? requestKey);
        const dynamicToolName = String(params.tool ?? "").trim();
        const dynamicToolArguments =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        if (dynamicToolName.length > 0) {
          this.dynamicToolMetadata.set(dynamicCallId, {
            toolName: dynamicToolName,
            arguments: dynamicToolArguments,
          });
        }
        const result = this.dynamicToolHandler
          ? await this.dynamicToolHandler({
              threadId: String(params.threadId ?? ""),
              turnId: String(params.turnId ?? ""),
              callId: dynamicCallId,
              tool: dynamicToolName,
              arguments: params.arguments,
            })
          : {
              contentItems: [
                {
                  type: "inputText" as const,
                  text: `Unsupported dynamic tool: ${String(params.tool ?? "unknown")}`,
                },
              ],
              success: false,
            };
        this.sendResponse(requestId, result);
        return;
      }

      if (method === "item/tool/requestUserInput") {
        const questions = Array.isArray(params.questions)
          ? (params.questions as AppServerQuestion[])
          : [];
        const result = this.elicitationHandler
          ? await this.elicitationHandler(
              {
                serverName: "Codex",
                message:
                  questions.length > 0
                    ? questions.map((question) => question.question).join("\n")
                    : "Codex requires additional user input.",
                mode: "form",
                requestedSchema: buildElicitationSchema(questions),
              },
              { signal: AbortSignal.timeout(10 * 60 * 1000) },
            )
          : { action: "cancel" as const };

        if (result.action !== "accept") {
          this.sendResponse(requestId, { answers: {} });
          return;
        }

        const answers = Object.fromEntries(
          questions.map((question) => {
            const value = result.content?.[question.id];
            if (Array.isArray(value)) {
              return [
                question.id,
                { answers: value.map((item) => String(item)) },
              ];
            }
            if (value == null) {
              return [question.id, { answers: [] }];
            }
            return [question.id, { answers: [String(value)] }];
          }),
        );
        this.sendResponse(requestId, { answers });
        return;
      }

      if (method === "mcpServer/elicitation/request") {
        const requestedToolName = extractMcpToolNameFromApprovalRequest(params);
        if (requestedToolName && this.permissionHandler) {
          const permissionId =
            typeof params.elicitationId === "string" && params.elicitationId.length > 0
              ? params.elicitationId
              : requestKey;
          const decision = (
            await this.permissionHandler.handleToolCall(permissionId, requestedToolName, {
              reason: params.message,
              requestedToolName,
              serverName: params.serverName,
              meta: params._meta,
            })
          ).decision;
          this.sendResponse(requestId, {
            action: mapElicitationDecision(decision),
            content: decision === "approved" || decision === "approved_for_session" ? {} : null,
            _meta: null,
          });
          return;
        }

        const mode = params.mode === "url" ? "url" : "form";
        const result = this.elicitationHandler
          ? await this.elicitationHandler(
              {
                serverName:
                  typeof params.serverName === "string" &&
                  params.serverName.length > 0
                    ? params.serverName
                    : "MCP Server",
                message:
                  typeof params.message === "string" && params.message.length > 0
                    ? params.message
                    : "MCP server requires user input.",
                mode,
                url:
                  mode === "url" && typeof params.url === "string"
                    ? params.url
                    : undefined,
                requestedSchema:
                  mode === "form" &&
                  params.requestedSchema &&
                  typeof params.requestedSchema === "object"
                    ? (params.requestedSchema as Record<string, unknown>)
                    : undefined,
              },
              { signal: AbortSignal.timeout(10 * 60 * 1000) },
            )
          : { action: "cancel" as const };

        this.sendResponse(requestId, {
          action: result.action,
          content: result.action === "accept" ? result.content ?? null : null,
          _meta: null,
        });
        return;
      }

      if (method === "account/chatgptAuthTokens/refresh") {
        if (!this.chatGptAuthTokensProvider) {
          this.sendError(requestId, "No ChatGPT auth token provider configured");
          return;
        }
        const refreshed = await this.chatGptAuthTokensProvider();
        if (!refreshed) {
          this.sendError(requestId, "No ChatGPT auth tokens available");
          return;
        }
        this.sendResponse(requestId, {
          accessToken: refreshed.accessToken,
          chatgptAccountId: refreshed.chatgptAccountId,
          chatgptPlanType: refreshed.chatgptPlanType ?? null,
        });
        return;
      }

      this.sendResponse(requestId, {});
    } catch (error) {
      logger.debug("[CodexAppServer] Server request handler failed", error);
      this.sendError(
        requestId,
        error instanceof Error ? error.message : "Server request handler failed",
      );
    }
  }

  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "turn/started": {
        const turnId =
          params &&
          typeof params === "object" &&
          typeof (params as { turn?: { id?: unknown } }).turn?.id === "string"
            ? (params as { turn: { id: string } }).turn.id
            : null;
        if (turnId) {
          this.activeTurnId = turnId;
        }
        this.handler?.({ type: "task_started" });
        return;
      }
      case "turn/completed": {
        const turn =
          params && typeof params === "object" ? (params as { turn?: any }).turn : null;
        const turnId = typeof turn?.id === "string" ? turn.id : null;
        const status = typeof turn?.status === "string" ? turn.status : "completed";
        if (turnId) {
          const waiter = this.turnWaiters.get(turnId);
          this.turnWaiters.delete(turnId);
          if (waiter) {
            if (status === "failed") {
              waiter.reject(
                parseError(turn?.error, "Codex app-server turn failed"),
              );
            } else {
              waiter.resolve();
            }
          }
        }
        this.activeTurnId = null;
        this.lastDiffPreview = null;
        if (status === "completed") {
          this.handler?.({ type: "task_complete", status });
        } else {
          this.handler?.({
            type: "turn_aborted",
            status,
            reason:
              typeof turn?.error?.message === "string"
                ? turn.error.message
                : status,
          });
        }
        return;
      }
      case "item/agentMessage/delta": {
        const notification =
          params && typeof params === "object"
            ? (params as { delta?: unknown; itemId?: unknown })
            : {};
        const delta =
          typeof notification.delta === "string" ? notification.delta : "";
        const itemId =
          typeof notification.itemId === "string" ? notification.itemId : null;
        if (delta && itemId) {
          this.handler?.({
            type: "text_delta",
            stream: itemId,
            delta,
          });
        }
        return;
      }
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta": {
        const notification =
          params && typeof params === "object"
            ? (params as { delta?: unknown; itemId?: unknown })
            : {};
        const delta =
          typeof notification.delta === "string" ? notification.delta : "";
        const itemId =
          typeof notification.itemId === "string" ? notification.itemId : null;
        if (delta && itemId) {
          this.handler?.({
            type: "text_delta",
            stream: itemId,
            delta,
            thinking: true,
          });
        }
        return;
      }
      case "item/reasoning/summaryPartAdded": {
        this.handler?.({ type: "agent_reasoning_section_break" });
        return;
      }
      case "account/updated":
      case "account/rateLimits/updated":
      case "skills/changed":
      case "mcpServer/startupStatus/updated":
        void this.refreshCapabilitiesAndNotify().catch((error) => {
          logger.debug("[CodexAppServer] Failed to refresh capabilities", error);
        });
        return;
      case "thread/tokenUsage/updated": {
        const notification =
          params && typeof params === "object"
            ? (params as {
                threadId?: unknown;
                turnId?: unknown;
                tokenUsage?: unknown;
              })
            : {};
        if (
          notification.tokenUsage &&
          typeof notification.tokenUsage === "object"
        ) {
          this.handler?.({
            type: "token_count",
            ...(typeof notification.threadId === "string"
              ? { threadId: notification.threadId }
              : {}),
            ...(typeof notification.turnId === "string"
              ? { turnId: notification.turnId }
              : {}),
            tokenUsage: notification.tokenUsage,
          });
        }
        return;
      }
      case "model/rerouted": {
        const notification = params as {
          fromModel?: string;
          toModel?: string;
          reason?: string;
        };
        if (typeof notification.toModel === "string") {
          this.currentModel = notification.toModel;
          this.handler?.({
            type: "metadata_patch",
            patch: {
              currentModelCode: notification.toModel,
            },
          });
        }
        this.handler?.({
          type: "service_message",
          text:
            notification.toModel && notification.fromModel
              ? `Codex rerouted model from ${notification.fromModel} to ${notification.toModel}`
              : "Codex rerouted the active model",
        });
        return;
      }
      case "configWarning": {
        const warning = params as { summary?: string; details?: string | null };
        this.handler?.({
          type: "service_message",
          text:
            warning.details && warning.summary
              ? `${warning.summary}\n${warning.details}`
              : warning.summary || "Codex reported a configuration warning",
        });
        return;
      }
      case "item/started": {
        this.handleItemEvent((params as { item?: any })?.item, "started");
        return;
      }
      case "item/completed": {
        this.handleItemEvent((params as { item?: any })?.item, "completed");
        return;
      }
      case "turn/plan/updated": {
        const notification = params as {
          explanation?: string | null;
          plan?: Array<{
            title?: string | null;
            step?: string | null;
            status?: string | null;
          }>;
        };
        this.handler?.({
          type: "turn_plan_updated",
          explanation: notification.explanation ?? null,
          plan: notification.plan ?? [],
        });
        const lines = [
          notification.explanation || "Plan updated",
          ...(notification.plan || []).map((step) => formatPlanLine(step)),
        ].filter(Boolean);
        this.handler?.({
          type: "service_message",
          text: lines.join("\n"),
        });
        return;
      }
      case "turn/diff/updated": {
        const notification = params as { diff?: string };
        if (typeof notification.diff === "string" && notification.diff.length > 0) {
          if (notification.diff === this.lastDiffPreview) {
            return;
          }
          this.lastDiffPreview = notification.diff;
          const callId = `codex-diff-${this.nextRequestId++}`;
          this.handler?.({
            type: "tool-call",
            callId,
            toolName: "CodexDiff",
            args: {
              unified_diff: notification.diff,
            },
          });
          this.handler?.({
            type: "tool-call-result",
            callId,
            name: "CodexDiff",
            output: {
              status: "completed",
            },
          });
        }
        return;
      }
      case "item/mcpToolCall/progress": {
        const notification =
          params && typeof params === "object"
            ? (params as { itemId?: unknown; message?: unknown })
            : {};
        const itemId =
          typeof notification.itemId === "string" ? notification.itemId : null;
        const progressMessage =
          typeof notification.message === "string"
            ? notification.message.trim()
            : "";
        if (!progressMessage) {
          return;
        }

        const toolName = itemId ? this.mcpToolNames.get(itemId) : null;
        this.handler?.({
          type: "tool-call",
          callId: itemId ?? "mcp-tool-progress",
          toolName: toolName ?? "mcpToolCall",
          args: {
            title: toolName ?? "MCP tool call",
            description: progressMessage,
          },
        });
        return;
      }
      case "serverRequest/resolved":
      default:
        return;
    }
  }

  private handleItemEvent(item: Record<string, unknown> | undefined, phase: "started" | "completed"): void {
    if (!item || typeof item.type !== "string") {
      return;
    }

    switch (item.type) {
      case "commandExecution":
        if (phase === "started") {
          this.handler?.({
            type: "exec_command_begin",
            call_id: item.id,
            command: item.command,
            cwd: item.cwd,
          });
        } else {
          this.handler?.({
            type: "exec_command_end",
            call_id: item.id,
            output: item.aggregatedOutput,
            success: item.status === "completed",
            error: item.status === "failed" ? item.aggregatedOutput : undefined,
          });
        }
        return;
      case "fileChange":
        if (phase === "started") {
          const changes = Array.isArray(item.changes)
            ? Object.fromEntries(
                item.changes.map((change) => [
                  String((change as { path?: unknown }).path || "unknown"),
                  change,
                ]),
              )
            : {};
          this.handler?.({
            type: "patch_apply_begin",
            call_id: item.id,
            changes,
          });
        } else {
          this.handler?.({
            type: "patch_apply_end",
            call_id: item.id,
            success: item.status === "completed",
            stderr:
              item.status === "failed"
                ? "File change failed"
                : item.status === "declined"
                  ? "File change declined"
                  : undefined,
          });
        }
        return;
      case "enteredReviewMode":
      case "exitedReviewMode":
        this.handler?.({
          type: "service_message",
          text:
            typeof item.review === "string" && item.review.length > 0
              ? item.review
              : item.type === "enteredReviewMode"
                ? "Codex review started"
                : "Codex review completed",
        });
        return;
      case "dynamicToolCall": {
        const callId = typeof item.id === "string" ? item.id : "dynamic-tool-call";
        const cachedMetadata = this.dynamicToolMetadata.get(callId);
        const toolName =
          typeof item.tool === "string" && item.tool.length > 0
            ? item.tool
            : cachedMetadata?.toolName ?? "CodexDynamicTool";
        const toolArguments =
          item.arguments && typeof item.arguments === "object"
            ? (item.arguments as Record<string, unknown>)
            : cachedMetadata?.arguments ?? {};
        if (phase === "started") {
          this.handler?.({
            type: "tool-call",
            callId,
            toolName,
            args: {
              ...toolArguments,
              requestedToolName: toolName,
              toolName,
            },
          });
          return;
        }

        const success = item.success === true && item.status === "completed";
        const content = extractDynamicToolCallText(
          item.contentItems,
          success ? "Tool call completed" : `Tool call failed: ${toolName}`,
        );
        this.handler?.({
          type: "tool-call-result",
          callId,
          name: toolName,
          output: {
            content:
              content ??
              (success
                ? `Tool call completed: ${toolName}`
                : `Tool call failed: ${toolName}`),
            status: success ? "completed" : "canceled",
          },
        });
        this.dynamicToolMetadata.delete(callId);
        return;
      }
      case "mcpToolCall": {
        const toolName = formatMcpToolName(item.server, item.tool);
        const callId =
          typeof item.id === "string" && item.id.length > 0 ? item.id : toolName;
        if (phase === "started") {
          this.mcpToolNames.set(callId, toolName);
          this.handler?.({
            type: "tool-call",
            callId,
            toolName,
            args:
              item.arguments && typeof item.arguments === "object"
                ? (item.arguments as Record<string, unknown>)
                : {},
          });
          return;
        }

        const content = extractMcpToolCallText(
          item.result,
          item.error,
          item.status === "completed"
            ? `MCP tool call completed: ${toolName}`
            : `MCP tool call failed: ${toolName}`,
        );
        this.handler?.({
          type: "tool-call-result",
          callId,
          name: toolName,
          output: {
            content:
              content ??
              (item.status === "completed"
                ? `MCP tool call completed: ${toolName}`
                : `MCP tool call failed: ${toolName}`),
            status: item.status === "completed" ? "completed" : "canceled",
          },
        });
        this.mcpToolNames.delete(callId);
        return;
      }
      default:
        return;
    }
  }

  private sendNotification(method: string): void {
    this.process?.stdin.write(`${JSON.stringify({ method })}\n`);
  }

  private sendResponse(id: string | number, result: unknown): void {
    this.process?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  private sendError(id: string | number, message: string): void {
    this.process?.stdin.write(
      `${JSON.stringify({ id, error: { message } })}\n`,
    );
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.process) {
      return Promise.reject(new Error("Codex app-server process not started"));
    }

    const id = this.nextRequestId++;
    const key = String(id);
    const payload = JSON.stringify({ method, id, params });

    return new Promise((resolve, reject) => {
      this.pendingCalls.set(key, { resolve, reject });
      this.process?.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pendingCalls.delete(key);
          reject(error);
        }
      });
    });
  }
}
