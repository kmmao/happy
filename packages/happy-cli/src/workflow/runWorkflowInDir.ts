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

/** Build the summarizer prompt from the goal + each sub-agent's output. */
export function buildSynthesisPrompt(
  goal: string,
  results: Array<{ role: string; output?: string; ok: boolean }>,
): string {
  const parts = results.map(
    (r) => `## ${r.role} (${r.ok ? "ok" : "failed"})\n${r.output ?? "(no output)"}`,
  );
  return [
    `You are the synthesis agent for a multi-agent build.`,
    `Goal: ${goal}`,
    ``,
    `Here are the results from each sub-agent:`,
    ``,
    parts.join("\n\n"),
    ``,
    `Synthesize these into one cohesive summary: what was accomplished, any`,
    `conflicts or gaps between the agents, and concrete next steps. Be concise.`,
  ].join("\n");
}

export async function runWorkflowInDir(
  definition: WorkflowDefinition,
  cwd: string,
  opts?: {
    dryRun?: boolean;
    isolation?: boolean;
    synthesis?: boolean;
    signal?: AbortSignal;
  },
): Promise<RunWorkflowInDirResult> {
  const workflowsDir = workflowsDirFor(cwd);
  const reporter = new WorkflowRunReporter(definition, workflowsDir);
  await reporter.start();

  const executor = opts?.dryRun
    ? dryRunExecutor
    : makeClaudeSubAgentExecutor(
        { cwd, isolation: opts?.isolation, workflowId: definition.id, signal: opts?.signal },
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
    opts?.signal,
  );

  // Optional synthesis: once the waves finish cleanly, a summarizer agent
  // combines every sub-agent's output into one write-up. Runs non-isolated in
  // the project dir (it only reads the collected outputs, doesn't touch files).
  if (opts?.synthesis && result.ok && !result.cancelled) {
    const synthExecutor = opts.dryRun
      ? dryRunExecutor
      : makeClaudeSubAgentExecutor({ cwd, signal: opts.signal });
    const synth = await synthExecutor({
      id: "__synthesis__",
      role: "synthesis",
      prompt: buildSynthesisPrompt(definition.goal, result.results),
      order: 0,
    });
    if (synth.output) reporter.noteSynthesis(synth.output);
  }

  const statusPath = await reporter.finish(
    result.cancelled ? "cancelled" : result.ok ? "completed" : "failed",
  );
  const jsPath = await persistWorkflow(definition, workflowsDir);
  return { ok: result.ok, statusPath, jsPath };
}
