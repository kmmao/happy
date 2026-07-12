import { readFile, readdir } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "@kmmao/happy-wire";
import { logger } from "@/lib";
import { runWorkflowInDir, workflowsDirFor } from "./runWorkflowInDir";

/**
 * `happy workflow` — the invocable entry that turns the Dynamic Workflow engine
 * (Phase 5) into a real runtime:
 *
 *   happy workflow run <spec.json> [--dir <cwd>] [--dry-run]
 *   happy workflow list [--dir <cwd>]
 *
 * `run` loads a WorkflowDefinition, spawns one headless Claude sub-agent per
 * step (concurrent within a wave, sequential across waves), and persists a
 * runnable replay script to `<cwd>/.happy/workflows/<id>.js`. The project-local
 * `.happy/workflows/` location (mirroring `.happy/agent-loops/`) is what the
 * mobile app browses to visualize workflows.
 *
 * `--dry-run` swaps the real sub-agent spawn for a no-op stub so the pipeline
 * (parse → run → persist) can be exercised without spending tokens.
 */

/** Load a spec file leniently: fill id/createdAt when omitted, then validate. */
async function loadSpec(specPath: string): Promise<WorkflowDefinition> {
  const raw = await readFile(specPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const withDefaults = {
    id: typeof parsed.id === "string" && parsed.id ? parsed.id : `wf_${randomUUID().slice(0, 8)}`,
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    ...parsed,
  };
  return WorkflowDefinitionSchema.parse(withDefaults);
}

async function runWorkflowCommand(rest: string[]): Promise<void> {
  const specArg = rest.find((a) => !a.startsWith("--"));
  if (!specArg) {
    logger.print("Usage: happy workflow run <spec.json> [--dir <cwd>] [--dry-run]");
    process.exit(1);
  }
  const dirFlag = rest[rest.indexOf("--dir") + 1];
  const cwd = dirFlag && rest.includes("--dir") ? resolve(dirFlag) : process.cwd();
  const dryRun = rest.includes("--dry-run");
  const isolation = rest.includes("--isolation");
  const synthesis = rest.includes("--synthesis");
  const specPath = isAbsolute(specArg) ? specArg : resolve(cwd, specArg);

  const definition = await loadSpec(specPath);
  logger.print(
    `Running workflow "${definition.goal}" — ${definition.steps.length} step(s)${dryRun ? " (dry-run)" : ""}${isolation ? " (isolated)" : ""}${synthesis ? " (+synthesis)" : ""}`,
  );

  const { ok, jsPath, statusPath } = await runWorkflowInDir(definition, cwd, {
    dryRun,
    isolation,
    synthesis,
  });
  logger.print(`${ok ? "Workflow complete" : "Workflow finished with failures"}.`);
  logger.print(`Persisted replay: ${jsPath}`);
  logger.print(`Run state: ${statusPath}`);
  process.exit(ok ? 0 : 1);
}

async function listWorkflowsCommand(rest: string[]): Promise<void> {
  const dirFlag = rest[rest.indexOf("--dir") + 1];
  const cwd = dirFlag && rest.includes("--dir") ? resolve(dirFlag) : process.cwd();
  const dir = workflowsDirFor(cwd);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".js"));
  } catch {
    // Directory absent = no workflows yet.
  }
  if (files.length === 0) {
    logger.print(`No workflows in ${dir}`);
    return;
  }
  logger.print(`Workflows in ${dir}:`);
  for (const f of files) logger.print(`  ${f}`);
}

export async function handleWorkflowCommand(args: string[]): Promise<void> {
  const action = args[0];
  const rest = args.slice(1);
  if (action === "run") {
    await runWorkflowCommand(rest);
  } else if (action === "list") {
    await listWorkflowsCommand(rest);
  } else {
    logger.print("Usage: happy workflow <run|list> [...]");
    process.exit(action ? 1 : 0);
  }
}
