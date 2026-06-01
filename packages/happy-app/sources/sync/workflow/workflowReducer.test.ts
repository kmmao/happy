import { describe, expect, it } from "vitest";

import {
  applyWorkflowEvent,
  applyWorkflowEvents,
} from "./workflowReducer";
import {
  EMPTY_WORKFLOW_RUNS,
  type WorkflowEvent,
  type WorkflowRunsMap,
} from "./typesWorkflow";

// ─── builders ──────────────────────────────────────────────────────────────

function runStart(
  overrides: Partial<Extract<WorkflowEvent, { t: "workflow-run-start" }>> = {},
): Extract<WorkflowEvent, { t: "workflow-run-start" }> {
  return {
    t: "workflow-run-start",
    runId: "wf_demo",
    toolUseId: "tool_use_xyz",
    name: "demo",
    description: "demo workflow",
    startedAt: 1000,
    ...overrides,
  };
}

function phaseStart(
  overrides: Partial<Extract<WorkflowEvent, { t: "workflow-phase-start" }>> = {},
): Extract<WorkflowEvent, { t: "workflow-phase-start" }> {
  return {
    t: "workflow-phase-start",
    runId: "wf_demo",
    index: 0,
    title: "调研",
    startedAt: 1010,
    ...overrides,
  };
}

function agentStart(
  overrides: Partial<Extract<WorkflowEvent, { t: "workflow-agent-start" }>> = {},
): Extract<WorkflowEvent, { t: "workflow-agent-start" }> {
  return {
    t: "workflow-agent-start",
    runId: "wf_demo",
    agentId: "a1",
    promptPreview: "Do thing X",
    hasSchema: false,
    startedAt: 1020,
    ...overrides,
  };
}

function agentEnd(
  overrides: Partial<Extract<WorkflowEvent, { t: "workflow-agent-end" }>> = {},
): Extract<WorkflowEvent, { t: "workflow-agent-end" }> {
  return {
    t: "workflow-agent-end",
    runId: "wf_demo",
    agentId: "a1",
    status: "completed",
    durationMs: 5000,
    endedAt: 6020,
    ...overrides,
  };
}

function runEnd(
  overrides: Partial<Extract<WorkflowEvent, { t: "workflow-run-end" }>> = {},
): Extract<WorkflowEvent, { t: "workflow-run-end" }> {
  return {
    t: "workflow-run-end",
    runId: "wf_demo",
    status: "completed",
    agentCount: 1,
    totalTokens: 2000,
    durationMs: 5020,
    endedAt: 6020,
    ...overrides,
  };
}

// ─── workflow-run-start ─────────────────────────────────────────────────────

describe("workflow-run-start", () => {
  it("creates a new run with empty agents/phases", () => {
    const runs = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    expect(runs.wf_demo).toBeDefined();
    expect(runs.wf_demo.status).toBe("running");
    expect(runs.wf_demo.name).toBe("demo");
    expect(runs.wf_demo.agents).toEqual({});
    expect(runs.wf_demo.agentOrder).toEqual([]);
    expect(runs.wf_demo.phases).toEqual([]);
    expect(runs.wf_demo.startedAt).toBe(1000);
  });

  it("preserves phasesMeta from the event", () => {
    const runs = applyWorkflowEvent(
      EMPTY_WORKFLOW_RUNS,
      runStart({
        phases: [{ title: "调研" }, { title: "汇总", detail: "synth" }],
      }),
    );
    expect(runs.wf_demo.phasesMeta).toHaveLength(2);
    expect(runs.wf_demo.phasesMeta[1]).toEqual({
      title: "汇总",
      detail: "synth",
    });
  });

  it("is idempotent — replaying does not reset accumulated state", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart());
    const beforeReplay = runs;
    runs = applyWorkflowEvent(runs, runStart());
    expect(runs).toBe(beforeReplay);
    expect(runs.wf_demo.agents.a1).toBeDefined();
  });
});

// ─── workflow-phase-start ───────────────────────────────────────────────────

describe("workflow-phase-start", () => {
  it("appends a new phase to the run", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, phaseStart({ index: 0, title: "调研" }));
    runs = applyWorkflowEvent(runs, phaseStart({ index: 1, title: "汇总", startedAt: 2000 }));
    expect(runs.wf_demo.phases).toHaveLength(2);
    expect(runs.wf_demo.phases[0]).toMatchObject({ title: "调研", index: 0 });
    expect(runs.wf_demo.phases[1]).toMatchObject({ title: "汇总", index: 1, startedAt: 2000 });
  });

  it("is idempotent on duplicate title", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, phaseStart());
    const before = runs;
    runs = applyWorkflowEvent(runs, phaseStart());
    expect(runs).toBe(before);
  });

  it("creates a placeholder run when phase-start arrives before run-start", () => {
    const runs = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, phaseStart());
    expect(runs.wf_demo).toBeDefined();
    expect(runs.wf_demo.name).toBe("");
    expect(runs.wf_demo.phases).toHaveLength(1);
  });
});

// ─── workflow-agent-start ───────────────────────────────────────────────────

describe("workflow-agent-start", () => {
  it("records an agent in running state with arrival order", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1" }));
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a2", startedAt: 1030 }));
    expect(runs.wf_demo.agentOrder).toEqual(["a1", "a2"]);
    expect(runs.wf_demo.agents.a1.status).toBe("running");
    expect(runs.wf_demo.agents.a2.startedAt).toBe(1030);
  });

  it("preserves optional metadata (label / parentAgentId / parallelGroupId)", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(
      runs,
      agentStart({
        agentId: "a1",
        label: "CLI 端",
        parentAgentId: "parent-x",
        parallelGroupId: "group-a",
      }),
    );
    expect(runs.wf_demo.agents.a1.label).toBe("CLI 端");
    expect(runs.wf_demo.agents.a1.parentAgentId).toBe("parent-x");
    expect(runs.wf_demo.agents.a1.parallelGroupId).toBe("group-a");
  });

  it("records label on start and model/tokens on end", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(
      runs,
      agentStart({ agentId: "a1", label: "调研 happy-app" }),
    );
    expect(runs.wf_demo.agents.a1.label).toBe("调研 happy-app");
    runs = applyWorkflowEvent(
      runs,
      agentEnd({
        agentId: "a1",
        model: "claude-haiku-4-5",
        tokens: { input: 1500, output: 300, cacheRead: 50, cacheWrite: 30 },
      }),
    );
    expect(runs.wf_demo.agents.a1.model).toBe("claude-haiku-4-5");
    expect(runs.wf_demo.agents.a1.tokens).toEqual({
      input: 1500,
      output: 300,
      cacheRead: 50,
      cacheWrite: 30,
    });
  });

  it("attaches agentId to the matching phase when event.phase is set", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, phaseStart({ title: "调研" }));
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1", phase: "调研" }));
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a2", phase: "调研" }));
    expect(runs.wf_demo.phases[0].agentIds).toEqual(["a1", "a2"]);
  });

  it("synthesises a phase when agent.phase has no matching phase-start", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1", phase: "Unknown" }));
    expect(runs.wf_demo.phases).toHaveLength(1);
    expect(runs.wf_demo.phases[0]).toMatchObject({
      title: "Unknown",
      agentIds: ["a1"],
    });
  });

  it("is idempotent on duplicate agentId", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1" }));
    const before = runs;
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1", label: "shouldNotOverride" }));
    expect(runs).toBe(before);
    expect(runs.wf_demo.agents.a1.label).toBeUndefined();
  });
});

// ─── workflow-agent-end ─────────────────────────────────────────────────────

describe("workflow-agent-end", () => {
  it("patches the matching agent with terminal status", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1" }));
    runs = applyWorkflowEvent(
      runs,
      agentEnd({
        agentId: "a1",
        status: "completed",
        outputPreview: "done",
        tokens: { input: 100, output: 200 },
      }),
    );
    expect(runs.wf_demo.agents.a1.status).toBe("completed");
    expect(runs.wf_demo.agents.a1.outputPreview).toBe("done");
    expect(runs.wf_demo.agents.a1.tokens).toEqual({ input: 100, output: 200 });
    expect(runs.wf_demo.agents.a1.durationMs).toBe(5000);
  });

  it("materializes a shell when agent-end races ahead of agent-start", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(
      runs,
      agentEnd({ agentId: "ghost", status: "completed", durationMs: 3000, endedAt: 4000 }),
    );
    expect(runs.wf_demo.agents.ghost).toBeDefined();
    expect(runs.wf_demo.agents.ghost.status).toBe("completed");
    expect(runs.wf_demo.agents.ghost.startedAt).toBe(1000); // 4000 - 3000
    expect(runs.wf_demo.agentOrder).toContain("ghost");
  });

  it("ignores a late agent-start after agent-end (end is authoritative)", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentEnd({ agentId: "a1", status: "errored" }));
    runs = applyWorkflowEvent(runs, agentStart({ agentId: "a1" }));
    expect(runs.wf_demo.agents.a1.status).toBe("errored");
  });

  it("preserves existing fields when patching", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(
      runs,
      agentStart({ agentId: "a1", label: "kept", promptPreview: "kept-prompt" }),
    );
    runs = applyWorkflowEvent(runs, agentEnd({ agentId: "a1" }));
    expect(runs.wf_demo.agents.a1.label).toBe("kept");
    expect(runs.wf_demo.agents.a1.promptPreview).toBe("kept-prompt");
  });
});

// ─── workflow-run-end ───────────────────────────────────────────────────────

describe("workflow-run-end", () => {
  it("closes the run with totals", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, agentStart());
    runs = applyWorkflowEvent(runs, agentEnd());
    runs = applyWorkflowEvent(
      runs,
      runEnd({ status: "completed", agentCount: 1, totalTokens: 2400, durationMs: 5020 }),
    );
    expect(runs.wf_demo.status).toBe("completed");
    expect(runs.wf_demo.agentCount).toBe(1);
    expect(runs.wf_demo.totalTokens).toBe(2400);
    expect(runs.wf_demo.durationMs).toBe(5020);
  });

  it("captures aborted / errored statuses", () => {
    let runs: WorkflowRunsMap = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    runs = applyWorkflowEvent(runs, runEnd({ status: "aborted" }));
    expect(runs.wf_demo.status).toBe("aborted");
  });

  it("creates a placeholder run when run-end arrives without preceding events", () => {
    const runs = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runEnd());
    expect(runs.wf_demo).toBeDefined();
    expect(runs.wf_demo.status).toBe("completed");
    expect(runs.wf_demo.name).toBe("");
  });
});

// ─── immutability / referential equality ────────────────────────────────────

describe("referential equality", () => {
  it("returns the same map reference when an unknown variant slips through", () => {
    const runs = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    const sameAgain = applyWorkflowEvent(runs, runStart());
    expect(sameAgain).toBe(runs);
  });

  it("returns a new map when state changes (so React selectors re-run)", () => {
    const runs = applyWorkflowEvent(EMPTY_WORKFLOW_RUNS, runStart());
    const next = applyWorkflowEvent(runs, agentStart());
    expect(next).not.toBe(runs);
  });
});

// ─── batch / e2e fold ───────────────────────────────────────────────────────

describe("applyWorkflowEvents (batch)", () => {
  it("folds a realistic parallel-then-synth sequence end-to-end", () => {
    // Simulates the workflow we ran earlier: 2 parallel research agents,
    // then 1 synthesis agent.
    const events: WorkflowEvent[] = [
      runStart({
        phases: [{ title: "调研" }, { title: "综合" }],
      }),
      phaseStart({ index: 0, title: "调研", startedAt: 1010 }),
      agentStart({
        agentId: "a1",
        phase: "调研",
        label: "CLI 端",
        startedAt: 1020,
      }),
      agentStart({
        agentId: "a2",
        phase: "调研",
        label: "App 端",
        startedAt: 1025,
      }),
      agentEnd({
        agentId: "a1",
        status: "completed",
        endedAt: 13020,
        durationMs: 12000,
        outputPreview: "CLI 调研结果",
      }),
      agentEnd({
        agentId: "a2",
        status: "completed",
        endedAt: 15025,
        durationMs: 14000,
        outputPreview: "App 调研结果",
      }),
      phaseStart({ index: 1, title: "综合", startedAt: 16000 }),
      agentStart({
        agentId: "a3",
        phase: "综合",
        label: "综合",
        startedAt: 16010,
      }),
      agentEnd({
        agentId: "a3",
        status: "completed",
        endedAt: 24010,
        durationMs: 8000,
        outputPreview: "综合结论",
      }),
      runEnd({
        status: "completed",
        agentCount: 3,
        totalTokens: 114145,
        durationMs: 23010,
        endedAt: 24010,
      }),
    ];

    const runs = applyWorkflowEvents(EMPTY_WORKFLOW_RUNS, events);
    const run = runs.wf_demo;
    expect(run.status).toBe("completed");
    expect(run.agentCount).toBe(3);
    expect(run.totalTokens).toBe(114145);
    expect(run.agentOrder).toEqual(["a1", "a2", "a3"]);
    expect(run.phases).toHaveLength(2);
    expect(run.phases[0].agentIds).toEqual(["a1", "a2"]);
    expect(run.phases[1].agentIds).toEqual(["a3"]);
    expect(run.agents.a1.outputPreview).toBe("CLI 调研结果");
    expect(run.agents.a3.outputPreview).toBe("综合结论");
  });

  it("tolerates concurrent runs in the same map", () => {
    const events: WorkflowEvent[] = [
      runStart({ runId: "wf_a", name: "A" }),
      runStart({ runId: "wf_b", name: "B" }),
      agentStart({ runId: "wf_a", agentId: "a1" }),
      agentStart({ runId: "wf_b", agentId: "b1" }),
      agentEnd({ runId: "wf_a", agentId: "a1" }),
      runEnd({ runId: "wf_a" }),
      agentEnd({ runId: "wf_b", agentId: "b1" }),
      runEnd({ runId: "wf_b" }),
    ];
    const runs = applyWorkflowEvents(EMPTY_WORKFLOW_RUNS, events);
    expect(Object.keys(runs).sort()).toEqual(["wf_a", "wf_b"]);
    expect(runs.wf_a.status).toBe("completed");
    expect(runs.wf_b.status).toBe("completed");
  });
});
