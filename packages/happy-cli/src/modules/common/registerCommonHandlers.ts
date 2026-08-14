import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";
import type { ResolvedRuntimeProfile, SpawnSessionResult } from "@kmmao/happy-wire";
import { registerFilesystemHandlers } from "./registerFilesystemHandlers";
import { registerSearchHandlers } from "./registerSearchHandlers";
import { registerGitHandlers } from "./registerGitHandlers";
import { registerPluginHandlers } from "./registerPluginHandlers";
import { registerMcpHandlers } from "./registerMcpHandlers";

// SpawnSessionResult is the cross-process result of the `spawn-happy-session`
// RPC — its single source of truth lives in happy-wire. Re-exported here so the
// daemon/automation call sites that already import it from this module keep working.
export type { SpawnSessionResult };

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
 */

export interface SpawnSessionOptions {
  machineId?: string;
  directory: string;
  sessionId?: string;
  approvedNewDirectoryCreation?: boolean;
  agent?: "claude" | "codex" | "gemini";
  token?: string;
  /** Happy session ID for reconnecting to an existing session (or pre-allocating one for fork) */
  happySessionId?: string;
  /** Source session ID when this spawn is a fork — written as --happy-fork-source in the process command */
  forkSourceId?: string;
  /** Profile ID from GUI — if it matches a locally configured profile, operator-only env vars are trusted */
  profileId?: string;
  /** Unified runtime profile contract resolved by App/Server before session spawn. */
  runtimeProfile?: ResolvedRuntimeProfile;
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
    loopId?: string;
    dedupeKey?: string;
  };
  environmentVariables?: {
    // Anthropic Claude API configuration
    ANTHROPIC_BASE_URL?: string; // Custom API endpoint (overrides default)
    ANTHROPIC_AUTH_TOKEN?: string; // API authentication token
    ANTHROPIC_MODEL?: string; // Model to use (e.g., claude-3-5-sonnet-20241022)

    // Tmux session management environment variables
    // Based on tmux(1) manual and common tmux usage patterns
    TMUX_SESSION_NAME?: string; // Name for tmux session (creates/attaches to named session)
    TMUX_TMPDIR?: string; // Temporary directory for tmux server socket files
    // Note: TMUX_TMPDIR is used by tmux to store socket files when default /tmp is not suitable
    // Common use case: When /tmp has limited space or different permissions

    // Webhook-triggered session: path to a file containing the initial prompt
    HAPPY_INITIAL_PROMPT_FILE?: string;

    // Allow arbitrary env vars for supervisor and other use cases
    [key: string]: string | undefined;
  };
}

/**
 * Register all common RPC handlers with the session.
 *
 * This is a thin orchestrator: each handler group owns its interfaces, helpers,
 * and (where needed) caches in a dedicated `register*Handlers` module. The split
 * keeps each group's complexity local and lets every group be reasoned about —
 * and tested — through its own register entry point.
 *
 * `workingDirectory` scopes file/shell RPCs to a workspace. Session-scoped
 * callers pass the session's path; machine-scoped (daemon) callers pass
 * null — the daemon serves the whole machine and its process.cwd() is just
 * wherever it happened to be started from, not a meaningful boundary.
 */
export function registerCommonHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string | null,
  sessionId: string,
) {
  // Sanitize sessionId to prevent path traversal when used in filesystem paths
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");

  registerFilesystemHandlers(rpcHandlerManager, workingDirectory, safeSessionId);
  registerSearchHandlers(rpcHandlerManager, workingDirectory);
  registerGitHandlers(rpcHandlerManager);
  registerPluginHandlers(rpcHandlerManager, workingDirectory);
  registerMcpHandlers(rpcHandlerManager);
}
