import { describe, expect, it } from "vitest";

import {
  is1MModelKey,
  isSlashCommand,
  resolveCliModelForMode,
  resolveModelKey,
} from "./claudeRemote";

// Sanity-check the toggle-driven 200K ↔ 1M switch. The behavioural contract:
//
//   resolveCliModelForMode({model, autoCompact}) returns the `--model` string
//   that Claude TUI receives. Strip the `[1m]` suffix when autoCompact is
//   true (or undefined — the default) so the TUI stays at 200K and happy's
//   apiSession.ts threshold handles the compact. Keep the suffix when
//   autoCompact === false so the TUI grants the 1M premium window.
//
// is1MModelKey is unchanged — still answers "is this App-level mode key
// 1M-capable?" — and used by coldModeHash together with the autoCompact
// flag to drive mode_change cold restarts when the toggle flips.

describe("resolveCliModelForMode", () => {
  it("strips [1m] suffix when autoCompact is true (default 200K compress mode)", () => {
    expect(
      resolveCliModelForMode({ model: "opus-4-7", autoCompact: true }),
    ).toBe("claude-opus-4-7");
    expect(
      resolveCliModelForMode({ model: "opus-4-7-1m", autoCompact: true }),
    ).toBe("claude-opus-4-7");
    expect(
      resolveCliModelForMode({ model: "sonnet", autoCompact: true }),
    ).toBe("claude-sonnet-4-6");
  });

  it("strips [1m] suffix when autoCompact is undefined (default behaviour)", () => {
    // Back-compat: old App builds without the field land here. Default
    // intent is 200K compress mode, matching ADR 0003.
    expect(resolveCliModelForMode({ model: "opus-4-7" })).toBe(
      "claude-opus-4-7",
    );
    expect(resolveCliModelForMode({ model: "opus-4-7-1m" })).toBe(
      "claude-opus-4-7",
    );
  });

  it("keeps [1m] suffix when autoCompact is false (1M premium mode)", () => {
    expect(
      resolveCliModelForMode({ model: "opus-4-7", autoCompact: false }),
    ).toBe("claude-opus-4-7[1m]");
    expect(
      resolveCliModelForMode({ model: "opus-4-7-1m", autoCompact: false }),
    ).toBe("claude-opus-4-7[1m]");
    expect(
      resolveCliModelForMode({ model: "fable-5", autoCompact: false }),
    ).toBe("claude-fable-5[1m]");
  });

  it("passes through non-1M-capable model ids untouched in either mode", () => {
    // `haiku` and unknown keys never carried a `[1m]` suffix, so they
    // bypass the stripping logic and return the raw mapping.
    expect(
      resolveCliModelForMode({ model: "haiku", autoCompact: true }),
    ).toBe("haiku");
    expect(
      resolveCliModelForMode({ model: "haiku", autoCompact: false }),
    ).toBe("haiku");
    expect(
      resolveCliModelForMode({ model: "some-custom-id", autoCompact: false }),
    ).toBe("some-custom-id");
  });

  it("returns undefined for unset / 'default' model ids regardless of toggle", () => {
    expect(
      resolveCliModelForMode({ model: undefined, autoCompact: true }),
    ).toBeUndefined();
    expect(
      resolveCliModelForMode({ model: "default", autoCompact: false }),
    ).toBeUndefined();
  });
});

describe("is1MModelKey", () => {
  it("still recognises 1M-capable App-level keys", () => {
    expect(is1MModelKey("opus-4-7")).toBe(true);
    expect(is1MModelKey("opus-4-7-1m")).toBe(true);
    expect(is1MModelKey("sonnet")).toBe(true);
    expect(is1MModelKey("fable-5-1m")).toBe(true);
  });

  it("returns false for non-1M-capable / unknown keys", () => {
    expect(is1MModelKey("haiku")).toBe(false);
    expect(is1MModelKey(undefined)).toBe(false);
    expect(is1MModelKey("claude-opus-4-7[1m]")).toBe(false);
    // ^ Note: is1MModelKey takes App key form, not the resolved CLI id.
  });
});

describe("resolveModelKey (unchanged sanity)", () => {
  it("maps App keys to canonical [1m] CLI ids", () => {
    expect(resolveModelKey("opus-4-7")).toBe("claude-opus-4-7[1m]");
    expect(resolveModelKey("opus-4-7-1m")).toBe("claude-opus-4-7[1m]");
  });
});

// Guards the echo-retry skip for slash commands. The retry path's Esc + re-
// paste concatenates onto a partially-landed first paste (TUI doesn't always
// clear the composer on Esc — vim mode, mid-turn drain, etc.). For prose the
// concatenation is recoverable via the launcher's watchdog redeliver; for
// slash commands the concatenated text is no longer a valid slash command
// (`/compact/compact` is prose), so the TUI silently treats it as text, the
// command never runs, and `compact_boundary` never fires. The auto-compact
// loop the user reported was exactly this. Test pins the heuristic so a
// future tweak doesn't accidentally let `/compact` re-enter the retry path.
describe("isSlashCommand", () => {
  it("matches typical slash commands", () => {
    expect(isSlashCommand("/compact")).toBe(true);
    expect(isSlashCommand("/clear")).toBe(true);
    expect(isSlashCommand("/handoff")).toBe(true);
    expect(isSlashCommand("/model claude-opus-4-7")).toBe(true);
    expect(isSlashCommand("/compact with optional args")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isSlashCommand("  /compact  ")).toBe(true);
    expect(isSlashCommand("\n/compact\n")).toBe(true);
  });

  it("rejects prose, code, and shell prefixes", () => {
    expect(isSlashCommand("Hello /compact world")).toBe(false);
    expect(isSlashCommand("$ ls")).toBe(false);
    expect(isSlashCommand("! pwd")).toBe(false);
    expect(isSlashCommand("Please run /compact for me")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
    expect(isSlashCommand("   ")).toBe(false);
  });

  it("rejects long messages that happen to start with '/' (defensive cap)", () => {
    // 200-char cap means a prose paste that starts with "/" is still given
    // the retry path. Real slash commands are well under this.
    expect(isSlashCommand("/" + "a".repeat(250))).toBe(false);
    expect(isSlashCommand("/" + "a".repeat(150))).toBe(true);
  });
});
