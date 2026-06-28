import { describe, it, expect } from "vitest";
import {
  TRANSIENT_ERROR_TYPES,
  computeAgentLoopTerminalOutcome,
} from "./agentLoopTerminalOutcome";
import type { AgentLoopDefinition } from "./AgentLoopStore";

const NOW = 1_700_000_000_000;
const FLOOR = 5 * 60_000;

function loop(over: Partial<AgentLoopDefinition> = {}): AgentLoopDefinition {
  return { iteration: 0, intervalMs: 60_000, ...over } as unknown as AgentLoopDefinition;
}

describe("computeAgentLoopTerminalOutcome", () => {
  it("does not burn the failure budget for a transient error type", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ consecutiveFailures: 2, maxConsecutiveFailures: 3 }),
      { status: "failed", errorType: "rate_limit" },
      NOW,
    );
    expect(out.isTransient).toBe(true);
    expect(out.nextConsecutiveFailures).toBe(2); // unchanged
    expect(out.shouldBlock).toBe(false);
  });

  it("counts a permanent failure and blocks once the budget is reached", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ consecutiveFailures: 2, maxConsecutiveFailures: 3 }),
      { status: "failed", errorType: "billing_error", errorMessage: "card declined" },
      NOW,
    );
    expect(out.isTransient).toBe(false);
    expect(out.nextConsecutiveFailures).toBe(3);
    expect(out.shouldBlock).toBe(true);
    expect(out.blockedReason).toBe("card declined");
  });

  it("floors the failure backoff at 5 minutes even for short intervals", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ intervalMs: 60_000 }),
      { status: "failed", errorType: "rate_limit" },
      NOW,
    );
    expect(out.effectiveBackoffMs).toBe(FLOOR);
  });

  it("defers past a reported rate-limit reset (plus 30s) when that is later", () => {
    const resetIn = 20 * 60_000; // 20 min > 5 min floor
    const out = computeAgentLoopTerminalOutcome(
      loop(),
      { status: "failed", errorType: "rate_limit", rateLimitResetsAt: NOW + resetIn },
      NOW,
    );
    expect(out.effectiveBackoffMs).toBe(resetIn + 30_000);
  });

  it("ignores a rate-limit reset already in the past", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop(),
      { status: "failed", errorType: "rate_limit", rateLimitResetsAt: NOW - 1000 },
      NOW,
    );
    expect(out.effectiveBackoffMs).toBe(FLOOR);
  });

  it("accumulates zero-cost iterations and self-heals the guardian at the threshold", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ consecutiveZeroCostIterations: 2 }),
      { status: "failed", errorType: "rate_limit", sessionCostUsd: 0 },
      NOW,
    );
    expect(out.nextConsecutiveZeroCost).toBe(3);
    expect(out.shouldForgetGuardian).toBe(true);
  });

  it("resets the zero-cost counter when the run billed positive cost", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ consecutiveZeroCostIterations: 2 }),
      { status: "completed", sessionCostUsd: 0.12 },
      NOW,
    );
    expect(out.runCost).toBe(0.12);
    expect(out.nextConsecutiveZeroCost).toBe(0);
    expect(out.shouldForgetGuardian).toBe(false);
  });

  it("applies stop-reason precedence: stop-on-success over max-iterations", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ stopOnSuccess: true, maxIterations: 5, iteration: 5 }),
      { status: "completed" },
      NOW,
    );
    expect(out.stopReason).toBe("stop-on-success");
  });

  it("flags daily-budget exhaustion as the stop reason", () => {
    const out = computeAgentLoopTerminalOutcome(
      loop({ maxUsdPerDay: 1, totalCostUsd: 0 }),
      { status: "completed", sessionCostUsd: 1.5 },
      NOW,
    );
    expect(out.dailyBudgetExceeded).toBe(true);
    expect(out.stopReason).toBe("budget-daily");
  });

  it("has no stop reason and no block on a clean success", () => {
    const out = computeAgentLoopTerminalOutcome(loop(), { status: "completed" }, NOW);
    expect(out.shouldBlock).toBe(false);
    expect(out.stopReason).toBeUndefined();
  });
});

describe("TRANSIENT_ERROR_TYPES (public — consumed by runClaude StopFailure split)", () => {
  it("includes the auto-retry categories and excludes permanent ones", () => {
    expect(TRANSIENT_ERROR_TYPES.has("rate_limit")).toBe(true);
    expect(TRANSIENT_ERROR_TYPES.has("overloaded")).toBe(true);
    expect(TRANSIENT_ERROR_TYPES.has("server_error")).toBe(true);
    expect(TRANSIENT_ERROR_TYPES.has("billing_error")).toBe(false);
    expect(TRANSIENT_ERROR_TYPES.has("authentication_failed")).toBe(false);
    expect(TRANSIENT_ERROR_TYPES.has("refusal")).toBe(false);
    expect(TRANSIENT_ERROR_TYPES.has("invalid_request")).toBe(false);
  });
});
