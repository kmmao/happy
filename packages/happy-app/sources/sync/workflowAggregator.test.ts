import { describe, expect, it } from "vitest";

import {
  aggregateWorkflows,
  type AggregatorProject,
  type Workflow,
  type WorkflowAggregateInputs,
} from "./workflowAggregator";
import type { Machine, Session } from "@/sync/storageTypes";
import type { SerializedAgentLoop } from "@kmmao/happy-wire";
import type { ServerTriggerSchedule } from "@/sync/apiTriggerSchedules";
import type { ServerWebhookTrigger } from "@/sync/apiWebhookTriggers";

// One snapshot constructor + one test per Workflow kind + the
// load-bearing dedup invariants (loopsById precedence, claimedSessions
// suppresses Ad-hoc). These tests replace the integration-style
// mount-the-hook-and-mock-Zustand pattern that was effectively absent —
// the hook's useMemo body had zero direct coverage.

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  active: true,
  updatedAt: 1000,
  metadata: {
    machineId: "m1",
    summary: { text: "Untitled session" },
  },
  ...overrides,
} as unknown as Session);

const machine = (id: string, loops: unknown[] = []): Machine => ({
  id,
  daemonState: { automation: { loops } },
} as unknown as Machine);

const project = (
  machineId: string,
  serverId: string | null = null,
): AggregatorProject => ({ key: { machineId }, serverId: serverId ?? undefined });

const emptyInputs = (): WorkflowAggregateInputs => ({
  allSessions: [],
  allMachines: [],
  allProjects: [],
  cronTriggers: [],
  webhookTriggers: [],
  serverLoops: [],
});

describe("aggregateWorkflows — empty + ad-hoc", () => {
  it("returns [] when there are no sessions and no triggers", () => {
    expect(aggregateWorkflows(emptyInputs())).toEqual([]);
  });

  it("turns every unattached Session into an Ad-hoc Workflow", () => {
    const s1 = session("s1");
    const s2 = session("s2");
    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s1, s2],
    });
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.kind === "adhoc")).toBe(true);
    expect(result.map((w) => w.id).sort()).toEqual(["adhoc:s1", "adhoc:s2"]);
  });

  it("skips string entries in allSessions (legacy id-only entries)", () => {
    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: ["s1" as any, session("s2")],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("adhoc:s2");
  });
});

describe("aggregateWorkflows — claimedSessions suppresses Ad-hoc", () => {
  it("a Session claimed by a Loop does NOT become its own Ad-hoc Workflow", () => {
    const loopId = "loop-1";
    const s1 = session("s1", {
      metadata: {
        machineId: "m1",
        automationContext: { loopId },
      },
    } as Partial<Session>);
    const m1 = machine("m1", [
      {
        id: loopId,
        name: "Loop One",
        directory: "/work",
        enabled: true,
        runtimeState: "idle",
      },
    ]);

    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s1],
      allMachines: [m1],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("loop");
    expect(result[0]?.sessions).toEqual([s1]);
  });

  it("a Session claimed by a TriggerSchedule does NOT become its own Ad-hoc Workflow", () => {
    const triggerId = "trigger-1";
    const s1 = session("s1", {
      metadata: {
        machineId: "m1",
        automationContext: { triggerRef: triggerId },
      },
    } as Partial<Session>);
    const trigger: ServerTriggerSchedule = {
      id: triggerId,
      machineId: "m1",
      name: "Nightly",
      cronExpression: "0 0 * * *",
      enabled: true,
      nextRunAt: 5000,
      lastRunAt: 2000,
      updatedAt: 3000,
      runCount: 7,
    } as ServerTriggerSchedule;

    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s1],
      cronTriggers: [trigger],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("scheduled");
    expect(result[0]?.sessions).toEqual([s1]);
  });
});

describe("aggregateWorkflows — loopsById precedence", () => {
  it("daemonState (live runtime) wins over server-fetched loop on collision", () => {
    const loopId = "shared-loop";
    const m1 = machine("m1", [
      {
        id: loopId,
        directory: "/from-daemon",
        runtimeState: "active",
        enabled: true,
      },
    ]);
    const serverLoop: SerializedAgentLoop = {
      id: loopId,
      projectId: "proj-1",
      directory: "/from-server",
      enabled: true,
      intervalMs: 0,
      cronExpression: null,
      iteration: 0,
      prompt: null,
      createdAt: 100,
      updatedAt: 200,
      nextRunAt: null,
      status: "idle",
      role: "supervisor",
      agent: "claude",
      genericConfig: { name: "From server" },
    } as unknown as SerializedAgentLoop;

    const result = aggregateWorkflows({
      ...emptyInputs(),
      allMachines: [m1],
      allProjects: [project("m1", "proj-1")],
      serverLoops: [serverLoop],
    });

    expect(result).toHaveLength(1);
    const loop = result[0] as Extract<Workflow, { kind: "loop" }>;
    // daemonState overrode the directory…
    expect(loop.loop.directory).toBe("/from-daemon");
    // …but the role from server (supervisor) survived the override.
    expect(loop.role).toBe("supervisor");
    // …and the projectId from server survived the override.
    expect(loop.projectId).toBe("proj-1");
    // …and machineId reflects the daemonState's machine (live).
    expect(loop.machineId).toBe("m1");
  });

  it("daemonState-only loop renders as role=generic, projectId=null", () => {
    const m1 = machine("m1", [
      {
        id: "loop-x",
        directory: "/local-only",
        runtimeState: "idle",
        enabled: false,
      },
    ]);
    const result = aggregateWorkflows({
      ...emptyInputs(),
      allMachines: [m1],
    });
    const loop = result[0] as Extract<Workflow, { kind: "loop" }>;
    expect(loop.role).toBe("generic");
    expect(loop.projectId).toBeNull();
    expect(loop.status).toBe("archived");
  });
});

describe("aggregateWorkflows — sort order", () => {
  it("sorts by lastActivityAt descending", () => {
    const s_old = session("old", { updatedAt: 100 });
    const s_new = session("new", { updatedAt: 999 });
    const s_mid = session("mid", { updatedAt: 500 });

    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s_old, s_new, s_mid],
    });
    expect(result.map((w) => w.id)).toEqual([
      "adhoc:new",
      "adhoc:mid",
      "adhoc:old",
    ]);
  });
});

describe("aggregateWorkflows — null fetch states (loading)", () => {
  it("treats null cronTriggers as 'not yet fetched' (no scheduled workflows surface)", () => {
    const s1 = session("s1");
    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s1],
      cronTriggers: null,
    });
    expect(result.every((w) => w.kind !== "scheduled")).toBe(true);
    // Sessions still surface as ad-hoc.
    expect(result.find((w) => w.id === "adhoc:s1")).toBeDefined();
  });

  it("treats null webhookTriggers identically", () => {
    const result = aggregateWorkflows({
      ...emptyInputs(),
      webhookTriggers: null,
    });
    expect(result.every((w) => w.kind !== "event")).toBe(true);
  });
});

describe("aggregateWorkflows — event Workflow basics", () => {
  it("produces an event Workflow per WebhookTrigger and counts claimed sessions", () => {
    const triggerId = "wh-1";
    const trigger: ServerWebhookTrigger = {
      id: triggerId,
      machineId: "m1",
      name: "GH push",
      slug: "gh-push",
      enabled: true,
      lastTriggeredAt: 4000,
      updatedAt: 4500,
      triggerCount: 3,
    } as ServerWebhookTrigger;
    const s = session("s1", {
      metadata: {
        machineId: "m1",
        automationContext: { triggerRef: triggerId },
      },
    } as Partial<Session>);

    const result = aggregateWorkflows({
      ...emptyInputs(),
      allSessions: [s],
      webhookTriggers: [trigger],
    });

    expect(result).toHaveLength(1);
    const event = result[0] as Extract<Workflow, { kind: "event" }>;
    expect(event.kind).toBe("event");
    expect(event.trigger.id).toBe(triggerId);
    expect(event.triggerCount).toBe(3);
    expect(event.sessions).toEqual([s]);
  });
});
