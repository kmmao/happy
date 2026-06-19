import { describe, it, expect } from "vitest";
import { createUsageReporter, type UsageReport } from "./usageReporter";
import { Usage } from "./types";

function makeUsage(partial: Partial<Usage>): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...partial,
  } as Usage;
}

function setup() {
  const emitted: UsageReport[] = [];
  const reporter = createUsageReporter({ emit: (r) => emitted.push(r) });
  return { reporter, emitted };
}

describe("UsageReporter.reportProviderUsage", () => {
  it("shapes token totals and zero cost, keyed by provider", () => {
    const { reporter, emitted } = setup();
    reporter.reportProviderUsage(
      "codex-session",
      makeUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 }),
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].key).toBe("codex-session");
    expect(emitted[0].tokens.total).toBe(17);
    expect(emitted[0].tokens.input).toBe(10);
    expect(emitted[0].tokens.cache_read).toBe(2);
    expect(emitted[0].cost.total).toBe(0);
  });

  it("adds a per-model token bucket when model is provided", () => {
    const { reporter, emitted } = setup();
    reporter.reportProviderUsage("claude-session", makeUsage({ input_tokens: 4, output_tokens: 1 }), "opus");
    expect(emitted[0].tokens.opus).toBe(5);
  });
});

describe("UsageReporter.reportTurnCost (cumulative → delta)", () => {
  it("reports the delta between consecutive cumulative totals", () => {
    const { reporter, emitted } = setup();
    reporter.reportTurnCost({ totalCostUsd: 1.0, modelUsage: { opus: { costUSD: 1.0 } } });
    reporter.reportTurnCost({ totalCostUsd: 1.75, modelUsage: { opus: { costUSD: 1.75 } } });

    expect(emitted[0].cost.total).toBeCloseTo(1.0);
    expect(emitted[1].cost.total).toBeCloseTo(0.75);
    expect(emitted[1].cost.opus).toBeCloseTo(0.75);
  });

  it("treats a cumulative drop as a new-run boundary (raw value, reset baseline)", () => {
    const { reporter, emitted } = setup();
    reporter.reportTurnCost({ totalCostUsd: 2.0, modelUsage: { opus: { costUSD: 2.0 } } });
    // New process: cumulative resets to a smaller value.
    reporter.reportTurnCost({ totalCostUsd: 0.5, modelUsage: { opus: { costUSD: 0.5 } } });
    // Next report continues from the new baseline (0.5), not the old (2.0).
    reporter.reportTurnCost({ totalCostUsd: 0.9, modelUsage: { opus: { costUSD: 0.9 } } });

    expect(emitted[1].cost.total).toBeCloseTo(0.5); // raw value at boundary
    expect(emitted[2].cost.total).toBeCloseTo(0.4); // 0.9 - 0.5
    expect(emitted[2].cost.opus).toBeCloseTo(0.4);
  });

  it("never emits a negative delta", () => {
    const { reporter, emitted } = setup();
    reporter.reportTurnCost({ totalCostUsd: 1.0, modelUsage: { opus: { costUSD: 1.0 } } });
    // Same cumulative reported again — delta should clamp to 0, not go negative.
    reporter.reportTurnCost({ totalCostUsd: 1.0, modelUsage: { opus: { costUSD: 1.0 } } });
    expect(emitted[1].cost.total).toBe(0);
    expect(emitted[1].cost.opus).toBe(0);
  });
});
