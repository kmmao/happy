import { Usage } from "./types";

/**
 * UsageReporter — the single home for turning provider usage/cost data into
 * `usage-report` socket emits. Extracted from ApiSessionClient, where the
 * "compute delta → shape {tokens, cost} → emit + log" pattern was repeated
 * across three methods with the cumulative-cost baseline (lastReportedCumulativeCost
 * / lastReportedModelCosts) living as loose god-class fields.
 *
 * The cumulative→delta accounting (the genuinely tricky part — SDK costs are
 * cumulative, with new-run boundary resets) lives here behind a small interface,
 * and is testable without a socket: the transport is injected as `emit`.
 */

export interface UsageTokens {
  [key: string]: number;
  total: number;
}

export interface UsageCost {
  [key: string]: number;
  total: number;
}

/** A shaped usage report, ready for the transport to stamp + emit. */
export interface UsageReport {
  key: string;
  tokens: UsageTokens;
  cost: UsageCost;
  /** Log label distinguishing per-request token reports from turn-end cost reports. */
  logLabel: string;
}

export interface UsageReporterDeps {
  /** Emit a shaped report (the transport adds sessionId + sends over the socket). */
  emit: (report: UsageReport) => void;
}

export interface UsageReporter {
  /**
   * Report per-request usage (tokens only) under a provider-specific key. Cost
   * is zero here — actual cost is reported once at turn end via reportTurnCost.
   */
  reportProviderUsage(key: string, usage: Usage, model?: string): void;
  /**
   * Report turn-end cost from SDK data. SDK `totalCostUsd` / `modelUsage[m].costUSD`
   * are CUMULATIVE; the reporter computes the delta from the last report to avoid
   * double-counting, treating a cumulative drop as a new-run boundary.
   */
  reportTurnCost(resultData: {
    totalCostUsd: number;
    modelUsage: Record<string, { costUSD: number }>;
  }): void;
}

export function createUsageReporter(deps: UsageReporterDeps): UsageReporter {
  // Cumulative-cost baseline. SDK costs are cumulative since process start, so
  // each turn-end report subtracts the previous cumulative to recover the delta.
  let lastReportedCumulativeCost = 0;
  let lastReportedModelCosts: Record<string, number> = {};

  function reportProviderUsage(key: string, usage: Usage, model?: string): void {
    const totalTokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    const tokens: UsageTokens = {
      total: totalTokens,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_creation: usage.cache_creation_input_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
    };
    if (model) {
      tokens[model] = totalTokens;
    }

    // Cost is zero for per-request reports; actual cost comes from the SDK at turn end.
    const cost: UsageCost = { total: 0, input: 0, output: 0 };

    deps.emit({ key, tokens, cost, logLabel: "[SOCKET] Sending usage data:" });
  }

  function reportTurnCost(resultData: {
    totalCostUsd: number;
    modelUsage: Record<string, { costUSD: number }>;
  }): void {
    // Compute delta from last reported cumulative cost. If cumulative drops
    // (SDK reports 0 for an aborted turn, or a new process), treat it as a new
    // run boundary — use the raw value as delta and reset the baseline.
    const isNewRun = resultData.totalCostUsd < lastReportedCumulativeCost;
    const deltaTotalCost = isNewRun
      ? resultData.totalCostUsd
      : Math.max(0, resultData.totalCostUsd - lastReportedCumulativeCost);
    lastReportedCumulativeCost = resultData.totalCostUsd;

    const cost: UsageCost = { total: deltaTotalCost };
    for (const [model, usage] of Object.entries(resultData.modelUsage)) {
      const prevModelCost = isNewRun ? 0 : lastReportedModelCosts[model] || 0;
      cost[model] = Math.max(0, usage.costUSD - prevModelCost);
      lastReportedModelCosts[model] = usage.costUSD;
    }

    if (isNewRun) {
      // Reset all model costs for the new run boundary.
      lastReportedModelCosts = {};
      for (const [model, usage] of Object.entries(resultData.modelUsage)) {
        lastReportedModelCosts[model] = usage.costUSD;
      }
    }

    deps.emit({
      key: "claude-session",
      tokens: { total: 0, input: 0, output: 0 },
      cost,
      logLabel: "[SOCKET] Sending turn-end cost report (SDK):",
    });
  }

  return { reportProviderUsage, reportTurnCost };
}
