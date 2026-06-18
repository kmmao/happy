import { describe, expect, it } from "vitest";

import {
  is1MModelKey,
  isSlashCommand,
  resolveCliModelForMode,
  resolveModelKey,
} from "./claudeRemote";

// After the `autoCompact` protocol removal, the model key alone decides the
// window tier: a `-1m`-suffixed App key (e.g. `opus-4-7-1m`) maps to a CLI
// id with the `[1m]` marker; everything else stays at 200K. `resolveCliModelForMode`
// is now a thin wrapper around `resolveModelKey` with no extra stripping.
//
// is1MModelKey is unchanged — still answers "is this App-level mode key
// 1M-capable?" — and used by coldModeHash to force a mode_change cold restart
// when the modelMode picker swaps between tiers.

describe("resolveCliModelForMode", () => {
  it("keeps the [1m] suffix when the user picked a -1m modelMode variant", () => {
    expect(resolveCliModelForMode({ model: "opus-4-7-1m" })).toBe(
      "claude-opus-4-7[1m]",
    );
    expect(resolveCliModelForMode({ model: "sonnet-1m" })).toBe(
      "claude-sonnet-4-6[1m]",
    );
    expect(resolveCliModelForMode({ model: "fable-5-1m" })).toBe(
      "claude-fable-5[1m]",
    );
  });

  it("strips the [1m] suffix when the user picked a default (non-1m) modelMode", () => {
    // `resolveModelKey` always appends [1m] for any 1M-capable model — this
    // is happy-cli's internal tracking marker. Strip it for the default
    // tier so the SDK gets a vanilla id.
    expect(resolveCliModelForMode({ model: "opus-4-7" })).toBe(
      "claude-opus-4-7",
    );
    expect(resolveCliModelForMode({ model: "sonnet" })).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("passes non-1M-capable keys through untouched", () => {
    expect(resolveCliModelForMode({ model: "haiku" })).toBe("haiku");
    expect(resolveCliModelForMode({ model: "some-custom-id" })).toBe(
      "some-custom-id",
    );
  });

  it("returns undefined for unset / 'default' model ids", () => {
    expect(resolveCliModelForMode({ model: undefined })).toBeUndefined();
    expect(resolveCliModelForMode({ model: "default" })).toBeUndefined();
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
  it("maps App keys to canonical [1m] CLI ids for 1M-capable models", () => {
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
// command never runs, and `compact_boundary` never fires. Test pins the
// heuristic so a future tweak doesn't accidentally let `/compact` re-enter
// the retry path.
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
