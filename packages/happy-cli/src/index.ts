#!/usr/bin/env node

/**
 * CLI entry point for happy command
 *
 * Simple argument parsing without any CLI framework dependencies
 */

import chalk from "chalk";
import { runClaude, StartOptions } from "@/claude/runClaude";
import { logger } from "./ui/logger";
import { readCredentials, readSettings } from "./persistence";
import { authAndSetupMachineIfNeeded } from "./ui/auth";
import packageJson from "../package.json";
import { z } from "zod";
import { startDaemon } from "./daemon/run";
import {
  checkDaemonStatus,
  isDaemonRunningCurrentlyInstalledHappyVersion,
  stopDaemon,
} from "./daemon/controlClient";
import { getLatestDaemonLog } from "./ui/logger";
import {
  doctorCleanUsage,
  hasHelpFlag,
  killRunawayHappyProcesses,
} from "./daemon/doctor";
import { install } from "./daemon/install";
import { uninstall } from "./daemon/uninstall";
import { ApiClient } from "./api/api";
import { runDoctorCommand } from "./ui/doctor";
import {
  cancelDaemonAutomationJob,
  clearDaemonAutomationAudit,
  clearDaemonAutomationGuardians,
  clearDaemonAutomationJobs,
  getDaemonAutomationStatus,
  listDaemonSessions,
  retryDaemonAutomationJob,
  stopDaemonSession,
} from "./daemon/controlClient";
import { handleAuthCommand } from "./commands/auth";
import { handleConnectCommand } from "./commands/connect";
import { handleSandboxCommand } from "./commands/sandbox";
import { handleSupervisorCommand } from "./commands/supervisor";
import { handleLoopCommand } from "./commands/loop";
import { handleTranscriptCommand } from "./commands/transcript";
import { handleIssueCommand } from "./commands/issue";
import { spawnHappyCLI } from "./utils/spawnHappyCLI";
import { claudeCliPath } from "./claude/claudeLocal";
import { execFileSync } from "node:child_process";
import { extractNoSandboxFlag } from "./utils/sandboxFlags";
import { sanitizeProcessArgv } from "./utils/securityRedaction";

type AutomationTimelineEntry = {
  timestamp: number;
  type: "queued" | "dispatched" | "running" | "terminal";
  jobId: string;
  label: string;
  subtitle: string;
};

function buildAutomationTimeline(
  jobs: Array<{
    id: string;
    label?: string;
    dedupeKey: string;
    status: string;
    createdAt: number;
    dispatchedAt?: number;
    updatedAt: number;
    completedAt?: number;
    errorMessage?: string;
    sessionId?: string;
  }>,
): AutomationTimelineEntry[] {
  const entries: AutomationTimelineEntry[] = [];
  for (const job of jobs) {
    const label = job.label ?? job.dedupeKey;
    entries.push({
      timestamp: job.createdAt,
      type: "queued",
      jobId: job.id,
      label,
      subtitle: "queued",
    });
    if (job.dispatchedAt) {
      entries.push({
        timestamp: job.dispatchedAt,
        type: "dispatched",
        jobId: job.id,
        label,
        subtitle: "dispatched",
      });
    }
    if (job.status === "running") {
      entries.push({
        timestamp: job.updatedAt,
        type: "running",
        jobId: job.id,
        label,
        subtitle: job.sessionId ? `running in ${job.sessionId}` : "running",
      });
    }
    if (job.completedAt) {
      entries.push({
        timestamp: job.completedAt,
        type: "terminal",
        jobId: job.id,
        label,
        subtitle: job.errorMessage ? `${job.status}: ${job.errorMessage}` : job.status,
      });
    }
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

function formatAutomationRate(value?: number): string {
  if (value == null || Number.isNaN(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

function describeAutomationAuditEvent(event: {
  kind: string;
  status?: string;
  guardianKey?: string;
  guardianSessionId?: string;
  sessionId?: string;
  jobId?: string;
  message?: string;
}): string {
  switch (event.kind) {
    case "job_enqueued":
      return event.message ?? "job enqueued";
    case "job_session_started":
      return event.sessionId ? `session started in ${event.sessionId}` : "session started";
    case "job_terminal":
      return event.message ? `${event.status ?? "terminal"}: ${event.message}` : (event.status ?? "terminal");
    case "task_session_webhook_timeout":
      return event.message
        ? `task webhook timeout (still running): ${event.message}`
        : "task webhook timeout (session id pending)";
    case "task_terminal_dedupe_fallback":
      return event.message
        ? `task terminal via dedupeKey: ${event.message}`
        : `task terminal via dedupeKey (${event.status ?? "terminal"})`;
    case "guardian_reused":
      return event.guardianKey
        ? `reused ${event.guardianKey}${event.guardianSessionId ? ` -> ${event.guardianSessionId}` : ""}`
        : "guardian reused";
    case "guardian_remembered":
      return event.guardianKey
        ? `remembered ${event.guardianKey}${event.guardianSessionId ? ` -> ${event.guardianSessionId}` : ""}`
        : "guardian remembered";
    case "guardian_cleared":
      return event.guardianKey ? `cleared ${event.guardianKey}` : (event.message ?? "guardian cleared");
    case "session_reattached":
      return event.message ?? (event.sessionId ? `reattached ${event.sessionId}` : "session reattached");
    case "watchdog_stopped":
      return event.message ?? "watchdog stopped session";
    case "session_stop_requested":
      return event.message ?? "stop requested";
    case "loop_policy_gated":
      return event.message ?? `policy gated: ${event.status ?? 'unknown'}`;
    case "loop_downstream_emitted":
      return event.message ?? "downstream event emitted";
    default:
      return event.message ?? event.kind;
  }
}


type AutomationFilters = {
  projectId?: string;
  loopId?: string;
  kind?: "supervisor" | "webhook" | "agent_loop";
  jobMode?: "running" | "failed" | "terminal";
  guardianState?: "attached" | "persisted";
  auditMode?: "anomalies" | "guardian" | "jobs";
  recoveredOnly?: boolean;
};

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return !value || value.startsWith("--") ? undefined : value;
}

function parseAutomationFilters(args: string[]): AutomationFilters {
  return {
    projectId: readFlagValue(args, "--project"),
    loopId: readFlagValue(args, "--loop"),
    kind: readFlagValue(args, "--kind") as "supervisor" | "webhook" | "agent_loop" | undefined,
    jobMode: args.includes("--running") ? "running" : args.includes("--failed") ? "failed" : args.includes("--terminal") ? "terminal" : undefined,
    guardianState: args.includes("--attached") ? "attached" : args.includes("--persisted") ? "persisted" : undefined,
    auditMode: args.includes("--anomalies") ? "anomalies" : args.includes("--guardian") ? "guardian" : args.includes("--jobs") ? "jobs" : undefined,
    recoveredOnly: args.includes("--recovered"),
  };
}

function filterAutomationJobs<T extends { status: string; projectId?: string; loopId?: string; kind: string; recovered?: boolean }>(entries: T[], filters: AutomationFilters): T[] {
  return entries.filter((entry) => {
    if (filters.projectId && entry.projectId !== filters.projectId) return false;
    if (filters.loopId && entry.loopId !== filters.loopId) return false;
    if (filters.kind && entry.kind !== filters.kind) return false;
    if (filters.recoveredOnly && entry.recovered !== true) return false;
    if (filters.jobMode === "running") return entry.status === "running" || entry.status === "dispatching";
    if (filters.jobMode === "failed") return entry.status === "failed";
    if (filters.jobMode === "terminal") return entry.status === "completed" || entry.status === "failed" || entry.status === "cancelled";
    return true;
  });
}

function filterAutomationGuardians<T extends { projectId?: string; loopId?: string; attached?: boolean; recovered?: boolean }>(entries: T[], filters: AutomationFilters): T[] {
  return entries.filter((entry) => {
    if (filters.projectId && entry.projectId !== filters.projectId) return false;
    if (filters.loopId && entry.loopId !== filters.loopId) return false;
    if (filters.guardianState === "attached" && entry.attached !== true) return false;
    if (filters.guardianState === "persisted" && entry.attached !== false) return false;
    if (filters.recoveredOnly && entry.recovered !== true) return false;
    return true;
  });
}

function filterAutomationAudit<T extends { kind: string; status?: string; projectId?: string; loopId?: string }>(entries: T[], filters: AutomationFilters): T[] {
  return entries.filter((entry) => {
    if (filters.projectId && entry.projectId !== filters.projectId) return false;
    if (filters.loopId && entry.loopId !== filters.loopId) return false;
    if (filters.recoveredOnly && entry.kind !== "session_reattached") return false;
    if (filters.auditMode === "anomalies") return entry.kind === "watchdog_stopped" || entry.kind === "session_stop_requested" || entry.kind === "guardian_cleared" || entry.status === "failed" || entry.status === "cancelled";
    if (filters.auditMode === "guardian") return entry.kind.startsWith("guardian_");
    if (filters.auditMode === "jobs") return entry.kind.startsWith("job_") || entry.kind === "session_reattached" || entry.kind === "watchdog_stopped" || entry.kind === "session_stop_requested";
    return true;
  });
}

(async () => {
  const args = process.argv.slice(2);

  // If --version is passed - do not log, its likely daemon inquiring about our version
  if (!args.includes("--version")) {
    logger.debug("Starting happy CLI with args: ", sanitizeProcessArgv(process.argv));
  }

  // Check if first argument is a subcommand
  const subcommand = args[0];

  // Log which subcommand was detected (for debugging)
  if (!args.includes("--version")) {
  }

  if (subcommand === "doctor") {
    // Check for clean subcommand
    if (args[1] === "clean") {
      // `clean` is destructive, so `--help`/`-h` must short-circuit to usage
      // before any process is killed.
      if (hasHelpFlag(args)) {
        logger.print(doctorCleanUsage());
        process.exit(0);
      }
      const result = await killRunawayHappyProcesses();
      logger.print(`Cleaned up ${result.killed} runaway processes`);
      if (result.errors.length > 0) {
        logger.print("Errors:", result.errors);
      }
      process.exit(0);
    }
    await runDoctorCommand();
    return;
  } else if (subcommand === "auth") {
    // Handle auth subcommands
    try {
      await handleAuthCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Auth command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "connect") {
    // Handle connect subcommands
    try {
      await handleConnectCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Connect command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "sandbox") {
    try {
      await handleSandboxCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Sandbox command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "supervisor") {
    try {
      await handleSupervisorCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Supervisor command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "loop") {
    try {
      await handleLoopCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Loop command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "transcript") {
    try {
      await handleTranscriptCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Transcript command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "issue") {
    try {
      await handleIssueCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Issue command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "bye") {
    logger.print("Bye!");
    process.exit(0);
  } else if (subcommand === "codex") {
    // Handle codex command
    try {
      const { runCodex } = await import("@/codex/runCodex");

      // Parse startedBy argument
      let startedBy: "daemon" | "terminal" | undefined = undefined;
      let happySessionId: string | undefined = undefined;
      let permissionMode: import("@/api/types").PermissionMode | undefined = undefined;
      const codexArgs = extractNoSandboxFlag(args.slice(1));
      for (let i = 0; i < codexArgs.args.length; i++) {
        if (codexArgs.args[i] === "--started-by") {
          startedBy = codexArgs.args[++i] as "daemon" | "terminal";
        } else if (codexArgs.args[i] === "--happy-session-id") {
          happySessionId = codexArgs.args[++i];
        } else if (codexArgs.args[i] === "--permission-mode") {
          permissionMode = codexArgs.args[++i] as import("@/api/types").PermissionMode;
        } else if (codexArgs.args[i] === "--yolo") {
          permissionMode = "yolo";
        }
      }

      for (let ci = 0; ci < codexArgs.args.length; ci++) {
        if (codexArgs.args[ci] === "--claude-env") {
          const envArg = codexArgs.args[++ci];
          if (envArg?.includes("=")) {
            const eqIdx = envArg.indexOf("=");
            process.env[envArg.substring(0, eqIdx)] = envArg.substring(eqIdx + 1);
          }
        }
      }

      const { credentials } = await authAndSetupMachineIfNeeded();
      await runCodex({
        credentials,
        startedBy,
        noSandbox: codexArgs.noSandbox,
        happySessionId,
        permissionMode,
      });
      // Do not force exit here; allow instrumentation to show lingering handles
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Codex command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "gemini") {
    // Handle gemini subcommands
    const geminiSubcommand = args[1];

    // Handle "happy gemini model set <model>" command
    if (geminiSubcommand === "model" && args[2] === "set" && args[3]) {
      const modelName = args[3];
      const validModels = [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
      ];

      if (!validModels.includes(modelName)) {
        logger.printError(`Invalid model: ${modelName}`);
        logger.printError(`Available models: ${validModels.join(", ")}`);
        process.exit(1);
      }

      try {
        const {
          existsSync,
          readFileSync,
          writeFileSync,
          mkdirSync,
        } = require("fs");
        const { join } = require("path");
        const { homedir } = require("os");

        const configDir = join(homedir(), ".gemini");
        const configPath = join(configDir, "config.json");

        // Create directory if it doesn't exist
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }

        // Read existing config or create new one
        let config: any = {};
        if (existsSync(configPath)) {
          try {
            config = JSON.parse(readFileSync(configPath, "utf-8"));
          } catch (error) {
            // Ignore parse errors, start fresh
            config = {};
          }
        }

        // Update model in config
        config.model = modelName;

        // Write config back
        writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        logger.print(`✓ Model set to: ${modelName}`);
        logger.print(`  Config saved to: ${configPath}`);
        logger.print(`  This model will be used in future sessions.`);
        process.exit(0);
      } catch (error) {
        logger.printError("Failed to save model configuration:", error);
        process.exit(1);
      }
    }

    // Handle "happy gemini model get" command
    if (geminiSubcommand === "model" && args[2] === "get") {
      try {
        const { existsSync, readFileSync } = require("fs");
        const { join } = require("path");
        const { homedir } = require("os");

        const configPaths = [
          join(homedir(), ".gemini", "config.json"),
          join(homedir(), ".config", "gemini", "config.json"),
        ];

        let model: string | null = null;
        for (const configPath of configPaths) {
          if (existsSync(configPath)) {
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              model = config.model || config.GEMINI_MODEL || null;
              if (model) break;
            } catch (error) {
              // Ignore parse errors
            }
          }
        }

        if (model) {
          logger.print(`Current model: ${model}`);
        } else if (process.env.GEMINI_MODEL) {
          logger.print(
            `Current model: ${process.env.GEMINI_MODEL} (from GEMINI_MODEL env var)`,
          );
        } else {
          logger.print("Current model: gemini-2.5-pro (default)");
        }
        process.exit(0);
      } catch (error) {
        logger.printError("Failed to read model configuration:", error);
        process.exit(1);
      }
    }

    // Handle "happy gemini project set <project-id>" command
    if (geminiSubcommand === "project" && args[2] === "set" && args[3]) {
      const projectId = args[3];

      try {
        const { saveGoogleCloudProjectToConfig } =
          await import("@/gemini/utils/config");
        const { readCredentials } = await import("@/persistence");
        const { ApiClient } = await import("@/api/api");

        // Try to get current user email from Happy cloud token
        let userEmail: string | undefined = undefined;
        try {
          const credentials = await readCredentials();
          if (credentials) {
            const api = await ApiClient.create(credentials);
            const vendorToken = await api.getVendorToken("gemini");
            if (vendorToken?.oauth?.id_token) {
              const parts = vendorToken.oauth.id_token.split(".");
              if (parts.length === 3) {
                const payload = JSON.parse(
                  Buffer.from(parts[1], "base64url").toString("utf8"),
                );
                userEmail = payload.email;
              }
            }
          }
        } catch {
          // If we can't get email, project will be saved globally
        }

        saveGoogleCloudProjectToConfig(projectId, userEmail);
        logger.print(`✓ Google Cloud Project set to: ${projectId}`);
        if (userEmail) {
          logger.print(`  Linked to account: ${userEmail}`);
        }
        logger.print(
          `  This project will be used for Google Workspace accounts.`,
        );
        process.exit(0);
      } catch (error) {
        logger.printError("Failed to save project configuration:", error);
        process.exit(1);
      }
    }

    // Handle "happy gemini project get" command
    if (geminiSubcommand === "project" && args[2] === "get") {
      try {
        const { readGeminiLocalConfig } = await import("@/gemini/utils/config");
        const config = await readGeminiLocalConfig();

        if (config.googleCloudProject) {
          logger.print(
            `Current Google Cloud Project: ${config.googleCloudProject}`,
          );
          if (config.googleCloudProjectEmail) {
            logger.print(
              `  Linked to account: ${config.googleCloudProjectEmail}`,
            );
          } else {
            logger.print(`  Applies to: all accounts (global)`);
          }
        } else if (process.env.GOOGLE_CLOUD_PROJECT) {
          logger.print(
            `Current Google Cloud Project: ${process.env.GOOGLE_CLOUD_PROJECT} (from env var)`,
          );
        } else {
          logger.print("No Google Cloud Project configured.");
          logger.print("");
          logger.print(
            'If you see "Authentication required" error, you may need to set a project:',
          );
          logger.print("  happy gemini project set <your-project-id>");
          logger.print("");
          logger.print("This is required for Google Workspace accounts.");
          logger.print(
            "Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca",
          );
        }
        process.exit(0);
      } catch (error) {
        logger.printError("Failed to read project configuration:", error);
        process.exit(1);
      }
    }

    // Handle "happy gemini project" (no subcommand) - show help
    if (geminiSubcommand === "project" && !args[2]) {
      logger.print("Usage: happy gemini project <command>");
      logger.print("");
      logger.print("Commands:");
      logger.print("  set <project-id>   Set Google Cloud Project ID");
      logger.print("  get                Show current Google Cloud Project ID");
      logger.print("");
      logger.print("Google Workspace accounts require a Google Cloud Project.");
      logger.print(
        'If you see "Authentication required" error, set your project ID.',
      );
      logger.print("");
      logger.print("Guide: https://goo.gle/gemini-cli-auth-docs#workspace-gca");
      process.exit(0);
    }

    // Handle gemini command (ACP-based agent)
    try {
      const { runGemini } = await import("@/gemini/runGemini");

      // Parse startedBy argument
      let startedBy: "daemon" | "terminal" | undefined = undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--started-by") {
          startedBy = args[++i] as "daemon" | "terminal";
        }
      }

      const { credentials } = await authAndSetupMachineIfNeeded();

      // Auto-start daemon for gemini (same as claude)
      logger.debug(
        "Ensuring Happy background service is running & matches our version...",
      );
      if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
        logger.debug("Starting Happy background service...");
        const daemonProcess = spawnHappyCLI(["daemon", "start-sync"], {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        daemonProcess.unref();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      await runGemini({ credentials, startedBy });
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Gemini command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "acp") {
    try {
      const { runAcp, resolveAcpAgentConfig } = await import("@/agent/acp");

      let startedBy: "daemon" | "terminal" | undefined = undefined;
      let verbose = false;
      const acpArgs: string[] = [];
      let customCommandMode = false;
      for (let i = 1; i < args.length; i++) {
        if (!customCommandMode && args[i] === "--started-by") {
          startedBy = args[++i] as "daemon" | "terminal";
          continue;
        }
        if (!customCommandMode && args[i] === "--verbose") {
          verbose = true;
          continue;
        }
        if (args[i] === "--") {
          customCommandMode = true;
        }
        acpArgs.push(args[i]);
      }

      const resolved = resolveAcpAgentConfig(acpArgs);
      const { credentials } = await authAndSetupMachineIfNeeded();

      logger.debug(
        "Ensuring Happy background service is running & matches our version...",
      );
      if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
        logger.debug("Starting Happy background service...");
        const daemonProcess = spawnHappyCLI(["daemon", "start-sync"], {
          detached: true,
          stdio: "ignore",
          env: process.env,
        });
        daemonProcess.unref();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      await runAcp({
        credentials,
        startedBy,
        verbose,
        agentName: resolved.agentName,
        command: resolved.command,
        args: resolved.args,
      });
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("ACP command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "logout") {
    // Keep for backward compatibility - redirect to auth logout
    logger.print(
      chalk.yellow(
        'Note: "happy logout" is deprecated. Use "happy auth logout" instead.\n',
      ),
    );
    try {
      await handleAuthCommand(["logout"]);
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Logout command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "notify") {
    // Handle notification command
    try {
      await handleNotifyCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Notify command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "worktree") {
    try {
      const { handleWorktreeCommand } = await import("./commands/worktree");
      await handleWorktreeCommand(args.slice(1));
    } catch (error) {
      logger.printError(
        chalk.red("Worktree error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("Worktree command error:", error);
      process.exit(1);
    }
    return;
  } else if (subcommand === "daemon") {
    const daemonSubcommand = args[1];

    if (daemonSubcommand === "automation") {
      const automationSubcommand = args[2] ?? "list";
      const jsonOutput = args.includes("--json");

      if (automationSubcommand === "list" || automationSubcommand === "status") {
        const filters = parseAutomationFilters(args);
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }

        if (jsonOutput) {
          logger.print(JSON.stringify(automationStatus, null, 2));
          return;
        }

        const jobs = filterAutomationJobs(automationStatus.jobs
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt), filters);
        const guardians = filterAutomationGuardians(automationStatus.guardians ?? [], filters);
        const derivedCounts = jobs.reduce<Record<string, number>>((acc, job) => {
          acc[job.status] = (acc[job.status] ?? 0) + 1;
          return acc;
        }, {});
        const countEntries = Object.entries(derivedCounts)
          .filter(([, value]) => value > 0)
          .sort(([a], [b]) => a.localeCompare(b));

        logger.print("Automation jobs:");
        logger.print(
          countEntries.length > 0
            ? `Counts: ${countEntries.map(([key, value]) => `${key}=${value}`).join(", ")}`
            : "Counts: none",
        );
        if (guardians.length > 0) {
          logger.print("Guardians:");
          guardians.forEach((guardian) => {
            logger.print(
              `- ${guardian.key} session=${guardian.sessionId}` +
                (guardian.attached === false ? ` state=persisted` : guardian.attached === true ? ` state=attached` : "") +
                (guardian.recovered ? ` recovered=true` : "") +
                (guardian.projectId ? ` project=${guardian.projectId}` : "") +
                (guardian.loopId ? ` loop=${guardian.loopId}` : "") +
                (guardian.lastRunId ? ` run=${guardian.lastRunId}` : ""),
            );
          });
        }
        if (automationStatus.auditStats) {
          const stats = automationStatus.auditStats;
          logger.print(
            `Stats: events=${stats.totalEvents} reuse=${stats.guardianReuseCount} reuseRate=${formatAutomationRate(stats.guardianReuseRate)} resets=${stats.guardianResetCount} reattached=${stats.sessionReattachedCount} watchdogStops=${stats.watchdogStopCount} stopRequests=${stats.stopRequestCount} policyGated=${stats.policyGatedCount} downstream=${stats.downstreamEmitCount}`,
          );
        }

        if (jobs.length === 0) {
          logger.print("No automation jobs");
          return;
        }

        jobs.forEach((job) => {
          logger.print(
            `- ${job.id} ${job.kind} ${job.status} ${job.priority} attempt=${job.attempt}/${job.maxAttempts} label=${job.label ?? job.dedupeKey}` +
              (job.projectId ? ` project=${job.projectId}` : "") +
              (job.loopId ? ` loop=${job.loopId}` : "") +
              (job.sessionId ? ` session=${job.sessionId}` : "") +
              (job.continuityKey ? ` continuity=${job.continuityKey}` : "") +
              (job.recovered ? ` recovered=true` : "") +
              (job.errorMessage ? ` error=${job.errorMessage}` : ""),
          );
        });
        return;
      }

      if (automationSubcommand === "guardians") {
        const action = args[3] ?? "list";
        const filters = parseAutomationFilters(args);
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }

        if (action === "list") {
          const guardians = filterAutomationGuardians(automationStatus.guardians ?? [], filters);
          if (jsonOutput) {
            logger.print(JSON.stringify({ guardians }, null, 2));
            return;
          }
          if (guardians.length === 0) {
            logger.print("No guardian sessions");
            return;
          }
          logger.print("Guardian sessions:");
          guardians.forEach((guardian) => {
            logger.print(
              `- ${guardian.key} session=${guardian.sessionId}` +
                (guardian.attached === false ? ` state=persisted` : guardian.attached === true ? ` state=attached` : "") +
                (guardian.recovered ? ` recovered=true` : "") +
                (guardian.projectId ? ` project=${guardian.projectId}` : "") +
                (guardian.loopId ? ` loop=${guardian.loopId}` : "") +
                (guardian.lastRunId ? ` run=${guardian.lastRunId}` : ""),
            );
          });
          return;
        }

        if (action === "clear") {
          const clearAll = args.includes("--all");
          const key = clearAll ? undefined : args[4];
          if (!clearAll && !key) {
            logger.printError("Guardian key required, or use --all");
            process.exit(1);
          }
          const result = await clearDaemonAutomationGuardians(clearAll ? { clearAll: true } : { key });
          if (!result.success) {
            logger.printError(result.errorMessage || "Failed to clear guardian sessions");
            process.exit(1);
          }
          logger.print(clearAll ? "Cleared all guardian sessions" : `Cleared guardian ${key}`);
          return;
        }

        logger.printError(`Unknown guardian action: ${action}`);
        process.exit(1);
      }

      if (automationSubcommand === "stop") {
        const jobId = args[3];
        if (!jobId) {
          logger.printError("Job ID required");
          process.exit(1);
        }
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }
        const job = automationStatus.jobs.find((entry) => entry.id === jobId);
        if (!job) {
          logger.printError(`Automation job ${jobId} not found`);
          process.exit(1);
        }
        if (!job.sessionId) {
          logger.printError(`Automation job ${jobId} has no running session`);
          process.exit(1);
        }
        const stopped = await stopDaemonSession(job.sessionId);
        if (!stopped) {
          logger.printError(`Failed to stop automation job ${jobId}`);
          process.exit(1);
        }
        logger.print(`Stopped automation job ${jobId} (session ${job.sessionId})`);
        return;
      }

      if (automationSubcommand === "cancel") {
        const jobId = args[3];
        if (!jobId) {
          logger.printError("Job ID required");
          process.exit(1);
        }
        const result = await cancelDaemonAutomationJob(jobId);
        if (!result.success) {
          logger.printError(result.errorMessage || "Failed to cancel automation job");
          process.exit(1);
        }
        logger.print(`Cancelled automation job ${jobId}`);
        return;
      }

      if (automationSubcommand === "clear") {
        const result = await clearDaemonAutomationJobs();
        if (!result.success) {
          logger.printError(result.errorMessage || "Failed to clear automation jobs");
          process.exit(1);
        }
        logger.print("Cleared terminal automation jobs");
        return;
      }

      if (automationSubcommand === "timeline") {
        const filters = parseAutomationFilters(args);
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }
        const timeline = buildAutomationTimeline(filterAutomationJobs(automationStatus.jobs, filters));
        if (jsonOutput) {
          logger.print(JSON.stringify({ timeline, guardians: automationStatus.guardians ?? [] }, null, 2));
          return;
        }
        logger.print("Automation timeline:");
        if (timeline.length === 0) {
          logger.print("No automation activity");
          return;
        }
        timeline.slice(0, 50).forEach((entry) => {
          logger.print(`- ${new Date(entry.timestamp).toLocaleString()} ${entry.label} ${entry.subtitle} job=${entry.jobId}`);
        });
        return;
      }

      if (automationSubcommand === "stats") {
        const filters = parseAutomationFilters(args);
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }

        const stats = automationStatus.auditStats;
        const guardianUsage = (automationStatus.guardianUsage ?? [])
          .filter((entry) => (!filters.projectId || entry.projectId === filters.projectId) && (!filters.loopId || entry.loopId === filters.loopId))
          .slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        if (jsonOutput) {
          logger.print(JSON.stringify({ auditStats: stats ?? null, guardianUsage }, null, 2));
          return;
        }
        if (!stats) {
          logger.print("No automation audit stats yet");
          return;
        }

        logger.print("Automation stats:");
        logger.print(`- total events: ${stats.totalEvents}`);
        logger.print(`- guardian reuse: ${stats.guardianReuseCount}`);
        logger.print(`- guardian reuse rate: ${formatAutomationRate(stats.guardianReuseRate)}`);
        logger.print(`- guardian remembered: ${stats.guardianRememberCount}`);
        logger.print(`- guardian resets: ${stats.guardianResetCount}`);
        logger.print(`- sessions reattached: ${stats.sessionReattachedCount}`);
        logger.print(`- watchdog stops: ${stats.watchdogStopCount}`);
        logger.print(`- stop requests: ${stats.stopRequestCount}`);
        logger.print(`- policy gated: ${stats.policyGatedCount}`);
        logger.print(`- downstream emitted: ${stats.downstreamEmitCount}`);
        logger.print(`- queued jobs: ${stats.queuedCount}`);
        logger.print(`- sessions started: ${stats.sessionStartedCount}`);
        logger.print(`- terminal: completed=${stats.terminalCompletedCount} failed=${stats.terminalFailedCount} cancelled=${stats.terminalCancelledCount}`);
        logger.print(`- active guardians: ${stats.activeGuardianCount}`);
        if (stats.lastEventAt) {
          logger.print(`- last event: ${new Date(stats.lastEventAt).toLocaleString()}`);
        }
        if (guardianUsage.length > 0) {
          logger.print("Guardian usage:");
          guardianUsage.slice(0, 10).forEach((entry) => {
            logger.print(
              `- ${entry.key} reuse=${entry.reuseCount} remember=${entry.rememberCount} reset=${entry.resetCount}` +
                (entry.currentSessionId ? ` session=${entry.currentSessionId}` : "") +
                ` last=${new Date(entry.lastUsedAt).toLocaleString()}`,
            );
          });
        }
        return;
      }

      if (automationSubcommand === "audit") {
        const filters = parseAutomationFilters(args);
        const automationStatus = await getDaemonAutomationStatus();
        if (!automationStatus) {
          logger.print("No daemon running");
          return;
        }

        const action = args[3] ?? "list";
        if (action === "clear") {
          const result = await clearDaemonAutomationAudit();
          if (!result.success) {
            logger.printError(result.errorMessage || "Failed to clear automation audit log");
            process.exit(1);
          }
          logger.print("Cleared automation audit log");
          return;
        }

        const recentAuditEvents = filterAutomationAudit(automationStatus.recentAuditEvents ?? [], filters);
        if (jsonOutput) {
          logger.print(JSON.stringify({ recentAuditEvents }, null, 2));
          return;
        }
        logger.print("Automation audit:");
        if (recentAuditEvents.length === 0) {
          logger.print("No automation audit events");
          return;
        }
        recentAuditEvents.slice(0, 50).forEach((event) => {
          logger.print(
            `- ${new Date(event.occurredAt).toLocaleString()} ${event.kind} ${describeAutomationAuditEvent(event)}` +
              (event.jobId ? ` job=${event.jobId}` : "") +
              (event.sessionId ? ` session=${event.sessionId}` : "") +
              (event.projectId ? ` project=${event.projectId}` : "") +
              (event.loopId ? ` loop=${event.loopId}` : ""),
          );
        });
        return;
      }


      if (automationSubcommand === "retry") {
        const jobId = args[3];
        if (!jobId) {
          logger.printError("Job ID required");
          process.exit(1);
        }
        const result = await retryDaemonAutomationJob(jobId);
        if (!result.success) {
          logger.printError(result.errorMessage || "Failed to retry automation job");
          process.exit(1);
        }
        logger.print(`Re-queued automation job ${jobId}`);
        return;
      }

      logger.print(`
${chalk.bold("happy daemon automation")} - Automation job management

${chalk.bold("Usage:")}
  happy daemon automation list [--json] [--running|--failed|--terminal] [--project <id>] [--loop <id>] [--kind <kind>]
  happy loop create --path <dir> --interval <10m> --prompt <text>
                                               List automation jobs
  happy daemon automation stats [--json] [--project <id>] [--loop <id>]
                                               Show audit + guardian metrics
  happy daemon automation audit [--json] [--anomalies|--guardian|--jobs] [--project <id>] [--loop <id>]
                                               Show recent audit events
  happy daemon automation audit clear           Clear audit history
  happy daemon automation timeline [--json] [--running|--failed|--terminal] [--project <id>] [--loop <id>] [--kind <kind>]
                                               Show derived automation timeline
  happy daemon automation guardians [--json] [--attached|--persisted] [--project <id>] [--loop <id>]
                                               List guardian sessions
  happy daemon automation guardians clear <key> Clear one guardian
  happy daemon automation guardians clear --all Clear all guardians
  happy daemon automation stop <jobId>          Stop a running automation job
  happy daemon automation retry <jobId>         Retry a job now
  happy daemon automation cancel <jobId>        Cancel a queued job
  happy daemon automation clear                 Clear terminal jobs
`);
      return;
    }

    if (daemonSubcommand === "list") {
      try {
        const sessions = await listDaemonSessions();

        if (sessions.length === 0) {
          logger.print(
            "No active sessions this daemon is aware of (they might have been started by a previous version of the daemon)",
          );
        } else {
          logger.print("Active sessions:");
          logger.print(JSON.stringify(sessions, null, 2));
        }
      } catch (error) {
        logger.print("No daemon running");
      }
      return;
    } else if (daemonSubcommand === "stop-session") {
      const sessionId = args[2];
      if (!sessionId) {
        logger.printError("Session ID required");
        process.exit(1);
      }

      try {
        const success = await stopDaemonSession(sessionId);
        logger.print(success ? "Session stopped" : "Failed to stop session");
      } catch (error) {
        logger.print("No daemon running");
      }
      return;
    } else if (daemonSubcommand === "start") {
      // Spawn detached daemon process
      const child = spawnHappyCLI(["daemon", "start-sync"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();

      // Wait for daemon to write state file (up to 5 seconds)
      let started = false;
      for (let i = 0; i < 50; i++) {
        if ((await checkDaemonStatus()).status === 'running') {
          started = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (started) {
        logger.print("Daemon started successfully");
      } else {
        logger.printError("Failed to start daemon");
        process.exit(1);
      }
      process.exit(0);
    } else if (daemonSubcommand === "start-sync") {
      await startDaemon();
      process.exit(0);
    } else if (daemonSubcommand === "stop") {
      await stopDaemon();
      process.exit(0);
    } else if (daemonSubcommand === "status") {
      // Show daemon-specific doctor output
      await runDoctorCommand("daemon");
      process.exit(0);
    } else if (daemonSubcommand === "logs") {
      // Simply print the path to the latest daemon log file
      const latest = await getLatestDaemonLog();
      if (!latest) {
        logger.print("No daemon logs found");
      } else {
        logger.print(latest.path);
      }
      process.exit(0);
    } else if (daemonSubcommand === "install") {
      try {
        await install();
      } catch (error) {
        logger.printError(
          chalk.red("Error:"),
          error instanceof Error ? error.message : "Unknown error",
        );
        process.exit(1);
      }
    } else if (daemonSubcommand === "uninstall") {
      try {
        await uninstall();
      } catch (error) {
        logger.printError(
          chalk.red("Error:"),
          error instanceof Error ? error.message : "Unknown error",
        );
        process.exit(1);
      }
    } else {
      logger.print(`
${chalk.bold("happy daemon")} - Daemon management

${chalk.bold("Usage:")}
  happy daemon start              Start the daemon (detached)
  happy daemon stop               Stop the daemon (sessions stay alive)
  happy daemon status             Show daemon status
  happy daemon list               List active sessions
  happy daemon automation list    List automation jobs
  happy supervisor loop status    Show active autonomous loop

  If you want to kill all happy related processes run 
  ${chalk.cyan("happy doctor clean")}

${chalk.bold("Note:")} The daemon runs in the background and manages Claude sessions.

${chalk.bold("To clean up runaway processes:")} Use ${chalk.cyan("happy doctor clean")}
`);
    }
    return;
  } else {
    // If the first argument is claude, remove it
    if (args.length > 0 && args[0] === "claude") {
      args.shift();
    }

    // Parse command line arguments for main command
    const options: StartOptions = {};
    let showHelp = false;
    let showVersion = false;
    let chromeOverride: boolean | undefined = undefined; // Track explicit --chrome or --no-chrome
    const unknownArgs: string[] = []; // Collect unknown args to pass through to claude
    const parsedSandboxFlag = extractNoSandboxFlag(args);
    options.noSandbox = parsedSandboxFlag.noSandbox;
    args.length = 0;
    args.push(...parsedSandboxFlag.args);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "-h" || arg === "--help") {
        showHelp = true;
        // Also pass through to claude
        unknownArgs.push(arg);
      } else if (arg === "-v" || arg === "--version") {
        showVersion = true;
        // Also pass through to claude (will show after our version)
        unknownArgs.push(arg);
      } else if (arg === "--happy-starting-mode") {
        options.startingMode = z.enum(["local", "remote"]).parse(args[++i]);
      } else if (arg === "--yolo") {
        // Shortcut for --dangerously-skip-permissions
        unknownArgs.push("--dangerously-skip-permissions");
      } else if (arg === "--started-by") {
        options.startedBy = args[++i] as "daemon" | "terminal";
      } else if (arg === "--happy-session-id") {
        options.happySessionId = args[++i];
      } else if (arg === "--js-runtime") {
        const runtime = args[++i];
        if (runtime !== "node" && runtime !== "bun") {
          logger.printError(
            chalk.red(
              `Invalid --js-runtime value: ${runtime}. Must be 'node' or 'bun'`,
            ),
          );
          process.exit(1);
        }
        options.jsRuntime = runtime;
      } else if (arg === "--claude-env") {
        // Parse KEY=VALUE environment variable to pass to Claude
        const envArg = args[++i];
        if (envArg && envArg.includes("=")) {
          const eqIndex = envArg.indexOf("=");
          const key = envArg.substring(0, eqIndex);
          const value = envArg.substring(eqIndex + 1);
          options.claudeEnvVars = options.claudeEnvVars || {};
          options.claudeEnvVars[key] = value;
        } else {
          logger.printError(
            chalk.red(
              `Invalid --claude-env format: ${envArg}. Expected KEY=VALUE`,
            ),
          );
          process.exit(1);
        }
      } else if (arg === "--chrome") {
        chromeOverride = true;
        // We'll add --chrome to claudeArgs after resolving settings default
      } else if (arg === "--no-chrome") {
        chromeOverride = false;
        // Happy-specific flag to disable chrome even if default is on
      } else if (arg === "--settings") {
        // Intercept --settings flag - Happy uses this internally for session hooks
        const settingsValue = args[++i]; // consume the value
        logger.warn(
          chalk.yellow(
            `⚠️  Warning: --settings is used internally by Happy for session tracking.`,
          ),
        );
        logger.warn(
          chalk.yellow(
            `   Your settings file "${settingsValue}" will be ignored.`,
          ),
        );
        logger.warn(
          chalk.yellow(
            `   To configure Claude, edit ~/.claude/settings.json instead.`,
          ),
        );
        // Don't pass through to claudeArgs
      } else {
        // Pass unknown arguments through to claude
        unknownArgs.push(arg);
        // Check if this arg expects a value (simplified check for common patterns)
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          unknownArgs.push(args[++i]);
        }
      }
    }

    // Add unknown args to claudeArgs
    if (unknownArgs.length > 0) {
      options.claudeArgs = [...(options.claudeArgs || []), ...unknownArgs];
    }

    // Resolve Chrome mode: explicit flag > settings > false
    const settings = await readSettings();
    const chromeEnabled = chromeOverride ?? settings.chromeMode ?? false;
    if (chromeEnabled) {
      options.claudeArgs = [...(options.claudeArgs || []), "--chrome"];
    }

    // Show help
    if (showHelp) {
      logger.print(`
${chalk.bold("happy")} - Claude Code On the Go

${chalk.bold("Usage:")}
  happy [options]         Start Claude with mobile control
  happy auth              Manage authentication
  happy codex             Start Codex mode
  happy gemini            Start Gemini mode (ACP)
  happy acp               Start a generic ACP-compatible agent
  happy connect           Connect AI vendor API keys
  happy sandbox           Configure and manage OS-level sandboxing
  happy supervisor        Manage supervisor summary, config, and autonomous loops
  happy notify            Send push notification
  happy daemon            Manage background service that allows
                            to spawn new sessions away from your computer
  happy doctor            System diagnostics & troubleshooting

${chalk.bold("Examples:")}
  happy                    Start session
  happy --yolo             Start with bypassing permissions
                            happy sugar for --dangerously-skip-permissions
  happy --chrome           Enable Chrome browser access for this session
  happy --no-chrome        Disable Chrome even if default is on
  happy --no-sandbox       Disable Happy sandbox for this session
  happy --js-runtime bun   Use bun instead of node to spawn Claude Code
  happy --claude-env ANTHROPIC_BASE_URL=http://127.0.0.1:3456
                           Use a custom API endpoint (e.g., claude-code-router)
  happy acp gemini         Start Gemini via generic ACP runner
  happy acp -- opencode --acp
                           Start a custom ACP command
  happy acp opencode --verbose
                           Print raw ACP backend/envelope events
  happy auth login --force Authenticate
  happy doctor             Run diagnostics
  happy supervisor summary --path ~/repo
                           Inspect health, schedule, and active loop
  happy supervisor loop start --path ~/repo --max-iterations 8
                           Start an autonomous maintenance loop

${chalk.bold("Happy supports ALL Claude options!")}
  Use any claude flag with happy as you would with claude. Our favorite:

  happy --resume

${chalk.gray("─".repeat(60))}
${chalk.bold.cyan("Claude Code Options (from `claude --help`):")}
`);

      // Run claude --help and display its output
      // Use execFileSync directly with claude CLI for runtime-agnostic compatibility
      try {
        const claudeHelp = execFileSync(claudeCliPath, ["--help"], {
          encoding: "utf8",
        });
        logger.print(claudeHelp);
      } catch (e) {
        logger.print(
          chalk.yellow(
            "Could not retrieve claude help. Make sure claude is installed.",
          ),
        );
      }

      process.exit(0);
    }

    // Show version
    if (showVersion) {
      logger.print(`happy version: ${packageJson.version}`);
      // Don't exit - continue to pass --version to Claude Code
    }

    // Normal flow - auth and machine setup
    const { credentials } = await authAndSetupMachineIfNeeded();

    // Always auto-start daemon for simplicity
    logger.debug(
      "Ensuring Happy background service is running & matches our version...",
    );

    if (!(await isDaemonRunningCurrentlyInstalledHappyVersion())) {
      logger.debug("Starting Happy background service...");

      // Use the built binary to spawn daemon
      const daemonProcess = spawnHappyCLI(["daemon", "start-sync"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      daemonProcess.unref();

      // Give daemon a moment to write PID & port file
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Start the CLI
    try {
      await runClaude(credentials, options);
    } catch (error) {
      logger.printError(
        chalk.red("Error:"),
        error instanceof Error ? error.message : "Unknown error",
      );
      logger.debug("CLI startup error:", error);
      process.exit(1);
    }
  }
})();

/**
 * Handle notification command
 */
async function handleNotifyCommand(args: string[]): Promise<void> {
  let message = "";
  let title = "";
  let showHelp = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-p" && i + 1 < args.length) {
      message = args[++i];
    } else if (arg === "-t" && i + 1 < args.length) {
      title = args[++i];
    } else if (arg === "-h" || arg === "--help") {
      showHelp = true;
    } else {
      logger.printError(chalk.red(`Unknown argument for notify command: ${arg}`));
      process.exit(1);
    }
  }

  if (showHelp) {
    logger.print(`
${chalk.bold("happy notify")} - Send notification

${chalk.bold("Usage:")}
  happy notify -p <message> [-t <title>]    Send notification with custom message and optional title
  happy notify -h, --help                   Show this help

${chalk.bold("Options:")}
  -p <message>    Notification message (required)
  -t <title>      Notification title (optional, defaults to "Happy")

${chalk.bold("Examples:")}
  happy notify -p "Deployment complete!"
  happy notify -p "System update complete" -t "Server Status"
  happy notify -t "Alert" -p "Database connection restored"
`);
    return;
  }

  if (!message) {
    logger.printError(
      chalk.red(
        'Error: Message is required. Use -p "your message" to specify the notification text.',
      ),
    );
    logger.print(chalk.gray('Run "happy notify --help" for usage information.'));
    process.exit(1);
  }

  // Load credentials
  let credentials = await readCredentials();
  if (!credentials) {
    logger.printError(
      chalk.red(
        'Error: Not authenticated. Please run "happy auth login" first.',
      ),
    );
    process.exit(1);
  }

  logger.print(chalk.blue("📱 Sending push notification..."));

  try {
    // Create API client and send push notification
    const api = await ApiClient.create(credentials);

    // Use custom title or default to "Happy"
    const notificationTitle = title || "Happy";

    // Send the push notification
    api.push().sendToAllDevices(notificationTitle, message, {
      source: "cli",
      timestamp: Date.now(),
    });

    logger.print(chalk.green("✓ Push notification sent successfully!"));
    logger.print(chalk.gray(`  Title: ${notificationTitle}`));
    logger.print(chalk.gray(`  Message: ${message}`));
    logger.print(chalk.gray("  Check your mobile device for the notification."));

    // Give a moment for the async operation to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    logger.printError(chalk.red("✗ Failed to send push notification"));
    throw error;
  }
}
