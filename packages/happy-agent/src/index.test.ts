import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(__dirname, "..", "bin", "happy-agent.mjs");

function runCli(...args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--no-warnings", "--no-deprecation", binPath, ...args],
      {
        encoding: "utf-8",
        env: { ...process.env, HAPPY_HOME_DIR: "/tmp/nonexistent-happy-test" },
      },
    );
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("happy-agent CLI", () => {
  it("should display help output", () => {
    const { stdout } = runCli("--help");
    expect(stdout).toContain("happy-agent");
    expect(stdout).toContain(
      "CLI client for controlling Happy Coder agents remotely",
    );
  });

  it("should display version", () => {
    const { stdout } = runCli("--version");
    expect(stdout.trim()).toBe("0.6.0");
  });

  it("should list all expected commands in help", () => {
    const { stdout } = runCli("--help");
    expect(stdout).toContain("auth");
    expect(stdout).toContain("list");
    expect(stdout).toContain("status");
    expect(stdout).toContain("summary");
    expect(stdout).toContain("create");
    expect(stdout).toContain("send");
    expect(stdout).toContain("history");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("wait");
  });

  describe("list command", () => {
    it("should show list help with --active and --json options", () => {
      const { stdout } = runCli("list", "--help");
      expect(stdout).toContain("List all sessions");
      expect(stdout).toContain("--active");
      expect(stdout).toContain("--json");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("list");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("status command", () => {
    it("should show status help with session-id argument and --json option", () => {
      const { stdout } = runCli("status", "--help");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("--json");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("status", "fake-session-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("create command", () => {
    it("should show create help with --tag, --path, and --json options", () => {
      const { stdout } = runCli("create", "--help");
      expect(stdout).toContain("Create a new session");
      expect(stdout).toContain("--tag");
      expect(stdout).toContain("--path");
      expect(stdout).toContain("--json");
    });

    it("should require --tag option", () => {
      const { stderr, exitCode } = runCli("create");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--tag");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("create", "--tag", "my-tag");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("summary command", () => {
    it("should show summary help with show and refresh subcommands", () => {
      const { stdout } = runCli("summary", "--help");
      expect(stdout).toContain("Inspect or refresh session summaries");
      expect(stdout).toContain("show");
      expect(stdout).toContain("refresh");
    });

    it("should show summary show help with session-id and --json option", () => {
      const { stdout } = runCli("summary", "show", "--help");
      expect(stdout).toContain("Show the narrative session summary");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("--json");
    });

    it("should show summary refresh help with session-id, --wait, --timeout, and --json options", () => {
      const { stdout } = runCli("summary", "refresh", "--help");
      expect(stdout).toContain("Ask the agent to rewrite the session summary");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("--wait");
      expect(stdout).toContain("--require-summary");
      expect(stdout).toContain("--timeout");
      expect(stdout).toContain("--json");
    });

    it("should fail summary show with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("summary", "show", "fake-session-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });

    it("should fail summary refresh with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("summary", "refresh", "fake-session-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("send command", () => {
    it("should show send help with session-id, message arguments and --wait, --json options", () => {
      const { stdout } = runCli("send", "--help");
      expect(stdout).toContain("Send a message to a session");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("message");
      expect(stdout).toContain("--wait");
      expect(stdout).toContain("--json");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("send", "fake-id", "hello");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("history command", () => {
    it("should show history help with session-id argument, --limit, and --json options", () => {
      const { stdout } = runCli("history", "--help");
      expect(stdout).toContain("Read message history");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("--limit");
      expect(stdout).toContain("--json");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("history", "fake-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("stop command", () => {
    it("should show stop help with session-id argument", () => {
      const { stdout } = runCli("stop", "--help");
      expect(stdout).toContain("Stop a session");
      expect(stdout).toContain("session-id");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("stop", "fake-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });

  describe("wait command", () => {
    it("should show wait help with session-id argument and --timeout option", () => {
      const { stdout } = runCli("wait", "--help");
      expect(stdout).toContain("Wait for agent to become idle");
      expect(stdout).toContain("session-id");
      expect(stdout).toContain("--timeout");
    });

    it("should fail with auth error when not authenticated", () => {
      const { stderr, exitCode } = runCli("wait", "fake-id");
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("happy-agent auth login");
    });
  });
});
