import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepStatus,
} from "@kmmao/happy-wire";

/**
 * Live run-state writer for Phase 5 progress reporting. Persists a workflow's
 * per-step status to `<workflowsDir>/<id>.json`, rewritten on every transition
 * so the mobile app can poll it and render real-time progress.
 *
 * Kept separate from the `.js` replay artifact (persistWorkflow): the `.js` is
 * the deterministic re-run script, the `.json` is the mutable run state.
 */
export class WorkflowRunReporter {
  private readonly filePath: string;
  private readonly steps: Record<string, WorkflowStepStatus>;
  private readonly branches: Record<string, string> = {};
  private readonly outputs: Record<string, string> = {};
  // Serialize writes so overlapping transitions can't interleave / land out of
  // order — each note() chains its flush after the previous one.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly definition: WorkflowDefinition,
    private readonly workflowsDir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.filePath = join(workflowsDir, `${definition.id}.json`);
    this.steps = Object.fromEntries(
      definition.steps.map((s) => [s.id, "pending" as WorkflowStepStatus]),
    );
  }

  private build(status: WorkflowRunStatus): WorkflowRun {
    const hasBranches = Object.keys(this.branches).length > 0;
    const hasOutputs = Object.keys(this.outputs).length > 0;
    return {
      definition: this.definition,
      status,
      steps: { ...this.steps },
      ...(hasBranches ? { branches: { ...this.branches } } : {}),
      ...(hasOutputs ? { outputs: { ...this.outputs } } : {}),
      updatedAt: this.now(),
    };
  }

  private enqueueFlush(status: WorkflowRunStatus): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.workflowsDir, { recursive: true });
      await writeFile(
        this.filePath,
        JSON.stringify(this.build(status), null, 2),
        "utf8",
      );
    });
    return this.writeChain;
  }

  /** Write the initial all-pending state. */
  async start(): Promise<void> {
    await this.enqueueFlush("running");
  }

  /**
   * Record a step transition (sync-callback friendly). Mutates in memory
   * immediately and enqueues a serialized flush; safe to call from the
   * runWorkflow `onStepStatus` hook without awaiting.
   */
  note(stepId: string, status: WorkflowStepStatus): void {
    if (stepId in this.steps) this.steps[stepId] = status;
    void this.enqueueFlush("running");
  }

  /** Record the isolation branch a step is running on. */
  noteBranch(stepId: string, branch: string): void {
    this.branches[stepId] = branch;
    void this.enqueueFlush("running");
  }

  /** Record a step's output (truncated to keep the run-state file small). */
  noteOutput(stepId: string, output: string): void {
    const MAX = 8_000;
    this.outputs[stepId] =
      output.length > MAX ? `${output.slice(0, MAX)}\n… (truncated)` : output;
    void this.enqueueFlush("running");
  }

  /** Await pending writes, then write the terminal state. */
  async finish(status: WorkflowRunStatus): Promise<string> {
    await this.writeChain;
    await this.enqueueFlush(status);
    return this.filePath;
  }
}
