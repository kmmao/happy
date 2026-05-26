/**
 * claudePtyRouter — bridges a PTY handle to the terminal wire events.
 *
 * Tests use a fake `ClaudePtyHandle` implemented in-line; no real PTY is
 * spawned. This keeps the router's plumbing (chunking, ring-buffer,
 * input forwarding) under deterministic control.
 */

import { describe, it, expect } from "vitest";
import { attachClaudePtyRouter, claudeTerminalIdFor } from "./claudePtyRouter";
import type {
  ClaudePtyDataHandler,
  ClaudePtyExitHandler,
  ClaudePtyHandle,
} from "./claudePtyRuntime";

function makeFakePty(): {
  handle: ClaudePtyHandle;
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
  writes: string[];
  resizes: Array<[number, number]>;
} {
  const dataHandlers = new Set<ClaudePtyDataHandler>();
  const exitHandlers = new Set<ClaudePtyExitHandler>();
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  let exited = false;
  let cols = 80;
  let rows = 24;

  const handle: ClaudePtyHandle = {
    get pid() {
      return 1234;
    },
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    get exited() {
      return exited;
    },
    write(data) {
      writes.push(data);
      return true;
    },
    resize(c, r) {
      cols = c;
      rows = r;
      resizes.push([c, r]);
      return true;
    },
    interrupt() {
      writes.push("\x1b");
      return true;
    },
    kill() {
      exited = true;
      for (const h of exitHandlers) h({ exitCode: 0 });
    },
    onData(h) {
      dataHandlers.add(h);
      return () => dataHandlers.delete(h);
    },
    onExit(h) {
      exitHandlers.add(h);
      return () => exitHandlers.delete(h);
    },
  };

  return {
    handle,
    emitData(data) {
      for (const h of dataHandlers) h(data);
    },
    emitExit(exitCode) {
      exited = true;
      for (const h of exitHandlers) h({ exitCode });
    },
    writes,
    resizes,
  };
}

describe("claudePtyRouter", () => {
  it("uses claude: prefix in terminalId", () => {
    expect(claudeTerminalIdFor("abc")).toBe("claude:abc");
  });

  it("forwards PTY data to onOutput (single chunk under MAX_OUTPUT_CHUNK)", () => {
    const fake = makeFakePty();
    const outputs: Array<{ terminalId: string; data: string }> = [];

    attachClaudePtyRouter({
      sessionId: "sess-1",
      pty: fake.handle,
      onOutput: (d) => outputs.push(d),
      onExit: () => {},
    });

    fake.emitData("hello world\n");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      terminalId: "claude:sess-1",
      data: "hello world\n",
    });
  });

  it("chunks PTY data > 8KB into multiple onOutput emits", () => {
    const fake = makeFakePty();
    const outputs: Array<{ terminalId: string; data: string }> = [];

    attachClaudePtyRouter({
      sessionId: "sess-2",
      pty: fake.handle,
      onOutput: (d) => outputs.push(d),
      onExit: () => {},
    });

    // 20KB burst → 3 chunks (8 + 8 + 4).
    const big = "x".repeat(20 * 1024);
    fake.emitData(big);

    expect(outputs.length).toBe(3);
    expect(outputs[0].data.length).toBe(8 * 1024);
    expect(outputs[1].data.length).toBe(8 * 1024);
    expect(outputs[2].data.length).toBe(4 * 1024);
    expect(outputs.map((o) => o.data).join("")).toBe(big);
  });

  it("snapshot returns rolling-buffered output", () => {
    const fake = makeFakePty();
    const router = attachClaudePtyRouter({
      sessionId: "sess-3",
      pty: fake.handle,
      onOutput: () => {},
      onExit: () => {},
      ringBufferBytes: 16,
    });

    fake.emitData("0123456789");
    fake.emitData("abcdef");
    fake.emitData("ghij"); // total 20 bytes → buffer should hold the last 16.

    const snap = router.snapshot();
    expect(snap.length).toBeLessThanOrEqual(16);
    expect(snap).toBe("456789abcdefghij");
  });

  it("acceptInput forwards bytes to the PTY", () => {
    const fake = makeFakePty();
    const router = attachClaudePtyRouter({
      sessionId: "sess-4",
      pty: fake.handle,
      onOutput: () => {},
      onExit: () => {},
    });

    router.acceptInput("typed text\n");
    expect(fake.writes).toEqual(["typed text\n"]);
  });

  it("acceptResize forwards to the PTY", () => {
    const fake = makeFakePty();
    const router = attachClaudePtyRouter({
      sessionId: "sess-5",
      pty: fake.handle,
      onOutput: () => {},
      onExit: () => {},
    });

    router.acceptResize(132, 50);
    expect(fake.resizes).toEqual([[132, 50]]);
  });

  it("emits onExit when the PTY exits", () => {
    const fake = makeFakePty();
    const exits: Array<{ terminalId: string; exitCode: number }> = [];
    attachClaudePtyRouter({
      sessionId: "sess-6",
      pty: fake.handle,
      onOutput: () => {},
      onExit: (e) => exits.push(e),
    });

    fake.emitExit(0);
    expect(exits).toEqual([{ terminalId: "claude:sess-6", exitCode: 0 }]);
  });

  it("dispose detaches handlers without killing the PTY", () => {
    const fake = makeFakePty();
    const outputs: Array<{ terminalId: string; data: string }> = [];
    const router = attachClaudePtyRouter({
      sessionId: "sess-7",
      pty: fake.handle,
      onOutput: (d) => outputs.push(d),
      onExit: () => {},
    });

    router.dispose();
    fake.emitData("post-dispose");
    expect(outputs).toHaveLength(0);
    // PTY itself is still alive (the test isn't asserting on .exited, but
    // the fake hasn't been killed — only handlers were unsubscribed).
  });
});
