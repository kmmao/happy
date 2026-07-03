import { describe, it, expect } from "vitest";
import { createAllowedToolMatcher } from "./allowedToolMatcher";

describe("allowedToolMatcher", () => {
  it("is-preallowed is false before any grant", () => {
    const m = createAllowedToolMatcher();
    expect(m.isPreAllowed("Read", {})).toBe(false);
    expect(m.isPreAllowed("Bash", { command: "ls" })).toBe(false);
  });

  it("grants a plain tool name by exact match", () => {
    const m = createAllowedToolMatcher();
    m.grant("Read");
    expect(m.isPreAllowed("Read", { file: "a" })).toBe(true);
    expect(m.isPreAllowed("Write", { file: "a" })).toBe(false);
  });

  it("grants a Bash literal — matches only the exact command", () => {
    const m = createAllowedToolMatcher();
    m.grant("Bash(git status)");
    expect(m.isPreAllowed("Bash", { command: "git status" })).toBe(true);
    expect(m.isPreAllowed("Bash", { command: "git status --short" })).toBe(false);
  });

  it("grants a Bash prefix (:*) — matches any command with that prefix", () => {
    const m = createAllowedToolMatcher();
    m.grant("Bash(npm run:*)");
    expect(m.isPreAllowed("Bash", { command: "npm run build" })).toBe(true);
    expect(m.isPreAllowed("Bash", { command: "npm run" })).toBe(true);
    expect(m.isPreAllowed("Bash", { command: "npm install" })).toBe(false);
  });

  it("ignores plain 'Bash' and unparseable grants", () => {
    const m = createAllowedToolMatcher();
    m.grant("Bash");
    m.grant("Bash(");
    expect(m.isPreAllowed("Bash", { command: "anything" })).toBe(false);
  });

  it("Bash pre-allow is false when the input carries no command", () => {
    const m = createAllowedToolMatcher();
    m.grant("Bash(ls)");
    expect(m.isPreAllowed("Bash", {})).toBe(false);
    expect(m.isPreAllowed("Bash", null)).toBe(false);
  });

  it("clear() forgets every grant", () => {
    const m = createAllowedToolMatcher();
    m.grant("Read");
    m.grant("Bash(git status)");
    m.grant("Bash(npm run:*)");
    m.clear();
    expect(m.isPreAllowed("Read", {})).toBe(false);
    expect(m.isPreAllowed("Bash", { command: "git status" })).toBe(false);
    expect(m.isPreAllowed("Bash", { command: "npm run build" })).toBe(false);
  });
});
