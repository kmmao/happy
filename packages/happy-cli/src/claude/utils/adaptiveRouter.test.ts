import { describe, it, expect } from "vitest";
import {
  parseAdaptiveKey,
  createInitialState,
  recordTurn,
  resolveModel,
  isAdaptiveMode,
  type AdaptiveRouterState,
  type TurnRecord,
} from "./adaptiveRouter";

describe("parseAdaptiveKey", () => {
  it("parses adaptiveUsage:sonnet", () => {
    const result = parseAdaptiveKey("adaptiveUsage:sonnet");
    expect(result).toEqual({
      isAdaptive: true,
      baseModelId: "claude-sonnet-4-6",
    });
  });

  it("parses adaptiveUsage:opus", () => {
    const result = parseAdaptiveKey("adaptiveUsage:opus");
    expect(result).toEqual({
      isAdaptive: true,
      baseModelId: "claude-opus-4-6",
    });
  });

  it("parses adaptiveUsage:haiku", () => {
    const result = parseAdaptiveKey("adaptiveUsage:haiku");
    expect(result).toEqual({
      isAdaptive: true,
      baseModelId: "claude-haiku-4-5-20251001",
    });
  });

  it("parses bare adaptiveUsage as sonnet (backward compat)", () => {
    const result = parseAdaptiveKey("adaptiveUsage");
    expect(result).toEqual({
      isAdaptive: true,
      baseModelId: "claude-sonnet-4-6",
    });
  });

  it("returns isAdaptive false for non-adaptive keys", () => {
    const result = parseAdaptiveKey("sonnet");
    expect(result.isAdaptive).toBe(false);
  });

  it("defaults unknown base to sonnet", () => {
    const result = parseAdaptiveKey("adaptiveUsage:unknown");
    expect(result).toEqual({
      isAdaptive: true,
      baseModelId: "claude-sonnet-4-6",
    });
  });
});

describe("isAdaptiveMode", () => {
  it("returns true for adaptiveUsage", () => {
    expect(isAdaptiveMode("adaptiveUsage")).toBe(true);
  });

  it("returns true for adaptiveUsage:sonnet", () => {
    expect(isAdaptiveMode("adaptiveUsage:sonnet")).toBe(true);
  });

  it("returns false for regular models", () => {
    expect(isAdaptiveMode("sonnet")).toBe(false);
    expect(isAdaptiveMode("opus")).toBe(false);
    expect(isAdaptiveMode(undefined)).toBe(false);
  });
});

describe("createInitialState", () => {
  it("creates state with correct base model", () => {
    const state = createInitialState("claude-sonnet-4-6");
    expect(state.baseModel).toBe("claude-sonnet-4-6");
    expect(state.currentModelId).toBe("claude-sonnet-4-6");
    expect(state.turnHistory).toEqual([]);
    expect(state.cumulativeInputTokens).toBe(0);
    expect(state.turnCount).toBe(0);
  });
});

describe("recordTurn", () => {
  it("immutably updates state", () => {
    const state = createInitialState("claude-sonnet-4-6");
    const turn: TurnRecord = {
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 2000,
    };

    const newState = recordTurn(state, turn);

    // Original state unchanged
    expect(state.turnHistory).toEqual([]);
    expect(state.cumulativeInputTokens).toBe(0);
    expect(state.turnCount).toBe(0);

    // New state updated
    expect(newState.turnHistory).toHaveLength(1);
    expect(newState.cumulativeInputTokens).toBe(1000);
    expect(newState.turnCount).toBe(1);
  });

  it("caps history at 20 entries", () => {
    let state = createInitialState("claude-sonnet-4-6");
    const turn: TurnRecord = {
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 500,
    };

    for (let i = 0; i < 25; i++) {
      state = recordTurn(state, turn);
    }

    expect(state.turnHistory).toHaveLength(20);
    expect(state.turnCount).toBe(25);
    expect(state.cumulativeInputTokens).toBe(2500);
  });
});

describe("resolveModel", () => {
  function stateWithBase(
    base: string,
    overrides?: Partial<AdaptiveRouterState>,
  ): AdaptiveRouterState {
    return {
      ...createInitialState(base),
      ...overrides,
    };
  }

  describe("simple/short messages → haiku", () => {
    it("routes 'ok' to haiku", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "ok");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });

    it("routes '好' to haiku", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "好");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });

    it("routes 'lgtm' to haiku", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "lgtm");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });

    it("routes short greetings like 'hello, what's model' to haiku", () => {
      const state = stateWithBase("claude-opus-4-6");
      const result = resolveModel(state, "hello,what's model");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });

    it("routes short questions without complex keywords to haiku", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "what time is it?");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });

    it("does not route short message with complex keyword to haiku", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "review this code");
      expect(result.modelId).not.toBe("claude-haiku-4-5-20251001");
    });

    it("does not change if already on haiku", () => {
      const state = stateWithBase("claude-haiku-4-5-20251001");
      const result = resolveModel(state, "ok");
      expect(result.changed).toBe(false);
    });
  });

  describe("complex keywords → opus", () => {
    it("routes long message with 'refactor' to opus", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const longMessage =
        "Please refactor the authentication module to use a more modular architecture. " +
        "The current implementation has too many responsibilities in a single file and needs " +
        "to be split into separate concerns for better maintainability and testing.";
      const result = resolveModel(state, longMessage);
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-opus-4-6");
    });

    it("routes long message with '架构' to opus", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const longMessage =
        "请帮我重新设计这个系统的架构，目前的微服务之间耦合太紧密了，" +
        "需要引入事件驱动的方式来解耦各个服务之间的通信，" +
        "同时考虑到高可用性和容错性的需求，我们需要一个更好的方案来处理服务发现和负载均衡。" +
        "另外，我们还需要考虑数据一致性的问题，目前使用的是最终一致性模型，" +
        "但在某些关键业务场景下可能需要强一致性保证，请给出一个全面的解决方案。" +
        "同时也要考虑到系统的可观测性，我们需要引入分布式追踪和日志聚合的能力，" +
        "确保在出现问题时能够快速定位和排查，减少系统的平均故障恢复时间。";
      expect(longMessage.length).toBeGreaterThan(200);
      const result = resolveModel(state, longMessage);
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-opus-4-6");
    });

    it("does not upgrade for short message with keyword", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "refactor this");
      // Short message (<200 chars) with keyword doesn't trigger opus
      expect(result.modelId).not.toBe("claude-opus-4-6");
    });
  });

  describe("high output trend → opus", () => {
    it("routes to opus when recent output is high", () => {
      const highOutputTurns: TurnRecord[] = [
        {
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 4000,
          durationMs: 5000,
        },
        {
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 3500,
          durationMs: 4000,
        },
        {
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 3800,
          durationMs: 4500,
        },
      ];
      const state = stateWithBase("claude-sonnet-4-6", {
        turnHistory: highOutputTurns,
        turnCount: 3,
      });
      const result = resolveModel(state, "Continue with the implementation");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-opus-4-6");
    });
  });

  describe("long context → 1M variant", () => {
    it("upgrades sonnet to sonnet-1m", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        cumulativeInputTokens: 160_000,
        currentModelId: "claude-sonnet-4-6",
      });
      const result = resolveModel(state, "Continue");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-sonnet-4-6[1m]");
    });

    it("upgrades opus to opus-1m", () => {
      const state = stateWithBase("claude-opus-4-6", {
        cumulativeInputTokens: 160_000,
        currentModelId: "claude-opus-4-6",
      });
      const result = resolveModel(state, "Continue");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-opus-4-6[1m]");
    });

    it("upgrades haiku to sonnet-1m (no haiku 1m)", () => {
      const state = stateWithBase("claude-haiku-4-5-20251001", {
        cumulativeInputTokens: 160_000,
        currentModelId: "claude-haiku-4-5-20251001",
      });
      const result = resolveModel(state, "Continue");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-sonnet-4-6[1m]");
    });

    it("does not change if already on 1m variant", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        cumulativeInputTokens: 200_000,
        currentModelId: "claude-sonnet-4-6[1m]",
      });
      const result = resolveModel(state, "Continue");
      expect(result.changed).toBe(false);
    });

    it("bypasses cooldown for 1m upgrade", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        cumulativeInputTokens: 160_000,
        currentModelId: "claude-sonnet-4-6",
        lastSwitchTurn: 5,
        turnCount: 5, // just switched, would be in cooldown
      });
      const result = resolveModel(state, "Continue");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-sonnet-4-6[1m]");
    });
  });

  describe("cooldown", () => {
    it("does not switch during cooldown period", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        currentModelId: "claude-sonnet-4-6",
        lastSwitchTurn: 3,
        turnCount: 4, // only 1 turn since last switch
      });
      const result = resolveModel(state, "ok");
      expect(result.changed).toBe(false);
      expect(result.reason).toBe("In cooldown period");
    });

    it("allows switch after cooldown expires", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        currentModelId: "claude-sonnet-4-6",
        lastSwitchTurn: 1,
        turnCount: 4, // 3 turns since last switch, > 2 cooldown
      });
      const result = resolveModel(state, "ok");
      expect(result.changed).toBe(true);
    });
  });

  describe("default behavior", () => {
    it("returns to base model when no special signal and message is medium length", () => {
      const state = stateWithBase("claude-sonnet-4-6", {
        currentModelId: "claude-opus-4-6",
      });
      // Message > 80 chars, no complex keywords → return to base model
      const result = resolveModel(
        state,
        "Can you explain how the weather API works and what endpoints are available for fetching forecast data?",
      );
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-sonnet-4-6");
      expect(result.reason).toContain("base model");
    });

    it("does not change when already on base model with medium message", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(
        state,
        "Can you explain how the weather API works and what endpoints are available for fetching forecast data?",
      );
      expect(result.changed).toBe(false);
    });

    it("routes short message to haiku even when on base model", () => {
      const state = stateWithBase("claude-sonnet-4-6");
      const result = resolveModel(state, "How is the weather today?");
      expect(result.changed).toBe(true);
      expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    });
  });
});
