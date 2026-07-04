import { describe, it, expect } from "vitest";
import { resolveVisibleAgentGoalStatus } from "./agentGoalStatus";
import type { AgentGoalStatus, Session } from "@/sync/storageTypes";

type GoalSession = Pick<Session, "agentState" | "presence" | "metadata">;

function activeGoal(overrides: Partial<Extract<AgentGoalStatus, { status: "active" }>> = {}) {
    return {
        source: "claude" as const,
        observedAt: 1000,
        status: "active" as const,
        sourceSessionId: "claude-abc",
        text: "测试goal bar的显示效果",
        capabilities: { clear: true, stop: true, edit: true },
        ...overrides,
    };
}

function session(goal: AgentGoalStatus | undefined, over: Partial<GoalSession> = {}): GoalSession {
    return {
        presence: "online",
        metadata: { claudeSessionId: "claude-abc" } as GoalSession["metadata"],
        agentState: goal ? ({ agentGoalStatus: goal } as GoalSession["agentState"]) : undefined,
        ...over,
    };
}

describe("resolveVisibleAgentGoalStatus (goal bar display gate)", () => {
    it("shows the bar with goal text when active, online, and source matches", () => {
        const result = resolveVisibleAgentGoalStatus(session(activeGoal()));
        expect(result).not.toBeNull();
        expect(result?.text).toBe("测试goal bar的显示效果");
        expect(result?.capabilities).toEqual({ clear: true, stop: true, edit: true });
    });

    it("hides the bar when there is no goal", () => {
        expect(resolveVisibleAgentGoalStatus(session(undefined))).toBeNull();
    });

    it("hides the bar when the goal is inactive", () => {
        const inactive = { source: "claude", observedAt: 1, status: "inactive", reason: "cleared" } as AgentGoalStatus;
        expect(resolveVisibleAgentGoalStatus(session(inactive))).toBeNull();
    });

    it("hides the bar when the session is offline", () => {
        expect(resolveVisibleAgentGoalStatus(session(activeGoal(), { presence: "offline" }))).toBeNull();
    });

    it("hides the bar when the source session id does not match the live claude session", () => {
        const mismatched = session(activeGoal({ sourceSessionId: "claude-STALE" }));
        expect(resolveVisibleAgentGoalStatus(mismatched)).toBeNull();
    });

    it("preserves long multibyte text so the renderer can ellipsize it (numberOfLines=1)", () => {
        const long = "验证超长目标文字在 goal bar 中是否会被正确截断处理 ".repeat(6).trim();
        const result = resolveVisibleAgentGoalStatus(session(activeGoal({ text: long })));
        expect(result?.text).toBe(long);
    });

    it("passes through partial capabilities so only enabled action buttons render", () => {
        const result = resolveVisibleAgentGoalStatus(
            session(activeGoal({ capabilities: { edit: true } })),
        );
        expect(result?.capabilities).toEqual({ edit: true });
    });
});
