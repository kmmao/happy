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
      autoCompact: true,
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
      autoCompact: true,
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
      autoCompact: true,
    });
  });

  it("does not send a model override when model mode is default", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      pinnedModelId: null,
      metadata: null,
    } as any);

    expect(meta.model).toBeNull();
  });

  it("uses the session-pinned model id before any current profile mapping", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "sonnet",
      pinnedModelId: "MiniMax-M2.7",
      modelMappings: {
        sonnet: "different-model-now",
      },
      metadata: null,
    } as any);

    expect(meta.model).toBe("MiniMax-M2.7");
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

  it("resolves xhigh effort level for codex sessions", () => {
    const meta = resolveMessageModeMeta({
      permissionMode: "default",
      modelMode: "default",
      metadata: null,
      thinkingMode: null,
      thinkingBudget: null,
      effortLevel: "xhigh",
      maxBudgetUsd: null,
    } as any);

    expect(meta.effort).toBe("xhigh");
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

  // ── agentDefaultOverrides fallback (modified A port of upstream b042d834a) ──

  it("falls back to settings-level permission override when session has none", () => {
    const meta = resolveMessageModeMeta(
      {
        permissionMode: null,
        modelMode: null,
        metadata: { flavor: "claude" },
      } as any,
      {
        agentDefaultOverrides: {
          claude: { permissionMode: "bypassPermissions" },
        },
      } as any,
    );

    expect(meta.permissionMode).toBe("bypassPermissions");
  });

  it("falls back to settings-level model override when session modelMode is 'default'", () => {
    const meta = resolveMessageModeMeta(
      {
        permissionMode: "default",
        modelMode: "default",
        metadata: { flavor: "codex" },
      } as any,
      {
        agentDefaultOverrides: {
          codex: { modelMode: "gpt-5.5" },
        },
      } as any,
    );

    expect(meta.model).toBe("gpt-5.5");
  });

  it("falls back to settings-level effort override when session effortLevel is null", () => {
    const meta = resolveMessageModeMeta(
      {
        permissionMode: "default",
        modelMode: null,
        effortLevel: null,
        metadata: { flavor: "claude" },
      } as any,
      {
        agentDefaultOverrides: {
          claude: { effortLevel: "high" },
        },
      } as any,
    );

    expect(meta.effort).toBe("high");
  });

  it("session-level explicit value beats settings-level override", () => {
    const meta = resolveMessageModeMeta(
      {
        permissionMode: "acceptEdits",
        modelMode: "gpt-5.4",
        effortLevel: "xhigh",
        metadata: { flavor: "codex" },
      } as any,
      {
        agentDefaultOverrides: {
          codex: {
            permissionMode: "yolo",
            modelMode: "gpt-5.5",
            effortLevel: "medium",
          },
        },
      } as any,
    );

    expect(meta.permissionMode).toBe("acceptEdits");
    expect(meta.model).toBe("gpt-5.4");
    expect(meta.effort).toBe("xhigh");
  });

  it("settings override does not erode the existing 6-field shape (modified A keeps thinking/maxBudget/taskBudget)", () => {
    // The upstream commit shrinks the return type to {permissionMode?, model?,
    // effort?}. This fork keeps the full shape; pin that contract here so a
    // future merge attempt has to revisit it intentionally.
    const meta = resolveMessageModeMeta(
      {
        permissionMode: null,
        modelMode: null,
        effortLevel: null,
        metadata: { flavor: "claude" },
      } as any,
      {
        agentDefaultOverrides: {
          claude: { permissionMode: "bypassPermissions" },
        },
      } as any,
    );

    expect(meta).toMatchObject({
      permissionMode: "bypassPermissions",
      thinking: { type: "adaptive" }, // default thinking still resolved
      maxBudgetUsd: null,
      taskBudget: null,
    });
  });

  it("sandbox auto-bypass is still applied when neither session nor settings override", () => {
    // Existing local behaviour: sandbox.enabled + permissionMode 'default'
    // yields bypassPermissions. Settings overrides take priority over sandbox
    // only when the override is explicit.
    const meta = resolveMessageModeMeta(
      {
        permissionMode: "default",
        modelMode: null,
        metadata: { flavor: "claude", sandbox: { enabled: true } },
      } as any,
      { agentDefaultOverrides: {} } as any,
    );

    expect(meta.permissionMode).toBe("bypassPermissions");
  });
});
