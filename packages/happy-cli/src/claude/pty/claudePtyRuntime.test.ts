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
});
