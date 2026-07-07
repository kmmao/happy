import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib";
import { PLAN_FAKE_RESTART } from "./jsonl/prompts";
import {
  MAX_PLAN_RESTART_DELAY_MS,
  maybeDelayPlanRestartWrite,
} from "./claudeRemote";

// Regression coverage for the plan-mode 429 mitigation.
//
// The helper throttles the PLAN_FAKE_RESTART continuation prompt so a
// self-hosted mirror ('ANTHROPIC_BASE_URL' pointing at a proxy) has a
// window to reset its per-minute rate limit before the huge --resume
// request lands. The four behaviours locked down here map 1:1 to the
// findings that survived the xhigh code-review:
//
//   1. `includes(PLAN_FAKE_RESTART)` — batched siblings still match.
//   2. AbortSignal — a stop mid-delay resolves promptly.
//   3. Upper-bound clamp — mis-set values above TIMEOUT_MAX don't
//      silently downgrade to a 1 ms setTimeout.
//   4. Strict integer parse — "30s", "5.5", "30000ms" fail loud instead
//      of degrading via parseInt's numeric-prefix accept.
//
// vi.useFakeTimers() lets us assert wait durations without real sleeps.

const ENV_KEY = "HAPPY_PLAN_RESTART_DELAY_MS";

describe("maybeDelayPlanRestartWrite", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  describe("message matching (finding #1: batched siblings)", () => {
    it("is a no-op when message does not include PLAN_FAKE_RESTART", async () => {
      vi.stubEnv(ENV_KEY, "5000");

      const started = performance.now();
      await maybeDelayPlanRestartWrite("regular user prompt");
      const elapsed = performance.now() - started;

      // Zero wall-time — never touched setTimeout.
      expect(elapsed).toBeLessThan(50);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("throttles the bare PLAN_FAKE_RESTART string", async () => {
      vi.stubEnv(ENV_KEY, "5000");

      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      // 4999 ms in — still pending.
      await vi.advanceTimersByTimeAsync(4999);
      let resolved = false;
      void p.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      // Cross the boundary.
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("sleeping 5000ms"),
      );
    });

    it("throttles a batched message where PLAN_FAKE_RESTART is joined with a sibling", async () => {
      // MessageQueue2.collectBatch joins same-modeHash urgent items with
      // "\n". The identity check `msg === PLAN_FAKE_RESTART` would drop
      // the throttle entirely in this shape; `.includes(...)` catches it.
      vi.stubEnv(ENV_KEY, "1000");

      const batched = `${PLAN_FAKE_RESTART}\n<some other queued urgent>`;
      const p = maybeDelayPlanRestartWrite(batched);
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("sleeping 1000ms"),
      );
    });

    it("throttles two batched PLAN_FAKE_RESTART entries", async () => {
      vi.stubEnv(ENV_KEY, "1000");

      const p = maybeDelayPlanRestartWrite(
        `${PLAN_FAKE_RESTART}\n${PLAN_FAKE_RESTART}`,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  describe("env var validation (finding #4: strict integer parse)", () => {
    it("is a no-op when HAPPY_PLAN_RESTART_DELAY_MS is unset", async () => {
      // Nothing stubbed — env var undefined in test env.
      await maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("is a no-op when HAPPY_PLAN_RESTART_DELAY_MS is empty string", async () => {
      vi.stubEnv(ENV_KEY, "");
      await maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["30s", "unit-suffix"],
      ["30000ms", "unit-suffix"],
      ["5.5", "decimal"],
      ["-100", "negative"],
      ["0x10", "hex-literal"],
      ["nope", "non-numeric"],
    ])(
      "warns and is a no-op for non-integer value %j (%s)",
      async (raw) => {
        vi.stubEnv(ENV_KEY, raw);
        await maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]![0]).toContain(ENV_KEY);
        expect(debugSpy).not.toHaveBeenCalled();
      },
    );

    it("is a no-op for zero without warning", async () => {
      vi.stubEnv(ENV_KEY, "0");
      await maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      // "0" passes the regex but fails ms<=0 — expected silent no-op.
      expect(debugSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("accepts a valid positive integer", async () => {
      vi.stubEnv(ENV_KEY, "2500");
      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      await vi.advanceTimersByTimeAsync(2500);
      await p;
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("sleeping 2500ms"),
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("upper-bound clamp (finding #3: setTimeout TIMEOUT_MAX)", () => {
    it("clamps values above MAX_PLAN_RESTART_DELAY_MS and warns", async () => {
      // 9_999_999_999 > 2^31-1 → Node's setTimeout would silently
      // downgrade to 1ms without this clamp.
      const oversized = String(MAX_PLAN_RESTART_DELAY_MS + 12345);
      vi.stubEnv(ENV_KEY, oversized);

      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      // Not resolved after MAX-1 ms — clamp is honoured.
      await vi.advanceTimersByTimeAsync(MAX_PLAN_RESTART_DELAY_MS - 1);
      let resolved = false;
      void p.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await p;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`exceeds max ${MAX_PLAN_RESTART_DELAY_MS}ms`),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining(`sleeping ${MAX_PLAN_RESTART_DELAY_MS}ms`),
      );
    });

    it("passes values at exactly MAX_PLAN_RESTART_DELAY_MS through unchanged", async () => {
      vi.stubEnv(ENV_KEY, String(MAX_PLAN_RESTART_DELAY_MS));

      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      await vi.advanceTimersByTimeAsync(MAX_PLAN_RESTART_DELAY_MS);
      await p;

      expect(warnSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining(`sleeping ${MAX_PLAN_RESTART_DELAY_MS}ms`),
      );
    });
  });

  describe("abort signal (finding #2: cancellable delay)", () => {
    it("returns immediately when the signal is already aborted", async () => {
      vi.stubEnv(ENV_KEY, "60000");
      const controller = new AbortController();
      controller.abort();

      const started = performance.now();
      await maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART, controller.signal);
      const elapsed = performance.now() - started;

      // Pre-check short-circuits BEFORE the debug log — sleep never ran.
      expect(elapsed).toBeLessThan(50);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("resolves promptly when the signal aborts mid-delay", async () => {
      vi.stubEnv(ENV_KEY, "60000");
      const controller = new AbortController();

      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART, controller.signal);
      // 5s in — nowhere near the 60s window.
      await vi.advanceTimersByTimeAsync(5_000);
      let resolved = false;
      void p.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Abort — the pending setTimeout should be cleared and the
      // promise should resolve on the next tick, NOT after another 55s.
      controller.abort();
      await Promise.resolve();
      await p;

      // Sanity: the debug log for the START of the sleep did fire, but
      // the "did we wait the full 60s?" is answered by the fact that
      // the promise resolved without advancing timers to 60s.
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("sleeping 60000ms"),
      );
    });

    it("works without a signal argument", async () => {
      vi.stubEnv(ENV_KEY, "1000");
      const p = maybeDelayPlanRestartWrite(PLAN_FAKE_RESTART);
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(debugSpy).toHaveBeenCalled();
    });
  });
});
