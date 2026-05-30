import { describe, expect, it } from "vitest";
import {
  getAgentDefaultOverrideValue,
  getCodeAgentDefaults,
  hasAgentDefaultOverride,
  normalizeAgentKey,
  resolveAgentDefaultConfig,
  setAgentDefaultOverride,
} from "./agentDefaults";

describe("agentDefaults", () => {
  describe("normalizeAgentKey", () => {
    it("maps unknown / null flavors to 'claude' (most common backend)", () => {
      expect(normalizeAgentKey(null)).toBe("claude");
      expect(normalizeAgentKey(undefined)).toBe("claude");
      expect(normalizeAgentKey("")).toBe("claude");
      expect(normalizeAgentKey("something-else")).toBe("claude");
    });

    it("passes through known agent keys", () => {
      expect(normalizeAgentKey("codex")).toBe("codex");
      expect(normalizeAgentKey("gemini")).toBe("gemini");
      expect(normalizeAgentKey("openclaw")).toBe("openclaw");
    });
  });

  describe("getCodeAgentDefaults — fork divergence guard", () => {
    it("pins permissionMode to 'default' (not upstream's 'bypassPermissions' / 'yolo') for ALL agents — yolo must remain opt-in", () => {
      // This is the deliberate fork difference vs upstream b042d834a. If a
      // future merge flips any of these back to 'bypassPermissions' / 'yolo'
      // it has to break this test first, forcing a security review.
      expect(getCodeAgentDefaults("claude").permissionMode).toBe("default");
      expect(getCodeAgentDefaults("codex").permissionMode).toBe("default");
      expect(getCodeAgentDefaults("gemini").permissionMode).toBe("default");
      expect(getCodeAgentDefaults("openclaw").permissionMode).toBe("default");
    });

    it("preserves upstream's model + effort defaults (only permissionMode differs)", () => {
      expect(getCodeAgentDefaults("claude")).toEqual({
        permissionMode: "default",
        modelMode: "opus",
        effortLevel: "medium",
      });
      expect(getCodeAgentDefaults("codex")).toEqual({
        permissionMode: "default",
        modelMode: "gpt-5.5",
        effortLevel: "medium",
      });
    });
  });

  describe("resolveAgentDefaultConfig", () => {
    it("falls back to code defaults when overrides is empty / null", () => {
      expect(resolveAgentDefaultConfig({}, "claude")).toEqual(
        getCodeAgentDefaults("claude"),
      );
      expect(resolveAgentDefaultConfig(null, "codex")).toEqual(
        getCodeAgentDefaults("codex"),
      );
      expect(resolveAgentDefaultConfig(undefined, "gemini")).toEqual(
        getCodeAgentDefaults("gemini"),
      );
    });

    it("merges per-field overrides on top of code defaults (partial override is allowed)", () => {
      const resolved = resolveAgentDefaultConfig(
        { claude: { permissionMode: "bypassPermissions" } },
        "claude",
      );
      expect(resolved).toEqual({
        permissionMode: "bypassPermissions", // overridden
        modelMode: "opus", // from code default
        effortLevel: "medium", // from code default
      });
    });
  });

  describe("setAgentDefaultOverride", () => {
    it("adds a new override and prunes the agent entry when its last field is removed", () => {
      let overrides = setAgentDefaultOverride({}, "claude", "modelMode", "sonnet");
      expect(overrides.claude).toEqual({ modelMode: "sonnet" });

      // Removing the last field deletes the agent key entirely so
      // settingsToSyncPayload doesn't ship a `claude: {}` ghost.
      overrides = setAgentDefaultOverride(overrides, "claude", "modelMode", null);
      expect("claude" in overrides).toBe(false);
    });

    it("treats undefined and null both as 'delete this field' (idempotent)", () => {
      const seeded = setAgentDefaultOverride(
        {},
        "codex",
        "permissionMode",
        "yolo",
      );
      const afterNull = setAgentDefaultOverride(
        seeded,
        "codex",
        "permissionMode",
        null,
      );
      const afterUndef = setAgentDefaultOverride(
        seeded,
        "codex",
        "permissionMode",
        undefined,
      );
      expect(afterNull).toEqual(afterUndef);
    });

    it("never mutates the input overrides object", () => {
      const seeded = setAgentDefaultOverride(
        {},
        "gemini",
        "modelMode",
        "gemini-2.5-pro",
      );
      const before = JSON.parse(JSON.stringify(seeded));
      setAgentDefaultOverride(seeded, "gemini", "modelMode", "different");
      expect(seeded).toEqual(before);
    });
  });

  describe("hasAgentDefaultOverride / getAgentDefaultOverrideValue", () => {
    it("returns false / undefined when no override exists for that (agent, field)", () => {
      const overrides = setAgentDefaultOverride(
        {},
        "claude",
        "modelMode",
        "sonnet",
      );
      expect(hasAgentDefaultOverride(overrides, "claude", "modelMode")).toBe(
        true,
      );
      expect(
        hasAgentDefaultOverride(overrides, "claude", "permissionMode"),
      ).toBe(false);
      expect(
        getAgentDefaultOverrideValue(overrides, "claude", "permissionMode"),
      ).toBeUndefined();
    });
  });
});
