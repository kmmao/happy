import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "path";
import { configuration } from "@/configuration";
import { authAndSetupMachineIfNeeded } from "@/ui/auth";
import { logger } from "@/ui/logger";

type SupervisorLoop = {
  id: string;
  projectId: string;
  status: string;
  currentPhase: string;
  currentIteration: number;
  maxIterations: number;
  costCapUsd: number | null;
  healthScoreTarget: number | null;
  autoApproveThreshold: number;
  maxConsecutiveFailures: number;
  maxDurationMinutes: number;
  totalCostUsd: number;
  totalTokens: number;
  totalActionsFound: number;
  totalActionsFixed: number;
  consecutiveFailures: number;
  initialHealthScore: number | null;
  currentHealthScore: number | null;
  activeRunId: string | null;
  exitReason: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type LoopDetailRun = {
  id: string;
  trigger: string;
  status: string;
  loopIteration: number | null;
  loopPhase: string | null;
  actionsCount: number;
  healthScore: number | null;
  costUsd: number | null;
  tokenCount: number | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
};

type LoopDetailAction = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  confidence: number | null;
  approval: string;
  fixStatus: string | null;
  createdAt: number;
};

type LoopConfig = {
  maxIterations: number;
  costCapUsd?: number;
  healthScoreTarget?: number;
  autoApproveThreshold: number;
  maxConsecutiveFailures: number;
  maxDurationMinutes: number;
};

type SupervisorSummary = {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  openCounts: { critical: number; high: number; medium: number; low: number };
  trendDirection: "improving" | "stable" | "declining";
  lastScanAt: number | null;
  totalRuns30d: number;
  nextRunAt: number | null;
  scheduleEnabled: boolean;
  scheduleIntervalHours: number | null;
  scheduleOverdueByMs: number | null;
  scheduleMissedRuns: number;
};

type ProjectRecord = {
  id: string;
  machineId: string;
  path: string;
  repoUrl: string | null;
  supervisorConfig: string | null;
  supervisorConfigVersion: number;
  supervisorMode: string | null;
  supervisorScheduleEnabled: boolean;
  supervisorScheduleIntervalHours: number | null;
  supervisorEnabledDimensions: string | null;
  supervisorPushTriggerEnabled: boolean;
  supervisorCustomRules: string | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

type ParsedFlags = {
  positional: string[];
  json: boolean;
  projectId?: string;
  path?: string;
  limit?: number;
  offset?: number;
  maxIterations?: number;
  costCapUsd?: number;
  healthScoreTarget?: number;
  autoApproveThreshold?: number;
  maxConsecutiveFailures?: number;
  maxDurationMinutes?: number;
  mode?: "disabled" | "suggest" | "semi-auto" | "auto";
  enableSchedule?: boolean;
  disableSchedule?: boolean;
  intervalHours?: number;
  enablePushTrigger?: boolean;
  disablePushTrigger?: boolean;
  fixStrategy?: "direct" | "pr";
  dimensions?: string;
  customRules?: string;
  customRulesFile?: string;
};

type ProjectTarget = {
  projectId: string;
  path: string;
};

export async function handleSupervisorCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    showSupervisorHelp();
    return;
  }

  switch (subcommand) {
    case "loop":
      await handleSupervisorLoopCommand(args.slice(1));
      return;
    case "summary":
      await handleSupervisorSummaryCommand(args.slice(1));
      return;
    case "config":
      await handleSupervisorConfigCommand(args.slice(1));
      return;
    default:
      logger.printError(chalk.red(`Unknown supervisor subcommand: ${subcommand}`));
      showSupervisorHelp();
      process.exit(1);
  }
}

async function handleSupervisorSummaryCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  normalizeProjectTarget(flags);
  const { credentials, machineId } = await authAndSetupMachineIfNeeded();
  const client = createSupervisorClient(credentials.token);
  const target = await resolveProjectTarget(client, machineId, flags);

  const [projectResponse, summary, activeLoop] = await Promise.all([
    client.get<{ project: ProjectRecord }>(`/v1/projects/${target.projectId}`),
    client.get<SupervisorSummary>(`/v1/projects/${target.projectId}/supervisor/summary`),
    client.get<{ loop: SupervisorLoop | null }>(`/v1/projects/${target.projectId}/supervisor/loop`),
  ]);

  if (flags.json) {
    logger.print(JSON.stringify({ project: projectResponse.project, summary, activeLoop: activeLoop.loop }, null, 2));
    return;
  }

  logger.print(chalk.bold(`Supervisor summary for ${target.path}`));
  logger.print(`Project ID: ${target.projectId}`);
  logger.print(`Mode: ${projectResponse.project.supervisorMode ?? "disabled"}`);
  logger.print(`Grade: ${summary.grade} (score=${summary.score})`);
  logger.print(`Trend: ${summary.trendDirection}`);
  logger.print(`Open findings: critical=${summary.openCounts.critical} high=${summary.openCounts.high} medium=${summary.openCounts.medium} low=${summary.openCounts.low}`);
  logger.print(`Last scan: ${formatOptionalTime(summary.lastScanAt)}`);
  logger.print(`Runs (30d): ${summary.totalRuns30d}`);
  logger.print(`Scheduled: ${summary.scheduleEnabled ? `enabled every ${summary.scheduleIntervalHours ?? 24}h` : "disabled"}`);
  logger.print(`Next run: ${formatOptionalTime(summary.nextRunAt)}`);
  if (summary.scheduleOverdueByMs != null) {
    logger.print(`Schedule overdue: ${formatDuration(summary.scheduleOverdueByMs)}`);
  }
  if (summary.scheduleMissedRuns > 0) {
    logger.print(`Missed runs: ${summary.scheduleMissedRuns}`);
  }
  logger.print(`Push trigger: ${projectResponse.project.supervisorPushTriggerEnabled ? "enabled" : "disabled"}`);
  logger.print(`Active loop: ${activeLoop.loop ? `${activeLoop.loop.id} (${activeLoop.loop.status}, ${activeLoop.loop.currentPhase})` : "none"}`);
}

async function handleSupervisorConfigCommand(args: string[]): Promise<void> {
  const action = args[0] ?? "show";
  if (action === "help" || action === "--help" || action === "-h") {
    showSupervisorConfigHelp();
    return;
  }

  const flags = parseFlags(args.slice(1));
  normalizeProjectTarget(flags);
  const { credentials, machineId } = await authAndSetupMachineIfNeeded();
  const client = createSupervisorClient(credentials.token);
  const target = await resolveProjectTarget(client, machineId, flags);

  if (action === "show") {
    const { project } = await client.get<{ project: ProjectRecord }>(`/v1/projects/${target.projectId}`);
    if (flags.json) {
      logger.print(JSON.stringify(project, null, 2));
      return;
    }

    logger.print(chalk.bold(`Supervisor config for ${target.path}`));
    logger.print(`Project ID: ${project.id}`);
    logger.print(`Mode: ${project.supervisorMode ?? "disabled"}`);
    logger.print(`Schedule: ${project.supervisorScheduleEnabled ? `enabled every ${project.supervisorScheduleIntervalHours ?? 24}h` : "disabled"}`);
    logger.print(`Push trigger: ${project.supervisorPushTriggerEnabled ? "enabled" : "disabled"}`);
    logger.print(`Fix strategy: ${readSupervisorConfig(project.supervisorConfig)?.fixStrategy ?? "default"}`);
    logger.print(`Dimensions: ${project.supervisorEnabledDimensions ?? "default"}`);
    logger.print(`Custom rules: ${project.supervisorCustomRules ? "configured" : "none"}`);
    logger.print(`Config version: ${project.supervisorConfigVersion}`);
    return;
  }

  if (action === "set") {
    const { project } = await client.get<{ project: ProjectRecord }>(`/v1/projects/${target.projectId}`);
    const update = await buildSupervisorConfigPatch(project, flags);
    if (Object.keys(update).length === 1 && "supervisorConfig" in update) {
      throw new Error("No config changes specified. Use --mode, --enable-schedule, --interval-hours, --enable-push-trigger, --fix-strategy, --dimensions, or --custom-rules.");
    }

    const result = await client.patch<{ supervisorConfig: string | null; supervisorConfigVersion: number }>(
      `/v1/projects/${target.projectId}/supervisor/config`,
      update,
    );

    if (flags.json) {
      logger.print(JSON.stringify(result, null, 2));
      return;
    }

    logger.print(chalk.green(`Updated supervisor config for ${target.path}`));
    logger.print(`Config version: ${result.supervisorConfigVersion}`);
    return;
  }

  logger.printError(chalk.red(`Unknown supervisor config action: ${action}`));
  showSupervisorConfigHelp();
  process.exit(1);
}

async function handleSupervisorLoopCommand(args: string[]): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "help" || action === "--help" || action === "-h") {
    showSupervisorLoopHelp();
    return;
  }

  const flags = parseFlags(args.slice(1));
  normalizeLoopTarget(action, flags);
  const { credentials, machineId } = await authAndSetupMachineIfNeeded();
  const client = createSupervisorClient(credentials.token);

  if (action === "start") {
    const target = await resolveProjectTarget(client, machineId, flags);
    const config: LoopConfig = {
      maxIterations: flags.maxIterations ?? 5,
      autoApproveThreshold: flags.autoApproveThreshold ?? 80,
      maxConsecutiveFailures: flags.maxConsecutiveFailures ?? 2,
      maxDurationMinutes: flags.maxDurationMinutes ?? 240,
    };
    if (flags.costCapUsd !== undefined) {
      config.costCapUsd = flags.costCapUsd;
    }
    if (flags.healthScoreTarget !== undefined) {
      config.healthScoreTarget = flags.healthScoreTarget;
    }

    const { loop } = await client.post<{ loop: SupervisorLoop }>(
      `/v1/projects/${target.projectId}/supervisor/loop`,
      config,
    );

    if (flags.json) {
      logger.print(JSON.stringify(loop, null, 2));
      return;
    }

    logger.print(chalk.green(`Started supervisor loop ${loop.id}`));
    logger.print(formatLoopSummary(loop, target.path));
    return;
  }

  if (action === "status") {
    const target = await resolveProjectTarget(client, machineId, flags);
    const { loop } = await client.get<{ loop: SupervisorLoop | null }>(
      `/v1/projects/${target.projectId}/supervisor/loop`,
    );

    if (flags.json) {
      logger.print(JSON.stringify({ projectId: target.projectId, path: target.path, loop }, null, 2));
      return;
    }

    if (!loop) {
      logger.print(`No active supervisor loop for ${target.path}`);
      return;
    }

    logger.print(formatLoopSummary(loop, target.path));
    return;
  }

  if (action === "list") {
    const target = await resolveProjectTarget(client, machineId, flags);
    const query = new URLSearchParams();
    if (flags.limit !== undefined) {
      query.set("limit", String(flags.limit));
    }
    if (flags.offset !== undefined) {
      query.set("offset", String(flags.offset));
    }
    const qs = query.toString() ? `?${query.toString()}` : "";
    const result = await client.get<{ loops: SupervisorLoop[]; total: number }>(
      `/v1/projects/${target.projectId}/supervisor/loops${qs}`,
    );

    if (flags.json) {
      logger.print(JSON.stringify({ ...result, projectId: target.projectId, path: target.path }, null, 2));
      return;
    }

    logger.print(`Supervisor loop history for ${target.path}`);
    logger.print(`Total loops: ${result.total}`);
    if (result.loops.length === 0) {
      logger.print("No supervisor loops found");
      return;
    }

    for (const loop of result.loops) {
      logger.print(`- ${formatLoopInline(loop)}`);
    }
    return;
  }

  if (action === "show") {
    const loopId = flags.positional[0];
    if (!loopId) {
      logger.printError("Loop ID required");
      process.exit(1);
    }
    const target = await resolveProjectTarget(client, machineId, flags);
    const detail = await client.get<{
      loop: SupervisorLoop;
      runs: LoopDetailRun[];
      actions: LoopDetailAction[];
    }>(`/v1/projects/${target.projectId}/supervisor/loops/${loopId}`);

    if (flags.json) {
      logger.print(JSON.stringify({ ...detail, projectId: target.projectId, path: target.path }, null, 2));
      return;
    }

    logger.print(formatLoopSummary(detail.loop, target.path));
    logger.print("");
    logger.print(`Runs (${detail.runs.length}):`);
    if (detail.runs.length === 0) {
      logger.print("- none");
    } else {
      for (const run of detail.runs) {
        logger.print(`- ${formatLoopRunInline(run)}`);
      }
    }
    logger.print("");
    logger.print(`Actions (${detail.actions.length}):`);
    if (detail.actions.length === 0) {
      logger.print("- none");
    } else {
      for (const actionItem of detail.actions.slice(0, 20)) {
        logger.print(`- [${actionItem.severity}] ${actionItem.title} (${actionItem.category}) approval=${actionItem.approval}${actionItem.fixStatus ? ` fix=${actionItem.fixStatus}` : ""}`);
      }
      if (detail.actions.length > 20) {
        logger.print(`- … ${detail.actions.length - 20} more action(s)`);
      }
    }
    return;
  }

  if (action === "pause" || action === "resume" || action === "stop") {
    const loopId = flags.positional[0];
    if (!loopId) {
      logger.printError("Loop ID required");
      process.exit(1);
    }
    const target = await resolveProjectTarget(client, machineId, flags);
    const { loop } = await client.post<{ loop: SupervisorLoop }>(
      `/v1/projects/${target.projectId}/supervisor/loop/${loopId}/${action}`,
      {},
    );

    if (flags.json) {
      logger.print(JSON.stringify(loop, null, 2));
      return;
    }

    logger.print(`${toPastTense(action)} supervisor loop ${loop.id}`);
    logger.print(formatLoopSummary(loop, target.path));
    return;
  }

  logger.printError(chalk.red(`Unknown supervisor loop action: ${action}`));
  showSupervisorLoopHelp();
  process.exit(1);
}

function normalizeProjectTarget(flags: ParsedFlags): void {
  if (!flags.path && flags.positional[0]) {
    flags.path = flags.positional.shift();
  }
}

function normalizeLoopTarget(action: string, flags: ParsedFlags): void {
  if ((action === "start" || action === "status" || action === "list") && !flags.path && flags.positional[0]) {
    flags.path = flags.positional.shift();
    return;
  }

  if ((action === "show" || action === "pause" || action === "resume" || action === "stop") && !flags.path && flags.positional.length > 1) {
    flags.path = flags.positional[1];
  }
}

function parseFlags(args: string[]): ParsedFlags {
  const parsed: ParsedFlags = {
    positional: [],
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--project":
      case "--project-id":
        parsed.projectId = args[++i];
        break;
      case "--path":
        parsed.path = args[++i];
        break;
      case "--limit":
        parsed.limit = parseIntFlag(arg, args[++i]);
        break;
      case "--offset":
        parsed.offset = parseIntFlag(arg, args[++i]);
        break;
      case "--max-iterations":
        parsed.maxIterations = parseIntFlag(arg, args[++i]);
        break;
      case "--cost-cap":
        parsed.costCapUsd = parseFloatFlag(arg, args[++i]);
        break;
      case "--health-target":
        parsed.healthScoreTarget = parseIntFlag(arg, args[++i]);
        break;
      case "--auto-approve-threshold":
        parsed.autoApproveThreshold = parseIntFlag(arg, args[++i]);
        break;
      case "--max-consecutive-failures":
        parsed.maxConsecutiveFailures = parseIntFlag(arg, args[++i]);
        break;
      case "--max-duration-minutes":
        parsed.maxDurationMinutes = parseIntFlag(arg, args[++i]);
        break;
      case "--mode":
        parsed.mode = parseModeFlag(args[++i]);
        break;
      case "--enable-schedule":
        parsed.enableSchedule = true;
        break;
      case "--disable-schedule":
        parsed.disableSchedule = true;
        break;
      case "--interval-hours":
        parsed.intervalHours = parseIntFlag(arg, args[++i]);
        break;
      case "--enable-push-trigger":
        parsed.enablePushTrigger = true;
        break;
      case "--disable-push-trigger":
        parsed.disablePushTrigger = true;
        break;
      case "--fix-strategy":
        parsed.fixStrategy = parseFixStrategyFlag(args[++i]);
        break;
      case "--dimensions":
        parsed.dimensions = args[++i];
        break;
      case "--custom-rules":
        parsed.customRules = args[++i];
        break;
      case "--custom-rules-file":
        parsed.customRulesFile = args[++i];
        break;
      default:
        parsed.positional.push(arg);
        break;
    }
  }

  return parsed;
}

function parseIntFlag(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

function parseFloatFlag(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

function parseModeFlag(value: string | undefined): ParsedFlags["mode"] {
  if (value !== "disabled" && value !== "suggest" && value !== "semi-auto" && value !== "auto") {
    throw new Error(`Invalid --mode value: ${value}`);
  }
  return value;
}

function parseFixStrategyFlag(value: string | undefined): ParsedFlags["fixStrategy"] {
  if (value !== "direct" && value !== "pr") {
    throw new Error(`Invalid --fix-strategy value: ${value}`);
  }
  return value;
}

async function resolveProjectTarget(
  client: ReturnType<typeof createSupervisorClient>,
  machineId: string,
  flags: ParsedFlags,
): Promise<ProjectTarget> {
  if (flags.projectId) {
    return {
      projectId: flags.projectId,
      path: flags.path ? resolvePath(flags.path) : process.cwd(),
    };
  }

  const path = resolvePath(flags.path ?? process.cwd());
  const response = await client.post<{
    project: {
      id: string;
      path: string;
    };
    created: boolean;
  }>("/v1/projects/resolve", {
    machineId,
    path,
  });

  return {
    projectId: response.project.id,
    path: response.project.path,
  };
}

async function buildSupervisorConfigPatch(project: ProjectRecord, flags: ParsedFlags): Promise<Record<string, unknown>> {
  if (flags.enableSchedule && flags.disableSchedule) {
    throw new Error("Cannot use --enable-schedule and --disable-schedule together");
  }
  if (flags.enablePushTrigger && flags.disablePushTrigger) {
    throw new Error("Cannot use --enable-push-trigger and --disable-push-trigger together");
  }

  const currentConfig = readSupervisorConfig(project.supervisorConfig) ?? {};
  const update: Record<string, unknown> = {
    supervisorConfig: project.supervisorConfig,
  };
  const configPatch: Record<string, unknown> = { ...currentConfig };

  if (flags.mode !== undefined) {
    update.supervisorMode = flags.mode;
  }
  if (flags.enableSchedule) {
    update.supervisorScheduleEnabled = true;
  }
  if (flags.disableSchedule) {
    update.supervisorScheduleEnabled = false;
  }
  if (flags.intervalHours !== undefined) {
    update.supervisorScheduleIntervalHours = flags.intervalHours;
  }
  if (flags.enablePushTrigger) {
    update.supervisorPushTriggerEnabled = true;
  }
  if (flags.disablePushTrigger) {
    update.supervisorPushTriggerEnabled = false;
  }
  if (flags.dimensions !== undefined) {
    update.supervisorEnabledDimensions = flags.dimensions;
  }
  if (flags.fixStrategy !== undefined) {
    update.fixStrategy = flags.fixStrategy;
    configPatch.fixStrategy = flags.fixStrategy;
  }

  let customRules = flags.customRules;
  if (flags.customRulesFile) {
    customRules = await readFile(resolvePath(flags.customRulesFile), "utf8");
  }
  if (customRules !== undefined) {
    update.supervisorCustomRules = customRules.length > 0 ? customRules : null;
  }

  update.supervisorConfig = Object.keys(configPatch).length > 0 ? JSON.stringify(configPatch) : null;

  return update;
}

function createSupervisorClient(token: string) {
  const baseUrl = configuration.serverUrl;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `${method} ${path} failed with HTTP ${response.status}`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) {
          message = data.error;
        }
      } catch {
        const text = await response.text().catch(() => "");
        if (text) {
          message = text;
        }
      }
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  };
}

function readSupervisorConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatLoopSummary(loop: SupervisorLoop, path: string): string {
  const lines = [
    `Path: ${path}`,
    `Loop: ${loop.id}`,
    `Status: ${loop.status}`,
    `Phase: ${loop.currentPhase}`,
    `Iteration: ${loop.currentIteration}/${loop.maxIterations}`,
    `Actions: found=${loop.totalActionsFound} fixed=${loop.totalActionsFixed}`,
    `Cost: $${loop.totalCostUsd.toFixed(4)}${loop.costCapUsd != null ? ` / $${loop.costCapUsd.toFixed(2)}` : ""}`,
    `Health: ${loop.currentHealthScore ?? "n/a"}${loop.healthScoreTarget != null ? ` target=${loop.healthScoreTarget}` : ""}`,
    `Failures: ${loop.consecutiveFailures}/${loop.maxConsecutiveFailures}`,
    `Active Run: ${loop.activeRunId ?? "none"}`,
    `Updated: ${new Date(loop.updatedAt).toLocaleString()}`,
  ];

  if (loop.exitReason) {
    lines.push(`Exit Reason: ${loop.exitReason}`);
  }
  if (loop.completedAt) {
    lines.push(`Completed: ${new Date(loop.completedAt).toLocaleString()}`);
  }
  return lines.join("\n");
}

function formatLoopInline(loop: SupervisorLoop): string {
  return `${loop.id} status=${loop.status} phase=${loop.currentPhase} iteration=${loop.currentIteration}/${loop.maxIterations} found=${loop.totalActionsFound} fixed=${loop.totalActionsFixed} cost=$${loop.totalCostUsd.toFixed(4)}${loop.exitReason ? ` exit=${loop.exitReason}` : ""}`;
}

function formatLoopRunInline(run: LoopDetailRun): string {
  const parts = [
    run.id,
    `trigger=${run.trigger}`,
    `status=${run.status}`,
  ];
  if (run.loopIteration != null) {
    parts.push(`iteration=${run.loopIteration}`);
  }
  if (run.loopPhase) {
    parts.push(`phase=${run.loopPhase}`);
  }
  if (run.actionsCount > 0) {
    parts.push(`actions=${run.actionsCount}`);
  }
  if (run.healthScore != null) {
    parts.push(`health=${run.healthScore}`);
  }
  if (run.costUsd != null) {
    parts.push(`cost=$${run.costUsd.toFixed(4)}`);
  }
  if (run.errorMessage) {
    parts.push(`error=${run.errorMessage}`);
  }
  return parts.join(" ");
}

function formatOptionalTime(value: number | null): string {
  return value == null ? "n/a" : new Date(value).toLocaleString();
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

function toPastTense(action: string): string {
  switch (action) {
    case "pause":
      return "Paused";
    case "resume":
      return "Resumed";
    case "stop":
      return "Stopped";
    default:
      return action;
  }
}

function showSupervisorHelp(): void {
  logger.print(`
${chalk.bold("happy supervisor")} - Supervisor automation and autonomous loop control

${chalk.bold("Usage:")}
  happy supervisor summary [--path <dir>] [--json]
  happy supervisor config show [--path <dir>] [--json]
  happy supervisor config set [--path <dir>] [options]
  happy supervisor loop <action> [options]

${chalk.bold("Examples:")}
  happy supervisor summary --path ~/repo
  happy supervisor config show --path ~/repo
  happy supervisor config set --path ~/repo --mode auto --enable-schedule --interval-hours 6
  happy supervisor loop start --path ~/repo --max-iterations 8
`);
}

function showSupervisorConfigHelp(): void {
  logger.print(`
${chalk.bold("happy supervisor config")} - Manage autonomous supervisor configuration

${chalk.bold("Usage:")}
  happy supervisor config show [--path <dir>] [--json]
  happy supervisor config set [--path <dir>] [options]

${chalk.bold("Set Options:")}
  --mode <disabled|suggest|semi-auto|auto>
  --enable-schedule | --disable-schedule
  --interval-hours <hours>
  --enable-push-trigger | --disable-push-trigger
  --fix-strategy <direct|pr>
  --dimensions <csv>
  --custom-rules <text>
  --custom-rules-file <file>

${chalk.bold("Examples:")}
  happy supervisor config set --path ~/repo --mode auto --enable-schedule --interval-hours 4
  happy supervisor config set --path ~/repo --disable-push-trigger --fix-strategy pr
`);
}

function showSupervisorLoopHelp(): void {
  logger.print(`
${chalk.bold("happy supervisor loop")} - Manage autonomous supervisor loops

${chalk.bold("Usage:")}
  happy supervisor loop start [--path <dir>] [--max-iterations N] [--cost-cap USD]
                              [--health-target SCORE] [--auto-approve-threshold N]
                              [--max-consecutive-failures N] [--max-duration-minutes N]
  happy supervisor loop status [--path <dir>] [--json]
  happy supervisor loop list [--path <dir>] [--limit N] [--offset N] [--json]
  happy supervisor loop show <loopId> [--path <dir>] [--json]
  happy supervisor loop pause <loopId> [--path <dir>]
  happy supervisor loop resume <loopId> [--path <dir>]
  happy supervisor loop stop <loopId> [--path <dir>]
`);
}
