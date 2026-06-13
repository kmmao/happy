import { describe, it, expect } from "vitest";
import {
  parseAndValidateSettings,
} from "./settingsParser";

describe("parseAndValidateSettings", () => {
  // ── Basic validation ──

  it("rejects non-object input", () => {
    const r = parseAndValidateSettings("not an object");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be a plain object/);
  });

  it("rejects null input", () => {
    const r = parseAndValidateSettings(null);
    expect(r.ok).toBe(false);
  });

  it("rejects array input", () => {
    const r = parseAndValidateSettings([1, 2, 3]);
    expect(r.ok).toBe(false);
  });

  it("returns empty patch for empty object", () => {
    const r = parseAndValidateSettings({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings).toEqual({});
  });

  // ── Blocklist: dangerous keys are rejected ──

  it("rejects hooks key (security)", () => {
    const r = parseAndValidateSettings({ hooks: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/hooks/);
  });

  it("rejects skillOverrides key (security)", () => {
    const r = parseAndValidateSettings({ skillOverrides: { foo: "off" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/skillOverrides/);
  });

  it("rejects disableBundledSkills key (claude-code 2.1.169 security)", () => {
    const r = parseAndValidateSettings({ disableBundledSkills: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/disableBundledSkills/);
  });

  it("rejects enforceAvailableModels key (claude-code 2.1.175 managed-only)", () => {
    const r = parseAndValidateSettings({ enforceAvailableModels: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/enforceAvailableModels/);
  });

  it("rejects unknown keys", () => {
    const r = parseAndValidateSettings({ totallyFakeKey: "lol" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/totallyFakeKey/);
  });

  // ── permissions ──

  it("validates permissions.allow as string array", () => {
    const r = parseAndValidateSettings({
      permissions: { allow: ["Read", "Bash(*)"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.permissions).toEqual({ allow: ["Read", "Bash(*)"] });
  });

  it("validates permissions.deny as string array", () => {
    const r = parseAndValidateSettings({
      permissions: { deny: ["Write"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.permissions).toEqual({ deny: ["Write"] });
  });

  it("validates permissions.defaultMode", () => {
    const r = parseAndValidateSettings({
      permissions: { defaultMode: "bypassPermissions" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.permissions).toEqual({ defaultMode: "bypassPermissions" });
  });

  it("validates permissions.ask as string array", () => {
    const r = parseAndValidateSettings({
      permissions: { ask: ["Edit"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.permissions).toEqual({ ask: ["Edit"] });
  });

  it("validates permissions.additionalDirectories as string array", () => {
    const r = parseAndValidateSettings({
      permissions: { additionalDirectories: ["/tmp", "/opt"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.permissions).toEqual({
        additionalDirectories: ["/tmp", "/opt"],
      });
    }
  });

  it("rejects permissions with non-string-array allow", () => {
    const r = parseAndValidateSettings({
      permissions: { allow: [42] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permissions\.allow/);
  });

  it("rejects permissions as non-object", () => {
    const r = parseAndValidateSettings({
      permissions: "grant all",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permissions/);
  });

  it("rejects unknown sub-key in permissions", () => {
    const r = parseAndValidateSettings({
      permissions: { sudo: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sudo/);
  });

  // ── model ──

  it("validates model as string", () => {
    const r = parseAndValidateSettings({ model: "claude-sonnet-4-20250514" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.model).toBe("claude-sonnet-4-20250514");
  });

  it("allows model as null (clears flag layer)", () => {
    const r = parseAndValidateSettings({ model: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.model).toBeNull();
  });

  it("rejects model as number", () => {
    const r = parseAndValidateSettings({ model: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/model/);
  });

  // ── boolean flags ──

  it("validates enableAllProjectMcpServers as boolean", () => {
    const r = parseAndValidateSettings({ enableAllProjectMcpServers: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.enableAllProjectMcpServers).toBe(true);
  });

  it("allows enableAllProjectMcpServers as null", () => {
    const r = parseAndValidateSettings({ enableAllProjectMcpServers: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.enableAllProjectMcpServers).toBeNull();
  });

  it("rejects enableAllProjectMcpServers as string", () => {
    const r = parseAndValidateSettings({ enableAllProjectMcpServers: "yes" });
    expect(r.ok).toBe(false);
  });

  it("validates attribution as boolean", () => {
    const r = parseAndValidateSettings({ attribution: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.attribution).toBe(false);
  });

  it("validates respectGitignore as boolean", () => {
    const r = parseAndValidateSettings({ respectGitignore: false });
    expect(r.ok).toBe(true);
  });

  it("validates includeGitInstructions as boolean", () => {
    const r = parseAndValidateSettings({ includeGitInstructions: true });
    expect(r.ok).toBe(true);
  });

  // ── string array flags ──

  it("validates enabledMcpjsonServers as string array", () => {
    const r = parseAndValidateSettings({
      enabledMcpjsonServers: ["server-a", "server-b"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.enabledMcpjsonServers).toEqual(["server-a", "server-b"]);
  });

  it("allows enabledMcpjsonServers as null", () => {
    const r = parseAndValidateSettings({ enabledMcpjsonServers: null });
    expect(r.ok).toBe(true);
  });

  it("validates disabledMcpjsonServers as string array", () => {
    const r = parseAndValidateSettings({
      disabledMcpjsonServers: ["server-c"],
    });
    expect(r.ok).toBe(true);
  });

  // ── env ──

  it("validates env as Record<string, string>", () => {
    const r = parseAndValidateSettings({
      env: { FOO: "bar", BAZ: "qux" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.env).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("allows env as null", () => {
    const r = parseAndValidateSettings({ env: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.env).toBeNull();
  });

  it("rejects env with non-string values", () => {
    const r = parseAndValidateSettings({
      env: { FOO: 42 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/env/);
  });

  // ── Combined ──

  it("validates multiple keys at once", () => {
    const r = parseAndValidateSettings({
      model: "opus",
      permissions: { allow: ["Read"], deny: [] },
      attribution: true,
      env: { LANG: "en_US" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.model).toBe("opus");
      expect(r.settings.permissions).toEqual({ allow: ["Read"], deny: [] });
      expect(r.settings.attribution).toBe(true);
      expect(r.settings.env).toEqual({ LANG: "en_US" });
    }
  });

  it("rejects if any key is invalid even when others are valid", () => {
    const r = parseAndValidateSettings({
      model: "opus",
      hooks: [{ command: "rm -rf /" }], // blocked
    });
    expect(r.ok).toBe(false);
  });
});
