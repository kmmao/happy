/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from "./apiSocket";
import { sync } from "./sync";
import { storage } from "./storage";
import type { MachineMetadata } from "./storageTypes";
import { getErrorMessage } from "@/utils/errors";

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  allowTools?: string[];
  decision?: "approved" | "approved_for_session" | "denied" | "abort";
  /** User answers for AskUserQuestion — keyed by question text */
  answers?: Record<string, string>;
}

// Mode change operation types
interface SessionModeChangeRequest {
  to: "remote" | "local";
}

// Bash operation types
interface SessionBashRequest {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface SessionBashResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
  path: string;
}

interface SessionReadFileResponse {
  success: boolean;
  content?: string; // base64 encoded
  error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
  path: string;
  content: string; // base64 encoded
  expectedHash?: string | null;
}

interface SessionWriteFileResponse {
  success: boolean;
  hash?: string;
  error?: string;
}

// List directory operation types
interface SessionListDirectoryRequest {
  path: string;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
  modified?: number;
}

interface SessionListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
}

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
  path: string;
  maxDepth: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: number;
  children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
  args: string[];
  cwd?: string;
}

interface SessionRipgrepResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

// Kill session operation types
interface SessionKillRequest {
  // No parameters needed
}

interface SessionKillResponse {
  success: boolean;
  message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
  | { type: "success"; sessionId: string }
  | { type: "requestToApproveDirectoryCreation"; directory: string }
  | { type: "error"; errorMessage: string };

// Options for spawning a session
export interface SpawnSessionOptions {
  machineId: string;
  directory: string;
  approvedNewDirectoryCreation?: boolean;
  token?: string;
  agent?: "codex" | "claude" | "gemini";
  // Claude Code session ID for --resume (resumes an existing session with full context)
  claudeSessionId?: string;
  // Happy session ID for reconnecting to the same Happy session (preserves message history)
  happySessionId?: string;
  // Environment variables from AI backend profile
  // Accepts any environment variables - daemon will pass them to the agent process
  // Common variables include:
  // - ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL
  // - OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_TIMEOUT_MS
  // - AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT_NAME
  // - TOGETHER_API_KEY, TOGETHER_MODEL
  // - TMUX_SESSION_NAME, TMUX_TMPDIR, TMUX_UPDATE_ENVIRONMENT
  // - API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  // - Custom variables (DEEPSEEK_*, Z_AI_*, etc.)
  environmentVariables?: Record<string, string>;
}

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(
  options: SpawnSessionOptions,
): Promise<SpawnSessionResult> {
  const {
    machineId,
    directory,
    approvedNewDirectoryCreation = false,
    token,
    agent,
    claudeSessionId,
    happySessionId,
    environmentVariables,
  } = options;

  try {
    // Inject knowledge base settings as environment variables
    const settings = storage.getState().settings;
    const knowledgeEnvVars: Record<string, string> = {};
    knowledgeEnvVars.HAPPY_KNOWLEDGE_BASE = settings.knowledgeBase ? "true" : "false";
    knowledgeEnvVars.HAPPY_KNOWLEDGE_MODE = settings.knowledgeBaseMode;
    knowledgeEnvVars.HAPPY_KNOWLEDGE_SENSITIVITY = settings.knowledgeBaseSensitivity;
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS = String(settings.knowledgeBaseTrackFileEdits);
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_TOOL_CALLS = String(settings.knowledgeBaseTrackToolCalls);
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_TOKENS = String(settings.knowledgeBaseTrackTokens);

    // Caller env vars (e.g. from profile) take precedence over knowledge settings
    const mergedEnvironmentVariables = { ...knowledgeEnvVars, ...environmentVariables };

    const result = await apiSocket.machineRPC<
      SpawnSessionResult,
      {
        type: "spawn-in-directory";
        directory: string;
        approvedNewDirectoryCreation?: boolean;
        token?: string;
        agent?: "codex" | "claude" | "gemini";
        sessionId?: string;
        happySessionId?: string;
        environmentVariables?: Record<string, string>;
      }
    >(machineId, "spawn-happy-session", {
      type: "spawn-in-directory",
      directory,
      approvedNewDirectoryCreation,
      token,
      agent,
      sessionId: claudeSessionId,
      happySessionId,
      environmentVariables: mergedEnvironmentVariables,
    });
    return result;
  } catch (error) {
    // Handle RPC errors
    return {
      type: "error",
      errorMessage:
        getErrorMessage(error, "Failed to spawn session"),
    };
  }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(
  machineId: string,
): Promise<{ message: string }> {
  const result = await apiSocket.machineRPC<{ message: string }, {}>(
    machineId,
    "stop-daemon",
    {},
  );
  return result;
}

/**
 * Upgrade the CLI on a specific machine by running npm install -g.
 * Uses the bash RPC with a 3-minute timeout since npm install can be slow.
 * After success the daemon's heartbeat will detect the version mismatch
 * and auto-restart within ~60 seconds.
 */
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export async function machineUpgradeCli(
  machineId: string,
  targetVersion: string,
): Promise<MachineBashResult> {
  if (!VERSION_RE.test(targetVersion)) {
    return { success: false, error: `Invalid version format: ${targetVersion}` };
  }
  return machineBash(
    machineId,
    `npm install -g @kmmao/happy-coder@${targetVersion}`,
    "/",
    180_000, // 3 minutes — npm install can be slow
  );
}

/**
 * Scan a machine for git repositories and return their paths + remote URLs.
 */
export interface GitRepoEntry {
  readonly repoPath: string;
  readonly remoteUrl: string;
  readonly name: string;
}

export async function machineListGitRepos(
  machineId: string,
  scanPaths?: readonly string[],
): Promise<readonly GitRepoEntry[]> {
  const result = await apiSocket.machineRPC<
    { success: boolean; repos?: GitRepoEntry[]; error?: string },
    { scanPaths?: readonly string[] }
  >(machineId, "listGitRepos", { scanPaths });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to scan git repos");
  }
  return result.repos ?? [];
}

export interface CreateRemoteWebhookParams {
  readonly provider: string;
  readonly apiToken: string;
  readonly repoUrl: string;
  readonly webhookUrl: string;
  readonly webhookSecret: string;
  readonly events: readonly string[];
}

export interface CreateRemoteWebhookResult {
  readonly created: boolean;
  readonly webhookId?: number;
}

export async function machineCreateRemoteWebhook(
  machineId: string,
  params: CreateRemoteWebhookParams,
): Promise<CreateRemoteWebhookResult> {
  const result = await apiSocket.machineRPC<
    { success: boolean; created?: boolean; webhookId?: number; error?: string },
    CreateRemoteWebhookParams
  >(machineId, "createRemoteWebhook", params);

  if (!result.success) {
    throw new Error(result.error ?? "Failed to create remote webhook");
  }
  return { created: result.created ?? true, webhookId: result.webhookId };
}

export interface DeleteRemoteWebhookParams {
  readonly provider: string;
  readonly apiToken: string;
  readonly repoUrl: string;
  readonly webhookUrl: string;
}

export async function machineDeleteRemoteWebhook(
  machineId: string,
  params: DeleteRemoteWebhookParams,
): Promise<{ deleted: boolean }> {
  const result = await apiSocket.machineRPC<
    { success: boolean; deleted?: boolean; error?: string },
    DeleteRemoteWebhookParams
  >(machineId, "deleteRemoteWebhook", params);

  if (!result.success) {
    throw new Error(result.error ?? "Failed to delete remote webhook");
  }
  return { deleted: result.deleted ?? false };
}

/**
 * Execute a bash command on a specific machine
 */
export interface MachineBashResult {
  readonly success: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly error?: string;
}

export async function machineBash(
  machineId: string,
  command: string,
  cwd: string,
  timeout?: number,
): Promise<MachineBashResult> {
  try {
    const result = await apiSocket.machineRPC<
      MachineBashResult,
      {
        command: string;
        cwd: string;
        timeout?: number;
      }
    >(machineId, "bash", { command, cwd, ...(timeout != null && { timeout }) });
    return result;
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: getErrorMessage(error),
      exitCode: -1,
      error: getErrorMessage(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Tailscale Serve / Funnel management
// ---------------------------------------------------------------------------

function validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${port}`);
    }
}

export async function machineTailscaleServeAdd(
    machineId: string,
    localPort: number,
    httpsPort: number,
    path: string,
    funnel: boolean,
): Promise<MachineBashResult> {
    validatePort(localPort);
    validatePort(httpsPort);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const pathFlag = normalizedPath === "/" ? "" : ` --set-path=${normalizedPath}`;
    const target = `http://localhost:${localPort}`;
    const cmd = funnel
        ? `tailscale funnel --bg --https=${httpsPort}${pathFlag} ${target}`
        : `tailscale serve --bg --https=${httpsPort}${pathFlag} ${target}`;
    return machineBash(machineId, cmd, "/");
}

export async function machineTailscaleServeRemove(
    machineId: string,
    port: number,
    path?: string,
): Promise<MachineBashResult> {
    validatePort(port);
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    return machineBash(machineId, `tailscale serve --https=${port}${pathFlag} off`, "/");
}

export async function machineTailscaleFunnelToggle(
    machineId: string,
    httpsPort: number,
    enable: boolean,
    target: string,
    path?: string,
): Promise<MachineBashResult> {
    validatePort(httpsPort);
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    // Enable: re-create via `tailscale funnel` (adds funnel flag)
    // Disable: re-create via `tailscale serve` (removes funnel flag, keeps serve)
    const base = enable ? "tailscale funnel" : "tailscale serve";
    const cmd = `${base} --bg --https=${httpsPort}${pathFlag} ${target}`;
    return machineBash(machineId, cmd, "/");
}

export async function machineTailscaleServeStatus(
    machineId: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, "tailscale serve status --json", "/");
}

// ---------------------------------------------------------------------------
// UPnP port mapping management
// ---------------------------------------------------------------------------

export async function machineUpnpAdd(
    machineId: string,
    localPort: number,
    externalPort: number,
    protocol: "TCP" | "UDP" = "TCP",
): Promise<MachineBashResult> {
    validatePort(localPort);
    validatePort(externalPort);
    // upnpc needs the local LAN IP — get it dynamically
    const cmd = `LOCAL_IP=$(python3 -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()") && upnpc -a $LOCAL_IP ${localPort} ${externalPort} ${protocol} 7200`;
    return machineBash(machineId, cmd, "/");
}

export async function machineUpnpRemove(
    machineId: string,
    externalPort: number,
    protocol: "TCP" | "UDP" = "TCP",
): Promise<MachineBashResult> {
    validatePort(externalPort);
    return machineBash(machineId, `upnpc -d ${externalPort} ${protocol}`, "/");
}

export async function machineUpnpStatus(
    machineId: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, "upnpc -l", "/");
}

// ---------------------------------------------------------------------------
// Tunnel RPC (provider-agnostic, used by Caddy/UPnP/etc)
// ---------------------------------------------------------------------------

export interface TunnelRpcResult {
    success: boolean;
    error?: string;
    state?: any;
}

export async function machineTunnelAdd(
    machineId: string,
    provider: string,
    params: { localPort: number; path?: string; hostname?: string; remotePort?: number; protocol?: string; publicAccess?: boolean },
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-add", { provider, ...params },
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTunnelRemove(
    machineId: string,
    provider: string,
    params: { path?: string; hostname?: string; remotePort?: number; removeEntireSite?: boolean },
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-remove", { provider, ...params },
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTunnelDetect(
    machineId: string,
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-detect", {},
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

/** Allowed signals for machineKillProcess — whitelist to prevent abuse. */
const KILL_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT"]);

/**
 * Kill a process on a machine by PID.
 * Safety: PID must be > 1, signal must be in whitelist.
 */
export async function machineKillProcess(
    machineId: string,
    pid: number,
    signal: string = "SIGTERM",
): Promise<MachineBashResult> {
    if (!Number.isInteger(pid) || pid <= 1) {
        return { success: false, error: `Invalid PID: ${pid}` };
    }
    if (!KILL_SIGNALS.has(signal)) {
        return { success: false, error: `Invalid signal: ${signal}` };
    }
    return machineBash(machineId, `kill -s ${signal} ${pid}`, "/");
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
  machineId: string,
  metadata: MachineMetadata,
  expectedVersion: number,
  maxRetries: number = 3,
): Promise<{ version: number; metadata: string }> {
  let currentVersion = expectedVersion;
  let currentMetadata = { ...metadata };
  let retryCount = 0;

  const machineEncryption = sync.encryption.getMachineEncryption(machineId);
  if (!machineEncryption) {
    throw new Error(`Machine encryption not found for ${machineId}`);
  }

  while (retryCount < maxRetries) {
    const encryptedMetadata =
      await machineEncryption.encryptRaw(currentMetadata);

    const result = await apiSocket.emitWithAck<{
      result: "success" | "version-mismatch" | "error";
      version?: number;
      metadata?: string;
      message?: string;
    }>("machine-update-metadata", {
      machineId,
      metadata: encryptedMetadata,
      expectedVersion: currentVersion,
    });

    if (result.result === "success") {
      return {
        version: result.version!,
        metadata: result.metadata!,
      };
    } else if (result.result === "version-mismatch") {
      // Get the latest version and metadata from the response
      currentVersion = result.version!;
      const latestMetadata = (await machineEncryption.decryptRaw(
        result.metadata!,
      )) as MachineMetadata;

      // Merge our changes with the latest metadata
      // Preserve the displayName we're trying to set, but use latest values for other fields
      currentMetadata = {
        ...latestMetadata,
        displayName: metadata.displayName, // Keep our intended displayName change
      };

      retryCount++;

      // If we've exhausted retries, throw error
      if (retryCount >= maxRetries) {
        throw new Error(
          `Failed to update after ${maxRetries} retries due to version conflicts`,
        );
      }

      // Otherwise, loop will retry with updated version and merged metadata
    } else {
      throw new Error(result.message || "Failed to update machine metadata");
    }
  }

  throw new Error("Unexpected error in machineUpdateMetadata");
}

/**
 * Abort the current session operation (kills the process)
 */
export async function sessionAbort(sessionId: string): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "abort", {
    reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
  });
}

/**
 * Discover installed Claude Code plugins on the target machine (legacy session-based)
 */
export async function sessionDiscoverPlugins(
    sessionId: string,
): Promise<{ plugins: Array<{ name: string; path: string }> }> {
    try {
        return await apiSocket.sessionRPC<
            { plugins: Array<{ name: string; path: string }> },
            Record<string, never>
        >(sessionId, "discoverPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/** Plugin metadata returned by the enriched discoverPlugins RPC. */
export interface PluginMeta {
    readonly name: string;
    readonly path: string;
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly homepage?: string;
    readonly license?: string;
    readonly keywords?: readonly string[];
    readonly counts: { readonly commands: number; readonly skills: number; readonly agents: number };
    readonly subPlugins?: ReadonlyArray<{
        readonly name: string;
        readonly description?: string;
        readonly category?: string;
    }>;
}

/** Extended detail returned by inspectPlugin RPC. */
export interface PluginDetail extends PluginMeta {
    readonly commandList?: readonly string[];
    readonly skillList?: readonly string[];
    readonly agentList?: readonly string[];
}

/**
 * Discover installed Claude Code plugins via machine RPC (no active session required).
 */
export async function machineDiscoverPlugins(
    machineId: string,
): Promise<{ plugins: readonly PluginMeta[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly PluginMeta[] },
            Record<string, never>
        >(machineId, "discoverPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * Inspect a single plugin for full detail (commands/skills/agents lists).
 */
export async function machineInspectPlugin(
    machineId: string,
    pluginPath: string,
): Promise<PluginDetail | null> {
    try {
        return await apiSocket.machineRPC<PluginDetail, { path: string }>(
            machineId,
            "inspectPlugin",
            { path: pluginPath },
        );
    } catch {
        return null;
    }
}

/** An individual installed plugin (from installed_plugins.json + enabledPlugins). */
export interface InstalledPlugin {
    readonly key: string; // e.g. "frontend-design@claude-plugins-official"
    readonly name: string;
    readonly marketplace: string;
    readonly version: string;
    readonly enabled: boolean;
    readonly scope: string;
    readonly installPath: string;
    readonly installedAt: string;
    readonly lastUpdated: string;
    readonly installs?: number;
    readonly description?: string;
}

/** A marketplace source (from known_marketplaces.json). */
export interface MarketplaceInfo {
    readonly name: string;
    readonly repo: string;
    readonly installLocation: string;
    readonly lastUpdated: string;
    readonly autoUpdate: boolean;
    readonly availableCount: number;
    readonly installedCount: number;
}

/**
 * List truly installed plugins with enabled state and descriptions.
 */
export async function machineListInstalledPlugins(
    machineId: string,
): Promise<{ plugins: readonly InstalledPlugin[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly InstalledPlugin[] },
            Record<string, never>
        >(machineId, "listInstalledPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * List marketplace sources with available/installed counts.
 */
export async function machineListMarketplaces(
    machineId: string,
): Promise<{ marketplaces: readonly MarketplaceInfo[] }> {
    try {
        return await apiSocket.machineRPC<
            { marketplaces: readonly MarketplaceInfo[] },
            Record<string, never>
        >(machineId, "listMarketplaces", {});
    } catch {
        return { marketplaces: [] };
    }
}

/** An available plugin from a marketplace (for Discover UI). */
export interface AvailablePlugin {
    readonly name: string;
    readonly key: string; // "plugin-name@marketplace"
    readonly marketplace: string;
    readonly description?: string;
    readonly category?: string;
    readonly homepage?: string;
    readonly installed: boolean;
    readonly enabled: boolean;
    readonly installs?: number;
}

/**
 * List all available plugins from all marketplaces (for Discover UI).
 */
export async function machineListAvailablePlugins(
    machineId: string,
): Promise<{ plugins: readonly AvailablePlugin[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly AvailablePlugin[] },
            Record<string, never>
        >(machineId, "listAvailablePlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * Execute a plugin action via `claude plugin <action> <key>`.
 */
export async function machinePluginAction(
    machineId: string,
    action: "install" | "uninstall" | "enable" | "disable" | "update" | "marketplace-update" | "marketplace-add",
    pluginKey: string,
): Promise<MachineBashResult> {
    // Use "/" as cwd — bash handler treats it as "use shell default" (respects user's PATH)
    if (action === "marketplace-update") {
        return machineBash(machineId, `claude plugin marketplace update "${pluginKey}"`, "/");
    }
    if (action === "marketplace-add") {
        return machineBash(machineId, `claude plugin marketplace add "${pluginKey}"`, "/");
    }
    return machineBash(machineId, `claude plugin ${action} "${pluginKey}"`, "/");
}

// ── MCP Server Management ──

/** A configured MCP server. */
export interface McpServerInfo {
    readonly name: string;
    readonly command: string;
    readonly status: "connected" | "disconnected" | "error";
}

/**
 * List all configured MCP servers with connection status.
 */
export async function machineListMcpServers(
    machineId: string,
): Promise<{ servers: readonly McpServerInfo[] }> {
    try {
        return await apiSocket.machineRPC<
            { servers: readonly McpServerInfo[] },
            Record<string, never>
        >(machineId, "listMcpServers", {});
    } catch {
        return { servers: [] };
    }
}

/**
 * Add an MCP server via `claude mcp add`.
 */
export async function machineMcpAdd(
    machineId: string,
    name: string,
    command: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, `claude mcp add -s user ${name} -- ${command}`, "/");
}

/**
 * Remove an MCP server via `claude mcp remove`.
 */
export async function machineMcpRemove(
    machineId: string,
    name: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, `claude mcp remove "${name}" -s user`, "/");
}

/** A curated MCP server from the catalog. */
export interface AvailableMcpServer {
    readonly name: string;
    readonly pkg: string;
    readonly description: string;
    readonly category: string;
    readonly envHint?: string;
    readonly installed: boolean;
}

/**
 * List curated MCP servers with install status.
 */
export async function machineListAvailableMcpServers(
    machineId: string,
): Promise<{ servers: readonly AvailableMcpServer[] }> {
    try {
        return await apiSocket.machineRPC<
            { servers: readonly AvailableMcpServer[] },
            Record<string, never>
        >(machineId, "listAvailableMcpServers", {});
    } catch {
        return { servers: [] };
    }
}

/**
 * Interrupt the current session operation (graceful, keeps process alive)
 */
export async function sessionInterrupt(sessionId: string): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "interrupt", {});
}

/**
 * Stop a specific background task
 */
export async function sessionStopTask(
  sessionId: string,
  taskId: string,
): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "stopTask", { taskId });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(
  sessionId: string,
  id: string,
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan",
  allowedTools?: string[],
  decision?: "approved" | "approved_for_session",
  answers?: Record<string, string>,
): Promise<void> {
  // Clear needsAttention when user handles a permission request
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  const request: SessionPermissionRequest = {
    id,
    approved: true,
    mode,
    allowTools: allowedTools,
    decision,
    ...(answers && { answers }),
  };
  await apiSocket.sessionRPC(sessionId, "permission", request);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(
  sessionId: string,
  id: string,
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan",
  allowedTools?: string[],
  decision?: "denied" | "abort",
  reason?: string,
): Promise<void> {
  // Clear needsAttention when user handles a permission request
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  const request: SessionPermissionRequest = {
    id,
    approved: false,
    mode,
    allowTools: allowedTools,
    decision,
    reason,
  };
  await apiSocket.sessionRPC(sessionId, "permission", request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(
  sessionId: string,
  to: "remote" | "local",
): Promise<boolean> {
  const request: SessionModeChangeRequest = { to };
  const response = await apiSocket.sessionRPC<
    boolean,
    SessionModeChangeRequest
  >(sessionId, "switch", request);
  return response;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(
  sessionId: string,
  request: SessionBashRequest,
): Promise<SessionBashResponse> {
  try {
    const response = await apiSocket.sessionRPC<
      SessionBashResponse,
      SessionBashRequest
    >(sessionId, "bash", request);
    return response;
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: getErrorMessage(error),
      exitCode: -1,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Subscribe to real-time log streaming for a background task.
 * CLI will start watching the output file and push incremental chunks.
 */
export async function subscribeTaskLog(
    sessionId: string,
    taskId: string,
    outputFile: string,
): Promise<{ ok: boolean; already?: boolean }> {
    try {
        return await apiSocket.sessionRPC<
            { ok: boolean; already?: boolean },
            { taskId: string; outputFile: string }
        >(sessionId, "subscribeTaskLog", { taskId, outputFile });
    } catch {
        return { ok: false };
    }
}

/**
 * Unsubscribe from real-time log streaming for a background task.
 */
export async function unsubscribeTaskLog(
    sessionId: string,
    taskId: string,
): Promise<{ ok: boolean }> {
    try {
        return await apiSocket.sessionRPC<
            { ok: boolean },
            { taskId: string }
        >(sessionId, "unsubscribeTaskLog", { taskId });
    } catch {
        return { ok: false };
    }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(
  sessionId: string,
  path: string,
): Promise<SessionReadFileResponse> {
  try {
    const request: SessionReadFileRequest = { path };
    const response = await apiSocket.sessionRPC<
      SessionReadFileResponse,
      SessionReadFileRequest
    >(sessionId, "readFile", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
  sessionId: string,
  path: string,
  content: string,
  expectedHash?: string | null,
): Promise<SessionWriteFileResponse> {
  try {
    const request: SessionWriteFileRequest = { path, content, expectedHash };
    const response = await apiSocket.sessionRPC<
      SessionWriteFileResponse,
      SessionWriteFileRequest
    >(sessionId, "writeFile", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(
  sessionId: string,
  path: string,
): Promise<SessionListDirectoryResponse> {
  try {
    const request: SessionListDirectoryRequest = { path };
    const response = await apiSocket.sessionRPC<
      SessionListDirectoryResponse,
      SessionListDirectoryRequest
    >(sessionId, "listDirectory", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
  sessionId: string,
  path: string,
  maxDepth: number,
): Promise<SessionGetDirectoryTreeResponse> {
  try {
    const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
    const response = await apiSocket.sessionRPC<
      SessionGetDirectoryTreeResponse,
      SessionGetDirectoryTreeRequest
    >(sessionId, "getDirectoryTree", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
  sessionId: string,
  args: string[],
  cwd?: string,
): Promise<SessionRipgrepResponse> {
  try {
    const request: SessionRipgrepRequest = { args, cwd };
    const response = await apiSocket.sessionRPC<
      SessionRipgrepResponse,
      SessionRipgrepRequest
    >(sessionId, "ripgrep", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Kill the session process immediately
 */
export async function sessionKill(
  sessionId: string,
): Promise<SessionKillResponse> {
  try {
    const response = await apiSocket.sessionRPC<SessionKillResponse, {}>(
      sessionId,
      "killSession",
      {},
    );
    return response;
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 */
export async function sessionDelete(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || "Failed to delete session",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

/**
 * Restore an archived session back to active state
 */
export async function sessionRestore(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}/restore`, {
      method: "PATCH",
    });

    if (response.ok) {
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || "Failed to restore session",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

// Export types for external use
export type {
  SessionBashRequest,
  SessionReadFileResponse,
  SessionWriteFileResponse,
  SessionListDirectoryResponse,
  SessionGetDirectoryTreeResponse,
  TreeNode,
  SessionRipgrepResponse,
  SessionKillResponse,
  PlanFileContentResponse,
};

/**
 * Response type for getPlanFileContent RPC
 */
interface PlanFileContentResponse {
    content: string | null;
    filePath: string | null;
}

/**
 * Fetch the saved plan file content from the CLI
 */
export async function sessionGetPlanFileContent(
    sessionId: string,
): Promise<PlanFileContentResponse> {
    try {
        const response = await apiSocket.sessionRPC<
            PlanFileContentResponse,
            Record<string, never>
        >(sessionId, "getPlanFileContent", {});
        return response;
    } catch {
        return { content: null, filePath: null };
    }
}

interface CancelQueuedMessageResponse {
    cancelled: boolean;
}

/**
 * Cancel a queued message that hasn't been processed yet
 */
export async function sessionCancelQueuedMessage(
    sessionId: string,
    localKey: string,
): Promise<boolean> {
    try {
        const response = await apiSocket.sessionRPC<
            CancelQueuedMessageResponse,
            { localKey: string }
        >(sessionId, "cancelQueuedMessage", { localKey });
        return response.cancelled;
    } catch {
        return false;
    }
}

/**
 * Fork a session from a specific point, creating a new session with context up to that message
 */
export async function sessionForkSession(
    sessionId: string,
    opts: { upToMessageId?: string; title?: string },
): Promise<{ claudeSessionId: string; path: string } | { error: string }> {
    try {
        const response = await apiSocket.sessionRPC<
            { claudeSessionId?: string; path?: string; error?: string },
            { upToMessageId?: string; title?: string }
        >(sessionId, "forkSession", opts);
        if (response.error || !response.claudeSessionId || !response.path) {
            return { error: response.error ?? "Fork failed" };
        }
        return { claudeSessionId: response.claudeSessionId, path: response.path };
    } catch (err) {
        return { error: err instanceof Error ? err.message : "Fork failed" };
    }
}

/**
 * Rewind files to their state at a specific user message.
 * Call with dryRun=true first to preview changes, then dryRun=false to execute.
 */
export async function sessionRewindFiles(
    sessionId: string,
    userMessageId: string,
    dryRun: boolean,
): Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
}> {
    try {
        return await apiSocket.sessionRPC<
            { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number },
            { userMessageId: string; dryRun: boolean }
        >(sessionId, "rewindFiles", { userMessageId, dryRun });
    } catch (err) {
        return { canRewind: false, error: err instanceof Error ? err.message : "Rewind failed" };
    }
}

/**
 * Respond to an MCP elicitation request
 */
export async function sessionElicitationResponse(
    sessionId: string,
    elicitationId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
): Promise<void> {
    try {
        await apiSocket.sessionRPC<void, { id: string; action: string; content?: Record<string, unknown> }>(
            sessionId,
            "elicitationResponse",
            { id: elicitationId, action, content },
        );
    } catch {
        // Best-effort — elicitation may have already been cancelled
    }
}
