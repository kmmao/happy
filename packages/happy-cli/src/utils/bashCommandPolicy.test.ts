import { describe, expect, it } from "vitest";
import { checkBlockedBashCommand, BLOCKED_BASH_PATTERNS } from "./bashCommandPolicy";

describe("checkBlockedBashCommand", () => {
  it("blocks env-dumping builtins", () => {
    expect(checkBlockedBashCommand("printenv")).toBe("printenv is blocked for security");
    expect(checkBlockedBashCommand("env")).toBe("env command is blocked for security");
    expect(checkBlockedBashCommand("env | grep KEY")).toBe("env command is blocked for security");
    expect(checkBlockedBashCommand("set")).toBe("set (list env) is blocked for security");
    expect(checkBlockedBashCommand("export -p")).toBe("export -p is blocked for security");
    expect(checkBlockedBashCommand("compgen -e")).toBe("compgen -e is blocked for security");
    expect(checkBlockedBashCommand("declare -x")).toBe("declare -x is blocked for security");
  });

  it("blocks reading process environment via procfs", () => {
    expect(checkBlockedBashCommand("cat /proc/1/environ")).toBe(
      "reading /proc/environ is blocked for security",
    );
  });

  it("blocks reading credential files", () => {
    expect(checkBlockedBashCommand("cat .env.local")).toBe("reading .env files is blocked for security");
    expect(checkBlockedBashCommand("cat ~/.aws/credentials")).toBe(
      "reading AWS credentials is blocked for security",
    );
    expect(checkBlockedBashCommand("cat ~/.netrc")).toBe("reading .netrc is blocked for security");
  });

  it("blocks references to sensitive environment variables", () => {
    const reason = checkBlockedBashCommand('echo "$ANTHROPIC_AUTH_TOKEN"');
    expect(reason).toContain("accessing sensitive environment variables is blocked");
    expect(reason).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  it("allows benign commands", () => {
    expect(checkBlockedBashCommand("ls -la")).toBeNull();
    expect(checkBlockedBashCommand("git status")).toBeNull();
    expect(checkBlockedBashCommand("echo $HOME")).toBeNull();
    expect(checkBlockedBashCommand("npm run build")).toBeNull();
  });

  it("exposes each pattern as a distinct security claim", () => {
    expect(BLOCKED_BASH_PATTERNS.length).toBeGreaterThan(0);
    for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(reason).toMatch(/blocked for security/);
    }
  });
});
