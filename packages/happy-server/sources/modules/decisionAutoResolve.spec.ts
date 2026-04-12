/**
 * Pure-function unit tests for decisionAutoResolve.
 * Zero DB mocks needed for canAutoResolveDecision.
 */

import { describe, expect, it } from "vitest";
import { canAutoResolveDecision } from "./decisionAutoResolve";
import type { WorldAutonomyPolicy } from "@kmmao/happy-wire";
import type { PrecedentMatch } from "./decisionMatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<WorldAutonomyPolicy> = {}): WorldAutonomyPolicy {
    return {
        level: "semi-auto",
        maxAutoAcceptsPerDay: null,
        maxConcurrentAutoTasks: null,
        autoAcceptTypes: ["suggested_task", "suggested_decision"],
        ...overrides,
    };
}

function makePrecedent(overrides: Partial<PrecedentMatch> = {}): PrecedentMatch {
    return {
        decisionId: "dec-prev-1",
        knowledgeId: "know-1",
        chosenOption: "opt-a",
        rationale: "Chose modal for consistency",
        question: "Use modal or sheet?",
        ...overrides,
    };
}

const OPTIONS = [
    { id: "opt-a", description: "Modal" },
    { id: "opt-b", description: "Sheet" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("canAutoResolveDecision", () => {
    it("allows resolution when policy is semi-auto with suggested_decision in types and option matches", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy({ level: "semi-auto" }),
            precedent: makePrecedent({ chosenOption: "opt-a" }),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(true);
    });

    it("allows resolution when policy is auto", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy({ level: "auto" }),
            precedent: makePrecedent({ chosenOption: "opt-b" }),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(true);
    });

    it("blocks when policy level is disabled", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy({ level: "disabled", autoAcceptTypes: ["suggested_decision"] }),
            precedent: makePrecedent(),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("disabled");
    });

    it("blocks when policy level is suggest", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy({ level: "suggest", autoAcceptTypes: ["suggested_decision"] }),
            precedent: makePrecedent(),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("suggest");
    });

    it('blocks when "suggested_decision" is not in autoAcceptTypes', () => {
        const result = canAutoResolveDecision({
            policy: makePolicy({ autoAcceptTypes: ["suggested_task"] }),
            precedent: makePrecedent(),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("autoAcceptTypes");
    });

    it("blocks when precedent chosenOption is not in current decision options", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy(),
            precedent: makePrecedent({ chosenOption: "opt-c" }),
            decisionOptions: OPTIONS,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("opt-c");
    });

    it("blocks when decisionOptions is empty", () => {
        const result = canAutoResolveDecision({
            policy: makePolicy(),
            precedent: makePrecedent({ chosenOption: "opt-a" }),
            decisionOptions: [],
        });

        expect(result.allowed).toBe(false);
    });
});
