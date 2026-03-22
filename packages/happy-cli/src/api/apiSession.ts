import { logger } from "@/ui/logger";
import { EventEmitter } from "node:events";
import { io, Socket } from "socket.io-client";
import {
  AgentState,
  ClientToServerEvents,
  Metadata,
  ServerToClientEvents,
  Session,
  Update,
  UserMessage,
  UserMessageSchema,
  Usage,
} from "./types";
import { decodeBase64, decrypt, encodeBase64, encrypt } from "./encryption";
import { backoff, delay } from "@/utils/time";
import { configuration } from "@/configuration";
import { RawJSONLines } from "@/claude/types";
import { randomUUID } from "node:crypto";
import { AsyncLock } from "@/utils/lock";
import { RpcHandlerManager } from "./rpc/RpcHandlerManager";
import { registerCommonHandlers } from "../modules/common/registerCommonHandlers";
import {
  createEnvelope,
  type SessionEnvelope,
  type SessionTurnEndStatus,
} from "@kmmao/happy-wire";
import {
  closeClaudeTurnWithStatus,
  mapClaudeLogMessageToSessionEnvelopes,
  type ClaudeSessionProtocolState,
  type TurnMeta,
} from "@/claude/utils/sessionProtocolMapper";
import { InvalidateSync } from "@/utils/sync";
import axios from "axios";

/**
 * ACP (Agent Communication Protocol) message data types.
 * This is the unified format for all agent messages - CLI adapts each provider's format to ACP.
 */
export type ACPMessageData =
  // Core message types
  | { type: "message"; message: string }
  | { type: "reasoning"; message: string }
  | { type: "thinking"; text: string }
  // Tool interactions
  | {
      type: "tool-call";
      callId: string;
      name: string;
      input: unknown;
      id: string;
    }
  | {
      type: "tool-result";
      callId: string;
      output: unknown;
      id: string;
      isError?: boolean;
    }
  // File operations
  | {
      type: "file-edit";
      description: string;
      filePath: string;
      diff?: string;
      oldContent?: string;
      newContent?: string;
      id: string;
    }
  // Terminal/command output
  | { type: "terminal-output"; data: string; callId: string }
  // Task lifecycle events
  | { type: "task_started"; id: string }
  | { type: "task_complete"; id: string }
  | { type: "turn_aborted"; id: string }
  // Permissions
  | {
      type: "permission-request";
      permissionId: string;
      toolName: string;
      description: string;
      options?: unknown;
    }
  // Usage/metrics
  | { type: "token_count"; [key: string]: unknown };

export type ACPProvider = "gemini" | "codex" | "claude" | "opencode";

type V3SessionMessage = {
  id: string;
  seq: number;
  content: { t: "encrypted"; c: string };
  localId: string | null;
  createdAt: number;
  updatedAt: number;
};

type V3GetSessionMessagesResponse = {
  messages: V3SessionMessage[];
  hasMore: boolean;
};

type V3PostSessionMessagesResponse = {
  messages: Array<{
    id: string;
    seq: number;
    localId: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
};

/** Helper to safely access the message.content array from a RawJSONLines body. */
interface MessageWithContent {
  content?: unknown[];
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  content?: ContentBlock[];
  source?: { data?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Strip large image base64 data from tool result messages before sending.
 * Claude Code tool results can contain full image data (200KB+) which,
 * after encryption + base64 encoding, becomes too large for socket.io transport.
 * The app only needs to know the tool completed, not the actual image data.
 */
function stripLargeImageContent(body: RawJSONLines): RawJSONLines {
  if (body.type !== "user" && body.type !== "assistant") {
    return body;
  }
  const msg = body.message as MessageWithContent | undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) {
    return body;
  }

  let modified = false;
  const strippedContent = content.map((item: unknown) => {
    const block = item as ContentBlock;
    // Handle tool_result blocks containing image content
    if (block.type === "tool_result" && Array.isArray(block.content)) {
      let innerModified = false;
      const strippedInner = block.content.map((inner: ContentBlock) => {
        if (inner.type === "image" && inner.source?.data) {
          innerModified = true;
          return { type: "text", text: "[image]" };
        }
        return inner;
      });
      if (innerModified) {
        modified = true;
        return { ...block, content: strippedInner };
      }
      return block;
    }
    // Handle direct image blocks
    if (block.type === "image" && block.source?.data) {
      modified = true;
      return { type: "text", text: "[image]" };
    }
    return block;
  });

  if (!modified) {
    return body;
  }

  return {
    ...body,
    message: {
      ...msg,
      content: strippedContent,
    },
  } as RawJSONLines;
}

export class ApiSessionClient extends EventEmitter {
  private readonly token: string;
  readonly sessionId: string;
  private metadata: Metadata | null;
  private metadataVersion: number;
  private agentState: AgentState | null;
  private agentStateVersion: number;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private pendingMessages: UserMessage[] = [];
  private pendingMessageCallback: ((message: UserMessage) => void) | null =
    null;
  readonly rpcHandlerManager: RpcHandlerManager;
  private agentStateLock = new AsyncLock();
  private metadataLock = new AsyncLock();
  private encryptionKey: Uint8Array;
  private encryptionVariant: "legacy" | "dataKey";
  private claudeSessionProtocolState: ClaudeSessionProtocolState = {
    currentTurnId: null,
    uuidToProviderSubagent: new Map<string, string>(),
    taskPromptToSubagents: new Map<string, string[]>(),
    providerSubagentToSessionSubagent: new Map<string, string>(),
    subagentTitles: new Map<string, string>(),
    bufferedSubagentMessages: new Map<string, RawJSONLines[]>(),
    hiddenParentToolCalls: new Set<string>(),
    startedSubagents: new Set<string>(),
    activeSubagents: new Set<string>(),
  };
  private lastSeq: number;
  private pendingOutbox: Array<{ content: string; localId: string }> = [];
  private currentTurnStartTime: number | null = null;
  private lastApiCallEndTime: number | null = null;
  private currentTurnModel: string | null = null;
  private currentTurnUsage: Usage | null = null;
  private accumulatedTurnUsage: Usage | null = null;
  private modelModeKey: string | undefined;
  private readonly sendSync: InvalidateSync;
  private readonly receiveSync: InvalidateSync;

  constructor(token: string, session: Session) {
    super();
    this.token = token;
    this.sessionId = session.id;
    // Initialize lastSeq from server state to avoid fetching entire message
    // history on resume. Only new messages (seq > lastSeq) will be fetched.
    this.lastSeq = session.seq ?? 0;
    this.metadata = session.metadata;
    this.metadataVersion = session.metadataVersion;
    this.agentState = session.agentState;
    this.agentStateVersion = session.agentStateVersion;
    this.encryptionKey = session.encryptionKey;
    this.encryptionVariant = session.encryptionVariant;
    this.sendSync = new InvalidateSync(() => this.flushOutbox());
    this.receiveSync = new InvalidateSync(() => this.fetchMessages());

    // Initialize RPC handler manager
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.sessionId,
      encryptionKey: this.encryptionKey,
      encryptionVariant: this.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });
    registerCommonHandlers(
      this.rpcHandlerManager,
      this.metadata.path,
      this.sessionId,
    );

    //
    // Create socket
    //

    this.socket = io(configuration.serverUrl, {
      auth: {
        token: this.token,
        clientType: "session-scoped" as const,
        sessionId: this.sessionId,
      },
      path: "/v1/updates",
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
    });

    //
    // Handlers
    //

    this.socket.on("connect", () => {
      logger.debug("Socket connected successfully");
      this.rpcHandlerManager.onSocketConnect(this.socket);
      // Send initial heartbeat immediately so server knows session is alive.
      // Without this, lastActiveAt stays stale and the 10-minute timeout may fire.
      this.keepAlive(false, "remote", true);
      this.receiveSync.invalidate();
    });

    // Set up global RPC request handler
    this.socket.on(
      "rpc-request",
      async (
        data: { method: string; params: string },
        callback: (response: string) => void,
      ) => {
        callback(await this.rpcHandlerManager.handleRequest(data));
      },
    );

    this.socket.on("disconnect", (reason) => {
      logger.debug("[API] Socket disconnected:", reason);
      this.rpcHandlerManager.onSocketDisconnect();
    });

    this.socket.on("connect_error", (error) => {
      logger.debug("[API] Socket connection error:", error);
      this.rpcHandlerManager.onSocketDisconnect();
    });

    // Server events
    this.socket.on("update", (data: Update) => {
      try {
        logger.debugLargeJson("[SOCKET] [UPDATE] Received update:", data);

        if (!data.body) {
          logger.debug("[SOCKET] [UPDATE] [ERROR] No body in update!");
          return;
        }

        if (data.body.t === "new-message") {
          const messageSeq = data.body.message?.seq;
          if (this.lastSeq === 0) {
            this.receiveSync.invalidate();
            return;
          }
          if (
            typeof messageSeq !== "number" ||
            messageSeq !== this.lastSeq + 1 ||
            data.body.message.content.t !== "encrypted"
          ) {
            this.receiveSync.invalidate();
            return;
          }
          const body = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(data.body.message.content.c),
          );
          logger.debugLargeJson("[SOCKET] [UPDATE] Received update:", body);
          this.routeIncomingMessage(body);
          this.lastSeq = messageSeq;
        } else if (data.body.t === "update-session") {
          if (
            data.body.metadata &&
            data.body.metadata.version > this.metadataVersion
          ) {
            this.metadata = decrypt(
              this.encryptionKey,
              this.encryptionVariant,
              decodeBase64(data.body.metadata.value),
            );
            this.metadataVersion = data.body.metadata.version;
          }
          if (
            data.body.agentState &&
            data.body.agentState.version > this.agentStateVersion
          ) {
            this.agentState = data.body.agentState.value
              ? decrypt(
                  this.encryptionKey,
                  this.encryptionVariant,
                  decodeBase64(data.body.agentState.value),
                )
              : null;
            this.agentStateVersion = data.body.agentState.version;
          }
        } else if (data.body.t === "update-machine") {
          // Session clients shouldn't receive machine updates - log warning
          logger.debug(
            `[SOCKET] WARNING: Session client received unexpected machine update - ignoring`,
          );
        } else {
          // If not a user message, it might be a permission response or other message type
          this.emit("message", data.body);
        }
      } catch (error) {
        logger.debug("[SOCKET] [UPDATE] [ERROR] Error handling update", {
          error,
        });
      }
    });

    // DEATH
    this.socket.on("error", (error) => {
      logger.debug("[API] Socket error:", error);
    });

    //
    // Connect (after short delay to give a time to add handlers)
    //

    this.socket.connect();
  }

  /**
   * Set the App-level model mode key (e.g., "sonnet-1m", "opus-1m").
   * Used to derive the correct model name for usage reporting,
   * since Claude API responses strip the [1m] suffix.
   */
  setModelModeKey(key: string | undefined) {
    this.modelModeKey = key;
  }

  onUserMessage(callback: (data: UserMessage) => void) {
    this.pendingMessageCallback = callback;
    while (this.pendingMessages.length > 0) {
      callback(this.pendingMessages.shift()!);
    }
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private routeIncomingMessage(message: unknown) {
    const userResult = UserMessageSchema.safeParse(message);
    if (userResult.success) {
      if (this.pendingMessageCallback) {
        this.pendingMessageCallback(userResult.data);
      } else {
        this.pendingMessages.push(userResult.data);
      }
      return;
    }
    this.emit("message", message);
  }

  private async fetchMessages() {
    let afterSeq = this.lastSeq;
    let decryptFailures = 0;
    while (true) {
      const response = await axios.get<V3GetSessionMessagesResponse>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
        {
          params: {
            after_seq: afterSeq,
            limit: 100,
          },
          headers: this.authHeaders(),
          timeout: 60000,
        },
      );

      const messages = Array.isArray(response.data.messages)
        ? response.data.messages
        : [];
      let maxSeq = afterSeq;

      for (const message of messages) {
        if (message.seq > maxSeq) {
          maxSeq = message.seq;
        }

        if (message.content?.t !== "encrypted") {
          continue;
        }

        try {
          const body = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(message.content.c),
          );
          this.routeIncomingMessage(body);
        } catch (error) {
          decryptFailures++;
          logger.debug(
            `[API] Failed to decrypt message seq=${message.seq} (${decryptFailures} failures so far)`,
            { sessionId: this.sessionId, error },
          );
        }
      }

      this.lastSeq = Math.max(this.lastSeq, maxSeq);
      const hasMore = !!response.data.hasMore;
      if (hasMore && maxSeq === afterSeq) {
        logger.debug(
          "[API] fetchMessages pagination stalled, stopping to avoid infinite loop",
          {
            sessionId: this.sessionId,
            afterSeq,
          },
        );
        break;
      }
      afterSeq = maxSeq;
      if (!hasMore) {
        break;
      }
    }
    if (decryptFailures > 0) {
      logger.debug(
        `[API] fetchMessages completed with ${decryptFailures} decrypt failures (likely old encryption key messages)`,
        { sessionId: this.sessionId },
      );
    }
  }

  private async flushOutbox() {
    const MAX_BATCH_SIZE = 100;

    while (this.pendingOutbox.length > 0) {
      const batch = this.pendingOutbox.slice(0, MAX_BATCH_SIZE);
      const response = await axios.post<V3PostSessionMessagesResponse>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
        {
          messages: batch,
        },
        {
          headers: this.authHeaders(),
          timeout: 60000,
        },
      );

      this.pendingOutbox.splice(0, batch.length);

      const messages = Array.isArray(response.data.messages)
        ? response.data.messages
        : [];
      const maxSeq = messages.reduce(
        (acc, message) => (message.seq > acc ? message.seq : acc),
        this.lastSeq,
      );
      this.lastSeq = maxSeq;
    }
  }

  private enqueueMessage(content: unknown, invalidate: boolean = true) {
    const encrypted = encodeBase64(
      encrypt(this.encryptionKey, this.encryptionVariant, content),
    );
    this.pendingOutbox.push({
      content: encrypted,
      localId: randomUUID(),
    });
    if (invalidate) {
      this.sendSync.invalidate();
    }
  }

  /**
   * Send message to session
   * @param body - Message body (can be MessageContent or raw content for agent messages)
   */
  sendClaudeSessionMessage(body: RawJSONLines) {
    // Strip large image base64 from tool results to prevent oversized messages
    body = stripLargeImageContent(body);

    const prevTurnId = this.claudeSessionProtocolState.currentTurnId;
    const mapped = mapClaudeLogMessageToSessionEnvelopes(
      body,
      this.claudeSessionProtocolState,
    );
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;

    // Track turn start time when a new turn is opened
    if (!prevTurnId && this.claudeSessionProtocolState.currentTurnId) {
      this.currentTurnStartTime = Date.now();
    }

    // Extract subagent from mapped envelopes for usage-update attribution
    const mappedSubagent = mapped.envelopes.find((e) => e.subagent)?.subagent;

    for (const envelope of mapped.envelopes) {
      this.sendSessionProtocolMessage(envelope);
    }
    // Track usage from assistant messages
    if (body.type === "assistant" && body.message?.usage) {
      this.currentTurnModel = body.message.model || null;
      this.currentTurnUsage = body.message.usage;
      try {
        // Claude API returns model IDs without [1m] suffix (e.g., "claude-sonnet-4-6").
        // When modelModeKey indicates 1M context (e.g., "sonnet-1m"), append [1m]
        // so usage is tracked separately for 1M variants.
        const effectiveModel =
          this.modelModeKey?.endsWith("-1m") && body.message.model
            ? `${body.message.model}[1m]`
            : body.message.model;
        this.sendUsageData(body.message.usage, effectiveModel);

        // Send per-request usage-update envelope to App for real-time display
        const turnId = this.claudeSessionProtocolState.currentTurnId;
        if (turnId) {
          const now = Date.now();
          const callDurationMs =
            now - (this.lastApiCallEndTime ?? this.currentTurnStartTime ?? now);
          this.lastApiCallEndTime = now;
          this.sendSessionProtocolMessage(
            createEnvelope(
              "agent",
              {
                t: "usage-update" as const,
                ...(effectiveModel ? { model: effectiveModel } : {}),
                usage: {
                  input_tokens: body.message.usage.input_tokens,
                  output_tokens: body.message.usage.output_tokens,
                  ...(body.message.usage.cache_creation_input_tokens != null
                    ? {
                        cache_creation_input_tokens:
                          body.message.usage.cache_creation_input_tokens,
                      }
                    : {}),
                  ...(body.message.usage.cache_read_input_tokens != null
                    ? {
                        cache_read_input_tokens:
                          body.message.usage.cache_read_input_tokens,
                      }
                    : {}),
                },
                durationMs: callDurationMs,
              },
              {
                turn: turnId,
                ...(mappedSubagent ? { subagent: mappedSubagent } : {}),
              },
            ),
          );
        }

        // Accumulate usage across all API calls within this turn
        this.accumulateTurnUsage(body.message.usage);
      } catch (error) {
        logger.debug("[SOCKET] Failed to send usage data:", error);
      }
    }

    // Update metadata with summary if this is a summary message
    if (body.type === "summary" && "summary" in body && "leafUuid" in body) {
      this.updateMetadata((metadata) => ({
        ...metadata,
        summary: {
          text: body.summary,
          updatedAt: Date.now(),
        },
      }));
    }
  }

  closeClaudeSessionTurn(
    status: SessionTurnEndStatus = "completed",
    resultData?: {
      totalCostUsd: number;
      numTurns: number;
      modelUsage: Record<
        string,
        {
          inputTokens: number;
          outputTokens: number;
          cacheReadInputTokens: number;
          cacheCreationInputTokens: number;
          costUSD: number;
          contextWindow: number;
          maxOutputTokens: number;
        }
      >;
    },
  ) {
    const durationMs =
      this.currentTurnStartTime != null
        ? Date.now() - this.currentTurnStartTime
        : undefined;

    // Use accumulated usage (total across all API calls in this turn)
    // instead of currentTurnUsage (which is only the last API call's snapshot)
    const usageForMeta = this.accumulatedTurnUsage ?? this.currentTurnUsage;

    const meta: TurnMeta = {
      ...(this.currentTurnModel ? { model: this.currentTurnModel } : {}),
      ...(usageForMeta ? { usage: usageForMeta } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(resultData?.totalCostUsd !== undefined
        ? { totalCostUsd: resultData.totalCostUsd }
        : {}),
      ...(resultData?.numTurns !== undefined
        ? { numTurns: resultData.numTurns }
        : {}),
      ...(resultData?.modelUsage &&
      Object.keys(resultData.modelUsage).length > 0
        ? { modelUsage: resultData.modelUsage }
        : {}),
    };

    // Send turn-end cost report using SDK-provided cost data.
    // Always send when totalCostUsd is present (even if 0) — the SDK explicitly
    // reported a value. Previously required > 0 && modelUsage, which silently
    // dropped reports when total_cost_usd defaulted to 0 or modelUsage was empty.
    if (resultData?.totalCostUsd !== undefined) {
      try {
        this.sendTurnCostReport({
          totalCostUsd: resultData.totalCostUsd,
          modelUsage: resultData.modelUsage ?? {},
        });
      } catch (error) {
        logger.debug("[SOCKET] Failed to send turn cost report:", error);
      }
    }

    const mapped = closeClaudeTurnWithStatus(
      this.claudeSessionProtocolState,
      status,
      Object.keys(meta).length > 0 ? meta : undefined,
    );

    // Reset turn tracking after close
    this.currentTurnStartTime = null;
    this.lastApiCallEndTime = null;
    this.currentTurnModel = null;
    this.currentTurnUsage = null;
    this.accumulatedTurnUsage = null;

    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const envelope of mapped.envelopes) {
      this.sendSessionProtocolMessage(envelope);
    }
  }

  private accumulateTurnUsage(usage: Usage) {
    if (!this.accumulatedTurnUsage) {
      this.accumulatedTurnUsage = {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      };
    } else {
      this.accumulatedTurnUsage = {
        input_tokens:
          this.accumulatedTurnUsage.input_tokens + usage.input_tokens,
        output_tokens:
          this.accumulatedTurnUsage.output_tokens + usage.output_tokens,
        cache_creation_input_tokens:
          (this.accumulatedTurnUsage.cache_creation_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0),
        cache_read_input_tokens:
          (this.accumulatedTurnUsage.cache_read_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0),
      };
    }
  }

  getAccumulatedTurnUsage(): {
    input_tokens: number;
    output_tokens: number;
  } | null {
    if (!this.accumulatedTurnUsage) return null;
    return {
      input_tokens: this.accumulatedTurnUsage.input_tokens,
      output_tokens: this.accumulatedTurnUsage.output_tokens,
    };
  }

  getCurrentTurnModel(): string | null {
    return this.currentTurnModel;
  }

  sendCodexMessage(body: any) {
    let content = {
      role: "agent",
      content: {
        type: "codex",
        data: body, // This wraps the entire Claude message
      },
      meta: {
        sentFrom: "cli",
      },
    };
    this.enqueueMessage(content);
  }

  private enqueueSessionProtocolEnvelope(
    envelope: SessionEnvelope,
    invalidate: boolean = true,
  ) {
    const content = {
      role: "session",
      content: envelope,
      meta: {
        sentFrom: "cli",
      },
    };

    this.enqueueMessage(content, invalidate);
  }

  sendSessionProtocolMessage(envelope: SessionEnvelope) {
    if (envelope.role !== "user") {
      this.enqueueSessionProtocolEnvelope(envelope);
      return;
    }

    if (envelope.ev.t !== "text") {
      this.enqueueSessionProtocolEnvelope(envelope);
      return;
    }

    this.enqueueSessionProtocolEnvelope(envelope);
  }

  /**
   * Send a direct text result to the session (bypasses Claude).
   * Creates its own turn lifecycle (turn-start → text → turn-end).
   * Used for shell commands and other direct results that don't go through the AI model.
   */
  sendDirectResult(text: string) {
    // Open a new turn
    const turnId = randomUUID();
    const turnStartEnvelope = createEnvelope(
      "agent",
      { t: "turn-start" },
      { turn: turnId },
    );
    this.sendSessionProtocolMessage(turnStartEnvelope);
    this.claudeSessionProtocolState.currentTurnId = turnId;

    // Send the text result
    const textEnvelope = createEnvelope(
      "agent",
      { t: "text", text },
      { turn: turnId },
    );
    this.sendSessionProtocolMessage(textEnvelope);

    // Close the turn
    this.closeClaudeSessionTurn("completed");
  }

  /**
   * Send a generic agent message to the session using ACP (Agent Communication Protocol) format.
   * Works for any agent type (Gemini, Codex, Claude, etc.) - CLI normalizes to unified ACP format.
   *
   * @param provider - The agent provider sending the message (e.g., 'gemini', 'codex', 'claude')
   * @param body - The message payload (type: 'message' | 'reasoning' | 'tool-call' | 'tool-result')
   */
  sendAgentMessage(
    provider: "gemini" | "codex" | "claude" | "opencode",
    body: ACPMessageData,
  ) {
    let content = {
      role: "agent",
      content: {
        type: "acp",
        provider,
        data: body,
      },
      meta: {
        sentFrom: "cli",
      },
    };

    logger.debug(`[SOCKET] Sending ACP message from ${provider}:`, {
      type: body.type,
      hasMessage: "message" in body,
    });

    this.enqueueMessage(content);
  }

  sendSessionEvent(
    event:
      | {
          type: "switch";
          mode: "local" | "remote";
        }
      | {
          type: "message";
          message: string;
        }
      | {
          type: "permission-mode-changed";
          mode: "default" | "acceptEdits" | "bypassPermissions" | "plan";
        }
      | {
          type: "ready";
        },
    id?: string,
  ) {
    let content = {
      role: "agent",
      content: {
        id: id ?? randomUUID(),
        type: "event",
        data: event,
      },
    };
    this.enqueueMessage(content);
  }

  /**
   * Send a ping message to keep the connection alive
   */
  keepAlive(
    thinking: boolean,
    mode: "local" | "remote",
    reliable?: boolean,
    apiRetry?: {
      attempt: number;
      maxRetries: number;
      retryDelayMs: number;
      errorStatus: number | null;
    },
  ) {
    if (process.env.DEBUG) {
      // too verbose for production
      logger.debug(`[API] Sending keep alive message: ${thinking}`);
    }
    const payload = {
      sid: this.sessionId,
      time: Date.now(),
      thinking,
      mode,
      ...(apiRetry ? { apiRetry } : {}),
    };
    // Use reliable (non-volatile) emit for thinking state changes so the
    // update is queued and delivered even during brief disconnections.
    if (reliable) {
      this.socket.emit("session-alive", payload);
    } else {
      this.socket.volatile.emit("session-alive", payload);
    }
  }

  /**
   * Send session death message
   */
  sendSessionDeath() {
    this.socket.emit("session-end", { sid: this.sessionId, time: Date.now() });
  }

  /**
   * Send per-request usage data (tokens only) to the server.
   * Cost is reported once at turn end using SDK-provided data.
   */
  sendUsageData(usage: Usage, model?: string) {
    const totalTokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    const tokens: { [key: string]: number; total: number } = {
      total: totalTokens,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_creation: usage.cache_creation_input_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
    };
    if (model) {
      tokens[model] = totalTokens;
    }

    // Cost is zero for per-request reports; actual cost comes from SDK at turn end
    const cost: { [key: string]: number; total: number } = {
      total: 0,
      input: 0,
      output: 0,
    };

    const usageReport = {
      key: "claude-session",
      sessionId: this.sessionId,
      tokens,
      cost,
    };
    logger.debugLargeJson("[SOCKET] Sending usage data:", usageReport);
    this.socket.emit("usage-report", usageReport);
  }

  /**
   * Send turn-end cost report using SDK-provided cost data.
   * Called once per turn with accurate cost from the official SDK.
   */
  sendTurnCostReport(resultData: {
    totalCostUsd: number;
    modelUsage: Record<string, { costUSD: number }>;
  }) {
    const cost: { [key: string]: number; total: number } = {
      total: resultData.totalCostUsd,
      ...Object.fromEntries(
        Object.entries(resultData.modelUsage).map(([model, usage]) => [
          model,
          usage.costUSD,
        ]),
      ),
    };

    const usageReport = {
      key: "claude-session",
      sessionId: this.sessionId,
      tokens: { total: 0, input: 0, output: 0 },
      cost,
    };
    logger.debugLargeJson(
      "[SOCKET] Sending turn-end cost report (SDK):",
      usageReport,
    );
    this.socket.emit("usage-report", usageReport);
  }

  /**
   * Update session metadata
   * @param handler - Handler function that returns the updated metadata
   */
  updateMetadata(handler: (metadata: Metadata) => Metadata) {
    this.metadataLock.inLock(async () => {
      await backoff(async () => {
        let updated = handler(this.metadata!); // Weird state if metadata is null - should never happen but here we are
        const answer = await this.socket.emitWithAck("update-metadata", {
          sid: this.sessionId,
          expectedVersion: this.metadataVersion,
          metadata: encodeBase64(
            encrypt(this.encryptionKey, this.encryptionVariant, updated),
          ),
        });
        if (answer.result === "success") {
          this.metadata = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(answer.metadata),
          );
          this.metadataVersion = answer.version;
        } else if (answer.result === "version-mismatch") {
          if (answer.version > this.metadataVersion) {
            this.metadataVersion = answer.version;
            this.metadata = decrypt(
              this.encryptionKey,
              this.encryptionVariant,
              decodeBase64(answer.metadata),
            );
          }
          throw new Error("Metadata version mismatch");
        } else if (answer.result === "error") {
          // Hard error - ignore
        }
      });
    });
  }

  /**
   * Update session agent state
   * @param handler - Handler function that returns the updated agent state
   */
  updateAgentState(handler: (metadata: AgentState) => AgentState) {
    logger.debugLargeJson("Updating agent state", this.agentState);
    this.agentStateLock.inLock(async () => {
      await backoff(async () => {
        let updated = handler(this.agentState || {});
        const answer = await this.socket.emitWithAck("update-state", {
          sid: this.sessionId,
          expectedVersion: this.agentStateVersion,
          agentState: updated
            ? encodeBase64(
                encrypt(this.encryptionKey, this.encryptionVariant, updated),
              )
            : null,
        });
        if (answer.result === "success") {
          this.agentState = answer.agentState
            ? decrypt(
                this.encryptionKey,
                this.encryptionVariant,
                decodeBase64(answer.agentState),
              )
            : null;
          this.agentStateVersion = answer.version;
          logger.debug("Agent state updated", this.agentState);
        } else if (answer.result === "version-mismatch") {
          if (answer.version > this.agentStateVersion) {
            this.agentStateVersion = answer.version;
            this.agentState = answer.agentState
              ? decrypt(
                  this.encryptionKey,
                  this.encryptionVariant,
                  decodeBase64(answer.agentState),
                )
              : null;
          }
          throw new Error("Agent state version mismatch");
        } else if (answer.result === "error") {
          // console.error('Agent state update error', answer);
          // Hard error - ignore
        }
      });
    });
  }

  /**
   * Wait for socket buffer to flush
   */
  async flush(): Promise<void> {
    await Promise.race([this.sendSync.invalidateAndAwait(), delay(10000)]);
    if (!this.socket.connected) {
      return;
    }
    return new Promise((resolve) => {
      this.socket.emit("ping", () => {
        resolve();
      });
      setTimeout(() => {
        resolve();
      }, 10000);
    });
  }

  async close() {
    logger.debug("[API] socket.close() called");
    this.sendSync.stop();
    this.receiveSync.stop();
    this.socket.close();
  }
}
