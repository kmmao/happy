import * as React from "react";
import { Session } from "@/sync/storageTypes";
import type { TerminalLiveStatus } from "@/sync/storage";
import { t } from "@/text";
import { getSessionDisplayModelLabel } from "@/utils/sessionModelLabel";

// Re-exported from a dependency-free leaf so the store's message-fold path can
// import the preview helper without pulling in @/text (and react-native).
export {
  getLatestUserRequestPreview,
  type LatestUserRequestPreview,
} from "@/utils/latestUserRequestPreview";

export type SessionState =
  | "disconnected"
  | "thinking"
  | "waiting"
  | "permission_required"
  | "needs_attention"
  | "workflow";

export interface SessionStatus {
  state: SessionState;
  isConnected: boolean;
  statusText: string;
  shouldShowStatus: boolean;
  statusColor: string;
  statusDotColor: string;
  isPulsing?: boolean;
}

export function isSessionRunning(session: Session): boolean {
  return session.sdkSessionState != null
    ? session.sdkSessionState === "running"
    : session.thinking === true;
}

export function shouldClearQueuedMessagesOnTransition(input: {
  prevIsRunning: boolean;
  nextIsRunning: boolean;
  nextSdkSessionState?: Session["sdkSessionState"];
}): boolean {
  if (!input.prevIsRunning || input.nextIsRunning) {
    return false;
  }
  return input.nextSdkSessionState !== "requires_action";
}

export function getSessionStatusState(session: Session): SessionState {
  const isOnline = session.presence === "online";
  const hasPermissions =
    session.agentState?.requests &&
    Object.keys(session.agentState.requests).length > 0
      ? true
      : false;

  if (!isOnline) {
    return "disconnected";
  }

  if (hasPermissions) {
    return "permission_required";
  }

  if (session.sdkSessionState === "requires_action" && !hasPermissions) {
    return "needs_attention";
  }

  if (isSessionRunning(session)) {
    return "thinking";
  }

  if (session.needsAttention) {
    return "needs_attention";
  }

  return "waiting";
}

export function formatApiRetryStatus(apiRetry: {
  attempt: number;
  maxRetries: number;
  retryDelayMs: number;
  errorStatus?: number | null;
}): string {
  const retryDelaySeconds = Math.max(0, Math.ceil(apiRetry.retryDelayMs / 1000));
  // Claude Code 2.1.150 split overloaded (529) out of rate_limit (429). Both
  // still mean "wait then retry" from the user's perspective, so we surface
  // them with the same "rate limited" copy and avoid a translation churn
  // until the desktop/app text differentiates the two.
  return t("status.apiRetry", {
    attempt: apiRetry.attempt,
    maxRetries: apiRetry.maxRetries,
    retryDelaySeconds,
    isRateLimit:
      apiRetry.errorStatus === 429 || apiRetry.errorStatus === 529,
  });
}

/**
 * Delay (ms) before committing a transition away from "thinking".
 * Timer starts when rawState first leaves "thinking"; if rawState
 * bounces back to "thinking" before the timer fires, the timer is
 * cancelled and we stay in "thinking".
 *
 * Only "soft" exits are debounced (waiting, needs_attention).
 * Hard exits (disconnected, permission_required) pass through immediately
 * because they require user attention.
 */
const THINKING_EXIT_DELAY_MS = 1500;

/** States that must pass through immediately even when leaving "thinking". */
const IMMEDIATE_EXIT_STATES: ReadonlySet<SessionState> = new Set([
  "disconnected",
  "permission_required",
]);

/**
 * Get the current state of a session based on presence and thinking status.
 * Uses centralized session state from storage.ts
 */
export function useSessionStatus(session: Session): SessionStatus {
  const rawState = getSessionStatusState(session);

  // Debounce exits from "thinking": when rawState leaves "thinking" for a
  // soft state (waiting / needs_attention), hold for THINKING_EXIT_DELAY_MS.
  // If rawState bounces back to "thinking" before the timer fires, cancel.
  // Hard states (disconnected, permission_required) pass through immediately.
  const [debouncedState, setDebouncedState] = React.useState(rawState);
  const debouncedStateRef = React.useRef(debouncedState);
  debouncedStateRef.current = debouncedState;
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTargetRef = React.useRef<SessionState | null>(null);

  React.useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingTargetRef.current = null;
    }

    if (rawState === "thinking") {
      // Enter or stay in thinking — apply immediately
      setDebouncedState("thinking");
    } else if (debouncedStateRef.current === "thinking") {
      // Leaving thinking — check if this exit needs debouncing
      if (IMMEDIATE_EXIT_STATES.has(rawState)) {
        // Hard exit: user action needed, pass through now
        setDebouncedState(rawState);
      } else {
        // Soft exit (waiting / needs_attention): debounce
        pendingTargetRef.current = rawState;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          const target = pendingTargetRef.current;
          pendingTargetRef.current = null;
          if (target) setDebouncedState(target);
        }, THINKING_EXIT_DELAY_MS);
      }
    } else {
      // Not currently in thinking — apply immediately
      setDebouncedState(rawState);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingTargetRef.current = null;
      }
    };
  }, [rawState]);

  const currentState = debouncedState;
  const isEffectivelyRunning = currentState === "thinking";

  // Derive a stable index from session ID + a counter that increments
  // each time the *debounced* running state changes, so the word updates
  // per real turn boundary but stays stable during mid-turn bouncing.
  const thinkingGeneration = React.useRef(0);
  const prevRunning = React.useRef(isEffectivelyRunning);
  if (isEffectivelyRunning !== prevRunning.current) {
    prevRunning.current = isEffectivelyRunning;
    thinkingGeneration.current += 1;
  }
  const generation = thinkingGeneration.current;

  const vibingMessage = React.useMemo(() => {
    let hash = 0;
    const seed = `${session.id}:${generation}`;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    const index = Math.abs(hash) % vibingMessages.length;
    return vibingMessages[index].toLowerCase() + "…";
  }, [session.id, generation]);

  if (currentState === "disconnected") {
    return {
      state: "disconnected",
      isConnected: false,
      statusText: t("status.lastSeen", {
        time: formatLastSeen(session.activeAt, false),
      }),
      shouldShowStatus: true,
      statusColor: "#999",
      statusDotColor: "#999",
    };
  }

  if (currentState === "permission_required") {
    return {
      state: "permission_required",
      isConnected: true,
      statusText: t("status.permissionRequired"),
      shouldShowStatus: true,
      statusColor: "#FF9500",
      statusDotColor: "#FF9500",
      isPulsing: true,
    };
  }

  if (currentState === "needs_attention") {
    return {
      state: "needs_attention",
      isConnected: true,
      statusText: t("status.needsAttention"),
      shouldShowStatus: true,
      statusColor: "#FF9500",
      statusDotColor: "#FF9500",
      isPulsing: true,
    };
  }

  if (currentState === "thinking") {
    if (session.apiRetry) {
      return {
        state: "thinking",
        isConnected: true,
        statusText: formatApiRetryStatus(session.apiRetry),
        shouldShowStatus: true,
        statusColor: "#FF9500",
        statusDotColor: "#FF9500",
        isPulsing: true,
      };
    }
    return {
      state: "thinking",
      isConnected: true,
      statusText: vibingMessage,
      shouldShowStatus: true,
      statusColor: "#007AFF",
      statusDotColor: "#007AFF",
      isPulsing: true,
    };
  }

  return {
    state: "waiting",
    isConnected: true,
    statusText: t("status.ready"),
    shouldShowStatus: false,
    statusColor: "#34C759",
    statusDotColor: "#34C759",
  };
}

/**
 * Overlays a "workflow" status when one or more Workflow runs are executing in
 * the background. A running workflow is the session's notable activity, so it
 * takes precedence over the idle "waiting" (ready) and "thinking" states — but
 * never over states that demand the user's attention (permission_required /
 * needs_attention) or a lost connection (disconnected).
 */
export function applyRunningWorkflowStatus(
  status: SessionStatus,
  hasRunningWorkflow: boolean,
): SessionStatus {
  if (!hasRunningWorkflow) {
    return status;
  }
  if (status.state !== "waiting" && status.state !== "thinking") {
    return status;
  }
  return {
    state: "workflow",
    isConnected: true,
    statusText: t("status.workflow"),
    shouldShowStatus: true,
    statusColor: "#5856D6",
    statusDotColor: "#5856D6",
    isPulsing: true,
  };
}

/**
 * Extracts a display name from a session's metadata path.
 * Returns the last segment of the path, or 'unknown' if no path is available.
 */
export function getSessionName(session: Session): string {
  const forkPrefix = session.forkedFromSessionId ? "🔀 " : "";
  if (session.metadata?.displayName) {
    return forkPrefix + session.metadata.displayName;
  } else if (session.metadata?.summary) {
    return forkPrefix + session.metadata.summary.text;
  } else if (session.metadata) {
    const segments = session.metadata.path.split("/").filter(Boolean);
    const lastSegment = segments.pop();
    if (!lastSegment) {
      return forkPrefix + t("status.unknown");
    }
    return forkPrefix + lastSegment;
  }
  return t("status.unknown");
}

/**
 * Generates a deterministic avatar ID from machine ID and path.
 * This ensures the same machine + path combination always gets the same avatar.
 */
export function getSessionAvatarId(session: Session): string {
  if (session.metadata?.machineId && session.metadata?.path) {
    // Combine machine ID and path for a unique, deterministic avatar
    return `${session.metadata.machineId}:${session.metadata.path}`;
  }
  // Fallback to session ID if metadata is missing
  return session.id;
}

/**
 * Formats a path relative to home directory if possible.
 * If the path starts with the home directory, replaces it with ~
 * Otherwise returns the full path.
 */
export function formatPathRelativeToHome(
  path: string,
  homeDir?: string,
): string {
  if (!homeDir) return path;

  // Normalize paths to handle trailing slashes
  const normalizedHome = homeDir.endsWith("/") ? homeDir.slice(0, -1) : homeDir;
  const normalizedPath = path;

  // Check if path starts with home directory
  if (normalizedPath.startsWith(normalizedHome)) {
    // Replace home directory with ~
    const relativePath = normalizedPath.slice(normalizedHome.length);
    // Add ~ and ensure there's a / after it if needed
    if (relativePath.startsWith("/")) {
      return "~" + relativePath;
    } else if (relativePath === "") {
      return "~";
    } else {
      return "~/" + relativePath;
    }
  }

  return path;
}

/**
 * Format a live TUI status (from `useSessionTerminalStatus`) into a one-line
 * subtitle, e.g. `Reasoning… · 12s · 1.2k tokens · 45%`. Returns null when
 * there is nothing meaningful to show — callers fall back to the terminal
 * title / static path. While a picker is pending the captured picker snippet
 * wins, so the user sees what the TUI is waiting on.
 *
 * Only call this for sessions that are currently running
 * (`isSessionRunning`): the status is a trailing snapshot and goes stale the
 * moment the turn ends.
 */
export function formatTerminalLiveStatus(
  status: TerminalLiveStatus | null,
): string | null {
  if (!status) return null;
  if (status.pickerPending) {
    // Keyboard glyph marks "blocked waiting for a choice" — a universal,
    // i18n-free badge that renders on every platform. The captured picker
    // snippet shows what the TUI is asking; fall back to the last verb when
    // detection fired before a snippet was captured.
    const detail = status.pickerSnippet ?? (status.verb ? `${status.verb}…` : "");
    return `⌨ ${detail}`.trim();
  }
  const parts: string[] = [];
  if (status.verb) parts.push(`${status.verb}…`);
  if (typeof status.seconds === "number") parts.push(`${status.seconds}s`);
  if (typeof status.tokens === "number") {
    parts.push(
      status.tokens >= 1000
        ? `${(status.tokens / 1000).toFixed(1)}k tokens`
        : `${status.tokens} tokens`,
    );
  }
  if (
    typeof status.progressValue === "number" &&
    (status.progressState === "normal" ||
      status.progressState === "error" ||
      status.progressState === "paused")
  ) {
    parts.push(`${Math.round(status.progressValue)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Returns the session path for the subtitle.
 * For worktree sessions, shows branch → parent branch instead of path.
 */
export function getSessionSubtitle(
  session: Session,
  terminalTitle?: string | null,
): string {
  // A TUI-supplied window title (via the `terminal-signal` wire event) takes
  // priority over the static project path: the user's hook may be surfacing
  // a build status, current task name, or progress indicator that is much
  // more informative than the cwd. Worktree sessions still prefer their
  // branch arrow because that's a user-facing identifier the TUI never has
  // a more accurate version of.
  const trimmedTerminalTitle =
    typeof terminalTitle === "string" ? terminalTitle.trim() : "";
  if (
    trimmedTerminalTitle.length > 0 &&
    !session.metadata?.worktree?.isWorktree
  ) {
    return trimmedTerminalTitle;
  }

  if (session.metadata) {
    // For worktree sessions, show branch info
    if (session.metadata.worktree?.isWorktree) {
      const { branchName, parentBranch } = session.metadata.worktree;
      return `${branchName} → ${parentBranch}`;
    }

    const path = formatPathRelativeToHome(
      session.metadata.path,
      session.metadata.homeDir,
    );
    if (session.metadata.startedBy === "daemon") {
      return `${path} · ${t("session.startedByDaemon")}`;
    }
    return path;
  }
  return t("status.unknown");
}

/**
 * Resolves the canonical provider key for a session.
 */
export function getSessionProviderKey(session: Session): string {
  const profileCandidates = [
    session.profileId?.toLowerCase(),
    session.profileName?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const candidate of profileCandidates) {
    if (candidate.includes("deepseek")) return "deepseek";
    if (
      candidate === "zai" ||
      candidate.includes("z.ai") ||
      candidate.includes("chatglm")
    ) {
      return "zai";
    }
    if (candidate.includes("minimax")) return "minimax";
    if (candidate.includes("kimi") || candidate.includes("moonshot")) {
      return "kimi";
    }
    if (candidate.includes("azure-openai")) return "azure-openai";
    if (candidate.includes("azure") && candidate.includes("openai")) {
      return "azure-openai";
    }
    if (
      candidate.includes("openai") ||
      candidate.includes("codex") ||
      candidate.includes("gpt")
    ) {
      return "codex";
    }
    if (candidate.includes("gemini")) return "gemini";
    if (
      candidate.includes("anthropic") ||
      candidate.includes("claude")
    ) {
      return "claude";
    }
    if (candidate.includes("opencode")) return "opencode";
    if (candidate === "acp") return "acp";
  }

  const flavor = session.metadata?.flavor?.toLowerCase();
  switch (flavor) {
    case "gpt":
    case "openai":
      return "codex";
    case "codex":
    case "gemini":
    case "opencode":
    case "acp":
      return flavor;
    case "claude":
      return "claude";
    case undefined:
    case null: {
      const model = session.resolvedModelId?.toLowerCase() ?? "";
      if (model.includes("gpt") || model.includes("o3-") || model.includes("o4-")) return "codex";
      if (model.includes("gemini")) return "gemini";
      return "claude";
    }
    default:
      return (flavor || "claude").trim() || "claude";
  }
}

/**
 * Returns the human-readable AI provider for a session.
 */
export function getSessionProviderLabel(session: Session): string {
  const key = getSessionProviderKey(session);
  switch (key) {
    case "codex":
      return t("agentInput.agent.codex");
    case "gemini":
      return t("agentInput.agent.gemini");
    case "claude":
      return t("agentInput.agent.claude");
    case "deepseek":
      return "DeepSeek";
    case "zai":
      return "Z.AI";
    case "minimax":
      return "MiniMax";
    case "kimi":
      return "Kimi";
    case "azure-openai":
      return "Azure OpenAI";
    case "opencode":
      return "OpenCode";
    case "acp":
      return "ACP";
    default:
      if (session.profileName && session.profileName.trim().length > 0) {
        return session.profileName;
      }
      return key.charAt(0).toUpperCase() + key.slice(1);
  }
}

/**
 * Returns the human-readable AI provider string shown in session lists.
 * Includes the normalized model label when it adds useful information.
 */
export function getSessionProviderDisplayLabel(session: Session): string {
  const provider = getSessionProviderLabel(session);
  const model = getSessionDisplayModelLabel(session);

  if (!model) {
    return provider;
  }

  if (provider.trim().toLowerCase() === model.trim().toLowerCase()) {
    return provider;
  }

  return `${provider} · ${model}`;
}

/**
 * Returns the project path for grouping.
 * Worktree sessions use parentRepoPath so they group with their parent project.
 */
export function getSessionProjectPath(session: Session): string {
  if (session.metadata?.worktree?.isWorktree) {
    return session.metadata.worktree.parentRepoPath;
  }
  return session.metadata?.path || "";
}

/**
 * Checks if a session is currently online based on the active flag.
 * A session is considered online if the active flag is true.
 */
export function isSessionOnline(session: Session): boolean {
  return session.active;
}

/**
 * Checks if a session should be shown in the active sessions group.
 * Uses the active flag directly.
 */
export function isSessionActive(session: Session): boolean {
  return session.active;
}

/**
 * Formats OS platform string into a more readable format
 */
export function formatOSPlatform(platform?: string): string {
  if (!platform) return "";

  const osMap: Record<string, string> = {
    darwin: "macOS",
    win32: "Windows",
    linux: "Linux",
    android: "Android",
    ios: "iOS",
    aix: "AIX",
    freebsd: "FreeBSD",
    openbsd: "OpenBSD",
    sunos: "SunOS",
  };

  return osMap[platform.toLowerCase()] || platform;
}

/**
 * Formats the last seen time of a session into a human-readable relative time.
 * @param activeAt - Timestamp when the session was last active
 * @param isActive - Whether the session is currently active
 * @returns Formatted string like "Active now", "5 minutes ago", "2 hours ago", or a date
 */
export function formatLastSeen(
  activeAt: number,
  isActive: boolean = false,
): string {
  if (isActive) {
    return t("status.activeNow");
  }

  const now = Date.now();
  const diffMs = now - activeAt;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return t("time.justNow");
  } else if (diffMinutes < 60) {
    return t("time.minutesAgo", { count: diffMinutes });
  } else if (diffHours < 24) {
    return t("time.hoursAgo", { count: diffHours });
  } else if (diffDays < 7) {
    return t("sessionHistory.daysAgo", { count: diffDays });
  } else {
    // Format as date
    const date = new Date(activeAt);
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    };
    return date.toLocaleDateString(undefined, options);
  }
}

const vibingMessages = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Baking",
  "Booping",
  "Brewing",
  "Calculating",
  "Cerebrating",
  "Channelling",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Computing",
  "Combobulating",
  "Concocting",
  "Conjuring",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Discombobulating",
  "Divining",
  "Doing",
  "Effecting",
  "Elucidating",
  "Enchanting",
  "Envisioning",
  "Finagling",
  "Flibbertigibbeting",
  "Forging",
  "Forming",
  "Frolicking",
  "Generating",
  "Germinating",
  "Hatching",
  "Herding",
  "Honking",
  "Ideating",
  "Imagining",
  "Incubating",
  "Inferring",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Noodling",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Pontificating",
  "Pondering",
  "Processing",
  "Puttering",
  "Puzzling",
  "Reticulating",
  "Ruminating",
  "Scheming",
  "Schlepping",
  "Shimmying",
  "Simmering",
  "Smooshing",
  "Spelunking",
  "Spinning",
  "Stewing",
  "Sussing",
  "Synthesizing",
  "Thinking",
  "Tinkering",
  "Transmuting",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Wandering",
  "Whirring",
  "Wibbling",
  "Wizarding",
  "Working",
  "Wrangling",
];
