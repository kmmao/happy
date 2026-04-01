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
} from "@/daemon/controlClient";
import { logger } from "@/ui/logger";

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
      case "--env": {
        const [key, value] = parseEnvFlag(args[++i]);
        environmentVariables[key] = value;
        break;
      }
      case "--no-run-now":
        runNow = false;
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
      environmentVariables: Object.keys(environmentVariables).length > 0 ? environmentVariables : undefined,
      runNow,
    },
  };
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
  happy loop create --path <dir> --interval <10m> --prompt <text> [--name <name>] [--project <id>] [--profile <id>] [--agent <claude|codex|gemini>] [--env KEY=value] [--no-run-now] [--json]
  happy loop update <id> [--name <name>|--clear-name] [--prompt <text>] [--path <dir>] [--interval <10m>] [--project <id>|--clear-project] [--profile <id>|--clear-profile] [--agent <claude|codex|gemini>] [--env KEY=value] [--clear-env] [--json]
  happy loop list [--json]
  happy loop show <id> [--json]
  happy loop pause <id>
  happy loop resume <id>
  happy loop run-now <id>
  happy loop remove <id>
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
          `- ${loop.id} ${loop.enabled ? "enabled" : "paused"} every=${formatIntervalMs(loop.intervalMs)} next=${formatTime(loop.nextRunAt)} iteration=${loop.iteration} name=${loop.name ?? "-"}`,
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
      logger.print(`Project: ${loop.projectId ?? "-"}`);
      logger.print(`Profile: ${loop.profileId ?? "-"}`);
      logger.print(`Iteration: ${loop.iteration}`);
      logger.print(`Next run: ${formatTime(loop.nextRunAt)}`);
      logger.print(`Last enqueued: ${formatTime(loop.lastEnqueuedAt)}`);
      logger.print(`Last started: ${formatTime(loop.lastStartedAt)}`);
      logger.print(`Last completed: ${formatTime(loop.lastCompletedAt)}`);
      logger.print(`Last session: ${loop.lastSessionId ?? "-"}`);
      logger.print(`Last error: ${loop.lastError ?? "-"}`);
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
    case "remove": {
      const loopId = args[1];
      if (!loopId) throw new Error("Loop ID required");
      const result = await removeDaemonAgentLoop(loopId);
      if (!result.success) throw new Error(result.errorMessage ?? "Failed to remove loop");
      logger.print(`Removed loop ${loopId}`);
      return;
    }
    default:
      throw new Error(`Unknown loop subcommand: ${subcommand}`);
  }
}
