/**
 * Session Metadata Factory
 *
 * Creates session state and metadata objects for all backends (Claude, Codex, Gemini).
 * This follows DRY principles by providing a single implementation for all backends.
 *
 * @module createSessionMetadata
 */

import os from "node:os";
import { resolve } from "node:path";

import type { AgentState, Metadata } from "@/api/types";
import { configuration } from "@/configuration";
import { projectPath } from "@/projectPath";
import type { SandboxConfig } from "@/persistence";
import { detectWorktreeInfo } from "@/utils/detectWorktreeInfo";
import { logger } from "@/ui/logger";
import packageJson from "../../package.json";

/**
 * Backend flavor identifier for session metadata.
 */
export type BackendFlavor = "claude" | "codex" | "gemini" | "opencode" | "acp";

/**
 * Options for creating session metadata.
 */
export interface CreateSessionMetadataOptions {
  /** Backend flavor (claude, codex, gemini) */
  flavor: BackendFlavor;
  /** Machine ID for server identification */
  machineId: string;
  /** How the session was started */
  startedBy?: "daemon" | "terminal";
  /** Active sandbox config for the session, or undefined when not used */
  sandbox?: SandboxConfig;
  /** Whether the backend runs with "dangerously skip permissions" behavior */
  dangerouslySkipPermissions?: boolean;
}

/**
 * Result containing both state and metadata for session creation.
 */
export interface SessionMetadataResult {
  /** Agent state for session */
  state: AgentState;
  /** Session metadata */
  metadata: Metadata;
}

/**
 * Creates session state and metadata for backend agents.
 *
 * This utility consolidates the common session metadata creation logic used by
 * Codex and Gemini backends, ensuring consistency across all backend implementations.
 *
 * @param opts - Options specifying flavor, machineId, and startedBy
 * @returns Object containing state and metadata for session creation
 *
 * @example
 * ```typescript
 * const { state, metadata } = createSessionMetadata({
 *     flavor: 'gemini',
 *     machineId: settings.machineId,
 *     startedBy: opts.startedBy
 * });
 *
 * const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
 * ```
 */
export function createSessionMetadata(
  opts: CreateSessionMetadataOptions,
): SessionMetadataResult {
  const state: AgentState = {
    controlledByUser: false,
  };

  const metadata: Metadata = {
    path: process.cwd(),
    host: os.hostname(),
    version: packageJson.version,
    os: os.platform(),
    machineId: opts.machineId,
    homeDir: os.homedir(),
    happyHomeDir: configuration.happyHomeDir,
    happyLibDir: projectPath(),
    happyToolsDir: resolve(projectPath(), "tools", "unpacked"),
    startedFromDaemon: opts.startedBy === "daemon",
    hostPid: process.pid,
    startedBy: opts.startedBy || "terminal",
    lifecycleState: "running",
    lifecycleStateSince: Date.now(),
    flavor: opts.flavor,
    sessionSummaryRefresh: {
      protocolVersion: 1,
      recent: [],
    },
    ...(opts.flavor === "codex"
      ? {
          codex: {
            requestedBackend: "codex-mcp-legacy" as const,
            resolvedBackend: "codex-mcp-legacy" as const,
            configMode: "inherit" as const,
          },
        }
      : {}),
    sandbox: opts.sandbox?.enabled ? opts.sandbox : null,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? null,
    ...(process.env.HAPPY_SESSION_NAME?.trim()
      ? { displayName: process.env.HAPPY_SESSION_NAME.trim() }
      : {}),
    ...(process.env.HAPPY_SESSION_TAGS?.trim()
      ? {
          tags: process.env.HAPPY_SESSION_TAGS.split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }
      : {}),
    ...parseAutomationContextEnv(),
  };

  return { state, metadata };
}

/**
 * Reconstruct `Metadata.automationContext` from the daemon-injected
 * `HAPPY_AUTOMATION_CONTEXT_JSON` env var. The daemon JSON-encodes the
 * SpawnSessionOptions.automationContext for every automation-spawned
 * session — see daemon's `finalSessionEnv` builder in startDaemon.ts.
 *
 * Returns an empty object (so spread becomes a no-op) when:
 *  - the env var is absent (terminal-started sessions)
 *  - the payload is empty / unparseable
 *  - the payload is missing the discriminator `kind`
 *
 * Unknown future automation kinds parse through verbatim — we only gate
 * on shape, not on the kind enum, so a newer daemon doesn't lose its
 * automationContext when paired with an older happy CLI.
 */
function parseAutomationContextEnv(): Pick<Metadata, "automationContext"> | {} {
  const raw = process.env.HAPPY_AUTOMATION_CONTEXT_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.kind !== "string"
    ) {
      return {};
    }
    return { automationContext: parsed as Metadata["automationContext"] };
  } catch (error) {
    logger.debug(
      `[SESSION] Failed to parse HAPPY_AUTOMATION_CONTEXT_JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}

/**
 * Enrich metadata with worktree information if running inside a Happy-managed worktree.
 * Call this after createSessionMetadata() for backends that use it.
 */
export async function enrichMetadataWithWorktree(
  metadata: Metadata,
): Promise<Metadata> {
  const worktreeInfo = await detectWorktreeInfo(metadata.path);
  if (!worktreeInfo) {
    return metadata;
  }

  logger.debug(
    `[SESSION] Detected worktree: ${worktreeInfo.name} (branch: ${worktreeInfo.branchName}, parent: ${worktreeInfo.parentBranch})`,
  );

  return {
    ...metadata,
    worktree: {
      ...worktreeInfo,
      state: "active",
      stateChangedAt: Date.now(),
    },
  };
}
