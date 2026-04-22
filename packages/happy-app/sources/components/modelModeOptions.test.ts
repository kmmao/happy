import { describe, expect, it } from "vitest";
import {
  getAvailableModels,
  getAvailablePermissionModes,
  getClaudeModelModes,
  getCodexModelModes,
  getClaudePermissionModes,
  getDefaultModelKey,
  LOCKED_CODEX_MODEL,
  mapMetadataOptions,
  resolveCurrentOption,
} from "./modelModeOptions";

const translate = (key: string) => `tr:${key}`;

describe("modelModeOptions", () => {
  it("maps metadata option shape into mode options", () => {
    expect(
      mapMetadataOptions([
        { code: "m1", value: "Model One", description: "Primary model" },
        { code: "m2", value: "Model Two" },
      ]),
    ).toEqual([
      { key: "m1", name: "Model One", description: "Primary model" },
      { key: "m2", name: "Model Two", description: null },
    ]);
  });

  it("builds claude permission fallbacks with translated names", () => {
    const modes = getClaudePermissionModes(translate);
    expect(modes.map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "dontAsk",
      "auto",
      "bypassPermissions",
    ]);
    expect(modes[0].name).toBe("tr:agentInput.permissionMode.default");
  });

  it("builds codex model fallbacks with translated labels", () => {
    const models = getCodexModelModes(translate);
    expect(models.map((model) => model.key)).toEqual([
      LOCKED_CODEX_MODEL,
      "gpt-5.3-codex",
    ]);
    expect(models).toEqual([
      {
        key: LOCKED_CODEX_MODEL,
        name: "tr:agentInput.codexModel.gpt54",
        description: null,
      },
      {
        key: "gpt-5.3-codex",
        name: "tr:agentInput.codexModel.gpt53Codex",
        description: null,
      },
    ]);
  });

  it("prefers metadata models over hardcoded fallbacks", () => {
    const models = getAvailableModels(
      "gemini",
      {
        models: [
          {
            code: "custom-gemini",
            value: "Gemini Custom",
            description: "From metadata",
          },
        ],
      } as any,
      translate,
    );

    expect(models).toEqual([
      {
        key: "custom-gemini",
        name: "Gemini Custom",
        description: "From metadata",
      },
    ]);
  });

  it("uses hardcoded Codex options even when metadata reports other models", () => {
    const models = getAvailableModels(
      "codex",
      {
        models: [
          {
            code: "gpt-5.4-mini",
            value: "GPT-5.4 Mini",
            description: "Legacy metadata",
          },
          {
            code: "gpt-5.4",
            value: "GPT-5.4",
            description: "From metadata",
          },
        ],
      } as any,
      translate,
    );

    expect(models).toEqual([
      {
        key: "gpt-5.4",
        name: "tr:agentInput.codexModel.gpt54",
        description: null,
      },
      {
        key: "gpt-5.3-codex",
        name: "tr:agentInput.codexModel.gpt53Codex",
        description: null,
      },
    ]);
  });

  it("ignores Codex custom model lists and keeps hardcoded options", () => {
    const models = getAvailableModels(
      "codex",
      null,
      translate,
      [
        { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", description: "legacy" },
      ],
    );

    expect(models).toEqual([
      {
        key: "gpt-5.4",
        name: "tr:agentInput.codexModel.gpt54",
        description: null,
      },
      {
        key: "gpt-5.3-codex",
        name: "tr:agentInput.codexModel.gpt53Codex",
        description: null,
      },
    ]);
  });

  it("deduplicates custom models by key and keeps a single default option", () => {
    const models = getAvailableModels(
      "claude",
      null,
      translate,
      [
        { id: "default", name: "Default (Custom)", description: "dup default" },
        { id: "sonnet", name: "Sonnet", description: "first" },
        { id: "sonnet", name: "Sonnet Duplicate", description: "second" },
      ],
    );

    expect(models).toEqual([
      {
        key: "default",
        name: "Default",
        description: "Use CLI configured model",
      },
      {
        key: "sonnet",
        name: "Sonnet",
        description: "first",
      },
    ]);
  });

  it("keeps codex permission modes hardcoded even when metadata modes exist", () => {
    const modes = getAvailablePermissionModes(
      "codex",
      {
        operatingModes: [
          { code: "metadata-only", value: "Metadata Mode", description: null },
        ],
      } as any,
      translate,
    );

    expect(modes.map((mode) => mode.key)).toEqual([
      "default",
      "read-only",
      "safe-yolo",
      "yolo",
    ]);
  });

  it("applies hacks to metadata-provided operating modes", () => {
    const modes = getAvailablePermissionModes(
      "gemini",
      {
        operatingModes: [
          {
            code: "build",
            value: "build, build",
            description: "Do build steps",
          },
          { code: "plan", value: "plan/plan", description: "Plan first" },
        ],
      } as any,
      translate,
    );

    expect(modes).toEqual([
      { key: "build", name: "Build", description: "Do build steps" },
      { key: "plan", name: "Plan", description: "Plan first" },
    ]);
  });

  describe("getClaudeModelModes", () => {
    it("includes manual model options", () => {
      const modes = getClaudeModelModes();
      const keys = modes.map((m) => m.key);
      expect(keys).toContain("default");
      expect(keys).toContain("haiku");
      expect(keys).toContain("sonnet");
      expect(keys).toContain("opus");
    });

    it("all options have non-empty description", () => {
      const modes = getClaudeModelModes();
      for (const mode of modes) {
        expect(mode.description).toBeTruthy();
      }
    });
  });

  it("resolves the first matching preferred key", () => {
    const options = [
      { key: "a", name: "A" },
      { key: "b", name: "B" },
    ];

    expect(resolveCurrentOption(options, ["missing", "b", "a"])).toEqual({
      key: "b",
      name: "B",
    });
    expect(resolveCurrentOption(options, ["missing"])).toBeNull();
  });

  it("uses GPT-5.4 as the codex fallback model key", () => {
    expect(getDefaultModelKey("codex")).toBe("gpt-5.4");
  });
});
