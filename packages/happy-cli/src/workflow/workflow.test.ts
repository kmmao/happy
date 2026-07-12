import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowDefinition } from "@kmmao/happy-wire";
import { runWorkflow } from "./runWorkflow";
import { serializeWorkflowToJs } from "./serializeWorkflow";
import { persistWorkflow } from "./persistWorkflow";

const DEF: WorkflowDefinition = {
  id: "wf_test",
  goal: "Build a settings page",
  createdAt: 0,
  steps: [
    { id: "s1", role: "frontend", prompt: "Build the UI", model: "claude-haiku-4-5-20251001", order: 0 },
    { id: "s2", role: "backend", prompt: "Add Prisma model", order: 0 },
    { id: "s3", role: "integrate", prompt: "Wire it together", order: 1 },
  ],
};

describe("runWorkflow", () => {
  it("runs same-order steps concurrently and later waves after earlier ones", async () => {
    const events: string[] = [];
    const result = await runWorkflow(DEF, async (step) => {
      events.push(`start:${step.id}`);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`end:${step.id}`);
      return { stepId: step.id, role: step.role, ok: true };
    });

    expect(result.ok).toBe(true);
    expect(result.results.map((r) => r.stepId)).toEqual(["s1", "s2", "s3"]);
    // Wave 0 (s1,s2) both start before either ends → concurrent.
    expect(events.indexOf("start:s2")).toBeLessThan(events.indexOf("end:s1"));
    // Wave 1 (s3) starts only after wave 0 fully completes.
    expect(events.indexOf("start:s3")).toBeGreaterThan(events.indexOf("end:s1"));
    expect(events.indexOf("start:s3")).toBeGreaterThan(events.indexOf("end:s2"));
  });

  it("reports running → succeeded/failed per step via onStepStatus", async () => {
    const events: string[] = [];
    await runWorkflow(
      DEF,
      async (step) => ({
        stepId: step.id,
        role: step.role,
        ok: step.id !== "s2",
        error: step.id === "s2" ? "x" : undefined,
      }),
      (stepId, status) => events.push(`${stepId}:${status}`),
    );
    expect(events).toContain("s1:running");
    expect(events).toContain("s1:succeeded");
    expect(events).toContain("s2:failed");
    // Every step announces running before its terminal status.
    expect(events.indexOf("s1:running")).toBeLessThan(events.indexOf("s1:succeeded"));
  });

  it("stops subsequent waves when a wave has a failure", async () => {
    const seen: string[] = [];
    const result = await runWorkflow(DEF, async (step) => {
      seen.push(step.id);
      if (step.id === "s2") return { stepId: step.id, role: step.role, ok: false, error: "boom" };
      return { stepId: step.id, role: step.role, ok: true };
    });
    expect(result.ok).toBe(false);
    expect(seen).not.toContain("s3"); // wave 1 never ran
  });
});

describe("serializeWorkflowToJs / persistWorkflow", () => {
  it("emits a runnable script that replays the waves", async () => {
    const js = serializeWorkflowToJs(DEF);
    const dir = await mkdtemp(join(tmpdir(), "wf-"));
    const filePath = await persistWorkflow(DEF, dir);
    expect(filePath.endsWith("wf_test.js")).toBe(true);

    const written = await readFile(filePath, "utf8");
    expect(written).toBe(js);

    // require() the generated CommonJS module and replay with a stub.
    const require = createRequire(import.meta.url);
    const mod = require(filePath) as {
      WORKFLOW: WorkflowDefinition;
      runWorkflow: (spawn: (s: any) => Promise<any>) => Promise<any[]>;
    };
    expect(mod.WORKFLOW.steps).toHaveLength(3);
    const order: string[] = [];
    const results = await mod.runWorkflow(async (s: any) => {
      order.push(s.id);
      return { stepId: s.id, ok: true };
    });
    expect(results).toHaveLength(3);
    expect(order).toEqual(["s1", "s2", "s3"]);
  });
});
