import {
  groupWorkflowWaves,
  type WorkflowDefinition,
  type WorkflowStep,
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
}

export interface WorkflowRunResult {
  workflowId: string;
  results: WorkflowStepResult[];
  ok: boolean;
}

/**
 * Run a workflow to completion. A failing step does not abort its concurrent
 * wave (all steps in the wave settle), but a wave with any failure stops
 * subsequent waves — later waves typically depend on earlier ones, so running
 * them against a broken foundation would produce misleading results.
 */
export async function runWorkflow(
  definition: WorkflowDefinition,
  executor: WorkflowStepExecutor,
): Promise<WorkflowRunResult> {
  const waves = groupWorkflowWaves(definition.steps);
  const results: WorkflowStepResult[] = [];
  let ok = true;

  for (const wave of waves) {
    const settled = await Promise.all(
      wave.map(async (step): Promise<WorkflowStepResult> => {
        try {
          return await executor(step);
        } catch (err) {
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
    if (settled.some((r) => !r.ok)) {
      ok = false;
      break;
    }
  }

  return { workflowId: definition.id, results, ok };
}
