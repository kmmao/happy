import { describe, expect, it } from "vitest";
import {
  getContextBreakdownItems,
  getContextBreakdownSourceInfo,
  getContextBreakdownSource,
  getContextBreakdownSummary,
  type ContextUsageData,
} from "./contextBreakdown";

const translate = (key: string) => `tr:${key}`;

function createUsageData(
  overrides: Partial<ContextUsageData> = {},
): ContextUsageData {
  return {
    totalTokens: 1000,
    maxTokens: 200000,
    percentage: 0.5,
    ...overrides,
  };
}

describe("getContextBreakdownItems", () => {
  it("prefers SDK categories, filters zero values, and humanizes known category names", () => {
    const items = getContextBreakdownItems(
      createUsageData({
        categories: [
          { name: "system prompt", tokens: 420, color: "#123456" },
          { name: "assistant messages", tokens: 180 },
          { name: "tool results", tokens: 0 },
          { name: "custom bucket", tokens: 90 },
        ],
      }),
      translate,
    );

    expect(items).toEqual([
      {
        key: "system prompt",
        label: "tr:agentInput.context.systemLabel",
        tokens: 420,
        percentage: 42,
        color: "#123456",
      },
      {
        key: "assistant messages",
        label: "tr:agentInput.context.assistantLabel",
        tokens: 180,
        percentage: 18,
        color: undefined,
      },
      {
        key: "custom bucket",
        label: "custom bucket",
        tokens: 90,
        percentage: 9,
        color: undefined,
      },
    ]);
  });

  it("falls back to messageBreakdown when SDK categories are absent", () => {
    const items = getContextBreakdownItems(
      createUsageData({
        totalTokens: 200,
        messageBreakdown: {
          toolCallTokens: 20,
          toolResultTokens: 80,
          attachmentTokens: 0,
          assistantMessageTokens: 60,
          userMessageTokens: 40,
        },
      }),
      translate,
    );

    expect(items).toEqual([
      {
        key: "tool-result",
        label: "tr:agentInput.context.toolResultLabel",
        tokens: 80,
        percentage: 40,
        color: undefined,
      },
      {
        key: "assistant",
        label: "tr:agentInput.context.assistantLabel",
        tokens: 60,
        percentage: 30,
        color: undefined,
      },
      {
        key: "user",
        label: "tr:agentInput.context.userLabel",
        tokens: 40,
        percentage: 20,
        color: undefined,
      },
      {
        key: "tool-call",
        label: "tr:agentInput.context.toolCallLabel",
        tokens: 20,
        percentage: 10,
        color: undefined,
      },
    ]);
  });

  it("returns an empty list when no breakdown data is available", () => {
    expect(getContextBreakdownItems(createUsageData(), translate)).toEqual([]);
  });
});

describe("getContextBreakdownSummary", () => {
  it("summarizes the top items and appends the remaining count", () => {
    const summary = getContextBreakdownSummary([
      { key: "system", label: "System", tokens: 420, percentage: 42 },
      { key: "assistant", label: "Assistant", tokens: 180, percentage: 18 },
      { key: "user", label: "User", tokens: 90, percentage: 9 },
    ]);

    expect(summary).toBe("System 42% · Assistant 18% · +1");
  });

  it("returns null when there is nothing to summarize", () => {
    expect(getContextBreakdownSummary([])).toBeNull();
  });
});

describe("getContextBreakdownSource", () => {
  it("returns sdk-categories when categories are present", () => {
    expect(
      getContextBreakdownSource(
        createUsageData({
          categories: [{ name: "system prompt", tokens: 420 }],
        }),
      ),
    ).toBe("sdk-categories");
  });

  it("returns message-breakdown-fallback when categories are absent but messageBreakdown exists", () => {
    expect(
      getContextBreakdownSource(
        createUsageData({
          messageBreakdown: {
            toolCallTokens: 20,
            toolResultTokens: 80,
            attachmentTokens: 0,
            assistantMessageTokens: 60,
            userMessageTokens: 40,
          },
        }),
      ),
    ).toBe("message-breakdown-fallback");
  });

  it("returns null when there is no breakdown source", () => {
    expect(getContextBreakdownSource(createUsageData())).toBeNull();
  });
});

describe("getContextBreakdownSourceInfo", () => {
  it("returns label and explanation for sdk categories", () => {
    expect(getContextBreakdownSourceInfo("sdk-categories", translate)).toEqual({
      label: "tr:agentInput.context.sourceSdkCategories",
      title: "tr:agentInput.context.sourceInfoTitle",
      message: "tr:agentInput.context.sourceSdkCategoriesMessage",
    });
  });

  it("returns label and explanation for fallback source", () => {
    expect(
      getContextBreakdownSourceInfo("message-breakdown-fallback", translate),
    ).toEqual({
      label: "tr:agentInput.context.sourceFallback",
      title: "tr:agentInput.context.sourceInfoTitle",
      message: "tr:agentInput.context.sourceFallbackMessage",
    });
  });

  it("returns null when source is missing", () => {
    expect(getContextBreakdownSourceInfo(null, translate)).toBeNull();
  });
});
