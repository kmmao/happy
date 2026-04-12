/**
 * Unit tests for goalHealthEngine pure functions.
 * Zero mocks — tests only use in-memory objects.
 */

import { describe, it, expect } from "vitest";
import {
    detectStaleInProgress,
    detectBlockedAging,
    detectRepeatedFailure,
    detectAllTerminalWithFailures,
    detectNarrativeDeviation,
    classifyGoalLayer,
    tokenize,
    scoreGoalHealth,
    buildHealthSuggestionCandidates,
    type GoalHealthInput,
    type GoalHealthResult,
} from "./goalHealthEngine";
import { TIME_MS, REPEATED_FAILURE_THRESHOLD } from "./worldConstants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(status: string, overrides: Partial<{ attempt: number; maxAttempts: number; errorMessage: string | null }> = {}) {
    return {
        id: `task-${Math.random().toString(36).slice(2)}`,
        status,
        attempt: overrides.attempt ?? 1,
        maxAttempts: overrides.maxAttempts ?? 3,
        errorMessage: overrides.errorMessage ?? null,
        updatedAt: new Date(),
    };
}

function makeGoal(overrides: Partial<GoalHealthInput> = {}): GoalHealthInput {
    return {
        id: "goal-1",
        title: "Test goal",
        description: null,
        status: "in_progress",
        progress: 0,
        priority: "normal",
        createdAt: new Date(),
        updatedAt: new Date(),
        blockedSince: null,
        layer: null,
        parentGoalId: null,
        subGoalCount: 0,
        tasks: [],
        ...overrides,
    };
}

function hoursAgo(h: number): Date {
    return new Date(Date.now() - h * 3_600_000);
}

// ---------------------------------------------------------------------------
// detectStaleInProgress
// ---------------------------------------------------------------------------

describe("detectStaleInProgress", () => {
    it("returns null for non-in_progress status", () => {
        const goal = { status: "blocked", updatedAt: hoursAgo(100) };
        expect(detectStaleInProgress(goal, new Date())).toBeNull();
    });

    it("returns null when age is below warning threshold (47h)", () => {
        const goal = { status: "in_progress", updatedAt: hoursAgo(47) };
        expect(detectStaleInProgress(goal, new Date())).toBeNull();
    });

    it("returns warning when age >= 48h and < 96h", () => {
        const goal = { status: "in_progress", updatedAt: hoursAgo(48) };
        const result = detectStaleInProgress(goal, new Date());
        expect(result).not.toBeNull();
        expect(result!.kind).toBe("stale_in_progress");
        expect(result!.severity).toBe("warning");
    });

    it("returns critical when age >= 96h", () => {
        const goal = { status: "in_progress", updatedAt: hoursAgo(96) };
        const result = detectStaleInProgress(goal, new Date());
        expect(result).not.toBeNull();
        expect(result!.severity).toBe("critical");
    });

    it("uses STALE_IN_PROGRESS_WARN threshold", () => {
        const justBefore = { status: "in_progress", updatedAt: new Date(Date.now() - TIME_MS.STALE_IN_PROGRESS_WARN + 1000) };
        const justAfter = { status: "in_progress", updatedAt: new Date(Date.now() - TIME_MS.STALE_IN_PROGRESS_WARN) };
        expect(detectStaleInProgress(justBefore, new Date())).toBeNull();
        expect(detectStaleInProgress(justAfter, new Date())?.severity).toBe("warning");
    });

    it("uses STALE_IN_PROGRESS_CRITICAL threshold", () => {
        const justBefore = { status: "in_progress", updatedAt: new Date(Date.now() - TIME_MS.STALE_IN_PROGRESS_CRITICAL + 1000) };
        const justAfter = { status: "in_progress", updatedAt: new Date(Date.now() - TIME_MS.STALE_IN_PROGRESS_CRITICAL) };
        expect(detectStaleInProgress(justBefore, new Date())?.severity).toBe("warning");
        expect(detectStaleInProgress(justAfter, new Date())?.severity).toBe("critical");
    });
});

// ---------------------------------------------------------------------------
// detectBlockedAging
// ---------------------------------------------------------------------------

describe("detectBlockedAging", () => {
    it("returns null for non-blocked status", () => {
        const goal = { status: "in_progress", blockedSince: hoursAgo(100) };
        expect(detectBlockedAging(goal, new Date())).toBeNull();
    });

    it("returns null when blockedSince is null", () => {
        const goal = { status: "blocked", blockedSince: null };
        expect(detectBlockedAging(goal, new Date())).toBeNull();
    });

    it("returns null when age is below warning threshold (23h)", () => {
        const goal = { status: "blocked", blockedSince: hoursAgo(23) };
        expect(detectBlockedAging(goal, new Date())).toBeNull();
    });

    it("returns warning when age >= 24h and < 72h", () => {
        const goal = { status: "blocked", blockedSince: hoursAgo(24) };
        const result = detectBlockedAging(goal, new Date());
        expect(result?.kind).toBe("blocked_aging");
        expect(result?.severity).toBe("warning");
    });

    it("returns critical when age >= 72h", () => {
        const goal = { status: "blocked", blockedSince: hoursAgo(72) };
        const result = detectBlockedAging(goal, new Date());
        expect(result?.severity).toBe("critical");
    });

    it("uses BLOCKED_AGING_WARN threshold", () => {
        const justBefore = { status: "blocked", blockedSince: new Date(Date.now() - TIME_MS.BLOCKED_AGING_WARN + 1000) };
        const justAfter = { status: "blocked", blockedSince: new Date(Date.now() - TIME_MS.BLOCKED_AGING_WARN) };
        expect(detectBlockedAging(justBefore, new Date())).toBeNull();
        expect(detectBlockedAging(justAfter, new Date())?.severity).toBe("warning");
    });

    it("uses BLOCKED_AGING_CRITICAL threshold", () => {
        const justBefore = { status: "blocked", blockedSince: new Date(Date.now() - TIME_MS.BLOCKED_AGING_CRITICAL + 1000) };
        const justAfter = { status: "blocked", blockedSince: new Date(Date.now() - TIME_MS.BLOCKED_AGING_CRITICAL) };
        expect(detectBlockedAging(justBefore, new Date())?.severity).toBe("warning");
        expect(detectBlockedAging(justAfter, new Date())?.severity).toBe("critical");
    });
});

// ---------------------------------------------------------------------------
// detectRepeatedFailure
// ---------------------------------------------------------------------------

describe("detectRepeatedFailure", () => {
    it("returns null when failed count is below threshold", () => {
        const tasks = Array.from({ length: REPEATED_FAILURE_THRESHOLD - 1 }, () => makeTask("failed"));
        expect(detectRepeatedFailure({ tasks })).toBeNull();
    });

    it(`returns warning when failed count is exactly ${REPEATED_FAILURE_THRESHOLD}`, () => {
        const tasks = Array.from({ length: REPEATED_FAILURE_THRESHOLD }, () => makeTask("failed"));
        const result = detectRepeatedFailure({ tasks });
        expect(result?.kind).toBe("repeated_failure");
        expect(result?.severity).toBe("warning");
    });

    it("returns critical when failed count >= 5", () => {
        const tasks = Array.from({ length: 5 }, () => makeTask("failed"));
        expect(detectRepeatedFailure({ tasks })?.severity).toBe("critical");
    });

    it("only counts failed tasks, ignores other statuses", () => {
        const tasks = [
            makeTask("failed"),
            makeTask("completed"),
            makeTask("failed"),
            makeTask("running"),
        ];
        // 2 failed < threshold of 3
        expect(detectRepeatedFailure({ tasks })).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// detectAllTerminalWithFailures
// ---------------------------------------------------------------------------

describe("detectAllTerminalWithFailures", () => {
    it("returns null for empty task list", () => {
        expect(detectAllTerminalWithFailures({ tasks: [] })).toBeNull();
    });

    it("returns null when some tasks are still active", () => {
        const tasks = [makeTask("running"), makeTask("failed")];
        expect(detectAllTerminalWithFailures({ tasks })).toBeNull();
    });

    it("returns null when all terminal but none failed", () => {
        const tasks = [makeTask("completed"), makeTask("cancelled")];
        expect(detectAllTerminalWithFailures({ tasks })).toBeNull();
    });

    it("returns critical when all terminal and some failed", () => {
        const tasks = [makeTask("completed"), makeTask("failed"), makeTask("cancelled")];
        const result = detectAllTerminalWithFailures({ tasks });
        expect(result?.kind).toBe("all_tasks_terminal_with_failures");
        expect(result?.severity).toBe("critical");
    });
});

// ---------------------------------------------------------------------------
// scoreGoalHealth
// ---------------------------------------------------------------------------

describe("scoreGoalHealth", () => {
    it("returns score of 100 for a healthy goal", () => {
        const goal = makeGoal({ status: "in_progress", updatedAt: hoursAgo(1), tasks: [makeTask("running")] });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(100);
        expect(result.signals).toHaveLength(0);
    });

    it("deducts 20 for stale_in_progress warning", () => {
        const goal = makeGoal({ status: "in_progress", updatedAt: hoursAgo(48), tasks: [] });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(80);
    });

    it("deducts 40 for stale_in_progress critical", () => {
        const goal = makeGoal({ status: "in_progress", updatedAt: hoursAgo(96), tasks: [] });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(60);
    });

    it("deducts 15 for blocked_aging warning", () => {
        const goal = makeGoal({ status: "blocked", blockedSince: hoursAgo(24), tasks: [] });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(85);
    });

    it("deducts 35 for blocked_aging critical", () => {
        const goal = makeGoal({ status: "blocked", blockedSince: hoursAgo(72), tasks: [] });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(65);
    });

    it("deducts 10 per failed task beyond 2 (3 failed + 1 running = -10)", () => {
        // Include a running task so all_tasks_terminal_with_failures doesn't also fire
        const tasks = [...Array.from({ length: 3 }, () => makeTask("failed")), makeTask("running")];
        const goal = makeGoal({ status: "in_progress", updatedAt: hoursAgo(1), tasks });
        const result = scoreGoalHealth(goal, new Date());
        // repeated_failure warning: (3 - 2) * 10 = 10
        expect(result.score).toBe(90);
    });

    it("deducts 30 for all_tasks_terminal_with_failures", () => {
        const tasks = [makeTask("completed"), makeTask("failed")];
        const goal = makeGoal({ status: "in_progress", updatedAt: hoursAgo(1), tasks });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBe(70);
    });

    it("score never goes below 0", () => {
        const tasks = Array.from({ length: 10 }, () => makeTask("failed"));
        const goal = makeGoal({
            status: "blocked",
            blockedSince: hoursAgo(96),
            updatedAt: hoursAgo(96),
            tasks,
        });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("returns correct goalId, title, description", () => {
        const goal = makeGoal({ id: "g-abc", title: "My goal", description: "Desc" });
        const result = scoreGoalHealth(goal, new Date());
        expect(result.goalId).toBe("g-abc");
        expect(result.goalTitle).toBe("My goal");
        expect(result.goalDescription).toBe("Desc");
    });
});

// ---------------------------------------------------------------------------
// classifyGoalLayer
// ---------------------------------------------------------------------------

describe("classifyGoalLayer", () => {
    it("returns strategic for root goal with subGoals", () => {
        expect(classifyGoalLayer({ parentGoalId: null, subGoalCount: 3, taskCount: 0 })).toBe("strategic");
    });

    it("returns operational for non-root goal with subGoals", () => {
        expect(classifyGoalLayer({ parentGoalId: "p-1", subGoalCount: 2, taskCount: 5 })).toBe("operational");
    });

    it("returns execution for leaf goal (has parent, no subGoals)", () => {
        expect(classifyGoalLayer({ parentGoalId: "p-1", subGoalCount: 0, taskCount: 3 })).toBe("execution");
    });

    it("returns operational for root goal with no subGoals but has tasks", () => {
        expect(classifyGoalLayer({ parentGoalId: null, subGoalCount: 0, taskCount: 5 })).toBe("operational");
    });

    it("returns operational for root goal with no subGoals and no tasks", () => {
        expect(classifyGoalLayer({ parentGoalId: null, subGoalCount: 0, taskCount: 0 })).toBe("operational");
    });
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
    it("lowercases and splits on whitespace", () => {
        const tokens = tokenize("Build Payment System");
        expect(tokens.has("build")).toBe(true);
        expect(tokens.has("payment")).toBe(true);
        expect(tokens.has("system")).toBe(true);
    });

    it("removes stop words", () => {
        const tokens = tokenize("build the system for the user");
        expect(tokens.has("the")).toBe(false);
        expect(tokens.has("for")).toBe(false);
        expect(tokens.has("build")).toBe(true);
    });

    it("removes short words (≤2 chars)", () => {
        const tokens = tokenize("go to a new db or vm");
        expect(tokens.has("go")).toBe(false);
        expect(tokens.has("db")).toBe(false);
        expect(tokens.has("new")).toBe(true);
    });

    it("splits on punctuation", () => {
        const tokens = tokenize("build-payment.system:now");
        expect(tokens.has("build")).toBe(true);
        expect(tokens.has("payment")).toBe(true);
        expect(tokens.has("system")).toBe(true);
        expect(tokens.has("now")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// detectNarrativeDeviation
// ---------------------------------------------------------------------------

describe("detectNarrativeDeviation", () => {
    it("returns null when project narrative is null", () => {
        expect(detectNarrativeDeviation({
            goalTitle: "Build payment system",
            goalDescription: null,
            projectNarrative: null,
        })).toBeNull();
    });

    it("returns null when project narrative is empty", () => {
        expect(detectNarrativeDeviation({
            goalTitle: "Build payment system",
            goalDescription: null,
            projectNarrative: "  ",
        })).toBeNull();
    });

    it("returns null when overlap is above 10%", () => {
        expect(detectNarrativeDeviation({
            goalTitle: "Build payment integration for e-commerce platform",
            goalDescription: "Integrate Stripe payment processing",
            projectNarrative: "Build an e-commerce platform with payment processing, user accounts, and product catalog",
        })).toBeNull();
    });

    it("returns warning when overlap is below 10%", () => {
        const result = detectNarrativeDeviation({
            goalTitle: "Optimize Redis caching layer",
            goalDescription: "Tune eviction policies and TTL settings",
            projectNarrative: "Build a mobile social media app with photo sharing and messaging",
        });
        expect(result).not.toBeNull();
        expect(result!.kind).toBe("narrative_deviation");
        expect(result!.severity).toBe("warning");
    });

    it("returns null for empty goal text", () => {
        expect(detectNarrativeDeviation({
            goalTitle: "a",
            goalDescription: null,
            projectNarrative: "Build something great",
        })).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// scoreGoalHealth with narrative context
// ---------------------------------------------------------------------------

describe("scoreGoalHealth with narrative", () => {
    it("deducts 15 for narrative_deviation", () => {
        const goal = makeGoal({
            title: "Optimize Redis caching layer",
            description: "Tune eviction policies",
            status: "in_progress",
            updatedAt: hoursAgo(1),
        });
        const result = scoreGoalHealth(goal, new Date(), {
            projectNarrative: "Build a mobile social media app with photo sharing and messaging",
        });
        expect(result.signals.some((s) => s.kind === "narrative_deviation")).toBe(true);
        expect(result.score).toBe(85);
    });

    it("does not add narrative_deviation when narrative is null", () => {
        const goal = makeGoal({ title: "Build something", status: "in_progress", updatedAt: hoursAgo(1) });
        const result = scoreGoalHealth(goal, new Date(), { projectNarrative: null });
        expect(result.signals.some((s) => s.kind === "narrative_deviation")).toBe(false);
        expect(result.score).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// buildHealthSuggestionCandidates
// ---------------------------------------------------------------------------

describe("buildHealthSuggestionCandidates", () => {
    function makeResult(overrides: Partial<GoalHealthResult>): GoalHealthResult {
        return {
            goalId: "g-1",
            goalTitle: "Test",
            goalDescription: null,
            goalLayer: "operational",
            score: 100,
            signals: [],
            ...overrides,
        };
    }

    it("returns empty array for healthy goals", () => {
        const results = [makeResult({ score: 100, signals: [] })];
        expect(buildHealthSuggestionCandidates(results)).toHaveLength(0);
    });

    it("generates stale_goal_attention for stale_in_progress warning", () => {
        const results = [makeResult({
            signals: [{ kind: "stale_in_progress", severity: "warning", detail: "48h stale" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toBe("stale_goal_attention:g-1:warning");
        expect(candidates[0].bucket).toBe("next_step");
        expect(candidates[0].requiresHuman).toBe(false);
    });

    it("generates stale_goal_attention for stale_in_progress critical", () => {
        const results = [makeResult({
            signals: [{ kind: "stale_in_progress", severity: "critical", detail: "96h stale" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates[0].dedupeKey).toBe("stale_goal_attention:g-1:critical");
    });

    it("skips blocked_aging warning (only critical triggers suggestion)", () => {
        const results = [makeResult({
            signals: [{ kind: "blocked_aging", severity: "warning", detail: "24h blocked" }],
        })];
        expect(buildHealthSuggestionCandidates(results)).toHaveLength(0);
    });

    it("generates blocked_goal_aging for blocked_aging critical", () => {
        const results = [makeResult({
            signals: [{ kind: "blocked_aging", severity: "critical", detail: "72h blocked" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toBe("blocked_goal_aging:g-1:critical");
        expect(candidates[0].requiresHuman).toBe(true);
        expect(candidates[0].bucket).toBe("needs_decision");
    });

    it("skips repeated_failure warning (only critical triggers suggestion)", () => {
        const results = [makeResult({
            signals: [{ kind: "repeated_failure", severity: "warning", detail: "3 failed" }],
        })];
        expect(buildHealthSuggestionCandidates(results)).toHaveLength(0);
    });

    it("generates repeated_failure_replan for repeated_failure critical", () => {
        const results = [makeResult({
            signals: [{ kind: "repeated_failure", severity: "critical", detail: "5 failed" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates[0].dedupeKey).toBe("repeated_failure_replan:g-1:critical");
        expect(candidates[0].requiresHuman).toBe(true);
    });

    it("generates suggested_goal (requiresHuman:false) for operational all_tasks_terminal_with_failures", () => {
        const results = [makeResult({
            goalLayer: "operational",
            signals: [{ kind: "all_tasks_terminal_with_failures", severity: "critical", detail: "all failed" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates[0].dedupeKey).toBe("goal_replan_needed:g-1");
        expect(candidates[0].type).toBe("suggested_goal");
        expect(candidates[0].requiresHuman).toBe(false);
        expect(candidates[0].bucket).toBe("next_step");
    });

    it("generates suggested_goal (requiresHuman:true) for strategic all_tasks_terminal_with_failures", () => {
        const results = [makeResult({
            goalLayer: "strategic",
            signals: [{ kind: "all_tasks_terminal_with_failures", severity: "critical", detail: "all failed" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates[0].dedupeKey).toBe("goal_replan_needed:g-1");
        expect(candidates[0].type).toBe("suggested_goal");
        expect(candidates[0].requiresHuman).toBe(true);
        expect(candidates[0].bucket).toBe("needs_decision");
    });

    it("generates suggested_task for execution all_tasks_terminal_with_failures", () => {
        const results = [makeResult({
            goalLayer: "execution",
            signals: [{ kind: "all_tasks_terminal_with_failures", severity: "critical", detail: "all failed" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates[0].dedupeKey).toBe("goal_replan_needed:g-1");
        expect(candidates[0].type).toBe("suggested_task");
        expect(candidates[0].requiresHuman).toBe(false);
        expect(candidates[0].bucket).toBe("next_step");
    });

    it("generates narrative_deviation suggestion", () => {
        const results = [makeResult({
            signals: [{ kind: "narrative_deviation", severity: "warning", detail: "0% overlap" }],
        })];
        const candidates = buildHealthSuggestionCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toBe("narrative_deviation:g-1");
        expect(candidates[0].requiresHuman).toBe(true);
        expect(candidates[0].bucket).toBe("needs_decision");
    });

    it("generates one candidate per qualifying signal across multiple goals", () => {
        const results = [
            makeResult({
                goalId: "g-1",
                signals: [
                    { kind: "stale_in_progress", severity: "warning", detail: "stale" },
                    { kind: "all_tasks_terminal_with_failures", severity: "critical", detail: "terminal" },
                ],
            }),
            makeResult({
                goalId: "g-2",
                signals: [{ kind: "blocked_aging", severity: "critical", detail: "blocked" }],
            }),
        ];
        const candidates = buildHealthSuggestionCandidates(results);
        // stale_in_progress warning → 1, all_tasks_terminal → 1, blocked_aging critical → 1
        expect(candidates).toHaveLength(3);
        const dedupeKeys = candidates.map((c) => c.dedupeKey);
        expect(dedupeKeys).toContain("stale_goal_attention:g-1:warning");
        expect(dedupeKeys).toContain("goal_replan_needed:g-1");
        expect(dedupeKeys).toContain("blocked_goal_aging:g-2:critical");
    });
});
