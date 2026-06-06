import { describe, expect, it } from "vitest";
import type { AgentLoop } from "@prisma/client";
import { buildSupervisorLoopBrief, type SupervisorLoopBriefSnapshot } from "./supervisorLoopBrief";

// A tight factory: only sets the fields buildSupervisorLoopBrief actually
// reads. Anything not in this list is filled with a neutral default. The
// cast at the bottom is deliberate — we don't pull in the full Prisma row
// shape (createdAt, profileId, runtimeProfile, etc.) just to test the
// composeSummary logic.
function makeLoop(overrides: Partial<AgentLoop>): AgentLoop {
    const base = {
        id: "loop-1",
        projectId: "project-1",
        accountId: "account-1",
        role: "supervisor",
        status: "completed",
        currentPhase: "idle",
        currentIteration: 0,
        maxIterations: 5,
        costCapUsd: null,
        healthScoreTarget: null,
        autoApproveThreshold: 80,
        maxConsecutiveFailures: 2,
        totalCostUsd: 0,
        totalTokens: 0,
        totalActionsFound: 0,
        totalActionsFixed: 0,
        consecutiveFailures: 0,
        initialHealthScore: null,
        currentHealthScore: null,
        activeRunId: null,
        exitReason: null,
        maxDurationMinutes: 240,
        profileId: null,
        runtimeProfile: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        completedAt: null,
    } satisfies Record<string, unknown>;
    return { ...base, ...overrides } as AgentLoop;
}

describe("goal_achieved exit reason (ADR-0022 C-1)", () => {
    it("flows through the brief snapshot unchanged", () => {
        const brief = buildSupervisorLoopBrief(
            makeLoop({ exitReason: "goal_achieved", status: "completed" }),
        );
        expect(brief.exitReason).toBe("goal_achieved");
    });

    it("appears in the summary tail when set", () => {
        const brief = buildSupervisorLoopBrief(
            makeLoop({
                exitReason: "goal_achieved",
                totalActionsFound: 12,
                totalActionsFixed: 12,
            }),
        );
        expect(brief.summary).toContain("goal_achieved");
    });
});

describe("buildSupervisorLoopBrief", () => {
    it("preserves DB fields verbatim on the snapshot", () => {
        const loop = makeLoop({
            id: "loop-abc",
            projectId: "proj-xyz",
            status: "completed",
            exitReason: "health_target",
            currentIteration: 4,
            maxIterations: 10,
            totalActionsFound: 7,
            totalActionsFixed: 7,
            totalCostUsd: 1.23,
            costCapUsd: 5,
            initialHealthScore: 80,
            currentHealthScore: 30,
            consecutiveFailures: 0,
        });
        const brief = buildSupervisorLoopBrief(loop);
        expect(brief).toMatchObject({
            loopId: "loop-abc",
            projectId: "proj-xyz",
            status: "completed",
            exitReason: "health_target",
            currentIteration: 4,
            maxIterations: 10,
            initialHealthScore: 80,
            currentHealthScore: 30,
            healthDelta: -50,
            totalActionsFound: 7,
            totalActionsFixed: 7,
            consecutiveFailures: 0,
            totalCostUsd: 1.23,
            costCapUsd: 5,
        });
        expect(brief.generatedAt).toBeGreaterThan(0);
    });

    it("computes healthDelta as null when either score is missing", () => {
        const onlyInitial = buildSupervisorLoopBrief(
            makeLoop({ initialHealthScore: 50, currentHealthScore: null }),
        );
        expect(onlyInitial.healthDelta).toBeNull();

        const onlyCurrent = buildSupervisorLoopBrief(
            makeLoop({ initialHealthScore: null, currentHealthScore: 40 }),
        );
        expect(onlyCurrent.healthDelta).toBeNull();

        const neither = buildSupervisorLoopBrief(
            makeLoop({ initialHealthScore: null, currentHealthScore: null }),
        );
        expect(neither.healthDelta).toBeNull();
    });

    describe("summary string", () => {
        it("uses ↓ when health improved (score went down)", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ initialHealthScore: 80, currentHealthScore: 30 }),
            );
            expect(brief.summary).toContain("Health 80↓30");
        });

        it("uses ↑ when health worsened (score went up)", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ initialHealthScore: 20, currentHealthScore: 50 }),
            );
            expect(brief.summary).toContain("Health 20↑50");
        });

        it("uses → when health was unchanged", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ initialHealthScore: 40, currentHealthScore: 40 }),
            );
            expect(brief.summary).toContain("Health 40→40");
        });

        it("omits health stanza when scores are missing", () => {
            const brief = buildSupervisorLoopBrief(makeLoop({}));
            expect(brief.summary).not.toContain("Health");
        });

        it("reports fixed count when at least one action was fixed", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ totalActionsFound: 5, totalActionsFixed: 3 }),
            );
            expect(brief.summary).toContain("fixed 3");
        });

        it("reports pending = found - fixed when work remains", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ totalActionsFound: 8, totalActionsFixed: 3 }),
            );
            expect(brief.summary).toContain("pending 5");
        });

        it("omits both fixed and pending when no actions found", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ totalActionsFound: 0, totalActionsFixed: 0 }),
            );
            expect(brief.summary).not.toContain("fixed");
            expect(brief.summary).not.toContain("pending");
        });

        it("omits cost stanza when totalCostUsd is zero", () => {
            const brief = buildSupervisorLoopBrief(makeLoop({ totalCostUsd: 0 }));
            expect(brief.summary).not.toContain("$");
        });

        it("formats cost to two decimals when non-zero", () => {
            const brief = buildSupervisorLoopBrief(makeLoop({ totalCostUsd: 0.5 }));
            expect(brief.summary).toContain("$0.50");
        });

        it("falls back to 'no changes' when no quantitative stat fires", () => {
            const brief = buildSupervisorLoopBrief(makeLoop({}));
            expect(brief.summary).toContain("no changes");
        });

        it("renders 'N/M iters' when maxIterations is positive", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ currentIteration: 3, maxIterations: 5 }),
            );
            expect(brief.summary).toContain("3/5 iters");
        });

        it("renders bare 'N iters' when maxIterations is 0 (unlimited)", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ currentIteration: 7, maxIterations: 0 }),
            );
            expect(brief.summary).toContain("7 iters");
            expect(brief.summary).not.toContain("7/0");
        });

        it("appends exit reason when present", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({ exitReason: "max_iterations" }),
            );
            expect(brief.summary).toContain("max_iterations");
        });

        it("omits exit reason suffix when null", () => {
            const brief = buildSupervisorLoopBrief(makeLoop({ exitReason: null }));
            expect(brief.summary).not.toContain(" — ");
        });

        it("starts with 'Loop done' for every status (presentation invariant)", () => {
            for (const status of ["completed", "failed", "stopped"] as const) {
                const brief = buildSupervisorLoopBrief(makeLoop({ status }));
                expect(brief.summary.startsWith("Loop done")).toBe(true);
            }
        });
    });

    describe("full composition", () => {
        it("composes all stanzas in canonical order: health, fixed, pending, cost", () => {
            const brief = buildSupervisorLoopBrief(
                makeLoop({
                    initialHealthScore: 80,
                    currentHealthScore: 30,
                    totalActionsFound: 8,
                    totalActionsFixed: 5,
                    totalCostUsd: 2.5,
                    currentIteration: 4,
                    maxIterations: 10,
                    exitReason: "health_target",
                }),
            );
            // Order matters for at-a-glance readability — health first, then
            // throughput, then cost. If composeSummary reorders, that's a
            // visible UX regression worth catching here.
            expect(brief.summary).toBe(
                "Loop done (4/10 iters): Health 80↓30, fixed 5, pending 3, $2.50 — health_target",
            );
        });

        it("snapshot generatedAt is a recent epoch ms", () => {
            const before = Date.now();
            const brief = buildSupervisorLoopBrief(makeLoop({}));
            const after = Date.now();
            expect(brief.generatedAt).toBeGreaterThanOrEqual(before);
            expect(brief.generatedAt).toBeLessThanOrEqual(after);
        });

        it("returns a snapshot whose summary stays under 140 chars (push payload budget)", () => {
            // Worst-case message: long exit reason, max stanzas active.
            const brief: SupervisorLoopBriefSnapshot = buildSupervisorLoopBrief(
                makeLoop({
                    initialHealthScore: 100,
                    currentHealthScore: 0,
                    totalActionsFound: 999,
                    totalActionsFixed: 500,
                    totalCostUsd: 1234.56,
                    currentIteration: 99,
                    maxIterations: 99,
                    exitReason: "consecutive_failures",
                }),
            );
            expect(brief.summary.length).toBeLessThanOrEqual(140);
        });
    });
});
