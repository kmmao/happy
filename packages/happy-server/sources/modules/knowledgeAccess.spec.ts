import { describe, it, expect } from "vitest";
import {
    computeTurnHitPlan,
    decideReinjectAction,
    getInitialTurnBudget,
    type TurnHitRow,
} from "./knowledgeAccess";

describe("knowledgeAccess", () => {
    describe("getInitialTurnBudget", () => {
        describe("initial session injection (isInitialInjection=true)", () => {
            it("seeds all confidences with flat 1 initial turn", () => {
                expect(getInitialTurnBudget("high", true)).toEqual({ initialTurns: 1, maxTurns: 14 });
                expect(getInitialTurnBudget("medium", true)).toEqual({ initialTurns: 1, maxTurns: 10 });
                expect(getInitialTurnBudget("low", true)).toEqual({ initialTurns: 1, maxTurns: 6 });
            });

            it("falls back to medium maxTurns for unknown confidence", () => {
                expect(getInitialTurnBudget("mystery", true)).toEqual({ initialTurns: 1, maxTurns: 10 });
            });
        });

        describe("mid-session injection (isInitialInjection=false)", () => {
            it("seeds high confidence with 7 initial / 14 max", () => {
                expect(getInitialTurnBudget("high", false)).toEqual({ initialTurns: 7, maxTurns: 14 });
            });

            it("seeds medium confidence with 5 initial / 10 max", () => {
                expect(getInitialTurnBudget("medium", false)).toEqual({ initialTurns: 5, maxTurns: 10 });
            });

            it("seeds low confidence with 3 initial / 6 max", () => {
                expect(getInitialTurnBudget("low", false)).toEqual({ initialTurns: 3, maxTurns: 6 });
            });

            it("falls back to medium budget for unknown confidence", () => {
                expect(getInitialTurnBudget("mystery", false)).toEqual({ initialTurns: 5, maxTurns: 10 });
            });
        });
    });

    describe("decideReinjectAction", () => {
        it("creates a row when no previous access exists", () => {
            expect(decideReinjectAction(null)).toBe("create");
        });

        it("reactivates only when the previous row is evicted", () => {
            expect(
                decideReinjectAction({
                    hotStatus: "evicted",
                    turnsRemaining: 0,
                    initialTurns: 7,
                }),
            ).toBe("reactivate");
        });

        it("is a noop when the previous row is hot at full TTL", () => {
            expect(
                decideReinjectAction({
                    hotStatus: "hot",
                    turnsRemaining: 7,
                    initialTurns: 7,
                }),
            ).toBe("noop");
        });

        it("is a noop when the previous row is hot but already decremented", () => {
            // This is the 7/14-stuck regression guard:
            // a partially-decayed hot row must NOT be reset to initialTurns.
            expect(
                decideReinjectAction({
                    hotStatus: "hot",
                    turnsRemaining: 3,
                    initialTurns: 7,
                }),
            ).toBe("noop");
        });
    });

    describe("computeTurnHitPlan", () => {
        it("returns empty plan when there are no hot rows", () => {
            const plan = computeTurnHitPlan([], ["any"]);
            expect(plan.hit).toBe(0);
            expect(plan.miss).toBe(0);
            expect(plan.evicted).toBe(0);
            expect(plan.hitIncrementIds).toEqual([]);
            expect(plan.hitAtCapIds).toEqual([]);
            expect(plan.decrementIds).toEqual([]);
            expect(plan.evictIds).toEqual([]);
        });

        it("increments below-cap hits and adds them to hitIncrementIds", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "a", turnsRemaining: 3, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, ["a"]);
            expect(plan.hitIncrementIds).toEqual(["a"]);
            expect(plan.hitAtCapIds).toEqual([]);
            expect(plan.hit).toBe(1);
            expect(plan.miss).toBe(0);
            expect(plan.evicted).toBe(0);
        });

        it("routes at-cap hits to hitAtCapIds (still bumps hitCount but no increment)", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "b", turnsRemaining: 10, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, ["b"]);
            expect(plan.hitAtCapIds).toEqual(["b"]);
            expect(plan.hitIncrementIds).toEqual([]);
            expect(plan.hit).toBe(1);
        });

        it("treats above-cap (defensive) as at-cap", () => {
            // Should not happen in practice but the plan must be idempotent.
            const rows: TurnHitRow[] = [
                { knowledgeId: "c", turnsRemaining: 20, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, ["c"]);
            expect(plan.hitAtCapIds).toEqual(["c"]);
            expect(plan.hitIncrementIds).toEqual([]);
        });

        it("decrements misses with remaining turns > 1", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "d", turnsRemaining: 5, maxTurns: 10 },
                { knowledgeId: "e", turnsRemaining: 2, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, []);
            expect(plan.decrementIds).toEqual(["d", "e"]);
            expect(plan.evictIds).toEqual([]);
            expect(plan.miss).toBe(2);
        });

        it("evicts misses when turnsRemaining-1 reaches zero", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "f", turnsRemaining: 1, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, []);
            expect(plan.evictIds).toEqual(["f"]);
            expect(plan.decrementIds).toEqual([]);
            expect(plan.evicted).toBe(1);
            expect(plan.miss).toBe(1);
        });

        it("evicts a row whose turnsRemaining is already 0", () => {
            // Edge case: drift shouldn't keep a zero-row alive.
            const rows: TurnHitRow[] = [
                { knowledgeId: "g", turnsRemaining: 0, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, []);
            expect(plan.evictIds).toEqual(["g"]);
        });

        it("splits a mixed batch into hit/decrement/evict correctly", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "hit-below", turnsRemaining: 4, maxTurns: 10 },
                { knowledgeId: "hit-at-cap", turnsRemaining: 10, maxTurns: 10 },
                { knowledgeId: "miss-decay", turnsRemaining: 3, maxTurns: 10 },
                { knowledgeId: "miss-evict", turnsRemaining: 1, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, ["hit-below", "hit-at-cap"]);
            expect(plan.hitIncrementIds).toEqual(["hit-below"]);
            expect(plan.hitAtCapIds).toEqual(["hit-at-cap"]);
            expect(plan.decrementIds).toEqual(["miss-decay"]);
            expect(plan.evictIds).toEqual(["miss-evict"]);
            expect(plan.hit).toBe(2);
            expect(plan.miss).toBe(2);
            expect(plan.evicted).toBe(1);
        });

        it("ignores hit ids that are not in the hot set", () => {
            const rows: TurnHitRow[] = [
                { knowledgeId: "present", turnsRemaining: 2, maxTurns: 10 },
            ];
            const plan = computeTurnHitPlan(rows, ["present", "ghost"]);
            expect(plan.hitIncrementIds).toEqual(["present"]);
            expect(plan.hit).toBe(1);
            expect(plan.miss).toBe(0);
        });

        it("repeated hits bank toward the cap (simulation)", () => {
            // Simulate 12 consecutive hits starting at 3/10: each tick moves toward 10.
            let turnsRemaining = 3;
            const maxTurns = 10;
            let hitCount = 0;
            for (let i = 0; i < 12; i++) {
                const plan = computeTurnHitPlan(
                    [{ knowledgeId: "x", turnsRemaining, maxTurns }],
                    ["x"],
                );
                if (plan.hitIncrementIds.length === 1) turnsRemaining += 1;
                hitCount += 1;
            }
            expect(turnsRemaining).toBe(maxTurns);
            expect(hitCount).toBe(12);
        });

        it("misses deplete the bank until eviction (simulation)", () => {
            // Start at 5/10 and miss until evicted.
            let turnsRemaining = 5;
            const maxTurns = 10;
            let evicted = false;
            for (let i = 0; i < 10 && !evicted; i++) {
                const plan = computeTurnHitPlan(
                    [{ knowledgeId: "x", turnsRemaining, maxTurns }],
                    [],
                );
                if (plan.evictIds.length === 1) {
                    evicted = true;
                    turnsRemaining = 0;
                } else if (plan.decrementIds.length === 1) {
                    turnsRemaining -= 1;
                }
            }
            expect(evicted).toBe(true);
            expect(turnsRemaining).toBe(0);
        });
    });
});
