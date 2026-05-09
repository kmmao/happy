import { describe, it, expect } from "vitest";
import { groupIntoChains, extractStatus, type IntentChain, type ProjectChain } from "./worldChainUtils";
import type { WorldEvent } from "./worldTypes";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let _seq = 0;

function task(id: string, status: "queued" | "running" | "completed" | "failed" | "cancelled", opts: {
    parentTaskId?: string;
    projectId?: string;
    projectPath?: string;
    sessionId?: string;
    occurredAt?: number;
    triggerType?: "cron" | "webhook";
} = {}): WorldEvent {
    const prefix = opts.triggerType ? `trigger.${opts.triggerType}` : "task";
    return {
        id,
        originalId: id,
        eventType: `${prefix}.${status}`,
        title: `Task ${id}`,
        summary: "",
        occurredAt: opts.occurredAt ?? ++_seq * 1000,
        severity: "info",
        source: {
            type: opts.projectId ? "project" : "machine",
            projectId: opts.projectId ?? null,
            projectPath: opts.projectPath ?? null,
            machineId: "m1",
            sessionId: opts.sessionId,
        },
        parentTaskId: opts.parentTaskId,
    };
}

function nonTask(id: string, eventType: string): WorldEvent {
    return {
        id,
        originalId: id,
        eventType,
        title: id,
        summary: "",
        occurredAt: ++_seq * 1000,
        severity: "info",
        source: { type: "system", projectId: null },
    };
}

// ─── extractStatus ────────────────────────────────────────────────────────────

describe("extractStatus", () => {
    it("extracts last segment of multi-part eventType", () => {
        expect(extractStatus("task.running")).toBe("running");
        expect(extractStatus("trigger.cron.completed")).toBe("completed");
        expect(extractStatus("trigger.webhook.failed")).toBe("failed");
    });

    it("returns the whole string when there is no dot", () => {
        expect(extractStatus("running")).toBe("running");
    });
});

// ─── groupIntoChains ─────────────────────────────────────────────────────────

describe("groupIntoChains", () => {

    describe("empty / non-task input", () => {
        it("returns [] for empty input", () => {
            expect(groupIntoChains([])).toEqual([]);
        });

        it("filters out non-task events (decision, session, memory)", () => {
            const events = [
                nonTask("d1", "decision.requested"),
                nonTask("s1", "session.started"),
                nonTask("m1", "memory.created"),
            ];
            expect(groupIntoChains(events)).toEqual([]);
        });
    });

    describe("trigger.* events", () => {
        it("includes cron trigger tasks", () => {
            const chains = groupIntoChains([task("t1", "completed", { triggerType: "cron" })]);
            expect(chains).toHaveLength(1);
            expect(chains[0].kind).toBe("project");
        });

        it("includes webhook trigger tasks", () => {
            const chains = groupIntoChains([task("t1", "running", { triggerType: "webhook" })]);
            expect(chains).toHaveLength(1);
            expect(chains[0].kind).toBe("project");
        });

        it("can form IntentChain from trigger.* child tasks", () => {
            const parent = task("p", "running", { triggerType: "cron" });
            const child = task("c", "completed", { parentTaskId: "p" });
            const chains = groupIntoChains([parent, child]);
            expect(chains[0].kind).toBe("intent");
        });
    });

    describe("ProjectChain — orphan tasks", () => {
        it("groups tasks by projectPath, using last path segment as label", () => {
            const events = [
                task("t1", "completed", { projectId: "p1", projectPath: "/home/user/proj" }),
                task("t2", "running", { projectId: "p1", projectPath: "/home/user/proj" }),
            ];
            const chains = groupIntoChains(events);
            expect(chains).toHaveLength(1);
            const c = chains[0] as ProjectChain;
            expect(c.kind).toBe("project");
            expect(c.projectLabel).toBe("proj");
            expect(c.projectId).toBe("p1");
            expect(c.total).toBe(2);
            expect(c.running).toBe(1);
            expect(c.completed).toBe(1);
            expect(c.failed).toBe(0);
        });

        it("falls back to projectId as label when projectPath is absent", () => {
            const chains = groupIntoChains([task("t1", "queued", { projectId: "proj-id-42" })]);
            const c = chains[0] as ProjectChain;
            expect(c.projectLabel).toBe("proj-id-42");
        });

        it("labels tasks with no project as 'Unassigned'", () => {
            const chains = groupIntoChains([task("t1", "queued")]);
            const c = chains[0] as ProjectChain;
            expect(c.projectLabel).toBe("Unassigned");
            expect(c.projectId).toBeNull();
        });

        it("creates separate ProjectChains for different projects", () => {
            const events = [
                task("t1", "completed", { projectId: "pA", projectPath: "/a" }),
                task("t2", "completed", { projectId: "pB", projectPath: "/b" }),
            ];
            const chains = groupIntoChains(events);
            expect(chains).toHaveLength(2);
            expect(chains.every((c) => c.kind === "project")).toBe(true);
        });

        it("sorts tasks within a ProjectChain by occurredAt ascending", () => {
            const events = [
                task("late", "completed", { occurredAt: 9000 }),
                task("early", "running", { occurredAt: 1000 }),
            ];
            const c = groupIntoChains(events)[0] as ProjectChain;
            expect(c.tasks[0].originalId).toBe("early");
            expect(c.tasks[1].originalId).toBe("late");
        });

        it("mixes task.* and trigger.* in the same ProjectChain for the same project", () => {
            const events = [
                task("t1", "completed", { projectId: "p1", projectPath: "/app", triggerType: "cron" }),
                task("t2", "running", { projectId: "p1", projectPath: "/app" }),
            ];
            const chains = groupIntoChains(events);
            expect(chains).toHaveLength(1);
            expect((chains[0] as ProjectChain).total).toBe(2);
        });
    });

    describe("IntentChain — parent-child tasks", () => {
        it("builds an IntentChain with correct step list and counts", () => {
            const parent = task("p", "running");
            const c1 = task("c1", "completed", { parentTaskId: "p" });
            const c2 = task("c2", "running", { parentTaskId: "p" });
            const c3 = task("c3", "failed", { parentTaskId: "p" });
            const ic = groupIntoChains([parent, c1, c2, c3])[0] as IntentChain;

            expect(ic.kind).toBe("intent");
            expect(ic.parentEvent.originalId).toBe("p");
            expect(ic.total).toBe(3);
            expect(ic.completed).toBe(1);
            expect(ic.running).toBe(1);
            expect(ic.failed).toBe(1);
        });

        it("excludes the parent task from the steps list", () => {
            const parent = task("p", "running");
            const child = task("c", "queued", { parentTaskId: "p" });
            const ic = groupIntoChains([parent, child])[0] as IntentChain;
            expect(ic.steps.every((s) => s.originalId !== "p")).toBe(true);
        });

        it("sorts steps by occurredAt ascending", () => {
            const parent = task("p", "running");
            const s1 = task("s1", "completed", { parentTaskId: "p", occurredAt: 5000 });
            const s2 = task("s2", "queued", { parentTaskId: "p", occurredAt: 2000 });
            const ic = groupIntoChains([parent, s1, s2])[0] as IntentChain;
            expect(ic.steps[0].originalId).toBe("s2");
            expect(ic.steps[1].originalId).toBe("s1");
        });

        it("children referencing an absent parent are hidden (not in any chain)", () => {
            // When parent is outside the visible window, the child is in childIds but its
            // IntentChain can't be built. The child is also excluded from orphans because
            // it IS a child. Result: no chain produced for this event.
            const child = task("c", "running", { parentTaskId: "ghost-parent" });
            const chains = groupIntoChains([child]);
            expect(chains).toHaveLength(0);
        });

        it("multi-level nesting: gp→p→gc produces two IntentChains", () => {
            const gp = task("gp", "running");
            const p = task("p", "running", { parentTaskId: "gp" });
            const gc = task("gc", "queued", { parentTaskId: "p" });
            const chains = groupIntoChains([gp, p, gc]);
            const intents = chains.filter((c) => c.kind === "intent") as IntentChain[];

            expect(intents).toHaveLength(2);
            const gpChain = intents.find((i) => i.parentEvent.originalId === "gp")!;
            const pChain = intents.find((i) => i.parentEvent.originalId === "p")!;
            expect(gpChain.steps[0].originalId).toBe("p");
            expect(pChain.steps[0].originalId).toBe("gc");
        });
    });

    describe("ordering", () => {
        it("places IntentChains before ProjectChains", () => {
            const parent = task("p", "completed");
            const child = task("c", "completed", { parentTaskId: "p" });
            const orphan = task("o", "completed", { projectId: "proj" });
            const chains = groupIntoChains([parent, child, orphan]);

            expect(chains[0].kind).toBe("intent");
            expect(chains[1].kind).toBe("project");
        });

        it("sorts IntentChains by running count desc, then total desc", () => {
            const p1 = task("p1", "running");
            const c1a = task("c1a", "running", { parentTaskId: "p1" });
            const c1b = task("c1b", "running", { parentTaskId: "p1" });

            const p2 = task("p2", "completed");
            const c2a = task("c2a", "completed", { parentTaskId: "p2" });
            const c2b = task("c2b", "completed", { parentTaskId: "p2" });
            const c2c = task("c2c", "completed", { parentTaskId: "p2" });

            const intents = groupIntoChains([p1, c1a, c1b, p2, c2a, c2b, c2c]) as IntentChain[];
            expect(intents[0].parentEvent.originalId).toBe("p1"); // 2 running beats 0
            expect(intents[1].parentEvent.originalId).toBe("p2"); // more total
        });

        it("sorts ProjectChains by running count desc", () => {
            const events = [
                task("t1", "completed", { projectId: "pA" }),
                task("t2", "running", { projectId: "pB" }),
            ];
            const chains = groupIntoChains(events) as ProjectChain[];
            expect(chains[0].projectId).toBe("pB"); // has running task
            expect(chains[1].projectId).toBe("pA");
        });
    });
});
