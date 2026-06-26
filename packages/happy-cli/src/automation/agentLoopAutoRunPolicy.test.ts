import { describe, it, expect } from "vitest";
import {
  evaluateAutoRunPolicy,
  isWithinQuietHours,
  localDayStartAt,
  normalizeAutoRunCounter,
  normalizeDailyCostCounter,
} from "./agentLoopAutoRunPolicy";
import type { AgentLoopDefinition } from "./AgentLoopStore";

// A local-time instant: 2024-06-15 14:00 local.
const NOW = new Date(2024, 5, 15, 14, 0, 0).getTime();
// A local-time instant at a given HH:MM on the same day.
const at = (h: number, m = 0) => new Date(2024, 5, 15, h, m, 0).getTime();

function loop(over: Partial<AgentLoopDefinition> = {}): AgentLoopDefinition {
  return { iteration: 0, ...over } as unknown as AgentLoopDefinition;
}

describe("isWithinQuietHours", () => {
  it("is false when bounds are missing or equal", () => {
    expect(isWithinQuietHours(NOW, undefined, "06:00")).toBe(false);
    expect(isWithinQuietHours(NOW, "09:00", undefined)).toBe(false);
    expect(isWithinQuietHours(NOW, "09:00", "09:00")).toBe(false);
  });

  it("handles a same-day window [start, end)", () => {
    expect(isWithinQuietHours(at(14), "09:00", "17:00")).toBe(true);
    expect(isWithinQuietHours(at(18), "09:00", "17:00")).toBe(false);
    expect(isWithinQuietHours(at(9), "09:00", "17:00")).toBe(true); // inclusive start
    expect(isWithinQuietHours(at(17), "09:00", "17:00")).toBe(false); // exclusive end
  });

  it("handles a window that wraps past midnight", () => {
    expect(isWithinQuietHours(at(23), "22:00", "06:00")).toBe(true);
    expect(isWithinQuietHours(at(5), "22:00", "06:00")).toBe(true);
    expect(isWithinQuietHours(at(12), "22:00", "06:00")).toBe(false);
    expect(isWithinQuietHours(at(6), "22:00", "06:00")).toBe(false); // exclusive end across wrap
  });
});

describe("normalizeAutoRunCounter / normalizeDailyCostCounter", () => {
  it("keeps the count when the window started today", () => {
    const today = localDayStartAt(NOW);
    expect(
      normalizeAutoRunCounter(loop({ autoRunsToday: 3, autoRunWindowStartedAt: today }), NOW),
    ).toEqual({ autoRunsToday: 3, autoRunWindowStartedAt: today });
  });

  it("resets the count when the window is stale (a previous day)", () => {
    const today = localDayStartAt(NOW);
    const yesterday = today - 24 * 60 * 60 * 1000;
    expect(
      normalizeAutoRunCounter(loop({ autoRunsToday: 9, autoRunWindowStartedAt: yesterday }), NOW),
    ).toEqual({ autoRunsToday: 0, autoRunWindowStartedAt: today });
    expect(
      normalizeDailyCostCounter(loop({ todayCostUsd: 5, todayCostWindowStartedAt: yesterday }), NOW),
    ).toEqual({ todayCostUsd: 0, todayCostWindowStartedAt: today });
  });
});

describe("evaluateAutoRunPolicy", () => {
  const today = localDayStartAt(NOW);

  it("allows a fresh loop with no limits", () => {
    expect(evaluateAutoRunPolicy(loop(), NOW)).toEqual({ allowed: true });
  });

  it("blocks at the iteration cap, taking priority over other reasons", () => {
    expect(evaluateAutoRunPolicy(loop({ iteration: 5, maxIterations: 5 }), NOW)).toEqual({
      allowed: false,
      reason: "max-iterations",
    });
  });

  it("blocks during quiet hours", () => {
    expect(
      evaluateAutoRunPolicy(loop({ quietHoursStart: "09:00", quietHoursEnd: "17:00" }), at(14)),
    ).toEqual({ allowed: false, reason: "quiet-hours" });
  });

  it("blocks inside the cooldown window", () => {
    expect(
      evaluateAutoRunPolicy(loop({ cooldownMs: 60_000, lastCompletedAt: NOW - 30_000 }), NOW),
    ).toEqual({ allowed: false, reason: "cooldown" });
    // Past the cooldown → allowed.
    expect(
      evaluateAutoRunPolicy(loop({ cooldownMs: 60_000, lastCompletedAt: NOW - 90_000 }), NOW).allowed,
    ).toBe(true);
  });

  it("blocks when today's auto-run quota is reached", () => {
    expect(
      evaluateAutoRunPolicy(
        loop({ maxAutoRunsPerDay: 3, autoRunsToday: 3, autoRunWindowStartedAt: today }),
        NOW,
      ),
    ).toEqual({ allowed: false, reason: "max-auto-runs" });
  });

  it("ignores a stale quota counter from a previous day", () => {
    const yesterday = today - 24 * 60 * 60 * 1000;
    expect(
      evaluateAutoRunPolicy(
        loop({ maxAutoRunsPerDay: 3, autoRunsToday: 99, autoRunWindowStartedAt: yesterday }),
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it("blocks when today's USD budget is reached", () => {
    expect(
      evaluateAutoRunPolicy(
        loop({ maxUsdPerDay: 1, todayCostUsd: 1, todayCostWindowStartedAt: today }),
        NOW,
      ),
    ).toEqual({ allowed: false, reason: "budget-daily" });
  });
});
