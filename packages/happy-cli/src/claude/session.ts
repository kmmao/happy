import { ApiClient, ApiSessionClient } from "@/lib";
import { MessageQueue2 } from "@/utils/MessageQueue2";
import { EnhancedMode } from "./loop";
import { logger } from "@/ui/logger";
import type { JsRuntime } from "./runClaude";
import type { SandboxConfig } from "@/persistence";

export class Session {
  readonly path: string;
  readonly logPath: string;
  readonly api: ApiClient;
  readonly client: ApiSessionClient;
  readonly queue: MessageQueue2<EnhancedMode>;
  readonly claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[]; // Made mutable to allow filtering
  /**
   * MCP server configs passed through to the SDK.
   * Kept as `any` to allow all SDK config shapes (stdio, sse, http, sdk).
   *
   * SDK 0.2.111+ supports per-tool `permission_policy` on remote servers:
   *   { type: 'http', url, tools: [{ name, permission_policy: 'always_allow' | 'always_ask' | 'always_deny' }] }
   * Upstream config producers can set `tools` on any entry to enforce
   * per-tool auto-allow/deny without wrapping every call with `canCallTool`.
   */
  readonly mcpServers: Record<string, any>;
  readonly allowedTools?: string[];
  readonly sandboxConfig?: SandboxConfig;
  readonly _onModeChange: (mode: "local" | "remote") => void;
  /**
   * Called by launchers (claudeLocalLauncher / claudeRemoteLauncherCore) when
   * the active runner is being torn down (mode switch, server-triggered abort,
   * etc). runClaude wires this to `resetCurrentModeDefaults` so the next turn
   * starts from the configured defaults instead of inheriting state from the
   * aborted turn.
   */
  readonly _onAbort?: () => void;
  /** Path to temporary settings file with SessionStart hook (required for session tracking) */
  readonly hookSettingsPath: string;
  /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
  readonly jsRuntime: JsRuntime;
  /** Model to pass to Claude Code */
  readonly model?: string;
  /** Optional callback to report session timeline events */
  onSessionEvent?: (sessionId: string, eventType: string, summary: string, detail?: Record<string, unknown>) => void;

  sessionId: string | null;
  mode: "local" | "remote" = "local";
  thinking: boolean = false;

  /** Callbacks to be notified when session ID is found/changed */
  private sessionFoundCallbacks: ((sessionId: string) => void)[] = [];

  /** Keep alive interval reference for cleanup */
  private keepAliveInterval: NodeJS.Timeout;

  constructor(opts: {
    api: ApiClient;
    client: ApiSessionClient;
    path: string;
    logPath: string;
    sessionId: string | null;
    claudeEnvVars?: Record<string, string>;
    claudeArgs?: string[];
    mcpServers: Record<string, any>;
    messageQueue: MessageQueue2<EnhancedMode>;
    onModeChange: (mode: "local" | "remote") => void;
    onAbort?: () => void;
    allowedTools?: string[];
    sandboxConfig?: SandboxConfig;
    /** Path to temporary settings file with SessionStart hook (required for session tracking) */
    hookSettingsPath: string;
    /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
    jsRuntime?: JsRuntime;
    /** Model to pass to Claude Code */
    model?: string;
  }) {
    this.path = opts.path;
    this.api = opts.api;
    this.client = opts.client;
    this.logPath = opts.logPath;
    this.sessionId = opts.sessionId;
    this.queue = opts.messageQueue;
    this.claudeEnvVars = opts.claudeEnvVars;
    this.claudeArgs = opts.claudeArgs;
    this.mcpServers = opts.mcpServers;
    this.allowedTools = opts.allowedTools;
    this.sandboxConfig = opts.sandboxConfig;
    this._onModeChange = opts.onModeChange;
    this._onAbort = opts.onAbort;
    this.hookSettingsPath = opts.hookSettingsPath;
    this.jsRuntime = opts.jsRuntime ?? "node";
    this.model = opts.model;

    // Start keep alive
    this.client.keepAlive(this.thinking, this.mode);
    this.keepAliveInterval = setInterval(() => {
      this.client.keepAlive(this.thinking, this.mode);
    }, 2000);
  }

  /**
   * Cleanup resources (call when session is no longer needed)
   */
  cleanup = (): void => {
    clearInterval(this.keepAliveInterval);
    this.sessionFoundCallbacks = [];
    logger.debug("[Session] Cleaned up resources");
  };

  onThinkingChange = (thinking: boolean) => {
    this.thinking = thinking;
    this.client.keepAlive(thinking, this.mode, true);
  };

  onModeChange = (mode: "local" | "remote") => {
    this.mode = mode;
    this.client.keepAlive(this.thinking, mode, true);
    this._onModeChange(mode);
  };

  onAbort = () => {
    this._onAbort?.();
  };

  /**
   * Called when Claude session ID is discovered or changed.
   *
   * This is triggered by the SessionStart hook when:
   * - Claude starts a new session (fresh start)
   * - Claude resumes a session (--continue, --resume flags)
   * - Claude forks a session (/compact, double-escape fork)
   *
   * Updates internal state, syncs to API metadata, and notifies
   * all registered callbacks (e.g., SessionScanner) about the change.
   */
  onSessionFound = (sessionId: string) => {
    this.sessionId = sessionId;

    // Update metadata with Claude Code session ID
    this.client.updateMetadata((metadata) => ({
      ...metadata,
      claudeSessionId: sessionId,
    }));
    logger.debug(
      `[Session] Claude Code session ID ${sessionId} added to metadata`,
    );

    // Notify all registered callbacks
    for (const callback of this.sessionFoundCallbacks) {
      callback(sessionId);
    }
  };

  /**
   * Register a callback to be notified when session ID is found/changed.
   *
   * Replays the last-known id to late subscribers (BehaviorSubject semantics):
   * the SessionStart hook fires once per fresh id and `onSessionFound` is gated
   * on the id actually changing, so a subscriber that registers *after* the hook
   * has already fired would otherwise never learn the id. In PTY/Remote mode the
   * claude process is live (and can fire SessionStart) from `startClaudePty`,
   * while the scanner only subscribes a couple of awaits later — without this
   * replay that race leaves the scanner watching nothing. All current
   * subscribers are idempotent on a repeated id, so the replay is safe.
   */
  addSessionFoundCallback = (callback: (sessionId: string) => void): void => {
    this.sessionFoundCallbacks.push(callback);
    if (this.sessionId !== null) {
      callback(this.sessionId);
    }
  };

  /**
   * Remove a session found callback
   */
  removeSessionFoundCallback = (
    callback: (sessionId: string) => void,
  ): void => {
    const index = this.sessionFoundCallbacks.indexOf(callback);
    if (index !== -1) {
      this.sessionFoundCallbacks.splice(index, 1);
    }
  };

  /**
   * Clear the current session ID (used by /clear command)
   */
  clearSessionId = (): void => {
    this.sessionId = null;
    logger.debug("[Session] Session ID cleared");
  };

  /**
   * Consume one-time Claude flags from claudeArgs after Claude spawn
   * Handles: --resume (with or without session ID), --continue
   */
  consumeOneTimeFlags = (): void => {
    if (!this.claudeArgs) return;

    const filteredArgs: string[] = [];
    for (let i = 0; i < this.claudeArgs.length; i++) {
      const arg = this.claudeArgs[i];

      if (arg === "--continue") {
        logger.debug("[Session] Consumed --continue flag");
        continue;
      }

      if (arg === "--resume") {
        // Check if next arg looks like a UUID (contains dashes and alphanumeric)
        if (i + 1 < this.claudeArgs.length) {
          const nextArg = this.claudeArgs[i + 1];
          // Simple UUID pattern check - contains dashes and is not another flag
          if (!nextArg.startsWith("-") && nextArg.includes("-")) {
            // Skip both --resume and the UUID
            i++; // Skip the UUID
            logger.debug(
              `[Session] Consumed --resume flag with session ID: ${nextArg}`,
            );
          } else {
            // Just --resume without UUID
            logger.debug("[Session] Consumed --resume flag (no session ID)");
          }
        } else {
          // --resume at the end of args
          logger.debug("[Session] Consumed --resume flag (no session ID)");
        }
        continue;
      }

      filteredArgs.push(arg);
    }

    this.claudeArgs = filteredArgs.length > 0 ? filteredArgs : undefined;
    logger.debug(
      `[Session] Consumed one-time flags, remaining args:`,
      this.claudeArgs,
    );
  };
}
