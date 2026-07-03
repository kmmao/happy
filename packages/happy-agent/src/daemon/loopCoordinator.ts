/**
 * AgentLoopCoordinator — lightweight loop scheduler for agent daemon.
 *
 * A "loop" is a recurring autonomous task: run a prompt in a directory
 * at a fixed interval. The coordinator polls every second, enqueues
 * due loops into the AutomationScheduler, and tracks iteration state.
 *
 * Simplified from CLI's full coordinator — no cron, quiet hours,
 * downstream chains, notifications, or memory snapshots.
 */

import { randomUUID } from "crypto";
import { logger } from "../logger";
import type { AutomationScheduler } from "./scheduler";
import type { GuardianSessionRegistry } from "./guardianRegistry";
import { spawnSession } from "./spawnSession";
import { bindJobToSessionExit } from "./bindJobToSessionExit";
import { join } from "path";
import { tmpdir } from "os";
import { writePromptFile } from "./promptFileWriter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoopState = "idle" | "active" | "paused" | "blocked";

export interface AgentLoop {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly directory: string;
  readonly intervalMs: number;
  readonly createdAt: number;

  state: LoopState;
  iteration: number;
  nextRunAt: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  activeJobId?: string;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  maxIterations: number;
  errorMessage?: string;
}

export interface CreateLoopInput {
  name: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  maxConsecutiveFailures?: number;
  maxIterations?: number;
}

export interface LoopSummary {
  id: string;
  name: string;
  state: LoopState;
  iteration: number;
  intervalMs: number;
  nextRunAt: number;
  lastCompletedAt?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMPT_DIR = join(tmpdir(), "happy", "agent-loop-prompts");
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_MAX_ITERATIONS = 0; // 0 = unlimited

// ---------------------------------------------------------------------------
// LoopCoordinator
// ---------------------------------------------------------------------------

export class AgentLoopCoordinator {
  private readonly loops = new Map<string, AgentLoop>();
  private readonly scheduler: AutomationScheduler;
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly guardian: GuardianSessionRegistry | null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    scheduler: AutomationScheduler,
    serverUrl: string,
    authToken: string,
    guardian?: GuardianSessionRegistry,
  ) {
    this.scheduler = scheduler;
    this.serverUrl = serverUrl;
    this.authToken = authToken;
    this.guardian = guardian ?? null;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    logger.debug("[LOOP] Coordinator started");
  }

  shutdown(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    logger.debug("[LOOP] Coordinator shutdown");
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  createLoop(input: CreateLoopInput): AgentLoop {
    const loop: AgentLoop = {
      id: randomUUID(),
      name: input.name,
      prompt: input.prompt,
      directory: input.directory,
      intervalMs: Math.max(input.intervalMs, 10_000), // min 10s
      createdAt: Date.now(),
      state: "idle",
      iteration: 0,
      nextRunAt: Date.now() + Math.max(input.intervalMs, 10_000),
      consecutiveFailures: 0,
      maxConsecutiveFailures: input.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
      maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    };

    this.loops.set(loop.id, loop);
    logger.debug(`[LOOP] Created: ${loop.name} (${loop.id}) interval=${loop.intervalMs}ms`);
    return loop;
  }

  getLoop(id: string): AgentLoop | undefined {
    return this.loops.get(id);
  }

  listLoops(): LoopSummary[] {
    return [...this.loops.values()].map((l) => ({
      id: l.id,
      name: l.name,
      state: l.state,
      iteration: l.iteration,
      intervalMs: l.intervalMs,
      nextRunAt: l.nextRunAt,
      lastCompletedAt: l.lastCompletedAt,
    }));
  }

  pauseLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop || loop.state === "paused") return false;
    loop.state = "paused";
    logger.debug(`[LOOP] Paused: ${loop.name} (${id})`);
    return true;
  }

  resumeLoop(id: string): boolean {
    const loop = this.loops.get(id);
    if (!loop || loop.state !== "paused") return false;
    loop.state = "idle";
    loop.nextRunAt = Date.now() + loop.intervalMs;
    loop.consecutiveFailures = 0;
    loop.errorMessage = undefined;
    logger.debug(`[LOOP] Resumed: ${loop.name} (${id})`);
    return true;
  }

  deleteLoop(id: string): boolean {
    const deleted = this.loops.delete(id);
    if (deleted) logger.debug(`[LOOP] Deleted: ${id}`);
    return deleted;
  }

  // -----------------------------------------------------------------------
  // Scheduler callback
  // -----------------------------------------------------------------------

  onJobTerminal(loopId: string, status: "completed" | "failed", errorMessage?: string): void {
    const loop = this.loops.get(loopId);
    if (!loop) return;

    loop.activeJobId = undefined;
    loop.lastCompletedAt = Date.now();

    if (status === "completed") {
      loop.consecutiveFailures = 0;
      loop.state = "idle";
      loop.nextRunAt = Date.now() + loop.intervalMs;
      logger.debug(`[LOOP] Iteration ${loop.iteration} completed: ${loop.name}`);
    } else {
      loop.consecutiveFailures++;
      loop.errorMessage = errorMessage;

      if (loop.consecutiveFailures >= loop.maxConsecutiveFailures) {
        loop.state = "blocked";
        logger.debug(`[LOOP] Blocked after ${loop.consecutiveFailures} failures: ${loop.name}`);
      } else {
        loop.state = "idle";
        loop.nextRunAt = Date.now() + loop.intervalMs;
        logger.debug(`[LOOP] Iteration ${loop.iteration} failed (${loop.consecutiveFailures}/${loop.maxConsecutiveFailures}): ${loop.name}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  private tick(): void {
    const now = Date.now();

    for (const loop of this.loops.values()) {
      if (loop.state !== "idle") continue;
      if (loop.nextRunAt > now) continue;

      // Max iterations check
      if (loop.maxIterations > 0 && loop.iteration >= loop.maxIterations) {
        loop.state = "paused";
        logger.debug(`[LOOP] Max iterations reached (${loop.maxIterations}): ${loop.name}`);
        continue;
      }

      this.enqueueLoop(loop);
    }
  }

  private enqueueLoop(loop: AgentLoop): void {
    loop.iteration++;
    loop.state = "active";
    loop.lastStartedAt = Date.now();

    const iterationNum = loop.iteration;
    const loopId = loop.id;
    const coordinator = this;

    // Resolve guardian session for resumption
    const guardianSessionId = this.guardian?.resolve({ loopId: loop.id }) ?? undefined;

    const { job, deduped } = this.scheduler.enqueue({
      kind: "task",
      dedupeKey: `agent-loop:${loop.id}:${loop.iteration}`,
      priority: "background",
      run: async (jobId) => {
        const promptFile = await writeLoopPromptFile(loop.name, loop.prompt, iterationNum);

        const result = await spawnSession({
          directory: loop.directory,
          approvedNewDirectoryCreation: false,
          happySessionId: guardianSessionId,
          automationContext: {
            kind: "agent_loop",
            trigger: `loop:${loop.name}:iteration-${iterationNum}`,
          },
          environmentVariables: {
            HAPPY_INITIAL_PROMPT_FILE: promptFile,
            HAPPY_LOOP_ID: loopId,
            HAPPY_LOOP_NAME: loop.name,
            HAPPY_LOOP_ITERATION: String(iterationNum),
            HAPPY_SERVER_URL: coordinator.serverUrl,
            HAPPY_AUTH_TOKEN: coordinator.authToken,
          },
        });

        if (result.type !== "success") {
          throw new Error(result.type === "error" ? result.errorMessage : "Directory not approved");
        }

        await bindJobToSessionExit({
          scheduler: coordinator.scheduler,
          jobId,
          pid: result.pid,
          onExit: ({ status, code }) =>
            coordinator.onJobTerminal(loopId, status, code !== 0 ? `exit code ${code}` : undefined),
        });

        return { pid: result.pid };
      },
    });

    if (deduped) {
      // Revert — scheduler says duplicate
      loop.iteration--;
      loop.state = "idle";
      logger.debug(`[LOOP] Enqueue deduped: ${loop.name} iteration ${iterationNum}`);
    } else {
      loop.activeJobId = job.id;
      logger.debug(`[LOOP] Enqueued: ${loop.name} iteration ${iterationNum} job=${job.id}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeLoopPromptFile(name: string, prompt: string, iteration: number): Promise<string> {
  const filename = `loop-${name.replace(/[^a-zA-Z0-9-]/g, "_")}-${iteration}-${Date.now()}.md`;
  const content = [
    `# Agent Loop: ${name}`,
    `Iteration: ${iteration}`,
    "",
    prompt,
  ].join("\n");
  return writePromptFile(PROMPT_DIR, filename, content);
}
