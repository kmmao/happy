import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GuardianSessionRegistry } from "./GuardianSessionRegistry";
import { AutomationAuditStore } from "./AutomationAuditStore";
import { deriveAutomationAuditStats, deriveAutomationGuardianUsage } from "./AutomationAudit";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("Automation autonomy regression", () => {
  it("keeps guardian continuity and audit visibility across a loop lifecycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "happy-automation-regression-"));
    tempDirs.push(dir);

    const registry = new GuardianSessionRegistry(join(dir, "guardians.json"));
    const auditStore = new AutomationAuditStore(join(dir, "audit.json"));
    await registry.load();
    await auditStore.load();

    const trigger = {
      type: "supervisor-trigger" as const,
      projectId: "project-1",
      runId: "run-1",
      trigger: "analysis",
      machineId: "machine-1",
      repoPath: "/tmp/repo",
      loopId: "loop-1",
      loopIteration: 1,
    };

    await registry.rememberForSupervisor(trigger, "session-1");
    await auditStore.append({
      id: "1",
      occurredAt: 100,
      kind: "guardian_remembered",
      projectId: trigger.projectId,
      runId: trigger.runId,
      loopId: trigger.loopId,
      trigger: trigger.trigger,
      sessionId: "session-1",
      guardianKey: "loop:loop-1",
      guardianSessionId: "session-1",
    });

    const resumed = registry.resolveForSupervisor({
      ...trigger,
      runId: "run-2",
      loopIteration: 2,
    });
    expect(resumed).toBe("session-1");

    await auditStore.append({
      id: "2",
      occurredAt: 200,
      kind: "job_session_started",
      projectId: trigger.projectId,
      runId: "run-2",
      loopId: trigger.loopId,
      trigger: trigger.trigger,
      sessionId: "session-1",
      status: "running",
    });
    await auditStore.append({
      id: "3",
      occurredAt: 300,
      kind: "guardian_reused",
      projectId: trigger.projectId,
      runId: "run-2",
      loopId: trigger.loopId,
      trigger: trigger.trigger,
      sessionId: "session-1",
      guardianKey: "loop:loop-1",
      guardianSessionId: "session-1",
    });

    await registry.forgetKey("loop:loop-1");
    await auditStore.append({
      id: "4",
      occurredAt: 400,
      kind: "guardian_cleared",
      projectId: trigger.projectId,
      loopId: trigger.loopId,
      guardianKey: "loop:loop-1",
    });

    expect(registry.resolveForSupervisor({ ...trigger, runId: "run-3", loopIteration: 3 })).toBe("session-1");

    await registry.clear();
    await auditStore.append({
      id: "5",
      occurredAt: 500,
      kind: "guardian_cleared",
      message: "Cleared all guardian sessions",
    });

    const events = auditStore.getAll();
    const guardians = registry.getSnapshot();
    const usage = deriveAutomationGuardianUsage(events, guardians);
    const stats = deriveAutomationAuditStats(events, guardians);

    expect(registry.resolveForSupervisor({ ...trigger, runId: "run-3", loopIteration: 3 })).toBeUndefined();
    expect(usage.find((entry) => entry.key === "loop:loop-1")).toMatchObject({
      rememberCount: 1,
      reuseCount: 1,
      resetCount: 1,
    });
    expect(stats.guardianReuseCount).toBe(1);
    expect(stats.guardianResetCount).toBe(2);
    expect(stats.guardianReuseRate).toBe(1);
  });
});
