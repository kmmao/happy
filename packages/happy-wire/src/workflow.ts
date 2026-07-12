import * as z from "zod";

/**
 * Dynamic Workflows (Phase 5).
 *
 * A workflow captures a multi-role build: several sub-agents (e.g. a frontend
 * agent and a backend/Prisma agent) each with their own prompt and model, run
 * in ordered "waves". Steps sharing an `order` run concurrently; ascending
 * orders run sequentially. Once a workflow completes it is persisted to
 * `.happy/workflows/<id>.js` as a runnable, self-contained script so the exact
 * multi-agent build can be replayed deterministically.
 *
 * The schema lives in wire so the CLI (runner + serializer), Server, and App
 * all agree on the workflow shape.
 */

export const WorkflowStepSchema = z.object({
  /** Stable id, unique within the workflow. */
  id: z.string(),
  /** Human role label, e.g. "frontend", "backend-prisma". */
  role: z.string(),
  /** The full prompt handed to this sub-agent. */
  prompt: z.string(),
  /** Resolved model id for this step (undefined = runner default). */
  model: z.string().optional(),
  /**
   * Execution wave. Steps with the same order run concurrently (Promise.all);
   * lower orders complete before higher orders start.
   */
  order: z.number().int().nonnegative(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  /** The overall goal this workflow was decomposed from. */
  goal: z.string(),
  createdAt: z.number(),
  steps: z.array(WorkflowStepSchema),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ===== Live run state (Phase 5 progress reporting) =====

/** Per-step lifecycle status, written incrementally as a workflow runs. */
export const WorkflowStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const WorkflowRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

/**
 * A workflow run's live state, persisted to `<cwd>/.happy/workflows/<id>.json`
 * and updated after every step transition. The mobile app reads this file to
 * render real-time progress (polling while `status === "running"`).
 */
export const WorkflowRunSchema = z.object({
  definition: WorkflowDefinitionSchema,
  status: WorkflowRunStatusSchema,
  steps: z.record(z.string(), WorkflowStepStatusSchema),
  /**
   * Per-step git branch, present when the run used worktree isolation — each
   * sub-agent works on its own branch for conflict-free parallelism + review.
   */
  branches: z.record(z.string(), z.string()).optional(),
  /** Per-step sub-agent output (truncated), for on-device review. */
  outputs: z.record(z.string(), z.string()).optional(),
  updatedAt: z.number(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

/**
 * Group steps into ordered waves (ascending `order`). Each inner array is a set
 * of steps to run concurrently. Pure — shared by the runner and any UI preview.
 */
export function groupWorkflowWaves(steps: WorkflowStep[]): WorkflowStep[][] {
  const byOrder = new Map<number, WorkflowStep[]>();
  for (const step of steps) {
    const wave = byOrder.get(step.order) ?? [];
    wave.push(step);
    byOrder.set(step.order, wave);
  }
  return [...byOrder.keys()]
    .sort((a, b) => a - b)
    .map((order) => byOrder.get(order)!);
}
