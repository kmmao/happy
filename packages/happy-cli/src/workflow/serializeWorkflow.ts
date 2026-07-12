import type { WorkflowDefinition } from "@kmmao/happy-wire";

/**
 * Serialize a completed workflow to a self-contained, runnable `.js` script
 * (Phase 5 persistence). The generated file records every sub-agent's prompt,
 * model, role, and wave order, plus a runner scaffold so the exact multi-agent
 * build can be replayed deterministically:
 *
 *   node .happy/workflows/<id>.js            # dry-run: prints the plan
 *   node .happy/workflows/<id>.js --run      # replay via a provided spawnAgent
 *
 * The replay harness is intentionally dependency-free: it groups steps into
 * concurrent waves exactly like the CLI runner, and calls a `spawnAgent`
 * callback the caller supplies (or a built-in stub that just logs), so the
 * script documents AND reproduces the workflow without importing the CLI.
 */
export function serializeWorkflowToJs(definition: WorkflowDefinition): string {
  // JSON.stringify with indentation gives a safe, human-readable literal; the
  // data is plain (strings/numbers) so there is no function/undefined loss.
  const literal = JSON.stringify(definition, null, 2);

  return `// Happy Dynamic Workflow — generated, deterministic replay.
// Goal: ${definition.goal.replace(/\r?\n/g, " ")}
// Generated for workflow id: ${definition.id}
//
// Run \`node <thisFile>\` to print the plan, or require() it and call
// runWorkflow(spawnAgent) with your own agent-spawning function.

'use strict';

const WORKFLOW = ${literal};

/** Group steps into ordered waves (same order = concurrent). */
function groupWaves(steps) {
  const byOrder = new Map();
  for (const step of steps) {
    const wave = byOrder.get(step.order) || [];
    wave.push(step);
    byOrder.set(step.order, wave);
  }
  return [...byOrder.keys()].sort((a, b) => a - b).map((o) => byOrder.get(o));
}

/**
 * Replay the workflow. \`spawnAgent(step)\` must return a Promise; steps in a
 * wave run concurrently, waves run in order. Defaults to a logging stub.
 */
async function runWorkflow(spawnAgent) {
  const spawn =
    spawnAgent ||
    (async (step) => {
      console.log(\`[\${step.role}] (\${step.model || 'default'}) \${step.prompt.slice(0, 80)}\`);
      return { stepId: step.id, ok: true };
    });
  const results = [];
  for (const wave of groupWaves(WORKFLOW.steps)) {
    const settled = await Promise.all(wave.map((step) => spawn(step)));
    results.push(...settled);
  }
  return results;
}

module.exports = { WORKFLOW, groupWaves, runWorkflow };

if (require.main === module) {
  console.log(\`Workflow \${WORKFLOW.id} — \${WORKFLOW.steps.length} step(s)\`);
  runWorkflow().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
`;
}
