import { describe, expect, it } from "vitest";

import {
  MAX_PLAN_CONTINUE_RETRIES,
  decidePlanContinueRetry,
  planContinueBackoffMs,
} from "./planContinueRetryPolicy";

describe("planContinueBackoffMs", () => {
  it("returns the 30s / 60s / 120s ladder for attempts 1..3", () => {
    expect(planContinueBackoffMs(1)).toBe(30_000);
    expect(planContinueBackoffMs(2)).toBe(60_000);
    expect(planContinueBackoffMs(3)).toBe(120_000);
  });

  it("clamps attempts below 1 to the first-attempt delay", () => {
    // Defensive: 0 and negatives shouldn't happen (retryCount is
    // monotonic) but the policy should still degrade gracefully to the
    // minimum backoff rather than returning 0/NaN.
    expect(planContinueBackoffMs(0)).toBe(30_000);
    expect(planContinueBackoffMs(-1)).toBe(30_000);
  });

  it("holds the ceiling for attempts beyond MAX", () => {
    // MAX_PLAN_CONTINUE_RETRIES=3 → caller should give up before
    // asking, but if it does ask, don't extrapolate into arbitrarily
    // long sleeps.
    expect(planContinueBackoffMs(4)).toBe(120_000);
    expect(planContinueBackoffMs(100)).toBe(120_000);
  });
});

describe("decidePlanContinueRetry", () => {
  it("no-op when the turn is not a plan continuation", () => {
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: false,
      retryCount: 0,
      turnProducedNonRateLimitOutput: false,
    });
    expect(d.action).toBe("no-op");
    if (d.action === "no-op") {
      expect(d.reason).toContain("not a plan-continuation turn");
    }
  });

  it("no-op when the turn already produced non-rate-limit output", () => {
    // Guardrail: user has seen partial output; do NOT silently re-fire
    // PLAN_FAKE_RESTART or the model would repeat itself.
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: 0,
      turnProducedNonRateLimitOutput: true,
    });
    expect(d.action).toBe("no-op");
    if (d.action === "no-op") {
      expect(d.reason).toContain("auto-retry disarmed");
    }
  });

  it("retries at attempt 1 with 30s delay on the first rate_limit hit", () => {
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: 0,
      turnProducedNonRateLimitOutput: false,
    });
    expect(d.action).toBe("retry");
    if (d.action === "retry") {
      expect(d.attempt).toBe(1);
      expect(d.delayMs).toBe(30_000);
    }
  });

  it("escalates through the 60s / 120s ladder", () => {
    const attempt2 = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: 1,
      turnProducedNonRateLimitOutput: false,
    });
    expect(attempt2.action).toBe("retry");
    if (attempt2.action === "retry") {
      expect(attempt2.attempt).toBe(2);
      expect(attempt2.delayMs).toBe(60_000);
    }

    const attempt3 = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: 2,
      turnProducedNonRateLimitOutput: false,
    });
    expect(attempt3.action).toBe("retry");
    if (attempt3.action === "retry") {
      expect(attempt3.attempt).toBe(3);
      expect(attempt3.delayMs).toBe(120_000);
    }
  });

  it("gives up when retryCount reaches MAX_PLAN_CONTINUE_RETRIES", () => {
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: MAX_PLAN_CONTINUE_RETRIES,
      turnProducedNonRateLimitOutput: false,
    });
    expect(d.action).toBe("give-up");
    if (d.action === "give-up") {
      expect(d.reason).toContain("budget exhausted");
      expect(d.reason).toContain(String(MAX_PLAN_CONTINUE_RETRIES));
    }
  });

  it("gives up when retryCount is above MAX (defensive)", () => {
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: MAX_PLAN_CONTINUE_RETRIES + 5,
      turnProducedNonRateLimitOutput: false,
    });
    expect(d.action).toBe("give-up");
  });

  it("prioritises 'produced output' rearm over the retry budget", () => {
    // Even with retries left, real output means we must NOT re-fire.
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: true,
      retryCount: 0,
      turnProducedNonRateLimitOutput: true,
    });
    expect(d.action).toBe("no-op");
  });

  it("prioritises 'not a continuation' over the retry budget", () => {
    // Defensive: if the launcher forgot to flip isPlanContinuationTurn
    // and left retryCount at 2, we must NOT auto-retry a normal user
    // turn — that's Claude TUI's job.
    const d = decidePlanContinueRetry({
      isPlanContinuationTurn: false,
      retryCount: 2,
      turnProducedNonRateLimitOutput: false,
    });
    expect(d.action).toBe("no-op");
  });
});
