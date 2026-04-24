import { describe, expect, it } from "vitest";
import {
  buildCodexContextUsage,
  codexBreakdownToUsage,
  extractCodexTokenUsageSnapshot,
  getCodexTokenUsageSignature,
} from "../utils/tokenUsage";

describe("codex token usage helpers", () => {
  it("parses legacy token_count payloads", () => {
    const snapshot = extractCodexTokenUsageSnapshot({
      type: "token_count",
      turn_id: "turn-legacy",
      info: {
        total_token_usage: {
          input_tokens: 900,
          cached_input_tokens: 300,
          output_tokens: 40,
          reasoning_output_tokens: 10,
          total_tokens: 1250,
        },
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 175,
        },
        model_context_window: 258400,
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.turnId).toBe("turn-legacy");
    expect(snapshot?.total.totalTokens).toBe(1250);
    expect(snapshot?.last.totalTokens).toBe(175);
    expect(codexBreakdownToUsage(snapshot!.last)).toEqual({
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 50,
    });
    expect(buildCodexContextUsage(snapshot!, "gpt-5.5")).toEqual({
      totalTokens: 150,
      maxTokens: 900000,
      percentage: (150 / 900000) * 100,
    });
  });

  it("parses app-server token usage payloads", () => {
    const snapshot = extractCodexTokenUsageSnapshot({
      type: "token_count",
      turnId: "turn-app-server",
      tokenUsage: {
        total: {
          totalTokens: 1000,
          inputTokens: 700,
          cachedInputTokens: 200,
          outputTokens: 80,
          reasoningOutputTokens: 20,
        },
        last: {
          totalTokens: 220,
          inputTokens: 150,
          cachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 10,
        },
        modelContextWindow: 950000,
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.turnId).toBe("turn-app-server");
    expect(snapshot?.total.cachedInputTokens).toBe(200);
    expect(snapshot?.last.reasoningOutputTokens).toBe(10);
    expect(getCodexTokenUsageSignature(snapshot!)).toContain("turn-app-server");
    expect(buildCodexContextUsage(snapshot!, "gpt-5.5")).toEqual({
      totalTokens: 190,
      maxTokens: 900000,
      percentage: (190 / 900000) * 100,
    });
  });

  it("keeps SDK-reported context windows for non GPT-5.4 models", () => {
    const snapshot = extractCodexTokenUsageSnapshot({
      type: "token_count",
      tokenUsage: {
        total: {
          totalTokens: 1000,
          inputTokens: 700,
          cachedInputTokens: 200,
          outputTokens: 80,
          reasoningOutputTokens: 20,
        },
        last: {
          totalTokens: 220,
          inputTokens: 150,
          cachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 10,
        },
        modelContextWindow: 950000,
      },
    });

    expect(buildCodexContextUsage(snapshot!, "gpt-5.4-mini")).toEqual({
      totalTokens: 190,
      maxTokens: 950000,
      percentage: (190 / 950000) * 100,
    });
  });

  it("ignores token_count payloads without concrete usage info", () => {
    expect(
      extractCodexTokenUsageSnapshot({
        type: "token_count",
        info: null,
      }),
    ).toBeNull();
  });
});
