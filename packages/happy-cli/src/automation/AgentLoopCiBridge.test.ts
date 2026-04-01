import { describe, expect, it } from "vitest";
import { buildLoopEventFromCiTrigger, selectLoopsForCiBridge } from "./AgentLoopCiBridge";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import type { CiTriggerData } from "@/api/apiMachine";

const payload: CiTriggerData = {
  type: "ci-trigger",
  eventId: "ci-1",
  provider: "github",
  repoPath: "/tmp/repo",
  repoUrl: "https://github.com/acme/repo",
  kind: "workflow_run",
  status: "completed",
  conclusion: "failure",
  workflowName: "CI",
  branch: "main",
  sha: "abc123",
  details: "tests failed",
};

function makeLoop(partial: Partial<AgentLoopDefinition>): AgentLoopDefinition {
  return {
    id: "loop-1",
    prompt: "x",
    directory: "/tmp/repo",
    intervalMs: 600000,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: 1,
    iteration: 0,
    continuityKey: "agent-loop:loop-1",
    agent: "claude",
    runtimeState: "idle",
    phase: "sleeping",
    phaseUpdatedAt: 1,
    ...partial,
  };
}

describe("AgentLoopCiBridge", () => {
  it("selects matching loops with ci bridge enabled", () => {
    const selected = selectLoopsForCiBridge([
      makeLoop({ id: "a", ciBridgeEnabled: true }),
      makeLoop({ id: "b", directory: "/tmp/repo/subdir", ciBridgeEnabled: true }),
      makeLoop({ id: "c", directory: "/tmp/other", ciBridgeEnabled: true }),
      makeLoop({ id: "d", ciBridgeEnabled: false }),
    ], payload);
    expect(selected.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("builds workflow ci loop events", () => {
    const event = buildLoopEventFromCiTrigger(payload);
    expect(event.source).toBe("ci-workflow");
    expect(event.title).toBe("CI");
    expect(event.details).toContain("conclusion=failure");
  });

  it("honors targetLoopId when present", () => {
    const selected = selectLoopsForCiBridge([
      makeLoop({ id: "a", ciBridgeEnabled: true }),
      makeLoop({ id: "b", ciBridgeEnabled: true }),
    ], { ...payload, targetLoopId: "b" });
    expect(selected.map((entry) => entry.id)).toEqual(["b"]);
  });
});
