/**
 * claudePtyRuntime — lifecycle tests.
 *
 * We never spawn `claude` in tests. Instead we use universally-available
 * binaries (`cat` echoes stdin → stdout, `printf` for one-shot output)
 * so the runtime mechanics are exercised without depending on a working
 * Claude install.
 */

import { describe, it, expect } from "vitest";
import { startClaudePty } from "./claudePtyRuntime";

const WAIT_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("claudePtyRuntime", () => {
  it("spawn → onData receives written bytes (cat echoes stdin)", async () => {
    const pty = startClaudePty({ command: "cat" });
    const received: string[] = [];
    pty.onData((d) => received.push(d));

    pty.write("hello\n");
    await delay(WAIT_MS);

    const joined = received.join("");
    expect(joined).toContain("hello");

    pty.kill();
    await delay(WAIT_MS);
    expect(pty.exited).toBe(true);
  });

  it("strips parent Claude session markers but preserves profile env", async () => {
    const keys = [
      "CLAUDECODE",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_CODE_CHILD_SESSION",
      "CODEX_COMPANION_SESSION_ID",
      "CLAUDE_PLUGIN_DATA",
      "ANTHROPIC_AUTH_TOKEN",
      "HAPPY_HOME_DIR",
    ];
    const pty = startClaudePty({
      command: process.execPath,
      args: [
        "-e",
        `const keys = ${JSON.stringify(keys)}; console.log(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null]))));`,
      ],
      env: {
        ...process.env,
        CLAUDECODE: "1",
        CLAUDE_CODE_SESSION_ID: "parent-session",
        CLAUDE_CODE_CHILD_SESSION: "1",
        CODEX_COMPANION_SESSION_ID: "parent-session",
        CLAUDE_PLUGIN_DATA: "/tmp/parent-plugin-data",
        ANTHROPIC_AUTH_TOKEN: "keep-auth-token",
        HAPPY_HOME_DIR: "/tmp/happy-home",
      },
    });
    const received: string[] = [];
    pty.onData((d) => received.push(d));

    await delay(WAIT_MS);

    const match = received.join("").match(/\{.*\}/s);
    expect(match).not.toBeNull();
    const env = JSON.parse(match![0]) as Record<string, string | null>;
    expect(env.CLAUDECODE).toBeNull();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeNull();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeNull();
    expect(env.CODEX_COMPANION_SESSION_ID).toBeNull();
    expect(env.CLAUDE_PLUGIN_DATA).toBeNull();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("keep-auth-token");
    expect(env.HAPPY_HOME_DIR).toBe("/tmp/happy-home");
  });

  it("onExit fires after kill()", async () => {
    const pty = startClaudePty({ command: "cat" });
    let exitInfo: { exitCode: number; signal?: number } | null = null;
    pty.onExit((event) => {
      exitInfo = event;
    });

    pty.kill();
    // Wait long enough for SIGTERM to propagate.
    await delay(WAIT_MS);

    expect(pty.exited).toBe(true);
    expect(exitInfo).not.toBeNull();
  });

  it("write / resize are no-ops after exit", async () => {
    const pty = startClaudePty({ command: "cat" });
    pty.kill();
    await delay(WAIT_MS);

    // Should not throw.
    pty.write("late data\n");
    pty.resize(120, 40);
    pty.interrupt();
    expect(pty.exited).toBe(true);
  });

  it("resize updates the reported cols/rows", async () => {
    const pty = startClaudePty({ command: "cat", cols: 80, rows: 24 });
    expect(pty.cols).toBe(80);
    expect(pty.rows).toBe(24);

    pty.resize(132, 50);
    expect(pty.cols).toBe(132);
    expect(pty.rows).toBe(50);

    pty.kill();
    await delay(WAIT_MS);
  });

  it("onData unsubscribe stops further calls", async () => {
    const pty = startClaudePty({ command: "cat" });
    const received: string[] = [];
    const unsub = pty.onData((d) => received.push(d));

    pty.write("first\n");
    await delay(WAIT_MS);
    const before = received.length;

    unsub();
    pty.write("second\n");
    await delay(WAIT_MS);

    expect(received.length).toBe(before);

    pty.kill();
    await delay(WAIT_MS);
  });

  it("onExit subscription returns synchronous-fire if already exited", async () => {
    const pty = startClaudePty({ command: "cat" });
    pty.kill();
    await delay(WAIT_MS);
    expect(pty.exited).toBe(true);

    let fired = false;
    pty.onExit(() => {
      fired = true;
    });
    // Subscription must fire on microtask after exit-already.
    await delay(50);
    expect(fired).toBe(true);
  });

  it("kill() escalates to SIGKILL when SIGTERM is ignored", async () => {
    // A node process that swallows SIGTERM but stays alive — only the
    // SIGKILL fallback in kill() can terminate it. Exercises the grace →
    // SIGKILL escalation path that the basic `cat` cases never hit.
    const pty = startClaudePty({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    });
    // Give node time to start and install the SIGTERM handler.
    await delay(400);
    expect(pty.exited).toBe(false);

    pty.kill("SIGTERM", 200); // short grace so SIGKILL fires quickly
    await delay(700);

    expect(pty.exited).toBe(true);
  });

  it("repeated kill() calls are safe and terminate once", async () => {
    const pty = startClaudePty({ command: "cat" });
    // Stacked kill() calls must not throw or arm duplicate SIGKILL timers.
    pty.kill();
    pty.kill();
    pty.kill();
    await delay(WAIT_MS);
    expect(pty.exited).toBe(true);

    // A kill() after exit is a no-op and still doesn't throw.
    pty.kill();
    expect(pty.exited).toBe(true);
  });

  it("resize after exit returns false and leaves cols/rows unchanged", async () => {
    const pty = startClaudePty({ command: "cat", cols: 80, rows: 24 });
    pty.kill();
    await delay(WAIT_MS);
    expect(pty.exited).toBe(true);

    // Rejected resize must not pollute the reported size (regression guard
    // for assigning state.cols/rows only after a successful child.resize()).
    const ok = pty.resize(132, 50);
    expect(ok).toBe(false);
    expect(pty.cols).toBe(80);
    expect(pty.rows).toBe(24);
  });
});
