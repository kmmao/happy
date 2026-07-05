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
import { createCipher } from "./encryption";
import {
  createSessionCryptoCodec,
  type SessionCryptoCodec,
} from "./sessionCryptoCodec";
import { createUsageReporter, type UsageReporter } from "./usageReporter";
import { delay } from "@/utils/time";
import { runVersionedUpdate } from "./versionedUpdate";
import { configuration } from "@/configuration";
import { RawJSONLines } from "@/claude/types";
import { randomUUID } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { AsyncLock } from "@/utils/lock";
import {
  createSmartReconnect,
  type SmartReconnectHandle,
} from "@/utils/smartReconnect";
import { RpcHandlerManager } from "./rpc/RpcHandlerManager";
import { registerCommonHandlers } from "../modules/common/registerCommonHandlers";
import {
  createEnvelope,
  type SessionEnvelope,
  type SessionTurnEndStatus,
} from "@kmmao/happy-wire";
import { type TurnMeta } from "@/claude/utils/sessionProtocolMapper";
import {
  createClaudeProtocolDriver,
  type ClaudeProtocolDriver,
} from "@/claude/claudeProtocolDriver";
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

type ReplayLocalIdFactory = (input: {
  envelope: SessionEnvelope;
  envelopeIndex: number;
}) => string;

type SessionProtocolSendOptions = {
  invalidate?: boolean;
  localId?: string;
};

type ClaudeSessionMessageSendOptions = {
  invalidate?: boolean;
  localIdForEnvelope?: ReplayLocalIdFactory;
  /**
   * When true, the call is part of historical transcript replay (see
   * transcriptReplay.ts and ADR-0032). Skips side-channels that are NOT
   * deduped by `localId` and would therefore double-attribute usage / cost
   * to the new Happy Session: `sendUsageData` (`usage-report` socket emit)
   * and `sendTurnCostReport` (`usage-report` cost socket emit). Envelopes
   * still flow through the localId-deduped pipeline so re-runs are idempotent.
   *
   * Naming caveat — the flag reads as a context label ("we're in replay")
   * but its load-bearing semantics are a behavior gate ("mute every
   * socket-emit channel that does NOT carry a deduplication key").
   * When adding a NEW socket-emit channel from this client, ask whether
   * the channel is `localId`-deduped:
   *   - If yes (goes through `enqueueMessage` / outbox) → no gate needed,
   *     the localId scheme already makes it idempotent.
   *   - If no (direct `this.socket.emit("...")` or `emitWithAck`) → gate
   *     it on `!options.replay`. Otherwise replay will double-emit under
   *     the new Happy Session id, defeating the ADR-0032 invariant.
   * The replay-skips-X tests in apiSession.test.ts are the contract pin
   * for these channels; mirror that pattern for any new one.
   */
  replay?: boolean;
};

/**
 * Dedup key for a `RawJSONLines` record — kept in sync with
 * `messageKey` in sessionScanner.ts. Duplicated here to avoid pulling the
 * full scanner module into the realtime client.
 */
function claudeRecordKey(body: RawJSONLines): string | null {
  switch (body.type) {
    case "user":
    case "assistant":
    case "system":
      return body.uuid;
    case "result":
      return "result: " + body.uuid;
    case "summary":
      return "summary: " + body.leafUuid + ": " + body.summary;
    default:
      return null;
  }
}

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
  private reconnect: SmartReconnectHandle;
  private pendingMessages: UserMessage[] = [];
  private pendingMessageCallback: ((message: UserMessage) => void) | null =
    null;
  /** Perf tracking: socket received timestamp for the most recently routed message */
  lastPerfSocketReceivedAt: number | undefined;
  readonly rpcHandlerManager: RpcHandlerManager;
  private agentStateLock = new AsyncLock();
  private metadataLock = new AsyncLock();
  // SessionCryptoCodec extends Cipher — adds typed encrypt/decode
  // methods per content kind (Metadata, AgentState, message content),
  // so the 9 wire-call sites no longer hand-narrow `(value as
  // Metadata)` after each decrypt. The codec also satisfies wire's
  // structural RpcCipher, so the cipher passed to RpcHandlerManager
  // below is the codec itself — no parallel surface.
  private readonly cipher: SessionCryptoCodec;
  private claudeDriver: ClaudeProtocolDriver = createClaudeProtocolDriver();
  private lastSeq: number;
  private pendingOutbox: Array<{ content: string; localId: string }> = [];
  private currentTurnStartTime: number | null = null;
  private lastApiCallEndTime: number | null = null;
  private currentTurnModel: string | null = null;
  private currentTurnUsage: Usage | null = null;
  private accumulatedTurnUsage: Usage | null = null;
  /**
   * Dedup keys for records already pushed through the historical-transcript
   * replay path (see transcriptReplay.ts). The JSONL session scanner running
   * concurrently re-reads the same records from the rewritten resume file —
   * we skip them here so a Claude version that does NOT preserve message
   * UUIDs across `--resume` cannot duplicate the whole chat under random
   * localIds. Population is opt-in via `markClaudeMessageReplayed`.
   */
  private replayedClaudeMessageKeys: Set<string> = new Set();
  private modelModeKey: string | undefined;
  /**
   * Per-turn latch — prevents emitting multiple `/compact` hints when a
   * long turn accumulates several assistant messages past the threshold
   * before the user reacts. Cleared on `startNewTurn` (the canonical turn
   * boundary, same place `accumulatedTurnUsage` resets), so a still-above-
   * threshold next turn will re-hint exactly once.
   */
  private compactHintEmittedInThisTurn: boolean = false;
  /**
   * 75% of the 200K window. The threshold detector fires a hint at this
   * usage so the user can run `/compact` before Claude TUI's own ~80%
   * auto-compact takes over.
   *
   * Skipped entirely for 1M models (modelModeKey ends with "-1m"): 150K
   * inside a 1M window is only 15%, so a "near limit" hint would be a
   * lie. The window-size choice is the model's own (via modelMode picker);
   * there is no separate "AUTO/1M" preference — see ADR notes in PR for
   * the removal of the `autoCompact` protocol.
   */
  private static readonly COMPACT_HINT_THRESHOLD = 150_000;
  private subagentFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Which full assistant envelopes to suppress on the next assistant message
   * because that content was already sent as real-time text-delta envelopes.
   */
  private _suppressAssistantTextEnvelopes: {
    text: boolean;
    thinking: boolean;
  } | null = null;
  private readonly sendSync: InvalidateSync;
  private readonly receiveSync: InvalidateSync;
  // Usage/cost reporting (delta accounting + payload shaping) lives behind this
  // seam; the transport (sessionId stamp + socket emit) is injected here.
  private readonly usageReporter: UsageReporter = createUsageReporter({
    emit: (report) => {
      const payload = {
        key: report.key,
        sessionId: this.sessionId,
        tokens: report.tokens,
        cost: report.cost,
      };
      logger.debugLargeJson(report.logLabel, payload);
      this.socket.emit("usage-report", payload);
    },
  });

  /** Current session protocol turn ID, or null if no turn is open. */
  get currentTurnId(): string | null {
    return this.claudeDriver.currentTurnId;
  }

  /**
   * Ensure a turn exists for the current query cycle. If no turn is open,
   * creates one and sends the `turn-start` envelope so the App can associate
   * subsequent stream events (text-delta) with a valid turn.
   *
   * Returns the current (possibly freshly-created) turn ID.
   */
  ensureCurrentTurn(): string {
    if (this.claudeDriver.currentTurnId) {
      return this.claudeDriver.currentTurnId;
    }
    const turnId = createId();
    const envelope = createEnvelope(
      "agent",
      { t: "turn-start" as const },
      { turn: turnId },
    );
    this.claudeDriver.setCurrentTurn(turnId);
    this.currentTurnStartTime = Date.now();
    this.sendSessionProtocolMessage(envelope);
    return turnId;
  }

  /**
   * Mark which assistant content was already streamed as text-delta envelopes.
   * Only matching full-text envelopes are suppressed, so streamed thinking alone
   * never hides the final visible assistant answer.
   */
  suppressAssistantTextEnvelopes(options: {
    text?: boolean;
    thinking?: boolean;
  } = { text: false, thinking: true }) {
    const text = options.text === true;
    const thinking = options.thinking === true;
    if (!text && !thinking) {
      return;
    }
    this._suppressAssistantTextEnvelopes = { text, thinking };
  }

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
    this.cipher = createSessionCryptoCodec(
      createCipher(session.encryptionKey, session.encryptionVariant),
    );
    this.sendSync = new InvalidateSync(() => this.flushOutbox());
    this.receiveSync = new InvalidateSync(() => this.fetchMessages());

    // Initialize RPC handler manager
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.sessionId,
      cipher: this.cipher,
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
      // socket.io's built-in auto-reconnect latches onto Power-Nap WiFi blips
      // and creates server-side zombie sessions; we self-manage reconnection
      // through SmartReconnect (network + lid + external-display gated).
      reconnection: false,
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
    });

    this.reconnect = createSmartReconnect({
      connect: () => this.socket.connect(),
      log: (message) => logger.debug(`[API] reconnect: ${message}`),
    });

    //
    // Handlers
    //

    this.socket.on("connect", () => {
      logger.debug("Socket connected successfully");
      this.reconnect.cancel();
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
      this.reconnect.schedule();
    });

    this.socket.on("connect_error", (error) => {
      logger.debug("[API] Socket connection error:", error);
      this.rpcHandlerManager.onSocketDisconnect();
      this.reconnect.schedule();
    });

    // Kick the reconnect loop immediately so that an initial connection
    // failure (before any connect/connect_error fires) is retried.
    this.reconnect.schedule();

    // Server events
    this.socket.on("update", (data: Update) => {
      try {
        logger.debugLargeJson("[SOCKET] [UPDATE] Received update:", data);

        if (!data.body) {
          logger.debug("[SOCKET] [UPDATE] [ERROR] No body in update!");
          return;
        }

        if (data.body.t === "new-message") {
          const socketReceivedAt = Date.now();
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
          const decrypted = this.cipher.decodeMessageContent(
            data.body.message.content.c,
          );
          const body = decrypted.ok ? decrypted.value : null;
          const decryptedAt = Date.now();
          logger.debug(`[perf] socket_received → decrypted: ${decryptedAt - socketReceivedAt}ms (seq=${messageSeq})`);
          logger.debugLargeJson("[SOCKET] [UPDATE] Received update:", body);
          // Attach timing for downstream perf tracking
          if (body && typeof body === "object") {
            (body as Record<string, unknown>).__perfSocketReceivedAt = socketReceivedAt;
          }
          this.routeIncomingMessage(body);
          this.lastSeq = messageSeq;
        } else if (data.body.t === "update-session") {
          if (
            data.body.metadata &&
            data.body.metadata.version > this.metadataVersion
          ) {
            const decryptedMetadata = this.cipher.decodeMetadata(
              data.body.metadata.value,
            );
            this.metadata = decryptedMetadata.ok ? decryptedMetadata.value : null;
            this.metadataVersion = data.body.metadata.version;
          }
          if (
            data.body.agentState &&
            data.body.agentState.version > this.agentStateVersion
          ) {
            const decryptedAgentState = data.body.agentState.value
              ? this.cipher.decodeAgentState(data.body.agentState.value)
              : null;
            this.agentState = decryptedAgentState?.ok ? decryptedAgentState.value : null;
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

  /**
   * Subscribe to "context size crossed the compact-hint threshold" events.
   * Fired at most once per turn (the latch resets at the same place
   * `accumulatedTurnUsage` does). The handler is expected to surface a
   * hint to the user. Skipped automatically for 1M models (modelModeKey
   * ends with "-1m").
   */
  onCompactHintRequest(callback: (contextSize: number) => void): void {
    this.compactHintHandler = callback;
  }
  private compactHintHandler: ((contextSize: number) => void) | null = null;

  onUserMessage(callback: (data: UserMessage) => void) {
    this.pendingMessageCallback = callback;
    // Drain the backlog through the guarded dispatcher so a throw on one buffered
    // message cannot interrupt the while-loop and strand the rest of the queue.
    while (this.pendingMessages.length > 0) {
      this.dispatchUserMessage(this.pendingMessages.shift()!);
    }
  }

  /**
   * Invoke the registered `onUserMessage` callback with a hard try/catch.
   *
   * Without this guard, any throw inside the Claude/Codex handlers (runClaude.ts
   * / runCodex.ts — large callbacks with meta resolution, special-command
   * parsing, queue pushes) is swallowed silently: the message looks "delivered"
   * on the wire (Web/App UI shows it in the conversation) but the agent never
   * sees it, producing the偶发 "sent on Web, no response" symptom.
   *
   * We deliberately do NOT rethrow — losing a single message is preferable to
   * tearing down the socket pipeline; the [FATAL] log line is the contract for
   * post-mortem grepping.
   */
  private dispatchUserMessage(message: UserMessage) {
    if (!this.pendingMessageCallback) {
      return;
    }
    try {
      this.pendingMessageCallback(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.debug(
        `[FATAL] [onUserMessage] callback threw — message NOT delivered to agent. sessionId=${this.sessionId} localKey=${message.localKey ?? "none"} err=${err.message}\n${err.stack ?? "(no stack)"}`,
      );
      logger.debugLargeJson(
        "[FATAL] [onUserMessage] offending message payload:",
        message,
      );
    }
  }

  /**
   * Inject a synthetic user-role message into the session from the CLI itself.
   * The message rides the same Socket.IO path as happy-agent's `sendMessage`
   * and happy-app's user input — server persists + broadcasts it back, which
   * this CLI then routes to `pendingMessageCallback`, triggering a normal
   * Agent turn.
   *
   * Pass `meta.displayText = ""` to hide the bubble in the App while the
   * Agent still sees the underlying `text`. Used by the auto-summary hook to
   * force a summary-update turn without polluting visible chat history.
   */
  /**
   * Read-only snapshot of the current metadata. Used by callers that need to
   * base a decision on the current state BEFORE calling `updateMetadata` (the
   * updater handler itself runs inside an async lock, so it doesn't help
   * callers that need the pre-state synchronously).
   */
  getMetadata(): Metadata | null {
    return this.metadata;
  }

  sendSyntheticUserMessage(text: string, meta: Record<string, unknown> = {}) {
    const content = {
      role: "user",
      content: { type: "text", text },
      meta: { sentFrom: "happy-cli-synthetic", ...meta },
    };
    this.enqueueMessage(content);
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private routeIncomingMessage(message: unknown) {
    // Extract perf timestamp before Zod strips unknown fields
    const perfTs = (message as Record<string, unknown>)?.__perfSocketReceivedAt as number | undefined;
    const userResult = UserMessageSchema.safeParse(message);
    if (userResult.success) {
      this.lastPerfSocketReceivedAt = perfTs;
      if (this.pendingMessageCallback) {
        this.dispatchUserMessage(userResult.data);
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

        // Skip messages already delivered via WebSocket during this fetch.
        // Race: fetchMessages captures afterSeq at start; if a WebSocket event
        // delivers seq N and bumps this.lastSeq to N while the HTTP request is
        // in-flight, the response still includes seq N, causing
        // routeIncomingMessage (and pendingMessageCallback) to fire twice for
        // commands like /clear and /compact.
        if (message.seq <= this.lastSeq) {
          continue;
        }

        if (message.content?.t !== "encrypted") {
          continue;
        }

        const decrypted = this.cipher.decodeMessageContent(message.content.c);
        if (!decrypted.ok) {
          decryptFailures++;
          logger.debug(
            `[API] Failed to decrypt message seq=${message.seq} (${decryptFailures} failures so far)`,
            { sessionId: this.sessionId },
          );
          continue;
        }
        this.routeIncomingMessage(decrypted.value);
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
      const batch = this.pendingOutbox.splice(0, MAX_BATCH_SIZE);
      try {
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

        const messages = Array.isArray(response.data.messages)
          ? response.data.messages
          : [];
        const maxSeq = messages.reduce(
          (acc, message) => (message.seq > acc ? message.seq : acc),
          this.lastSeq,
        );
        this.lastSeq = maxSeq;
      } catch (e) {
        this.pendingOutbox.unshift(...batch);
        throw e;
      }
    }
  }

  private scheduleSubagentFlush() {
    if (this.subagentFlushTimer) return;
    this.subagentFlushTimer = setTimeout(() => {
      this.subagentFlushTimer = null;
      void this.flushOutbox();
    }, 50);
  }

  private enqueueMessage(
    content: unknown,
    options: SessionProtocolSendOptions = {},
  ) {
    const encrypted = this.cipher.encryptMessageContent(content);
    this.pendingOutbox.push({
      content: encrypted,
      localId: options.localId ?? randomUUID(),
    });
    if (options.invalidate ?? true) {
      this.sendSync.invalidate();
    }
  }

  /**
   * Send message to session
   * @param body - Message body (can be MessageContent or raw content for agent messages)
   */
  /**
   * Mark a `RawJSONLines` record as already pushed through transcript replay.
   * The next `sendClaudeSessionMessage` call carrying a record with the same
   * dedup key (the scanner forwarding the resume-rewritten copy) is dropped.
   */
  markClaudeMessageReplayed(key: string) {
    this.replayedClaudeMessageKeys.add(key);
  }

  /**
   * Force-clear per-turn tracking state. Called at the end of transcript
   * replay so a truncated history (no terminal `result` record) does not leak
   * `currentTurnUsage` / `accumulatedTurnUsage` into the first real turn.
   */
  resetCurrentTurnTracking() {
    this.currentTurnStartTime = null;
    this.lastApiCallEndTime = null;
    this.currentTurnModel = null;
    this.currentTurnUsage = null;
    this.accumulatedTurnUsage = null;
    this.compactHintEmittedInThisTurn = false;
  }

  sendClaudeSessionMessage(
    body: RawJSONLines,
    options: ClaudeSessionMessageSendOptions = {},
  ) {
    // Defense in depth: if the JSONL scanner re-discovers a record that
    // transcript replay already pushed, drop it here. Without this, a Claude
    // version that rewrites message UUIDs on `--resume` would duplicate the
    // whole chat (scanner uses random localIds — server can't dedup).
    const recordKey = claudeRecordKey(body);
    if (recordKey && this.replayedClaudeMessageKeys.has(recordKey)) {
      logger.debug(
        `[SOCKET] Skipping scanner-forwarded record already covered by replay: type=${body.type} key=${recordKey}`,
      );
      return;
    }

    // Strip large image base64 from tool results to prevent oversized messages
    body = stripLargeImageContent(body);

    const prevTurnId = this.claudeDriver.currentTurnId;
    const mapped = this.claudeDriver.ingest(body);

    // Surface intentionally-unemitted messages for diagnostics. These used to
    // vanish silently; now the mapper classifies each, so "why didn't my
    // message show up?" is answerable from the logs.
    if (mapped.dropped.length > 0) {
      logger.debug("[SOCKET] Claude log messages produced no envelopes", {
        dropped: mapped.dropped,
      });
    }

    // Track turn start time when a new turn is opened
    if (!prevTurnId && this.claudeDriver.currentTurnId) {
      this.currentTurnStartTime = Date.now();
    }

    // Extract subagent from mapped envelopes for usage-update attribution
    const mappedSubagent = mapped.envelopes.find((e) => e.subagent)?.subagent;

    // When thinking was already streamed as text-delta envelopes, suppress only
    // matching full thinking envelopes from the complete assistant message. The
    // visible assistant text is always sent as a durable history fallback.
    const suppressText =
      body.type === "assistant" ? this._suppressAssistantTextEnvelopes : null;
    if (body.type === "assistant") {
      this._suppressAssistantTextEnvelopes = null;
    }

    let envelopeIndex = 0;
    const sendReplayAwareEnvelope = (envelope: SessionEnvelope) => {
      this.sendSessionProtocolMessage(envelope, {
        invalidate: options.invalidate,
        localId: options.localIdForEnvelope?.({ envelope, envelopeIndex }),
      });
      envelopeIndex += 1;
    };

    for (const envelope of mapped.envelopes) {
      if (suppressText && envelope.ev.t === "text") {
        const isThinking = envelope.ev.thinking === true;
        if (isThinking ? suppressText.thinking : suppressText.text) {
          continue;
        }
      }
      sendReplayAwareEnvelope(envelope);
    }

    // Subagent messages bypass InvalidateSync's single-flight limit so the App
    // sees tool-by-tool progress instead of a single batch at the end.
    if (mappedSubagent) {
      this.scheduleSubagentFlush();
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
        // Skip `sendUsageData` during transcript replay — that path goes over
        // the `usage-report` socket emit which is NOT deduplicated by
        // `localId`, so historical tokens would be re-attributed to the new
        // Happy session on every replay.
        if (!options.replay) {
          this.sendUsageData(body.message.usage, effectiveModel);
        }

        // Send per-request usage-update envelope to App for real-time display
        const turnId = this.claudeDriver.currentTurnId;
        if (turnId) {
          const now = Date.now();
          const callDurationMs =
            now - (this.lastApiCallEndTime ?? this.currentTurnStartTime ?? now);
          this.lastApiCallEndTime = now;
          sendReplayAwareEnvelope(
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

        // Compact-hint threshold. Skip during replay (reconstructing history)
        // and for 1M models (150K is only 15% of 1M — hint would be a lie).
        // Per-turn latch keeps the hint at most once across a long turn with
        // multiple API calls past the threshold; `resetCurrentTurnTracking`
        // re-arms it on the next turn so a still-above-threshold session
        // re-hints once more.
        const isOneMillionContextModel =
          this.modelModeKey?.endsWith("-1m") ?? false;
        if (
          !options.replay &&
          !isOneMillionContextModel &&
          !this.compactHintEmittedInThisTurn &&
          this.compactHintHandler
        ) {
          const contextSize =
            body.message.usage.input_tokens +
            (body.message.usage.cache_read_input_tokens ?? 0) +
            (body.message.usage.cache_creation_input_tokens ?? 0);
          if (contextSize >= ApiSessionClient.COMPACT_HINT_THRESHOLD) {
            this.compactHintEmittedInThisTurn = true;
            logger.debug(
              `[compactHint] threshold reached at ${contextSize} tokens — emitting hint`,
            );
            try {
              this.compactHintHandler(contextSize);
            } catch (handlerError) {
              logger.debug(
                `[compactHint] handler threw: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`,
              );
            }
          }
        }
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
    options: ClaudeSessionMessageSendOptions = {},
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
    //
    // Skip during transcript replay — `sendTurnCostReport` writes to the
    // `usage-report` socket channel (non-deduped); historical cost was
    // already billed under the OLD session, replaying it would double-bill
    // under the new one.
    if (resultData?.totalCostUsd !== undefined && !options.replay) {
      try {
        this.sendTurnCostReport({
          totalCostUsd: resultData.totalCostUsd,
          modelUsage: resultData.modelUsage ?? {},
        });
      } catch (error) {
        logger.debug("[SOCKET] Failed to send turn cost report:", error);
      }
    }

    const mapped = this.claudeDriver.closeTurn(
      status,
      Object.keys(meta).length > 0 ? meta : undefined,
    );

    // Reset turn tracking after close
    this.currentTurnStartTime = null;
    this.lastApiCallEndTime = null;
    this.currentTurnModel = null;
    this.currentTurnUsage = null;
    this.accumulatedTurnUsage = null;
    this.compactHintEmittedInThisTurn = false;

    mapped.envelopes.forEach((envelope, envelopeIndex) => {
      this.sendSessionProtocolMessage(envelope, {
        invalidate: options.invalidate,
        localId: options.localIdForEnvelope?.({ envelope, envelopeIndex }),
      });
    });
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
    options: SessionProtocolSendOptions = {},
  ) {
    const content = {
      role: "session",
      content: envelope,
      meta: {
        sentFrom: "cli",
      },
    };

    this.enqueueMessage(content, options);
  }

  sendSessionProtocolMessage(
    envelope: SessionEnvelope,
    options: SessionProtocolSendOptions = {},
  ) {
    this.enqueueSessionProtocolEnvelope(envelope, options);
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
    this.claudeDriver.setCurrentTurn(turnId);

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
        }
      | {
          // Structured `compact_boundary` event emitted alongside the legacy
          // `{type:"message", message:"Context compacted"}` text bubble. New
          // Apps render this with token deltas + duration + collapsible
          // summary; older Apps reject it at the agentEventSchema strict
          // discriminator and drop the envelope — they still see the legacy
          // text bubble. The `summary` field is populated asynchronously
          // after the JSONL `isCompactSummary:true` user record materializes
          // — emitted as a SECOND event carrying the same `boundaryUuid` so
          // the App reducer can merge it onto the first bubble in place
          // instead of inserting a duplicate.
          type: "compact-boundary";
          // Stable dedup key shared by BOTH emits for the same /compact
          // run. Mirrors the JSONL `compact_boundary.uuid`. The envelope's
          // own `content.id` is not propagated to the App's NormalizedMessage,
          // so we surface the uuid inside the event payload itself.
          boundaryUuid: string;
          // Source of truth: `compactMetadata.preTokens` from the Claude TUI
          // `compact_boundary` system record (pre-compaction context size in
          // tokens).
          preTokens: number;
          // Post-compaction context size in tokens (compactMetadata.postTokens).
          postTokens: number;
          // Wall-clock duration of the /compact call in milliseconds
          // (compactMetadata.durationMs).
          durationMs: number;
          // Whether the user invoked /compact ("manual") or the TUI hit its
          // own auto-compact threshold ("auto"). Mirrored from
          // compactMetadata.trigger.
          trigger: "manual" | "auto";
          // The full summary text injected by the TUI as the post-compact
          // context. Lives in the next-record `{type:"user",
          // isCompactSummary:true}` message — typically ~5-15KB of structured
          // prose. Optional because the second emit (with summary populated)
          // can be skipped if the user navigated away before the JSONL flush.
          summary?: string;
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
   * Run a callback once the socket is connected.
   * Executes immediately if already connected; otherwise registers a one-time
   * connect listener. Use for best-effort setup events that require an active socket.
   */
  runOnConnect(callback: () => void): void {
    if (this.socket.connected) {
      callback();
    } else {
      this.socket.once("connect", callback);
    }
  }

  /**
   * Report a session timeline event. Fire-and-forget, no queueing.
   */
  sessionEvent(
    sessionId: string,
    eventType: string,
    summary: string,
    detail?: Record<string, unknown>,
  ) {
    if (!this.socket.connected) return;
    this.socket.emit("session-event", { sessionId, eventType, summary, detail });
  }

  /**
   * Report a preview candidate (dev server) to the server.
   * The server stores it and broadcasts to interested App clients.
   */
  async emitPreviewCandidateReport(report: {
    sessionId: string;
    protocol: string;
    host: string;
    port: number;
    path?: string;
    devServerType?: string;
    command?: string;
    cwd?: string;
    pid?: number;
  }): Promise<{ ok: boolean; candidateId?: string; error?: string }> {
    if (!this.socket.connected) {
      return { ok: false, error: "socket-disconnected" };
    }
    return new Promise((resolve) => {
      this.socket.emit(
        "preview-candidate-report" as any,
        report,
        (response: any) => {
          resolve(response ?? { ok: false, error: "no-response" });
        },
      );
      // Timeout after 10s
      setTimeout(() => resolve({ ok: false, error: "timeout" }), 10_000);
    });
  }

  /**
   * Send session death message
   */
  sendSessionDeath() {
    this.socket.emit("session-end", { sid: this.sessionId, time: Date.now() });
  }

  /**
   * Forward a plaintext status message to another session's clients.
   * Used by Swarm child agents to report completion/blocked state to a coordinator.
   */
  sendInterAgentMessage(toSessionId: string, message: string) {
    if (!this.socket.connected) return;
    this.socket.emit("session:message", {
      fromSessionId: this.sessionId,
      toSessionId,
      message,
    });
  }

  /**
   * Emit a task-log chunk as an ephemeral event (not persisted to DB).
   * Used for real-time log streaming from background tasks.
   * Sent unencrypted since it's volatile data over an authenticated TLS connection.
   */
  emitTaskLog(taskId: string, outputFile: string, chunk: string, offset: number) {
    this.socket.volatile.emit("task-log", {
      sid: this.sessionId,
      taskId,
      outputFile,
      chunk,
      offset,
    });
  }

  /**
   * Submit knowledge entry to the server for the project knowledge base.
   * Non-blocking: fires and forgets via socket.io.
   */
  submitKnowledge(entry: {
    entryType: string;
    contributorType: string;
    action: string;
    title: string;
    content: string;
    request?: string;
    outcome?: string;
    tags: string[];
    confidence: string;
    model?: string;
    affectedFiles: string[];
  }) {
    this.socket.emit("submit-knowledge", {
      sid: this.sessionId,
      entry,
    });
  }

  /**
   * Report per-turn knowledge hits. hitIds are ProjectKnowledge ids the CLI detected
   * as referenced by the assistant this turn. Server uses this to tick the TTL-by-turn
   * counters on KnowledgeAccess rows and evict cold entries.
   */
  emitKnowledgeTurnEnd(hitIds: string[]) {
    this.socket.emit("knowledge-turn-end", {
      sid: this.sessionId,
      hitIds,
    });
  }

  /**
   * Fetch knowledge context from server for injection into session.
   * Uses socket.io emitWithAck (already authenticated).
   * Returns null on timeout or error.
   */
  async fetchKnowledge(
    mode: "auto" | "full" | "minimal",
    contextHints?: string[],
  ): Promise<{
    profile: {
      techStack: string[];
      architectureType?: string;
      knownPitfalls: string[];
      coreConventions: string[];
      lastUpdatedAt: number;
    } | null;
    entries: {
      id: string;
      entryType: string;
      title: string;
      content: string;
      tags: string[];
      confidence: string;
      createdAt: string;
    }[];
    actionItems: {
      id: string;
      entryType: string;
      title: string;
      content: string;
      tags: string[];
      confidence: string;
      createdAt: string;
    }[];
    knowledgeConfig?: {
      enabled: boolean;
      mode: "auto" | "full" | "minimal";
      sensitivity: "conservative" | "balanced" | "aggressive";
      trackFileEdits: boolean;
      trackTokens: boolean;
      summaryEnabled: boolean;
    };
  } | null> {
    try {
      const result = await this.socket.timeout(10_000).emitWithAck("fetch-knowledge", {
        sid: this.sessionId,
        mode,
        contextHints,
      });
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Fetch global world config (narrative + laws + policy) from UserKVStore via socket.
   * Returns null if not configured or on error.
   */
  async fetchWorldConfig(): Promise<{ narrative: string; laws: string; policy: string } | null> {
    try {
      const result = await this.socket.timeout(5_000).emitWithAck("fetch-world-config", {
        sid: this.sessionId,
      });
      return result ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Send per-request usage data (tokens only) to the server.
   * Cost is reported once at turn end using SDK-provided data.
   */
  sendUsageData(usage: Usage, model?: string) {
    this.usageReporter.reportProviderUsage("claude-session", usage, model);
  }

  /**
   * Send provider usage data (tokens only) to the server using a provider-specific key.
   * This keeps Claude and Codex usage isolated while reusing the same socket transport.
   */
  sendProviderUsageData(key: string, usage: Usage, model?: string) {
    this.usageReporter.reportProviderUsage(key, usage, model);
  }

  /**
   * Send turn-end cost report using SDK-provided cost data.
   * Called once per turn with accurate cost from the official SDK.
   */
  sendTurnCostReport(resultData: {
    totalCostUsd: number;
    modelUsage: Record<string, { costUSD: number }>;
  }) {
    this.usageReporter.reportTurnCost(resultData);
  }

  /**
   * Update session metadata
   * @param handler - Handler function that returns the updated metadata
   */
  updateMetadata(handler: (metadata: Metadata) => Metadata) {
    runVersionedUpdate<Metadata>({
      lock: this.metadataLock,
      currentVersion: () => this.metadataVersion,
      attempt: async (expectedVersion) => {
        const updated = handler(this.metadata!); // Weird state if metadata is null - should never happen but here we are
        const answer = await this.socket.emitWithAck("update-metadata", {
          sid: this.sessionId,
          expectedVersion,
          metadata: this.cipher.encryptMetadata(updated),
        });
        if (answer.result === "success" || answer.result === "version-mismatch") {
          const decrypted = this.cipher.decodeMetadata(answer.metadata);
          return { result: answer.result, version: answer.version, value: decrypted.ok ? decrypted.value : null };
        }
        return { result: "error" };
      },
      commit: (version, value) => {
        this.metadataVersion = version;
        this.metadata = value;
      },
    });
  }

  /**
   * Update session agent state
   * @param handler - Handler function that returns the updated agent state
   */
  updateAgentState(handler: (metadata: AgentState) => AgentState) {
    logger.debugLargeJson("Updating agent state", this.agentState);
    runVersionedUpdate<AgentState>({
      lock: this.agentStateLock,
      currentVersion: () => this.agentStateVersion,
      attempt: async (expectedVersion) => {
        const updated = handler(this.agentState || {});
        const answer = await this.socket.emitWithAck("update-state", {
          sid: this.sessionId,
          expectedVersion,
          agentState: updated ? this.cipher.encryptAgentState(updated) : null,
        });
        if (answer.result === "success" || answer.result === "version-mismatch") {
          const decrypted = answer.agentState
            ? this.cipher.decodeAgentState(answer.agentState)
            : null;
          return { result: answer.result, version: answer.version, value: decrypted?.ok ? decrypted.value : null };
        }
        return { result: "error" };
      },
      commit: (version, value) => {
        this.agentStateVersion = version;
        this.agentState = value;
        logger.debug("Agent state updated", this.agentState);
      },
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
    if (this.subagentFlushTimer !== null) {
      clearTimeout(this.subagentFlushTimer);
      this.subagentFlushTimer = null;
    }
    this.sendSync.stop();
    this.receiveSync.stop();
    this.reconnect.shutdown();
    this.socket.close();
  }
}
