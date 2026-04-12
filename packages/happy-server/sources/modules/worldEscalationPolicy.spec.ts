/**
 * Pure-function unit tests for worldEscalationPolicy.
 * Zero mocks needed.
 */

import { describe, expect, it } from "vitest";
import { classifyActionRisk, shouldEscalate } from "./worldEscalationPolicy";
import type { WorldAutonomyPolicy } from "@kmmao/happy-wire";

function makePolicy(level: WorldAutonomyPolicy["level"]): WorldAutonomyPolicy {
    return {
        level,
        maxAutoAcceptsPerDay: null,
        maxConcurrentAutoTasks: null,
        autoAcceptTypes: ["suggested_task", "suggested_decision", "suggested_goal"],
    };
}

// ---------------------------------------------------------------------------
// classifyActionRisk
// ---------------------------------------------------------------------------

describe("classifyActionRisk", () => {
    describe("auto_accept_task", () => {
        it("is low risk when requiresHuman=false", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_task",
                requiresHuman: false,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("low");
        });

        it("is high risk when requiresHuman=true", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_task",
                requiresHuman: true,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("high");
        });
    });

    describe("auto_accept_goal", () => {
        it("is high risk for strategic layer", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_goal",
                goalLayer: "strategic",
                requiresHuman: false,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("high");
        });

        it("is medium risk for operational layer", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_goal",
                goalLayer: "operational",
                requiresHuman: false,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("medium");
        });

        it("is low risk for execution layer", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_goal",
                goalLayer: "execution",
                requiresHuman: false,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("low");
        });

        it("is high risk when requiresHuman=true regardless of layer", () => {
            const result = classifyActionRisk({
                actionType: "auto_accept_goal",
                goalLayer: "operational",
                requiresHuman: true,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("high");
        });
    });

    describe("auto_resolve_decision", () => {
        it("is medium risk with precedent", () => {
            const result = classifyActionRisk({
                actionType: "auto_resolve_decision",
                requiresHuman: false,
                hasPrecedent: true,
            });
            expect(result.risk).toBe("medium");
        });

        it("is high risk without precedent", () => {
            const result = classifyActionRisk({
                actionType: "auto_resolve_decision",
                requiresHuman: false,
                hasPrecedent: false,
            });
            expect(result.risk).toBe("high");
        });
    });
});

// ---------------------------------------------------------------------------
// shouldEscalate
// ---------------------------------------------------------------------------

describe("shouldEscalate", () => {
    it("always escalates high risk regardless of policy", () => {
        for (const level of ["disabled", "suggest", "semi-auto", "auto"] as const) {
            expect(shouldEscalate({ policy: makePolicy(level), risk: "high" })).toBe(true);
        }
    });

    it("escalates medium risk for disabled and suggest", () => {
        expect(shouldEscalate({ policy: makePolicy("disabled"), risk: "medium" })).toBe(true);
        expect(shouldEscalate({ policy: makePolicy("suggest"), risk: "medium" })).toBe(true);
    });

    it("escalates medium risk for semi-auto (requires auto)", () => {
        expect(shouldEscalate({ policy: makePolicy("semi-auto"), risk: "medium" })).toBe(true);
    });

    it("does not escalate medium risk for auto", () => {
        expect(shouldEscalate({ policy: makePolicy("auto"), risk: "medium" })).toBe(false);
    });

    it("does not escalate low risk for semi-auto", () => {
        expect(shouldEscalate({ policy: makePolicy("semi-auto"), risk: "low" })).toBe(false);
    });

    it("does not escalate low risk for auto", () => {
        expect(shouldEscalate({ policy: makePolicy("auto"), risk: "low" })).toBe(false);
    });
});
