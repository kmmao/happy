import { execFile } from "node:child_process";
import type { WorkflowStep } from "@kmmao/happy-wire";
import type { WorkflowStepExecutor, WorkflowStepResult } from "./runWorkflow";
import { createWorktreeLocal } from "@/webhook/createWorktreeLocal";
import { logger } from "@/ui/logger";

/**
 * Real sub-agent spawn for Dynamic Workflows (Phase 5).
 *
 * Each workflow step becomes a headless Claude Code invocation:
 *
 *   claude -p "<role prompt>" --model <id> --output-format text
 *
 * run concurrently by the wave runner (`runWorkflow`). The command build is a
 * pure seam so it can be unit-tested without spawning anything, and the process
 * runner is injectable so the executor itself is testable with a fake.
 */

export interface SubAgentSpawnOptions {
  /** Working directory each sub-agent runs in (the project dir). */
  cwd: string;
  /** Claude executable — defaults to `claude` on PATH. */
  claudeBin?: string;
  /** Per-step timeout in ms (default 10 min). */
  timeoutMs?: number;
  /**
   * When true, each sub-agent runs in its own git worktree (a fresh branch off
   * the current one) so concurrent steps can't clobber each other's files and
   * each agent's work is reviewable / mergeable independently. The workflow id
   * scopes the branch prefix.
   */
  isolation?: boolean;
  /** Workflow id — used to prefix isolation branch names. */
  workflowId?: string;
}

/** Optional lifecycle hooks (e.g. surface an isolation branch as it's created). */
export interface SubAgentExecutorHooks {
  onBranch?: (stepId: string, branch: string) => void;
}

export interface SubAgentCommand {
  file: string;
  args: string[];
}

/** Build the headless `claude -p` command for a step. Pure. */
export function buildSubAgentCommand(
  step: WorkflowStep,
  opts: SubAgentSpawnOptions,
): SubAgentCommand {
  const args = ["-p", step.prompt, "--output-format", "text"];
  if (step.model) {
    args.push("--model", step.model);
  }
  return { file: opts.claudeBin ?? "claude", args };
}

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable process runner. Never rejects — failures surface as exitCode. */
export type CommandRunner = (
  cmd: SubAgentCommand,
  opts: { cwd: string; timeoutMs: number },
) => Promise<CommandRunResult>;

/** Default runner: spawns the real process via execFile. */
export const defaultCommandRunner: CommandRunner = (cmd, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd.file,
      cmd.args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        });
      },
    );
  });

/**
 * Build a WorkflowStepExecutor that spawns a real headless Claude sub-agent per
 * step. Pass a fake `runner` in tests to exercise the executor without a real
 * process.
 */
export function makeClaudeSubAgentExecutor(
  opts: SubAgentSpawnOptions,
  runner: CommandRunner = defaultCommandRunner,
  hooks?: SubAgentExecutorHooks,
): WorkflowStepExecutor {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  return async (step: WorkflowStep): Promise<WorkflowStepResult> => {
    // Isolation: give this step its own worktree/branch off the project dir so
    // concurrent steps never touch the same working tree. Best-effort — if the
    // worktree can't be created (e.g. not a git repo), fall back to the shared
    // cwd rather than failing the step.
    let runCwd = opts.cwd;
    let branch: string | undefined;
    if (opts.isolation) {
      const wt = await createWorktreeLocal(opts.cwd, {
        prefix: `wf-${(opts.workflowId ?? "run").slice(0, 12)}-${step.id}`,
      });
      if (wt.success) {
        runCwd = wt.worktreePath;
        branch = wt.branchName;
        hooks?.onBranch?.(step.id, wt.branchName);
      } else {
        logger.debug(`Worktree isolation failed for ${step.id}, using shared cwd: ${wt.error}`);
      }
    }

    const cmd = buildSubAgentCommand(step, opts);
    const res = await runner(cmd, { cwd: runCwd, timeoutMs });
    return {
      stepId: step.id,
      role: step.role,
      ok: res.exitCode === 0,
      output: res.stdout.trim() || undefined,
      error: res.exitCode === 0 ? undefined : res.stderr.trim() || `exit ${res.exitCode}`,
      branch,
    };
  };
}
