import type { Usage } from "@/api/types";

type CodexTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexTokenUsageSnapshot = {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
  turnId: string | null;
};

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBreakdown(
  value: unknown,
  keys:
    | {
        total: "total_tokens";
        input: "input_tokens";
        cached: "cached_input_tokens";
        output: "output_tokens";
        reasoning: "reasoning_output_tokens";
      }
    | {
        total: "totalTokens";
        input: "inputTokens";
        cached: "cachedInputTokens";
        output: "outputTokens";
        reasoning: "reasoningOutputTokens";
      },
): CodexTokenUsageBreakdown | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const totalTokens = readNumber(record[keys.total]);
  const inputTokens = readNumber(record[keys.input]);
  const cachedInputTokens = readNumber(record[keys.cached]);
  const outputTokens = readNumber(record[keys.output]);
  const reasoningOutputTokens = readNumber(record[keys.reasoning]);

  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    return null;
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

export function extractCodexTokenUsageSnapshot(
  message: Record<string, unknown>,
): CodexTokenUsageSnapshot | null {
  if (message.type !== "token_count") {
    return null;
  }

  const info =
    message.info && typeof message.info === "object"
      ? (message.info as Record<string, unknown>)
      : null;
  const tokenUsage =
    (message.tokenUsage && typeof message.tokenUsage === "object"
      ? (message.tokenUsage as Record<string, unknown>)
      : null) ??
    (message.token_usage && typeof message.token_usage === "object"
      ? (message.token_usage as Record<string, unknown>)
      : null);

  const total =
    parseBreakdown(info?.total_token_usage, {
      total: "total_tokens",
      input: "input_tokens",
      cached: "cached_input_tokens",
      output: "output_tokens",
      reasoning: "reasoning_output_tokens",
    }) ??
    parseBreakdown(tokenUsage?.total, {
      total: "totalTokens",
      input: "inputTokens",
      cached: "cachedInputTokens",
      output: "outputTokens",
      reasoning: "reasoningOutputTokens",
    });

  const last =
    parseBreakdown(info?.last_token_usage, {
      total: "total_tokens",
      input: "input_tokens",
      cached: "cached_input_tokens",
      output: "output_tokens",
      reasoning: "reasoning_output_tokens",
    }) ??
    parseBreakdown(tokenUsage?.last, {
      total: "totalTokens",
      input: "inputTokens",
      cached: "cachedInputTokens",
      output: "outputTokens",
      reasoning: "reasoningOutputTokens",
    });

  if (!total || !last) {
    return null;
  }

  const modelContextWindow =
    readNumber(info?.model_context_window) ??
    readNumber(tokenUsage?.modelContextWindow);
  const turnId =
    typeof message.turn_id === "string"
      ? message.turn_id
      : typeof message.turnId === "string"
        ? message.turnId
        : null;

  return {
    total,
    last,
    modelContextWindow,
    turnId,
  };
}

export function getCodexTokenUsageSignature(
  snapshot: CodexTokenUsageSnapshot,
): string {
  return JSON.stringify({
    turnId: snapshot.turnId,
    total: snapshot.total,
  });
}

export function codexBreakdownToUsage(
  breakdown: CodexTokenUsageBreakdown,
): Usage | null {
  if (breakdown.totalTokens <= 0) {
    return null;
  }

  return {
    input_tokens: breakdown.inputTokens,
    output_tokens: breakdown.outputTokens + breakdown.reasoningOutputTokens,
    cache_read_input_tokens: breakdown.cachedInputTokens,
  };
}

export function buildCodexContextUsage(
  snapshot: CodexTokenUsageSnapshot,
): {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
} | null {
  if (!snapshot.modelContextWindow || snapshot.modelContextWindow <= 0) {
    return null;
  }

  const estimatedContextTokens =
    snapshot.last.inputTokens + snapshot.last.cachedInputTokens;

  return {
    totalTokens: estimatedContextTokens,
    maxTokens: snapshot.modelContextWindow,
    percentage:
      (estimatedContextTokens / snapshot.modelContextWindow) * 100,
  };
}
