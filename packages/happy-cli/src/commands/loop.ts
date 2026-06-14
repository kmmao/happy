import { readFile } from "node:fs/promises";
import chalk from "chalk";
import {
  createDaemonAgentLoop,
  getDaemonAgentLoop,
  listDaemonAgentLoops,
  pauseDaemonAgentLoop,
  removeDaemonAgentLoop,
  resumeDaemonAgentLoop,
  runNowDaemonAgentLoop,
  updateDaemonAgentLoop,
  emitDaemonAgentLoopEvent,
  emitDaemonCiTrigger,
  emitDaemonGitHubActionsWebhook,
  suggestDaemonAgentLoops,
  listDaemonAgentLoopBootstrapProfiles,
  getDaemonAgentLoopBootstrapProfile,
  createDaemonAgentLoopBootstrapProfile,
  updateDaemonAgentLoopBootstrapProfile,
  pauseDaemonAgentLoopBootstrapProfile,
  resumeDaemonAgentLoopBootstrapProfile,
  runNowDaemonAgentLoopBootstrapProfile,
  removeDaemonAgentLoopBootstrapProfile,
  listDaemonAutoDreamProfiles,
  getDaemonAutoDreamProfile,
  createDaemonAutoDreamProfile,
  updateDaemonAutoDreamProfile,
  pauseDaemonAutoDreamProfile,
  resumeDaemonAutoDreamProfile,
  runNowDaemonAutoDreamProfile,
  removeDaemonAutoDreamProfile,
} from "@/daemon/controlClient";
import { logger } from "@/ui/logger";
import { getAgentLoopContextFilePath, getAgentLoopMemoryFilePath } from "@/automation/AgentLoopMemory";
import { readAgentLoopBrief } from "@/automation/AgentLoopBrief";
import { suggestionToCreateInput } from "@/automation/AgentLoopSuggestion";
import { buildAgentLoopBootstrapPlan } from "@/automation/AgentLoopBootstrap";
import { buildCreateBody } from "@/automation/migrateLocalAgentLoops";

function parseIntervalMs(raw: string): number {
  const match = raw.trim().match(/^(\d+)([smhd])$/i);
  if (!match) {
    throw new Error(`Invalid interval '${raw}'. Use Ns, Nm, Nh, or Nd.`);
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return value * multiplier;
}

function formatIntervalMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1_000)}s`;
}


function formatLoopRuntime(loop: { runtimeState: string; phase: string; lastTriggerSource?: string }): string {
  const trigger = loop.lastTriggerSource ? `/${loop.lastTriggerSource}` : "";
  return `${loop.runtimeState}:${loop.phase}${trigger}`;
}

function formatTime(value?: number | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function parseEnvFlag(value: string | undefined): [string, string] {
  const idx = value?.indexOf("=") ?? -1;
  if (idx <= 0) {
    throw new Error(`Invalid --env '${value}'. Use KEY=value.`);
  }
  return [value!.slice(0, idx), value!.slice(idx + 1)];
}

function parseCreateArgs(args: string[]) {
  let name: string | undefined;
  let prompt: string | undefined;
  let directory: string | undefined;
  let interval: string | undefined;
  let agent: "claude" | "codex" | "gemini" | undefined;
  let profileId: string | undefined;
  let projectId: string | undefined;
  let runNow = true;
  let fileWatchEnabled: boolean | undefined;
  let githubBridgeEnabled: boolean | undefined;
  let ciBridgeEnabled: boolean | undefined;
  const eventSourceAllowlist: string[] = [];
  const eventKeywordFilters: string[] = [];
  let goal: string | undefined;
  let currentFocus: string | undefined;
  let workingMemory: string | undefined;
  let lastReflectionSummary: string | undefined;
  let maxConsecutiveFailures: number | undefined;
  let retryBackoff: string | undefined;
  let cooldown: string | undefined;
  let quietHoursStart: string | undefined;
  let quietHoursEnd: string | undefined;
  let maxAutoRunsPerDay: number | undefined;
  let maxIterations: number | undefined;
  let stopOnSuccess = false;
  const downstreamLoopIds: string[] = [];
  const downstreamTriggerOn: Array<"completed" | "failed"> = [];
  const notifyEvents: Array<"completed" | "failed" | "blocked" | "brief"> = [];
  const notificationChannels: Array<"push" | "webhook"> = [];
  let notificationWebhookUrl: string | undefined;
  const environmentVariables: Record<string, string> = {};
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i];
        break;
      case "--prompt":
        prompt = args[++i];
        break;
      case "--path":
      case "--directory":
        directory = args[++i];
        break;
      case "--interval":
        interval = args[++i];
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--profile":
        profileId = args[++i];
        break;
      case "--project":
        projectId = args[++i];
        break;
      case "--goal":
        goal = args[++i];
        break;
      case "--focus":
        currentFocus = args[++i];
        break;
      case "--working-memory":
        workingMemory = args[++i];
        break;
      case "--reflection":
        lastReflectionSummary = args[++i];
        break;
      case "--max-failures":
        maxConsecutiveFailures = Number(args[++i]);
        break;
      case "--retry-backoff":
        retryBackoff = args[++i];
        break;
      case "--cooldown":
        cooldown = args[++i];
        break;
      case "--quiet-start":
        quietHoursStart = args[++i];
        break;
      case "--quiet-end":
        quietHoursEnd = args[++i];
        break;
      case "--max-auto-runs":
        maxAutoRunsPerDay = Number(args[++i]);
        break;
      case "--max-iterations":
        maxIterations = Number(args[++i]);
        break;
      case "--stop-on-success":
        stopOnSuccess = true;
        break;
      case "--downstream-loop":
        downstreamLoopIds.push(args[++i] ?? "");
        break;
      case "--downstream-trigger":
        downstreamTriggerOn.push(args[++i] as "completed" | "failed");
        break;
      case "--notify-event":
        notifyEvents.push(args[++i] as "completed" | "failed" | "blocked" | "brief");
        break;
      case "--notify-channel":
        notificationChannels.push(args[++i] as "push" | "webhook");
        break;
      case "--notify-webhook":
        notificationWebhookUrl = args[++i];
        break;
      case "--env": {
        const [key, value] = parseEnvFlag(args[++i]);
        environmentVariables[key] = value;
        break;
      }
      case "--no-run-now":
        runNow = false;
        break;
      case "--file-watch":
        fileWatchEnabled = true;
        break;
      case "--github-bridge":
        githubBridgeEnabled = true;
        break;
      case "--ci-bridge":
        ciBridgeEnabled = true;
        break;
      case "--event-source":
        eventSourceAllowlist.push(args[++i] ?? "");
        break;
      case "--event-keyword":
        eventKeywordFilters.push(args[++i] ?? "");
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop create flag: ${arg}`);
    }
  }

  if (!prompt || !directory || !interval) {
    throw new Error("loop create requires --prompt, --path, and --interval");
  }

  return {
    json,
    input: {
      name,
      prompt,
      directory,
      intervalMs: parseIntervalMs(interval),
      agent,
      profileId,
      projectId,
      fileWatchEnabled,
      githubBridgeEnabled,
      ciBridgeEnabled,
      eventSourceAllowlist: eventSourceAllowlist.length > 0 ? eventSourceAllowlist : undefined,
      eventKeywordFilters: eventKeywordFilters.length > 0 ? eventKeywordFilters : undefined,
      goal,
      currentFocus,
      workingMemory,
      lastReflectionSummary,
      maxConsecutiveFailures: Number.isFinite(maxConsecutiveFailures) ? maxConsecutiveFailures : undefined,
      retryBackoffMs: retryBackoff ? parseIntervalMs(retryBackoff) : undefined,
      cooldownMs: cooldown ? parseIntervalMs(cooldown) : undefined,
      quietHoursStart,
      quietHoursEnd,
      maxAutoRunsPerDay: Number.isFinite(maxAutoRunsPerDay) ? maxAutoRunsPerDay : undefined,
      maxIterations: Number.isFinite(maxIterations) ? maxIterations : undefined,
      stopOnSuccess,
      downstreamLoopIds: downstreamLoopIds.length > 0 ? downstreamLoopIds : undefined,
      downstreamTriggerOn: downstreamTriggerOn.length > 0 ? downstreamTriggerOn : undefined,
      notifyEvents: notifyEvents.length > 0 ? notifyEvents : undefined,
      notificationChannels: notificationChannels.length > 0 ? notificationChannels : undefined,
      notificationWebhookUrl,
      environmentVariables: Object.keys(environmentVariables).length > 0 ? environmentVariables : undefined,
      runNow,
    },
  };
}

function parseSuggestArgs(args: string[]) {
  let directory: string | undefined;
  let agent: "claude" | "codex" | "gemini" | undefined;
  let projectId: string | undefined;
  let profileId: string | undefined;
  let create = false;
  let runNow = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--path":
      case "--directory":
        directory = args[++i];
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--project":
        projectId = args[++i];
        break;
      case "--profile":
        profileId = args[++i];
        break;
      case "--create":
        create = true;
        break;
      case "--run-now":
        runNow = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop suggest flag: ${arg}`);
    }
  }

  if (!directory) {
    throw new Error("loop suggest requires --path");
  }

  return { json, create, runNow, input: { directory, agent, projectId, profileId } };
}

function parseBootstrapArgs(args: string[]) {
  let root: string | undefined;
  let agent: "claude" | "codex" | "gemini" | undefined;
  let projectId: string | undefined;
  let profileId: string | undefined;
  let create = false;
  let runNow = false;
  let maxDepth: number | undefined;
  let limit: number | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--root":
      case "--path":
      case "--directory":
        root = args[++i];
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--project":
        projectId = args[++i];
        break;
      case "--profile":
        profileId = args[++i];
        break;
      case "--depth":
        maxDepth = Number(args[++i]);
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--create":
        create = true;
        break;
      case "--run-now":
        runNow = true;
        create = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop bootstrap flag: ${arg}`);
    }
  }

  if (!root) {
    throw new Error("loop bootstrap requires --root");
  }

  return {
    json,
    create,
    runNow,
    input: {
      root,
      agent,
      projectId,
      profileId,
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    },
  };
}

function parseBootstrapProfileCreateArgs(args: string[]) {
  let name: string | undefined;
  let rootDirectory: string | undefined;
  let interval: string | undefined;
  let maxDepth: number | undefined;
  let limit: number | undefined;
  let agent: "claude" | "codex" | "gemini" | undefined;
  let profileId: string | undefined;
  let projectId: string | undefined;
  let autoRunCreatedLoops = false;
  let runNow = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i];
        break;
      case "--root":
      case "--path":
      case "--directory":
        rootDirectory = args[++i];
        break;
      case "--interval":
        interval = args[++i];
        break;
      case "--depth":
        maxDepth = Number(args[++i]);
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--profile":
        profileId = args[++i];
        break;
      case "--project":
        projectId = args[++i];
        break;
      case "--auto-run-created":
        autoRunCreatedLoops = true;
        break;
      case "--run-now":
        runNow = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop bootstrap-profile create flag: ${arg}`);
    }
  }

  if (!rootDirectory || !interval) {
    throw new Error("loop bootstrap-profile create requires --root and --interval");
  }

  return {
    json,
    input: {
      name,
      rootDirectory,
      intervalMs: parseIntervalMs(interval),
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      agent,
      profileId,
      projectId,
      autoRunCreatedLoops,
      runNow,
    },
  };
}

function parseBootstrapProfileUpdateArgs(args: string[]) {
  const profileIdValue = args[0];
  if (!profileIdValue) {
    throw new Error("Bootstrap profile ID required");
  }
  let name: string | null | undefined;
  let rootDirectory: string | undefined;
  let intervalMs: number | undefined;
  let maxDepth: number | null | undefined;
  let limit: number | null | undefined;
  let agent: "claude" | "codex" | "gemini" | null | undefined;
  let profileId: string | null | undefined;
  let projectId: string | null | undefined;
  let autoRunCreatedLoops: boolean | undefined;
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i] ?? "";
        break;
      case "--clear-name":
        name = null;
        break;
      case "--root":
      case "--path":
      case "--directory":
        rootDirectory = args[++i];
        break;
      case "--interval":
        intervalMs = parseIntervalMs(args[++i] ?? "");
        break;
      case "--depth":
        maxDepth = Number(args[++i]);
        break;
      case "--clear-depth":
        maxDepth = null;
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--clear-limit":
        limit = null;
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--clear-agent":
        agent = null;
        break;
      case "--profile":
        profileId = args[++i] ?? "";
        break;
      case "--clear-profile":
        profileId = null;
        break;
      case "--project":
        projectId = args[++i] ?? "";
        break;
      case "--clear-project":
        projectId = null;
        break;
      case "--auto-run-created":
        autoRunCreatedLoops = true;
        break;
      case "--no-auto-run-created":
        autoRunCreatedLoops = false;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop bootstrap-profile update flag: ${arg}`);
    }
  }

  const input = {
    ...(name !== undefined ? { name } : {}),
    ...(rootDirectory !== undefined ? { rootDirectory } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(profileId !== undefined ? { profileId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(autoRunCreatedLoops !== undefined ? { autoRunCreatedLoops } : {}),
  };
  if (Object.keys(input).length === 0) {
    throw new Error("loop bootstrap-profile update requires at least one field to change");
  }
  return { profileIdValue, json, input };
}

function formatBootstrapProfile(profile: { id: string; name?: string; rootDirectory: string; status: string; intervalMs: number; nextRunAt: number; lastCreatedCount?: number; lastError?: string; autoRunCreatedLoops?: boolean; }) {
  return `${profile.id} ${profile.status} every=${formatIntervalMs(profile.intervalMs)} next=${formatTime(profile.nextRunAt)} root=${profile.rootDirectory} created=${profile.lastCreatedCount ?? 0} autoRun=${profile.autoRunCreatedLoops ? "yes" : "no"} name=${profile.name ?? "-"}${profile.lastError ? ` error=${profile.lastError}` : ""}`;
}

function parseDreamProfileCreateArgs(args: string[]) {
  let name: string | undefined;
  let rootDirectory: string | undefined;
  let interval: string | undefined;
  let maxDepth: number | undefined;
  let limit: number | undefined;
  let runNow = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i];
        break;
      case "--root":
      case "--path":
      case "--directory":
        rootDirectory = args[++i];
        break;
      case "--interval":
        interval = args[++i];
        break;
      case "--depth":
        maxDepth = Number(args[++i]);
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--run-now":
        runNow = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop dream-profile create flag: ${arg}`);
    }
  }

  if (!rootDirectory || !interval) {
    throw new Error("loop dream-profile create requires --root and --interval");
  }

  return {
    json,
    input: {
      name,
      rootDirectory,
      intervalMs: parseIntervalMs(interval),
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      runNow,
    },
  };
}

function parseDreamProfileUpdateArgs(args: string[]) {
  const profileIdValue = args[0];
  if (!profileIdValue) {
    throw new Error("Auto-Dream profile ID required");
  }
  let name: string | null | undefined;
  let rootDirectory: string | undefined;
  let intervalMs: number | undefined;
  let maxDepth: number | null | undefined;
  let limit: number | null | undefined;
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i] ?? "";
        break;
      case "--clear-name":
        name = null;
        break;
      case "--root":
      case "--path":
      case "--directory":
        rootDirectory = args[++i];
        break;
      case "--interval":
        intervalMs = parseIntervalMs(args[++i] ?? "");
        break;
      case "--depth":
        maxDepth = Number(args[++i]);
        break;
      case "--clear-depth":
        maxDepth = null;
        break;
      case "--limit":
        limit = Number(args[++i]);
        break;
      case "--clear-limit":
        limit = null;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop dream-profile update flag: ${arg}`);
    }
  }

  const input = {
    ...(name !== undefined ? { name } : {}),
    ...(rootDirectory !== undefined ? { rootDirectory } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
  if (Object.keys(input).length === 0) {
    throw new Error("loop dream-profile update requires at least one field to change");
  }
  return { profileIdValue, json, input };
}

function formatDreamProfile(profile: { id: string; name?: string; rootDirectory: string; status: string; stage: string; intervalMs: number; nextRunAt: number; lastMemoryFiles?: number; lastUpdatedFiles?: number; lastError?: string; }) {
  return `${profile.id} ${profile.status}/${profile.stage} every=${formatIntervalMs(profile.intervalMs)} next=${formatTime(profile.nextRunAt)} root=${profile.rootDirectory} memory=${profile.lastMemoryFiles ?? 0} updated=${profile.lastUpdatedFiles ?? 0} name=${profile.name ?? "-"}${profile.lastError ? ` error=${profile.lastError}` : ""}`;
}

function parseCiEventArgs(args: string[]) {
  let repoPath: string | undefined;
  let repoUrl: string | undefined;
  let provider = "github";
  let kind: "workflow_run" | "check_run" | "check_suite" | "generic" = "workflow_run";
  let status = "completed";
  let conclusion: string | undefined;
  let workflowName: string | undefined;
  let checkName: string | undefined;
  let branch: string | undefined;
  let sha: string | undefined;
  let title: string | undefined;
  let details: string | undefined;
  let targetLoopId: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--path":
      case "--directory":
        repoPath = args[++i];
        break;
      case "--repo-url":
        repoUrl = args[++i];
        break;
      case "--provider":
        provider = args[++i] ?? provider;
        break;
      case "--kind":
        kind = (args[++i] as any) ?? kind;
        break;
      case "--status":
        status = args[++i] ?? status;
        break;
      case "--conclusion":
        conclusion = args[++i];
        break;
      case "--workflow":
        workflowName = args[++i];
        break;
      case "--check":
        checkName = args[++i];
        break;
      case "--branch":
        branch = args[++i];
        break;
      case "--sha":
        sha = args[++i];
        break;
      case "--title":
        title = args[++i];
        break;
      case "--details":
        details = args[++i];
        break;
      case "--loop":
        targetLoopId = args[++i];
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop ci-event flag: ${arg}`);
    }
  }

  if (!repoPath && !targetLoopId) {
    throw new Error("loop ci-event requires --path or --loop");
  }

  return { json, input: { repoPath, repoUrl, provider, kind, status, conclusion, workflowName, checkName, branch, sha, title, details, targetLoopId } };
}

function parseGitHubActionsWebhookArgs(args: string[]) {
  let eventName: "workflow_run" | "check_run" | "check_suite" | undefined;
  let payloadFile: string | undefined;
  let repoPath: string | undefined;
  let targetLoopId: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--event":
        eventName = args[++i] as "workflow_run" | "check_run" | "check_suite";
        break;
      case "--payload-file":
        payloadFile = args[++i];
        break;
      case "--path":
      case "--directory":
        repoPath = args[++i];
        break;
      case "--loop":
        targetLoopId = args[++i];
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop github-actions-webhook flag: ${arg}`);
    }
  }

  if (!eventName || !payloadFile) {
    throw new Error("loop github-actions-webhook requires --event and --payload-file");
  }
  return { json, input: { eventName, payloadFile, repoPath, targetLoopId } };
}

function parseEventArgs(args: string[]) {
  const loopId = args[0];
  if (!loopId) {
    throw new Error("Loop ID required");
  }
  let title: string | undefined;
  let details: string | undefined;
  let source: string | undefined;
  let autoRun = true;
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--title":
        title = args[++i];
        break;
      case "--details":
        details = args[++i];
        break;
      case "--source":
        source = args[++i];
        break;
      case "--no-auto-run":
        autoRun = false;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop event flag: ${arg}`);
    }
  }

  if (!title) {
    throw new Error("loop event requires --title");
  }

  return { loopId, json, input: { title, details, source, autoRun } };
}

function parseUpdateArgs(args: string[]) {
  const loopId = args[0];
  if (!loopId) {
    throw new Error("Loop ID required");
  }

  let name: string | null | undefined;
  let prompt: string | undefined;
  let directory: string | undefined;
  let intervalMs: number | undefined;
  let agent: "claude" | "codex" | "gemini" | undefined;
  let profileId: string | null | undefined;
  let projectId: string | null | undefined;
  let fileWatchEnabled: boolean | undefined;
  let githubBridgeEnabled: boolean | undefined;
  let ciBridgeEnabled: boolean | undefined;
  let eventSourceAllowlist: string[] | null | undefined;
  let eventKeywordFilters: string[] | null | undefined;
  let goal: string | null | undefined;
  let currentFocus: string | null | undefined;
  let workingMemory: string | null | undefined;
  let lastReflectionSummary: string | null | undefined;
  let maxConsecutiveFailures: number | null | undefined;
  let retryBackoffMs: number | null | undefined;
  let cooldownMs: number | null | undefined;
  let quietHoursStart: string | null | undefined;
  let quietHoursEnd: string | null | undefined;
  let maxAutoRunsPerDay: number | null | undefined;
  let maxIterations: number | null | undefined;
  let stopOnSuccess: boolean | undefined;
  let downstreamLoopIds: string[] | null | undefined;
  let downstreamTriggerOn: Array<"completed" | "failed"> | null | undefined;
  let notifyEvents: Array<"completed" | "failed" | "blocked" | "brief"> | null | undefined;
  let notificationChannels: Array<"push" | "webhook"> | null | undefined;
  let notificationWebhookUrl: string | null | undefined;
  let clearEnv = false;
  const environmentVariables: Record<string, string> = {};
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--name":
        name = args[++i] ?? "";
        break;
      case "--clear-name":
        name = null;
        break;
      case "--prompt":
        prompt = args[++i];
        break;
      case "--path":
      case "--directory":
        directory = args[++i];
        break;
      case "--interval":
        intervalMs = parseIntervalMs(args[++i] ?? "");
        break;
      case "--agent":
        agent = args[++i] as "claude" | "codex" | "gemini";
        break;
      case "--profile":
        profileId = args[++i] ?? "";
        break;
      case "--clear-profile":
        profileId = null;
        break;
      case "--project":
        projectId = args[++i] ?? "";
        break;
      case "--clear-project":
        projectId = null;
        break;
      case "--file-watch":
        fileWatchEnabled = true;
        break;
      case "--no-file-watch":
        fileWatchEnabled = false;
        break;
      case "--github-bridge":
        githubBridgeEnabled = true;
        break;
      case "--no-github-bridge":
        githubBridgeEnabled = false;
        break;
      case "--ci-bridge":
        ciBridgeEnabled = true;
        break;
      case "--no-ci-bridge":
        ciBridgeEnabled = false;
        break;
      case "--event-source":
        eventSourceAllowlist = [...(eventSourceAllowlist ?? []), args[++i] ?? ""];
        break;
      case "--clear-event-sources":
        eventSourceAllowlist = null;
        break;
      case "--event-keyword":
        eventKeywordFilters = [...(eventKeywordFilters ?? []), args[++i] ?? ""];
        break;
      case "--clear-event-keywords":
        eventKeywordFilters = null;
        break;
      case "--goal":
        goal = args[++i] ?? "";
        break;
      case "--clear-goal":
        goal = null;
        break;
      case "--focus":
        currentFocus = args[++i] ?? "";
        break;
      case "--clear-focus":
        currentFocus = null;
        break;
      case "--working-memory":
        workingMemory = args[++i] ?? "";
        break;
      case "--clear-working-memory":
        workingMemory = null;
        break;
      case "--reflection":
        lastReflectionSummary = args[++i] ?? "";
        break;
      case "--clear-reflection":
        lastReflectionSummary = null;
        break;
      case "--max-failures":
        maxConsecutiveFailures = Number(args[++i]);
        break;
      case "--clear-max-failures":
        maxConsecutiveFailures = null;
        break;
      case "--retry-backoff":
        retryBackoffMs = parseIntervalMs(args[++i] ?? "");
        break;
      case "--clear-retry-backoff":
        retryBackoffMs = null;
        break;
      case "--cooldown":
        cooldownMs = parseIntervalMs(args[++i] ?? "");
        break;
      case "--clear-cooldown":
        cooldownMs = null;
        break;
      case "--quiet-start":
        quietHoursStart = args[++i] ?? "";
        break;
      case "--clear-quiet-start":
        quietHoursStart = null;
        break;
      case "--quiet-end":
        quietHoursEnd = args[++i] ?? "";
        break;
      case "--clear-quiet-end":
        quietHoursEnd = null;
        break;
      case "--max-auto-runs":
        maxAutoRunsPerDay = Number(args[++i]);
        break;
      case "--max-iterations":
        maxIterations = Number(args[++i]);
        break;
      case "--stop-on-success":
        stopOnSuccess = true;
        break;
      case "--clear-max-auto-runs":
        maxAutoRunsPerDay = null;
        break;
      case "--downstream-loop":
        downstreamLoopIds = [...(downstreamLoopIds ?? []), args[++i] ?? ""];
        break;
      case "--clear-downstream-loops":
        downstreamLoopIds = null;
        break;
      case "--downstream-trigger":
        downstreamTriggerOn = [...(downstreamTriggerOn ?? []), args[++i] as "completed" | "failed"];
        break;
      case "--clear-downstream-triggers":
        downstreamTriggerOn = null;
        break;
      case "--notify-event":
        notifyEvents = [...(notifyEvents ?? []), args[++i] as "completed" | "failed" | "blocked" | "brief"];
        break;
      case "--clear-notify-events":
        notifyEvents = null;
        break;
      case "--notify-channel":
        notificationChannels = [...(notificationChannels ?? []), args[++i] as "push" | "webhook"];
        break;
      case "--clear-notify-channels":
        notificationChannels = null;
        break;
      case "--notify-webhook":
        notificationWebhookUrl = args[++i] ?? "";
        break;
      case "--clear-notify-webhook":
        notificationWebhookUrl = null;
        break;
      case "--env": {
        const [key, value] = parseEnvFlag(args[++i]);
        environmentVariables[key] = value;
        break;
      }
      case "--clear-env":
        clearEnv = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown loop update flag: ${arg}`);
    }
  }

  const input = {
    ...(name !== undefined ? { name } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(directory !== undefined ? { directory } : {}),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(profileId !== undefined ? { profileId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(fileWatchEnabled !== undefined ? { fileWatchEnabled } : {}),
    ...(githubBridgeEnabled !== undefined ? { githubBridgeEnabled } : {}),
    ...(ciBridgeEnabled !== undefined ? { ciBridgeEnabled } : {}),
    ...(eventSourceAllowlist !== undefined ? { eventSourceAllowlist } : {}),
    ...(eventKeywordFilters !== undefined ? { eventKeywordFilters } : {}),
    ...(goal !== undefined ? { goal } : {}),
    ...(currentFocus !== undefined ? { currentFocus } : {}),
    ...(workingMemory !== undefined ? { workingMemory } : {}),
    ...(lastReflectionSummary !== undefined ? { lastReflectionSummary } : {}),
    ...(maxConsecutiveFailures !== undefined ? { maxConsecutiveFailures } : {}),
    ...(retryBackoffMs !== undefined ? { retryBackoffMs } : {}),
    ...(cooldownMs !== undefined ? { cooldownMs } : {}),
    ...(quietHoursStart !== undefined ? { quietHoursStart } : {}),
    ...(quietHoursEnd !== undefined ? { quietHoursEnd } : {}),
    ...(maxAutoRunsPerDay !== undefined ? { maxAutoRunsPerDay } : {}),
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    ...(stopOnSuccess !== undefined ? { stopOnSuccess } : {}),
    ...(downstreamLoopIds !== undefined ? { downstreamLoopIds } : {}),
    ...(downstreamTriggerOn !== undefined ? { downstreamTriggerOn } : {}),
    ...(notifyEvents !== undefined ? { notifyEvents } : {}),
    ...(notificationChannels !== undefined ? { notificationChannels } : {}),
    ...(notificationWebhookUrl !== undefined ? { notificationWebhookUrl } : {}),
    ...(clearEnv ? { environmentVariables: null as Record<string, string> | null } : {}),
    ...(!clearEnv && Object.keys(environmentVariables).length > 0 ? { environmentVariables } : {}),
  };

  if (Object.keys(input).length === 0) {
    throw new Error("loop update requires at least one field to change");
  }

  return { loopId, json, input };
}

function showHelp(): void {
  logger.print(`
${chalk.bold("happy loop")} - Generic autonomous agent loops

${chalk.bold("Usage:")}
  happy loop create --path <dir> --interval <10m> --prompt <text> [--name <name>] [--project <id>] [--profile <id>] [--agent <claude|codex|gemini>] [--file-watch] [--github-bridge] [--ci-bridge] [--event-source <name>] [--event-keyword <text>] [--goal <text>] [--focus <text>] [--working-memory <text>] [--reflection <text>] [--max-failures <n>] [--retry-backoff <10m>] [--cooldown <10m>] [--quiet-start <HH:MM>] [--quiet-end <HH:MM>] [--max-auto-runs <n>] [--max-iterations <n>] [--stop-on-success] [--downstream-loop <id>] [--downstream-trigger <completed|failed>] [--notify-event <completed|failed|blocked|brief>] [--notify-channel <push|webhook>] [--notify-webhook <url>] [--env KEY=value] [--no-run-now] [--json]
  happy loop update <id> [--name <name>|--clear-name] [--prompt <text>] [--path <dir>] [--interval <10m>] [--project <id>|--clear-project] [--profile <id>|--clear-profile] [--agent <claude|codex|gemini>] [--file-watch|--no-file-watch] [--github-bridge|--no-github-bridge] [--ci-bridge|--no-ci-bridge] [--event-source <name>|--clear-event-sources] [--event-keyword <text>|--clear-event-keywords] [--goal <text>|--clear-goal] [--focus <text>|--clear-focus] [--working-memory <text>|--clear-working-memory] [--reflection <text>|--clear-reflection] [--max-failures <n>|--clear-max-failures] [--retry-backoff <10m>|--clear-retry-backoff] [--cooldown <10m>|--clear-cooldown] [--quiet-start <HH:MM>|--clear-quiet-start] [--quiet-end <HH:MM>|--clear-quiet-end] [--max-auto-runs <n>|--clear-max-auto-runs] [--max-iterations <n>|--clear-max-iterations] [--stop-on-success|--no-stop-on-success] [--downstream-loop <id>|--clear-downstream-loops] [--downstream-trigger <completed|failed>|--clear-downstream-triggers] [--notify-event <completed|failed|blocked|brief>|--clear-notify-events] [--notify-channel <push|webhook>|--clear-notify-channels] [--notify-webhook <url>|--clear-notify-webhook] [--env KEY=value] [--clear-env] [--json]
  happy loop list [--json]
  happy loop show <id> [--json]
  happy loop suggest --path <dir> [--create] [--run-now] [--json]
  happy loop bootstrap --root <dir> [--depth <n>] [--limit <n>] [--agent <claude|codex|gemini>] [--create] [--run-now] [--json]
  happy loop bootstrap-profile <list|show|create|update|pause|resume|run-now|remove> ...
  happy loop dream-profile <list|show|create|update|pause|resume|run-now|remove> ...
  happy loop pause <id>
  happy loop resume <id>
  happy loop run-now <id>
  happy loop event <id> --title <text> [--details <text>] [--source <name>] [--no-auto-run] [--json]
  happy loop ci-event (--path <dir>|--loop <id>) [--repo-url <url>] [--provider <name>] [--kind <workflow_run|check_run|check_suite|generic>] [--workflow <name>] [--check <name>] [--status <text>] [--conclusion <text>] [--branch <name>] [--sha <commit>] [--title <text>] [--details <text>] [--json]
  happy loop github-actions-webhook --event <workflow_run|check_run|check_suite> --payload-file <payload.json> [--path <dir>|--loop <id>] [--json]
  happy loop brief <id>
  happy loop remove <id>
  happy loop migrate-preview [--json]
`);
}

export async function handleLoopCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    showHelp();
    return;
  }

  switch (subcommand) {
    case "create": {
      const { json, input } = parseCreateArgs(args.slice(1));
      const result = await createDaemonAgentLoop(input);
      if (!result.success) {
        throw new Error(result.errorMessage ?? "Failed to create loop");
      }
      if (json) {
        logger.print(JSON.stringify(result, null, 2));
        return;
      }
      logger.print(chalk.bold("Agent loop created"));
      if (result.loop) {
        logger.print(`ID: ${result.loop.id}`);
        logger.print(`Name: ${result.loop.name ?? "-"}`);
        logger.print(`Path: ${result.loop.directory}`);
        logger.print(`Interval: ${formatIntervalMs(result.loop.intervalMs)}`);
        logger.print(`Next run: ${formatTime(result.loop.nextRunAt)}`);
        logger.print(`Runtime: ${formatLoopRuntime(result.loop)}`);
        logger.print(`File watch: ${result.loop.fileWatchEnabled ? "enabled" : "disabled"}`);
        logger.print(`GitHub bridge: ${result.loop.githubBridgeEnabled ? "enabled" : "disabled"}`);
        logger.print(`CI bridge: ${result.loop.ciBridgeEnabled ? "enabled" : "disabled"}`);
        logger.print(`Event sources: ${result.loop.eventSourceAllowlist?.join(", ") ?? "-"}`);
        logger.print(`Event keywords: ${result.loop.eventKeywordFilters?.join(", ") ?? "-"}`);
        logger.print(`Goal: ${result.loop.goal ?? "-"}`);
        logger.print(`Focus: ${result.loop.currentFocus ?? "-"}`);
        logger.print(`Max iterations: ${result.loop.maxIterations ?? "-"}`);
        logger.print(`Stop on success: ${result.loop.stopOnSuccess ? "yes" : "no"}`);
        logger.print(`Failures: ${result.loop.consecutiveFailures ?? 0}/${result.loop.maxConsecutiveFailures ?? 1}`);
        logger.print(`Retry backoff: ${result.loop.retryBackoffMs ? formatIntervalMs(result.loop.retryBackoffMs) : "-"}`);
        logger.print(`Cooldown: ${result.loop.cooldownMs ? formatIntervalMs(result.loop.cooldownMs) : "-"}`);
        logger.print(`Quiet hours: ${result.loop.quietHoursStart ?? "-"} → ${result.loop.quietHoursEnd ?? "-"}`);
        logger.print(`Max auto-runs/day: ${result.loop.maxAutoRunsPerDay ?? "-"}`);
        logger.print(`Max iterations: ${result.loop.maxIterations ?? "-"}`);
        logger.print(`Stop on success: ${result.loop.stopOnSuccess ? "yes" : "no"}`);
      }
      return;
    }
    case "update":
    case "edit": {
      const { loopId, json, input } = parseUpdateArgs(args.slice(1));
      const result = await updateDaemonAgentLoop(loopId, input);
      if (!result.success) {
        throw new Error(result.errorMessage ?? "Failed to update loop");
      }
      if (json) {
        logger.print(JSON.stringify(result, null, 2));
        return;
      }
      logger.print(chalk.bold(`Agent loop updated: ${loopId}`));
      if (result.loop) {
        logger.print(`Name: ${result.loop.name ?? "-"}`);
        logger.print(`Path: ${result.loop.directory}`);
        logger.print(`Interval: ${formatIntervalMs(result.loop.intervalMs)}`);
        logger.print(`Agent: ${result.loop.agent}`);
        logger.print(`Runtime: ${formatLoopRuntime(result.loop)}`);
        logger.print(`File watch: ${result.loop.fileWatchEnabled ? "enabled" : "disabled"}`);
        logger.print(`GitHub bridge: ${result.loop.githubBridgeEnabled ? "enabled" : "disabled"}`);
        logger.print(`CI bridge: ${result.loop.ciBridgeEnabled ? "enabled" : "disabled"}`);
        logger.print(`Event sources: ${result.loop.eventSourceAllowlist?.join(", ") ?? "-"}`);
        logger.print(`Event keywords: ${result.loop.eventKeywordFilters?.join(", ") ?? "-"}`);
        logger.print(`Goal: ${result.loop.goal ?? "-"}`);
        logger.print(`Focus: ${result.loop.currentFocus ?? "-"}`);
        logger.print(`Max iterations: ${result.loop.maxIterations ?? "-"}`);
        logger.print(`Stop on success: ${result.loop.stopOnSuccess ? "yes" : "no"}`);
      }
      return;
    }
    case "list": {
      const json = args.includes("--json");
      const loops = await listDaemonAgentLoops();
      if (json) {
        logger.print(JSON.stringify({ loops }, null, 2));
        return;
      }
      if (loops.length === 0) {
        logger.print("No agent loops configured");
        return;
      }
      logger.print(chalk.bold("Agent loops"));
      for (const loop of loops) {
        logger.print(
          `- ${loop.id} ${loop.enabled ? "enabled" : "paused"} state=${formatLoopRuntime(loop)} watch=${loop.fileWatchEnabled ? "on" : "off"} gh=${loop.githubBridgeEnabled ? "on" : "off"} ci=${loop.ciBridgeEnabled ? "on" : "off"} failures=${loop.consecutiveFailures ?? 0}/${loop.maxConsecutiveFailures ?? 1} policy=${loop.lastPolicyGateReason ?? loop.stopReason ?? "ready"} cooldown=${loop.cooldownMs ? formatIntervalMs(loop.cooldownMs) : "-"} cap=${loop.autoRunsToday ?? 0}/${loop.maxAutoRunsPerDay ?? "-"} iterCap=${loop.iteration}/${loop.maxIterations ?? "-"} stopOnSuccess=${loop.stopOnSuccess ? "yes" : "no"} downstream=${loop.downstreamLoopIds?.length ?? 0} every=${formatIntervalMs(loop.intervalMs)} next=${formatTime(loop.nextRunAt)} name=${loop.name ?? "-"} focus=${loop.currentFocus ?? "-"}`,
        );
      }
      return;
    }
    case "show": {
      const loopId = args[1];
      const json = args.includes("--json");
      if (!loopId) throw new Error("Loop ID required");
      const result = await getDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to load loop");
      if (json) {
        logger.print(JSON.stringify(result, null, 2));
        return;
      }
      if (!result.loop) {
        logger.print(`Loop ${loopId} not found`);
        return;
      }
      const loop = result.loop;
      logger.print(chalk.bold(`Agent loop ${loop.id}`));
      logger.print(`Name: ${loop.name ?? "-"}`);
      logger.print(`Enabled: ${loop.enabled}`);
      logger.print(`Path: ${loop.directory}`);
      logger.print(`Interval: ${formatIntervalMs(loop.intervalMs)}`);
      logger.print(`Agent: ${loop.agent}`);
      logger.print(`File watch: ${loop.fileWatchEnabled ? "enabled" : "disabled"}`);
      logger.print(`GitHub bridge: ${loop.githubBridgeEnabled ? "enabled" : "disabled"}`);
      logger.print(`CI bridge: ${loop.ciBridgeEnabled ? "enabled" : "disabled"}`);
      logger.print(`Event sources: ${loop.eventSourceAllowlist?.join(", ") ?? "-"}`);
      logger.print(`Event keywords: ${loop.eventKeywordFilters?.join(", ") ?? "-"}`);
      logger.print(`Project: ${loop.projectId ?? "-"}`);
      logger.print(`Profile: ${loop.profileId ?? "-"}`);
      logger.print(`Iteration: ${loop.iteration}`);
      logger.print(`Failures: ${loop.consecutiveFailures ?? 0}/${loop.maxConsecutiveFailures ?? 1}`);
      logger.print(`Retry backoff: ${loop.retryBackoffMs ? formatIntervalMs(loop.retryBackoffMs) : "-"}`);
      logger.print(`Cooldown: ${loop.cooldownMs ? formatIntervalMs(loop.cooldownMs) : "-"}`);
      logger.print(`Quiet hours: ${loop.quietHoursStart ?? "-"} → ${loop.quietHoursEnd ?? "-"}`);
      logger.print(`Max auto-runs/day: ${loop.maxAutoRunsPerDay ?? "-"}`);
      logger.print(`Max iterations: ${loop.maxIterations ?? "-"}`);
      logger.print(`Stop on success: ${loop.stopOnSuccess ? "yes" : "no"}`);
      logger.print(`Auto-runs today: ${loop.autoRunsToday ?? 0}`);
      logger.print(`Auto-run window: ${formatTime(loop.autoRunWindowStartedAt)}`);
      logger.print(`Downstream loops: ${loop.downstreamLoopIds?.join(', ') ?? '-'}`);
      logger.print(`Downstream triggers: ${loop.downstreamTriggerOn?.join(', ') ?? '-'}`);
      logger.print(`Notify events: ${loop.notifyEvents?.join(', ') ?? '-'}`);
      logger.print(`Notify channels: ${loop.notificationChannels?.join(', ') ?? '-'}`);
      logger.print(`Notify webhook: ${loop.notificationWebhookUrl ?? '-'}`);
      logger.print(`Last brief: ${formatTime(loop.lastBriefAt)}${loop.lastBriefSummary ? ` • ${loop.lastBriefSummary}` : ''}`);
      logger.print(`Brief file: ${loop.directory}/.happy/agent-loops/${loop.id}/brief-latest.md`);
      logger.print(`Last policy gate: ${loop.lastPolicyGateReason ?? '-'} @ ${formatTime(loop.lastPolicyGateAt)}`);
      logger.print(`Runtime: ${loop.runtimeState}`);
      logger.print(`Phase: ${loop.phase}`);
      logger.print(`Phase updated: ${formatTime(loop.phaseUpdatedAt)}`);
      logger.print(`Active job: ${loop.activeJobId ?? "-"}`);
      logger.print(`Active session: ${loop.activeSessionId ?? "-"}`);
      logger.print(`Last trigger: ${loop.lastTriggerSource ?? "-"} @ ${formatTime(loop.lastTriggerAt)}`);
      logger.print(`Next run: ${formatTime(loop.nextRunAt)}`);
      logger.print(`Last enqueued: ${formatTime(loop.lastEnqueuedAt)}`);
      logger.print(`Last started: ${formatTime(loop.lastStartedAt)}`);
      logger.print(`Last completed: ${formatTime(loop.lastCompletedAt)}`);
      logger.print(`Last session: ${loop.lastSessionId ?? "-"}`);
      logger.print(`Last error: ${loop.lastError ?? "-"}`);
      logger.print(`Blocked reason: ${loop.blockedReason ?? "-"}`);
      logger.print(`Stop reason: ${loop.stopReason ?? "-"}`);
      logger.print(`Last reflection: ${formatTime(loop.lastReflectionAt)}`);
      logger.print(`Memory file: ${getAgentLoopMemoryFilePath(loop.directory, loop.id)}`);
      logger.print(`Context file: ${getAgentLoopContextFilePath(loop.directory, loop.id)}`);
      logger.print(`Goal: ${loop.goal ?? "-"}`);
      logger.print(`Current focus: ${loop.currentFocus ?? "-"}`);
      logger.print(`Working memory: ${loop.workingMemory ?? "-"}`);
      logger.print(`Reflection summary: ${loop.lastReflectionSummary ?? "-"}`);
      logger.print(`Memory updated: ${formatTime(loop.memoryUpdatedAt)}`);
      logger.print(`Pending events: ${(loop.recentEvents ?? []).filter((event) => event.status === "pending").length}`);
      if ((loop.recentEvents ?? []).length > 0) {
        logger.print("Recent events:");
        loop.recentEvents!.slice(0, 5).forEach((event) => {
          logger.print(`  - ${formatTime(event.createdAt)} ${event.status} [${event.source}] ${event.title}` + (event.errorMessage ? ` error=${event.errorMessage}` : ""));
        });
      }
      logger.print(`Prompt: ${loop.prompt}`);
      return;
    }
    case "pause": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await pauseDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to pause loop");
      logger.print(`Paused loop ${loopId}`);
      return;
    }
    case "resume": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await resumeDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to resume loop");
      logger.print(`Resumed loop ${loopId}`);
      return;
    }
    case "run-now": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await runNowDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to enqueue loop run");
      logger.print(`Enqueued loop ${loopId} for immediate run`);
      return;
    }
    case "event": {
      const { loopId, json, input } = parseEventArgs(args.slice(1));
      const result = await emitDaemonAgentLoopEvent(loopId, input);
      if (!result.success) {
        throw new Error(result.errorMessage ?? "Failed to emit loop event");
      }
      if (json) {
        logger.print(JSON.stringify(result, null, 2));
        return;
      }
      logger.print(chalk.bold(`Loop event accepted: ${loopId}`));
      logger.print(`Title: ${input.title}`);
      logger.print(`Source: ${input.source ?? "manual"}`);
      logger.print(`Auto-run: ${input.autoRun !== false}`);
      if (result.loop) {
        logger.print(`Runtime: ${formatLoopRuntime(result.loop)}`);
      }
      return;
    }
    case "suggest": {
      const { json, create, runNow, input } = parseSuggestArgs(args.slice(1));
      const suggestions = await suggestDaemonAgentLoops(input);
      if (create) {
        const created = [] as Array<{ suggestionKey: string; loopId?: string; skipped?: boolean }>;
        for (const suggestion of suggestions) {
          if (suggestion.alreadyConfigured) {
            created.push({ suggestionKey: suggestion.key, loopId: suggestion.existingLoopId, skipped: true });
            continue;
          }
          const result = await createDaemonAgentLoop(
            suggestionToCreateInput(suggestion, {
              projectId: input.projectId,
              profileId: input.profileId,
              runNow,
            }),
          );
          if (!result.success) {
            throw new Error(result.errorMessage ?? `Failed to create suggested loop ${suggestion.name}`);
          }
          created.push({ suggestionKey: suggestion.key, loopId: result.loop?.id });
        }
        if (json) {
          logger.print(JSON.stringify({ suggestions, created }, null, 2));
          return;
        }
        logger.print(chalk.bold(`Suggested loops processed: ${created.length}`));
        for (const entry of created) {
          logger.print(`- ${entry.suggestionKey} ${entry.skipped ? "already-configured" : `created=${entry.loopId ?? "-"}`}`);
        }
        return;
      }
      if (json) {
        logger.print(JSON.stringify({ suggestions }, null, 2));
        return;
      }
      if (suggestions.length === 0) {
        logger.print("No loop suggestions available for this path");
        return;
      }
      logger.print(chalk.bold(`Loop suggestions for ${input.directory}`));
      for (const suggestion of suggestions) {
        logger.print(`- ${suggestion.name} [${suggestion.confidence}] every=${formatIntervalMs(suggestion.intervalMs)} configured=${suggestion.alreadyConfigured ? suggestion.existingLoopId ?? "yes" : "no"}`);
        logger.print(`  ${suggestion.description}`);
        logger.print(`  Why: ${suggestion.rationale}`);
        logger.print(`  Focus: ${suggestion.currentFocus ?? "-"}`);
      }
      logger.print("Tip: rerun with --create to materialize missing suggestions.");
      return;
    }
    case "brief": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await getDaemonAgentLoop(loopId);
      if (!result.success || !result.loop) throw new Error(result.errorMessage ?? `Loop ${loopId} not found`);
      const brief = await readAgentLoopBrief(result.loop.directory, result.loop.id);
      if (!brief) {
        logger.print(`No brief available for loop ${loopId}`);
        return;
      }
      logger.print(brief);
      return;
    }
    case "memory": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await getDaemonAgentLoop(loopId);
      if (!result.success || !result.loop) throw new Error(result.errorMessage ?? `Loop ${loopId} not found`);
      const memoryPath = getAgentLoopMemoryFilePath(result.loop.directory, result.loop.id);
      try {
        logger.print(await readFile(memoryPath, "utf-8"));
      } catch {
        logger.print(`No memory file available for loop ${loopId}`);
      }
      return;
    }
    case "context": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await getDaemonAgentLoop(loopId);
      if (!result.success || !result.loop) throw new Error(result.errorMessage ?? `Loop ${loopId} not found`);
      const contextPath = getAgentLoopContextFilePath(result.loop.directory, result.loop.id);
      try {
        logger.print(await readFile(contextPath, "utf-8"));
      } catch {
        logger.print(`No context file available for loop ${loopId}`);
      }
      return;
    }
    case "dream-profile": {
      const action = args[1];
      if (!action || action === "help" || action === "--help" || action === "-h") {
        logger.print("Usage: happy loop dream-profile <list|show|create|update|pause|resume|run-now|remove>");
        return;
      }
      switch (action) {
        case "list": {
          const json = args.includes("--json");
          const profiles = await listDaemonAutoDreamProfiles();
          if (json) {
            logger.print(JSON.stringify({ profiles }, null, 2));
            return;
          }
          if (profiles.length === 0) {
            logger.print("No Auto-Dream profiles configured");
            return;
          }
          logger.print(chalk.bold("Auto-Dream profiles"));
          for (const profile of profiles) {
            logger.print(`- ${formatDreamProfile(profile)}`);
          }
          return;
        }
        case "show": {
          const profileIdValue = args[2];
          const json = args.includes("--json");
          if (!profileIdValue) throw new Error("Auto-Dream profile ID required");
          const result = await getDaemonAutoDreamProfile(profileIdValue);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to load Auto-Dream profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          if (!result.profile) {
            logger.print(`Auto-Dream profile ${profileIdValue} not found`);
            return;
          }
          const profile = result.profile;
          logger.print(chalk.bold(`Auto-Dream profile ${profile.id}`));
          logger.print(`Name: ${profile.name ?? "-"}`);
          logger.print(`Enabled: ${profile.enabled}`);
          logger.print(`Status: ${profile.status}`);
          logger.print(`Stage: ${profile.stage}`);
          logger.print(`Path: ${profile.rootDirectory}`);
          logger.print(`Interval: ${formatIntervalMs(profile.intervalMs)}`);
          logger.print(`Next run: ${formatTime(profile.nextRunAt)}`);
          logger.print(`Max depth: ${profile.maxDepth ?? "-"}`);
          logger.print(`Limit: ${profile.limit ?? "-"}`);
          logger.print(`Last run: ${formatTime(profile.lastRunAt)}`);
          logger.print(`Memory files: ${profile.lastMemoryFiles ?? 0}`);
          logger.print(`Updated files: ${profile.lastUpdatedFiles ?? 0}`);
          logger.print(`Latest dream: ${profile.latestDreamFilePath ?? "-"}`);
          logger.print(`Last error: ${profile.lastError ?? "-"}`);
          return;
        }
        case "create": {
          const { json, input } = parseDreamProfileCreateArgs(args.slice(2));
          const result = await createDaemonAutoDreamProfile(input);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to create Auto-Dream profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          logger.print(chalk.bold("Auto-Dream profile created"));
          if (result.profile) logger.print(`ID: ${result.profile.id}`);
          return;
        }
        case "update": {
          const { profileIdValue, json, input } = parseDreamProfileUpdateArgs(args.slice(2));
          const result = await updateDaemonAutoDreamProfile(profileIdValue, input);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to update Auto-Dream profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          logger.print(chalk.bold(`Auto-Dream profile updated: ${profileIdValue}`));
          return;
        }
        case "pause":
        case "resume":
        case "run-now":
        case "remove": {
          const profileIdValue = args[2];
          if (!profileIdValue) throw new Error("Auto-Dream profile ID required");
          const result = action === "pause"
            ? await pauseDaemonAutoDreamProfile(profileIdValue)
            : action === "resume"
              ? await resumeDaemonAutoDreamProfile(profileIdValue)
              : action === "run-now"
                ? await runNowDaemonAutoDreamProfile(profileIdValue)
                : await removeDaemonAutoDreamProfile(profileIdValue);
          if (!result.success) throw new Error(result.errorMessage ?? `Failed to ${action} Auto-Dream profile`);
          logger.print(`${action} ${profileIdValue}`);
          return;
        }
        default:
          throw new Error(`Unknown loop dream-profile action: ${action}`);
      }
    }

    case "bootstrap-profile": {
      const action = args[1];
      if (!action || action === "help" || action === "--help" || action === "-h") {
        logger.print("Usage: happy loop bootstrap-profile <list|show|create|update|pause|resume|run-now|remove>");
        return;
      }
      switch (action) {
        case "list": {
          const json = args.includes("--json");
          const profiles = await listDaemonAgentLoopBootstrapProfiles();
          if (json) {
            logger.print(JSON.stringify({ profiles }, null, 2));
            return;
          }
          if (profiles.length === 0) {
            logger.print("No bootstrap profiles configured");
            return;
          }
          logger.print(chalk.bold("Bootstrap profiles"));
          for (const profile of profiles) {
            logger.print(`- ${formatBootstrapProfile(profile)}`);
          }
          return;
        }
        case "show": {
          const profileIdValue = args[2];
          const json = args.includes("--json");
          if (!profileIdValue) throw new Error("Bootstrap profile ID required");
          const result = await getDaemonAgentLoopBootstrapProfile(profileIdValue);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to load bootstrap profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          if (!result.profile) {
            logger.print(`Bootstrap profile ${profileIdValue} not found`);
            return;
          }
          const profile = result.profile;
          logger.print(chalk.bold(`Bootstrap profile ${profile.id}`));
          logger.print(`Name: ${profile.name ?? "-"}`);
          logger.print(`Root: ${profile.rootDirectory}`);
          logger.print(`Status: ${profile.status}`);
          logger.print(`Interval: ${formatIntervalMs(profile.intervalMs)}`);
          logger.print(`Next run: ${formatTime(profile.nextRunAt)}`);
          logger.print(`Depth: ${profile.maxDepth ?? "-"}`);
          logger.print(`Limit: ${profile.limit ?? "-"}`);
          logger.print(`Agent: ${profile.agent ?? "-"}`);
          logger.print(`Project: ${profile.projectId ?? "-"}`);
          logger.print(`Profile: ${profile.profileId ?? "-"}`);
          logger.print(`Auto-run created: ${profile.autoRunCreatedLoops ? "yes" : "no"}`);
          logger.print(`Last run: ${formatTime(profile.lastRunAt)}`);
          logger.print(`Last repos: ${profile.lastRepoCount ?? 0}`);
          logger.print(`Last suggestions: ${profile.lastSuggestionCount ?? 0}`);
          logger.print(`Last created: ${profile.lastCreatedCount ?? 0}`);
          logger.print(`Last error: ${profile.lastError ?? "-"}`);
          return;
        }
        case "create": {
          const { json, input } = parseBootstrapProfileCreateArgs(args.slice(2));
          const result = await createDaemonAgentLoopBootstrapProfile(input);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to create bootstrap profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          logger.print(chalk.bold("Bootstrap profile created"));
          if (result.profile) logger.print(`ID: ${result.profile.id}`);
          return;
        }
        case "update": {
          const { profileIdValue, json, input } = parseBootstrapProfileUpdateArgs(args.slice(2));
          const result = await updateDaemonAgentLoopBootstrapProfile(profileIdValue, input);
          if (!result.success) throw new Error(result.errorMessage ?? "Failed to update bootstrap profile");
          if (json) {
            logger.print(JSON.stringify(result, null, 2));
            return;
          }
          logger.print(chalk.bold(`Bootstrap profile updated: ${profileIdValue}`));
          return;
        }
        case "pause":
        case "resume":
        case "run-now":
        case "remove": {
          const profileIdValue = args[2];
          if (!profileIdValue) throw new Error("Bootstrap profile ID required");
          const result = action === "pause"
            ? await pauseDaemonAgentLoopBootstrapProfile(profileIdValue)
            : action === "resume"
              ? await resumeDaemonAgentLoopBootstrapProfile(profileIdValue)
              : action === "run-now"
                ? await runNowDaemonAgentLoopBootstrapProfile(profileIdValue)
                : await removeDaemonAgentLoopBootstrapProfile(profileIdValue);
          if (!result.success) throw new Error(result.errorMessage ?? `Failed to ${action} bootstrap profile`);
          logger.print(`${action} ${profileIdValue}`);
          return;
        }
        default:
          throw new Error(`Unknown loop bootstrap-profile action: ${action}`);
      }
    }

    case "bootstrap": {
      const { json, create, runNow, input } = parseBootstrapArgs(args.slice(1));
      const existingLoops = await listDaemonAgentLoops();
      const plans = await buildAgentLoopBootstrapPlan({
        root: input.root,
        maxDepth: input.maxDepth,
        limit: input.limit,
        suggestInput: {
          agent: input.agent,
          projectId: input.projectId,
          profileId: input.profileId,
        },
        existingLoops,
      });
      const created: Array<{ repo: string; suggestionKey: string; loopId?: string; skipped?: boolean }> = [];
      if (create) {
        for (const plan of plans) {
          for (const suggestion of plan.suggestions) {
            if (suggestion.alreadyConfigured) {
              created.push({ repo: plan.repo.directory, suggestionKey: suggestion.key, loopId: suggestion.existingLoopId, skipped: true });
              continue;
            }
            const result = await createDaemonAgentLoop(suggestionToCreateInput(suggestion, {
              projectId: input.projectId,
              profileId: input.profileId,
              runNow,
            }));
            if (!result.success) {
              throw new Error(result.errorMessage ?? `Failed to create suggested loop ${suggestion.name}`);
            }
            created.push({ repo: plan.repo.directory, suggestionKey: suggestion.key, loopId: result.loop?.id });
          }
        }
      }
      if (json) {
        logger.print(JSON.stringify({ root: input.root, plans, created }, null, 2));
        return;
      }
      if (plans.length === 0) {
        logger.print(`No git repositories with loop suggestions found under ${input.root}`);
        return;
      }
      logger.print(chalk.bold(`Bootstrap loop plans for ${input.root}`));
      for (const plan of plans) {
        const creatable = plan.suggestions.filter((entry) => !entry.alreadyConfigured).length;
        logger.print(`- ${plan.repo.name} path=${plan.repo.directory} suggestions=${plan.suggestions.length} creatable=${creatable}`);
        for (const suggestion of plan.suggestions) {
          logger.print(`  • ${suggestion.name} [${suggestion.confidence}] configured=${suggestion.alreadyConfigured ? suggestion.existingLoopId ?? "yes" : "no"}`);
        }
      }
      if (create) {
        logger.print(chalk.bold(`Materialized suggestions: ${created.length}`));
        for (const entry of created) {
          logger.print(`- repo=${entry.repo} suggestion=${entry.suggestionKey} ${entry.skipped ? `already-configured=${entry.loopId ?? "yes"}` : `created=${entry.loopId ?? "-"}`}`);
        }
      } else {
        logger.print("Tip: rerun with --create to materialize missing loop suggestions.");
      }
      return;
    }

    case "github-actions-webhook": {
      const { json, input } = parseGitHubActionsWebhookArgs(args.slice(1));
      const payload = JSON.parse(await (await import("node:fs/promises")).readFile(input.payloadFile, "utf-8"));
      let resolvedPath = input.repoPath;
      if (input.targetLoopId && !resolvedPath) {
        const loop = await getDaemonAgentLoop(input.targetLoopId);
        if (!loop.success || !loop.loop) {
          throw new Error(loop.errorMessage ?? `Loop ${input.targetLoopId} not found`);
        }
        resolvedPath = loop.loop.directory;
      }
      const result = await emitDaemonGitHubActionsWebhook({
        eventName: input.eventName,
        payload,
        repoPath: resolvedPath,
        targetLoopId: input.targetLoopId,
      });
      if (!result.success) {
        throw new Error(result.errorMessage ?? "Failed to emit GitHub Actions webhook");
      }
      if (json) {
        logger.print(JSON.stringify({ success: true, eventName: input.eventName, payloadFile: input.payloadFile, repoPath: resolvedPath, targetLoopId: input.targetLoopId }, null, 2));
        return;
      }
      logger.print(chalk.bold("GitHub Actions webhook accepted"));
      logger.print(`Event: ${input.eventName}`);
      logger.print(`Payload file: ${input.payloadFile}`);
      logger.print(`Path: ${resolvedPath ?? "matched-by-repo-url"}`);
      logger.print(`Target loop: ${input.targetLoopId ?? "matched-by-repo"}`);
      return;
    }

    case "ci-event": {
      const { json, input } = parseCiEventArgs(args.slice(1));
      let resolvedPath = input.repoPath;
      let resolvedRepoUrl = input.repoUrl;
      if (input.targetLoopId && !resolvedPath) {
        const loop = await getDaemonAgentLoop(input.targetLoopId);
        if (!loop.success || !loop.loop) {
          throw new Error(loop.errorMessage ?? `Loop ${input.targetLoopId} not found`);
        }
        resolvedPath = loop.loop.directory;
        resolvedRepoUrl = resolvedRepoUrl ?? loop.loop.directory;
      }
      const result = await emitDaemonCiTrigger({
        eventId: undefined,
        provider: input.provider,
        repoPath: resolvedPath!,
        repoUrl: resolvedRepoUrl ?? resolvedPath!,
        kind: input.kind,
        status: input.status,
        conclusion: input.conclusion,
        workflowName: input.workflowName,
        checkName: input.checkName,
        branch: input.branch,
        sha: input.sha,
        title: input.title,
        details: input.details,
        targetLoopId: input.targetLoopId,
      });
      if (!result.success) {
        throw new Error(result.errorMessage ?? "Failed to emit ci event");
      }
      if (json) {
        logger.print(JSON.stringify({ success: true, input: { ...input, repoPath: resolvedPath, repoUrl: resolvedRepoUrl ?? resolvedPath } }, null, 2));
        return;
      }
      logger.print(chalk.bold("CI event accepted"));
      logger.print(`Kind: ${input.kind}`);
      logger.print(`Status: ${input.status}`);
      logger.print(`Conclusion: ${input.conclusion ?? "-"}`);
      logger.print(`Path: ${resolvedPath}`);
      logger.print(`Target loop: ${input.targetLoopId ?? "matched-by-repo"}`);
      return;
    }

    case "remove": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await removeDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to remove loop");
      logger.print(`Removed loop ${loopId}`);
      return;
    }
    case "migrate-preview": {
      // ADR-0022 Phase 3b — preview the plan to migrate CLI-local agent
      // loops to the server-side AgentLoop table. This subcommand runs
      // the migration core's dry-run path so users see what would happen
      // before the full `migrate` apply (landed alongside Phase 4 once
      // server deploy + project resolution wiring is unblocked).
      const json = args.includes("--json");
      const loops = await listDaemonAgentLoops();
      const previews = loops.map((loop) => {
        const body = buildCreateBody(loop);
        return {
          localId: loop.id,
          name: loop.name ?? null,
          directory: loop.directory,
          enabled: loop.enabled,
          alreadyMigrated: Boolean(loop.migratedToServerLoopId),
          serverLoopId: loop.migratedToServerLoopId ?? null,
          plannedBody: body,
        };
      });
      if (json) {
        logger.print(JSON.stringify({ previews }, null, 2));
        return;
      }
      if (previews.length === 0) {
        logger.print(chalk.dim("No local agent loops to migrate."));
        return;
      }
      logger.print(chalk.bold(`migrate-preview — ${previews.length} local loop(s):`));
      for (const p of previews) {
        const status = p.alreadyMigrated
          ? chalk.green(`migrated → ${p.serverLoopId}`)
          : chalk.yellow("pending");
        const enabled = p.enabled ? chalk.green("enabled") : chalk.dim("disabled");
        logger.print(`  ${chalk.bold(p.localId)} (${enabled}) — ${status}`);
        logger.print(`    name: ${p.name ?? "-"}`);
        logger.print(`    directory: ${p.directory}`);
        if (p.plannedBody.cronExpression) {
          logger.print(`    cron: ${p.plannedBody.cronExpression}`);
        } else if (p.plannedBody.intervalMs) {
          logger.print(`    interval: ${formatIntervalMs(p.plannedBody.intervalMs)}`);
        }
        if (p.plannedBody.profileId) {
          logger.print(`    profile: ${p.plannedBody.profileId}`);
        }
        const longTailKeys = Object.keys(p.plannedBody.genericConfig ?? {});
        if (longTailKeys.length > 0) {
          logger.print(`    long-tail: ${longTailKeys.join(", ")}`);
        }
      }
      logger.print("");
      logger.print(
        chalk.dim(
          `Apply path lands when server deploy is verified + project resolver is wired. ` +
            `Phase 3b code path: \`buildCreateBody\` + \`migrateLocalAgentLoops\` (unit-tested).`,
        ),
      );
      return;
    }
    default:
      throw new Error(`Unknown loop subcommand: ${subcommand}`);
  }
}
