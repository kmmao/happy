import {
  groupWorkflowWaves,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowStepStatus,
} from "@kmmao/happy-wire";

/**
 * Dynamic Workflow runner (Phase 5).
 *
 * Executes a workflow's steps in ordered waves: steps sharing an `order` run
 * concurrently via `Promise.all`; ascending orders run sequentially so a later
 * wave can rely on earlier waves having finished (e.g. a "wire up" wave after
 * the parallel frontend + backend build wave).
 *
 * The actual sub-agent spawn is injected as `executor`, keeping this pure and
 * unit-testable. Production wiring passes an executor that launches a Claude
 * sub-agent session with the step's prompt + model.
 */

export type WorkflowStepExecutor = (
  step: WorkflowStep,
) => Promise<WorkflowStepResult>;

export interface WorkflowStepResult {
  stepId: string;
  role: string;
  ok: boolean;
  output?: string;
  error?: string;
  /** Git branch this step ran on, when worktree isolation was used. */
  branch?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  results: WorkflowStepResult[];
  ok: boolean;
  /** True when the run was aborted before all waves completed. */
  cancelled: boolean;
}

/**
 * Run a workflow to completion. A failing step does not abort its concurrent
 * wave (all steps in the wave settle), but a wave with any failure stops
 * subsequent waves — later waves typically depend on earlier ones, so running
 * them against a broken foundation would produce misleading results.
 */
/**
 * Optional progress hook fired on each step transition. Used by the CLI command
 * to persist a live `<id>.json` run-state file the app polls.
 */
export type StepStatusListener = (
  stepId: string,
  status: WorkflowStepStatus,
) => void;

export async function runWorkflow(
  definition: WorkflowDefinition,
  executor: WorkflowStepExecutor,
  onStepStatus?: StepStatusListener,
  onStepResult?: (result: WorkflowStepResult) => void,
  signal?: AbortSignal,
): Promise<WorkflowRunResult> {
  const waves = groupWorkflowWaves(definition.steps);
  const results: WorkflowStepResult[] = [];
  let ok = true;
  let cancelled = false;

  for (const wave of waves) {
    // Stop before starting a new wave if the run was cancelled. In-flight steps
    // of the current wave are killed via the executor's abort signal.
    if (signal?.aborted) {
      cancelled = true;
      ok = false;
      break;
    }
    const settled = await Promise.all(
      wave.map(async (step): Promise<WorkflowStepResult> => {
        onStepStatus?.(step.id, "running");
        try {
          const r = await executor(step);
          onStepStatus?.(step.id, r.ok ? "succeeded" : "failed");
          onStepResult?.(r);
          return r;
        } catch (err) {
          onStepStatus?.(step.id, "failed");
          return {
            stepId: step.id,
            role: step.role,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...settled);
    if (signal?.aborted) {
      cancelled = true;
      ok = false;
      break;
    }
    if (settled.some((r) => !r.ok)) {
      ok = false;
      break;
    }
  }

  return { workflowId: definition.id, results, ok, cancelled };
}
