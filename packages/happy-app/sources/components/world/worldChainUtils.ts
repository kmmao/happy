import type { WorldEvent } from "./worldTypes";

// ─── Chain types ──────────────────────────────────────────────────────────────

export interface IntentChain {
    kind: "intent";
    parentEvent: WorldEvent;
    steps: WorldEvent[];
    running: number;
    completed: number;
    failed: number;
    total: number;
}

export interface ProjectChain {
    kind: "project";
    projectLabel: string;
    projectId: string | null;
    tasks: WorldEvent[];
    running: number;
    completed: number;
    failed: number;
    total: number;
}

export type Chain = IntentChain | ProjectChain;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function extractStatus(eventType: string): string {
    return eventType.split(".").pop() ?? eventType;
}

export function isRunning(e: WorldEvent): boolean { return extractStatus(e.eventType) === "running"; }
export function isCompleted(e: WorldEvent): boolean { return extractStatus(e.eventType) === "completed"; }
export function isFailed(e: WorldEvent): boolean { return extractStatus(e.eventType) === "failed"; }

// ─── Core grouping logic ──────────────────────────────────────────────────────

export function groupIntoChains(events: WorldEvent[]): Chain[] {
    const taskEvents = events.filter(
        (e) => e.eventType.startsWith("task.") || e.eventType.startsWith("trigger."),
    );

    const byId = new Map<string, WorldEvent>();
    for (const e of taskEvents) byId.set(e.originalId, e);

    // group children by their parentTaskId
    const childrenByParent = new Map<string, WorldEvent[]>();
    const childIds = new Set<string>();
    for (const e of taskEvents) {
        if (e.parentTaskId) {
            childIds.add(e.originalId);
            const list = childrenByParent.get(e.parentTaskId) ?? [];
            list.push(e);
            childrenByParent.set(e.parentTaskId, list);
        }
    }

    // build IntentChains from parents that have known children
    const usedAsParent = new Set<string>();
    const intentChains: IntentChain[] = [];
    for (const [parentId, steps] of childrenByParent) {
        const parentEvent = byId.get(parentId);
        if (!parentEvent) continue; // parent not in visible window — orphaned children fall through
        usedAsParent.add(parentId);
        const sorted = steps.slice().sort((a, b) => a.occurredAt - b.occurredAt);
        intentChains.push({
            kind: "intent",
            parentEvent,
            steps: sorted,
            running: sorted.filter(isRunning).length,
            completed: sorted.filter(isCompleted).length,
            failed: sorted.filter(isFailed).length,
            total: sorted.length,
        });
    }

    // orphan tasks: not a child, not a parent-with-visible-children
    const orphans = taskEvents.filter(
        (e) => !childIds.has(e.originalId) && !usedAsParent.has(e.originalId),
    );

    const byProject = new Map<string, WorldEvent[]>();
    for (const e of orphans) {
        const key = e.source.projectPath ?? e.source.projectId ?? "_no_project";
        const list = byProject.get(key) ?? [];
        list.push(e);
        byProject.set(key, list);
    }

    const projectChains: ProjectChain[] = [];
    for (const [key, tasks] of byProject) {
        const label = key === "_no_project"
            ? "Unassigned"
            : key.split("/").filter(Boolean).pop() ?? key;
        const sorted = tasks.slice().sort((a, b) => a.occurredAt - b.occurredAt);
        projectChains.push({
            kind: "project",
            projectLabel: label,
            projectId: tasks[0]?.source.projectId ?? null,
            tasks: sorted,
            running: sorted.filter(isRunning).length,
            completed: sorted.filter(isCompleted).length,
            failed: sorted.filter(isFailed).length,
            total: sorted.length,
        });
    }

    const sortFn = (a: { running: number; total: number }, b: { running: number; total: number }) =>
        b.running - a.running || b.total - a.total;

    return [
        ...intentChains.sort(sortFn),
        ...projectChains.sort(sortFn),
    ];
}
