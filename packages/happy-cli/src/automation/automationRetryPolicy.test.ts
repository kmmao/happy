import { describe, it, expect } from "vitest";
import {
  shouldRetry,
  computeNextRunAt,
  evaluateRetry,
  RETRY_BACKOFF_STEP_MS,
} from "./automationRetryPolicy";

describe("shouldRetry", () => {
  it("retries while attempts remain, stops at the cap", () => {
    expect(shouldRetry(1, 3)).toBe(true);
    expect(shouldRetry(2, 3)).toBe(true);
    expect(shouldRetry(3, 3)).toBe(false); // boundary: attempt === max → no retry
    expect(shouldRetry(4, 3)).toBe(false);
  });
});

describe("computeNextRunAt", () => {
  it("schedules linear backoff of attempt * step from now", () => {
    expect(computeNextRunAt(1000, 1, 3)).toBe(1000 + 1 * RETRY_BACKOFF_STEP_MS);
    expect(computeNextRunAt(1000, 2, 3)).toBe(1000 + 2 * RETRY_BACKOFF_STEP_MS);
  });

  it("returns undefined once out of attempts", () => {
    expect(computeNextRunAt(1000, 3, 3)).toBeUndefined();
  });
});

describe("evaluateRetry", () => {
  it("returns retry=true with a scheduled nextRunAt while attempts remain", () => {
    expect(evaluateRetry(1000, 2, 3)).toEqual({
      retry: true,
      nextRunAt: 1000 + 2 * RETRY_BACKOFF_STEP_MS,
    });
  });

  it("returns retry=false with undefined nextRunAt at the cap", () => {
    expect(evaluateRetry(1000, 3, 3)).toEqual({
      retry: false,
      nextRunAt: undefined,
    });
  });
});
