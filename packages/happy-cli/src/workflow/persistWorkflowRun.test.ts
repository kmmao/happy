import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowRunSchema, type WorkflowDefinition } from "@kmmao/happy-wire";
import { WorkflowRunReporter } from "./persistWorkflowRun";

const DEF: WorkflowDefinition = {
  id: "wf_run",
  goal: "g",
  createdAt: 0,
  steps: [
    { id: "a", role: "frontend", prompt: "p", order: 0 },
    { id: "b", role: "backend", prompt: "p", order: 0 },
  ],
};

describe("WorkflowRunReporter", () => {
  it("writes an all-pending running file on start, then terminal state on finish", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wfr-"));
    const reporter = new WorkflowRunReporter(DEF, dir, () => 42);

    await reporter.start();
    let run = WorkflowRunSchema.parse(
      JSON.parse(await readFile(join(dir, "wf_run.json"), "utf8")),
    );
    expect(run.status).toBe("running");
    expect(run.steps).toEqual({ a: "pending", b: "pending" });
    expect(run.updatedAt).toBe(42);

    reporter.note("a", "running");
    reporter.note("a", "succeeded");
    reporter.note("b", "failed");
    const path = await reporter.finish("failed");
    expect(path.endsWith("wf_run.json")).toBe(true);

    run = WorkflowRunSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    expect(run.status).toBe("failed");
    expect(run.steps).toEqual({ a: "succeeded", b: "failed" });
    expect(run.definition.id).toBe("wf_run");
  });
});
