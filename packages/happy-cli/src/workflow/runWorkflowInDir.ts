import { join } from "node:path";
import type { WorkflowDefinition } from "@kmmao/happy-wire";
import { runWorkflow, type WorkflowStepExecutor } from "./runWorkflow";
import { persistWorkflow } from "./persistWorkflow";
import { WorkflowRunReporter } from "./persistWorkflowRun";
import { makeClaudeSubAgentExecutor } from "./spawnClaudeSubAgent";

/**
 * Run a workflow in a project directory end-to-end (Phase 5): live run-state
 * reporting → concurrent wave execution → persisted replay `.js`. Shared by
 * both entry points — the `happy workflow run` CLI command and the app-facing
 * `workflowRun` RPC handler — so they behave identically.
 */

/** No-op executor: exercises the pipeline without spawning agents / spending tokens. */
export const dryRunExecutor: WorkflowStepExecutor = async (step) => ({
  stepId: step.id,
  role: step.role,
  ok: true,
  output: `[dry-run] ${step.role} (${step.model ?? "default"}): ${step.prompt.slice(0, 60)}`,
});

export interface RunWorkflowInDirResult {
  ok: boolean;
  statusPath: string;
  jsPath: string;
}

export function workflowsDirFor(cwd: string): string {
  return join(cwd, ".happy", "workflows");
}

export async function runWorkflowInDir(
  definition: WorkflowDefinition,
  cwd: string,
  opts?: { dryRun?: boolean; isolation?: boolean },
): Promise<RunWorkflowInDirResult> {
  const workflowsDir = workflowsDirFor(cwd);
  const reporter = new WorkflowRunReporter(definition, workflowsDir);
  await reporter.start();

  const executor = opts?.dryRun
    ? dryRunExecutor
    : makeClaudeSubAgentExecutor(
        { cwd, isolation: opts?.isolation, workflowId: definition.id },
        undefined,
        { onBranch: (stepId, branch) => reporter.noteBranch(stepId, branch) },
      );
  const result = await runWorkflow(
    definition,
    executor,
    (stepId, status) => reporter.note(stepId, status),
    (r) => {
      if (r.output) reporter.noteOutput(r.stepId, r.output);
    },
  );

  const statusPath = await reporter.finish(result.ok);
  const jsPath = await persistWorkflow(definition, workflowsDir);
  return { ok: result.ok, statusPath, jsPath };
}
