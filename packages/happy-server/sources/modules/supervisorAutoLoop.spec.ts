import { describe, expect, it } from "vitest";
import {
    AUTO_LOOP_DEBOUNCE_MS,
    decideAutoLoop,
    type AutoLoopDecisionInput,
} from "./supervisorAutoLoop";

const NOW = 1_700_000_000_000;

function base(overrides: Partial<AutoLoopDecisionInput>): AutoLoopDecisionInput {
    return {
        threshold: 30,
        healthScore: 50,
        lastAutoLoopStartedAt: null,
        runLoopId: null,
        now: NOW,
        ...overrides,
    };
}

describe("decideAutoLoop (ADR-0022 D-1)", () => {
    it("fires when threshold is set, health crosses it, no debounce, no parent loop", () => {
        const decision = decideAutoLoop(base({}));
        expect(decision).toEqual({ fire: true });
    });

    describe("does NOT fire when:", () => {
        it("threshold is null (feature disabled)", () => {
            const decision = decideAutoLoop(base({ threshold: null }));
            expect(decision).toEqual({ fire: false, reason: "disabled" });
        });

        it("the run is already inside a loop (no self-spawn)", () => {
            const decision = decideAutoLoop(base({ runLoopId: "loop-abc" }));
            expect(decision).toEqual({ fire: false, reason: "in_loop" });
        });

        it("healthScore is null (analysis didn't produce one)", () => {
            const decision = decideAutoLoop(base({ healthScore: null }));
            expect(decision).toEqual({ fire: false, reason: "no_health_score" });
        });

        it("healthScore is strictly below the threshold (project is healthier)", () => {
            const decision = decideAutoLoop(base({ threshold: 30, healthScore: 29 }));
            expect(decision).toEqual({ fire: false, reason: "below_threshold" });
        });

        it("an auto-loop fired within the debounce window", () => {
            const lastStart = new Date(NOW - 60 * 60 * 1000); // 1h ago
            const decision = decideAutoLoop(base({ lastAutoLoopStartedAt: lastStart }));
            expect(decision).toEqual({ fire: false, reason: "debounced" });
        });
    });

    describe("debounce boundary behaviour:", () => {
        it("exactly at the boundary is still debounced (strict less-than)", () => {
            const lastStart = new Date(NOW - AUTO_LOOP_DEBOUNCE_MS);
            const decision = decideAutoLoop(base({ lastAutoLoopStartedAt: lastStart }));
            expect(decision).toEqual({ fire: true });
        });

        it("just past the boundary fires", () => {
            const lastStart = new Date(NOW - AUTO_LOOP_DEBOUNCE_MS - 1);
            const decision = decideAutoLoop(base({ lastAutoLoopStartedAt: lastStart }));
            expect(decision).toEqual({ fire: true });
        });

        it("just inside the boundary still debounces", () => {
            const lastStart = new Date(NOW - AUTO_LOOP_DEBOUNCE_MS + 1);
            const decision = decideAutoLoop(base({ lastAutoLoopStartedAt: lastStart }));
            expect(decision).toEqual({ fire: false, reason: "debounced" });
        });
    });

    describe("health-score boundary behaviour:", () => {
        it("equal to threshold fires (>= semantics)", () => {
            const decision = decideAutoLoop(base({ threshold: 30, healthScore: 30 }));
            expect(decision).toEqual({ fire: true });
        });

        it("zero healthScore does NOT fire when threshold > 0", () => {
            const decision = decideAutoLoop(base({ threshold: 30, healthScore: 0 }));
            expect(decision).toEqual({ fire: false, reason: "below_threshold" });
        });

        it("threshold 0 fires for any non-null health score", () => {
            const decision = decideAutoLoop(base({ threshold: 0, healthScore: 0 }));
            expect(decision).toEqual({ fire: true });
        });
    });

    describe("guard precedence (early returns win when multiple reasons apply):", () => {
        it("threshold null wins over everything else", () => {
            const decision = decideAutoLoop(base({
                threshold: null,
                runLoopId: "loop-x",
                healthScore: null,
            }));
            expect(decision).toEqual({ fire: false, reason: "disabled" });
        });

        it("in_loop wins over below_threshold and debounce", () => {
            const decision = decideAutoLoop(base({
                runLoopId: "loop-x",
                healthScore: 5,
                lastAutoLoopStartedAt: new Date(NOW),
            }));
            expect(decision).toEqual({ fire: false, reason: "in_loop" });
        });

        it("no_health_score wins over below_threshold and debounce", () => {
            const decision = decideAutoLoop(base({
                healthScore: null,
                lastAutoLoopStartedAt: new Date(NOW),
            }));
            expect(decision).toEqual({ fire: false, reason: "no_health_score" });
        });

        it("below_threshold wins over debounce", () => {
            const decision = decideAutoLoop(base({
                healthScore: 5,
                lastAutoLoopStartedAt: new Date(NOW),
            }));
            expect(decision).toEqual({ fire: false, reason: "below_threshold" });
        });
    });
});
