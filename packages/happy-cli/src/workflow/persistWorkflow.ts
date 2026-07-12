import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowDefinition } from "@kmmao/happy-wire";
import { serializeWorkflowToJs } from "./serializeWorkflow";

/**
 * Persist a completed workflow to `<workflowsDir>/<id>.js` (Phase 5). Creates
 * the directory if needed and returns the written file path so callers can
 * surface it to the user. The file is a self-contained, runnable replay script
 * (see serializeWorkflow.ts).
 */
export async function persistWorkflow(
  definition: WorkflowDefinition,
  workflowsDir: string,
): Promise<string> {
  await mkdir(workflowsDir, { recursive: true });
  const filePath = join(workflowsDir, `${definition.id}.js`);
  await writeFile(filePath, serializeWorkflowToJs(definition), "utf8");
  return filePath;
}
