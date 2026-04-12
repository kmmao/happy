import { describe, expect, it } from "vitest";
import { resolveMessageModeMeta } from "./messageMeta";

describe("resolveMessageModeMeta", () => {
  it("sends explicit permission and model keys", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "read-only",
      modelMode: "gpt-5-high",
      metadata: null,
    } as any);

    expect(meta).toEqual({
      permissionMode: "read-only",
      model: "gpt-5-high",
      thinking: { type: "adaptive" },
      effort: null,
      maxBudgetUsd: null,
      taskBudget: null,
    });
  });

  it("forces bypass permissions in sandbox when mode is default", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: null,
      metadata: {
        sandbox: { enabled: true },
      },
    } as any);

    expect(meta).toEqual({
      permissionMode: "bypassPermissions",
      model: null,
      thinking: { type: "adaptive" },
      effort: null,
      maxBudgetUsd: null,
      taskBudget: null,
    });
  });

  it("keeps default permissions when sandbox is disabled", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: null,
      modelMode: "default",
      metadata: {
        sandbox: null,
      },
    } as any);

    expect(meta).toEqual({
      permissionMode: "default",
      model: null,
      thinking: { type: "adaptive" },
      effort: null,
      maxBudgetUsd: null,
      taskBudget: null,
    });
  });

  it("does not send a model override when model mode is default", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
    } as any);

    expect(meta.model).toBeNull();
  });

  it("resolves thinking mode as adaptive", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: "adaptive",
      thinkingBudget: null,
      effortLevel: null,
      maxBudgetUsd: null,
    } as any);

    expect(meta.thinking).toEqual({ type: "adaptive" });
  });

  it("resolves thinking mode as enabled with budget", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: "enabled",
      thinkingBudget: 8000,
      effortLevel: null,
      maxBudgetUsd: null,
    } as any);

    expect(meta.thinking).toEqual({ type: "enabled", budgetTokens: 8000 });
  });

  it("resolves effort level", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: null,
      thinkingBudget: null,
      effortLevel: "max",
      maxBudgetUsd: null,
    } as any);

    expect(meta.effort).toBe("max");
  });

  it("resolves maxBudgetUsd", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: null,
      thinkingBudget: null,
      effortLevel: null,
      maxBudgetUsd: 5.0,
    } as any);

    expect(meta.maxBudgetUsd).toBe(5.0);
  });

  it("returns null thinking when mode is disabled", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: "disabled",
      thinkingBudget: null,
      effortLevel: null,
      maxBudgetUsd: null,
    } as any);

    expect(meta.thinking).toBeNull();
  });
});
