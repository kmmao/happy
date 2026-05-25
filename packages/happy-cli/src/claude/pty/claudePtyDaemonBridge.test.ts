/**
 * claudePtyDaemonBridge — backpressure / ordering tests.
 *
 * We never touch a real daemon. Instead each test starts a throwaway
 * loopback HTTP server, points `HAPPY_DAEMON_CONTROL_URL` at it, and asserts
 * on what the bridge actually POSTed. No mocking — the real `fetch` path and
 * the real FIFO drain run end to end.
 *
 * Backpressure determinism: a synchronous burst of `bridgeData` calls cannot
 * be drained mid-loop (the event loop is blocked), so every drop lands in the
 * in-memory FIFO before any POST completes. That makes the drop-oldest
 * behaviour reproducible without timing hacks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import {
  bridgeAttach,
  bridgeData,
  bridgeDetach,
  bridgeExit,
  bridgeAvailable,
  _resetBridgeForTests,
} from "./claudePtyDaemonBridge";
import { TERMINAL_REPLAY_BUFFER_BYTES } from "@kmmao/happy-wire";

const CONTROL_ENV = "HAPPY_DAEMON_CONTROL_URL";

interface MockDaemon {
  url: string;
  received: Array<{ path: string; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}

async function startMockDaemon(): Promise<MockDaemon> {
  const received: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      received.push({ path: req.url ?? "", body });
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function dataPayloads(received: MockDaemon["received"]): string {
  return received
    .filter((r) => r.path === "/claude-pty/data")
    .map((r) => String(r.body.data ?? ""))
    .join("");
}

describe("claudePtyDaemonBridge", () => {
  let daemon: MockDaemon | null = null;
  const prevEnv = process.env[CONTROL_ENV];

  beforeEach(() => {
    _resetBridgeForTests();
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.close();
      daemon = null;
    }
    if (prevEnv === undefined) delete process.env[CONTROL_ENV];
    else process.env[CONTROL_ENV] = prevEnv;
    _resetBridgeForTests();
  });

  it("bridgeAvailable reflects the control env var", () => {
    delete process.env[CONTROL_ENV];
    expect(bridgeAvailable()).toBe(false);
    process.env[CONTROL_ENV] = "http://127.0.0.1:1";
    expect(bridgeAvailable()).toBe(true);
  });

  it("forwards output serially and in order", async () => {
    daemon = await startMockDaemon();
    process.env[CONTROL_ENV] = daemon.url;
    const tid = "claude:order";

    bridgeData(tid, "first");
    bridgeData(tid, "second");
    bridgeData(tid, "third");
    await bridgeDetach(tid);

    expect(dataPayloads(daemon.received)).toBe("firstsecondthird");
  });

  it("drops the oldest output under backpressure, preserving the newest", async () => {
    daemon = await startMockDaemon();
    process.env[CONTROL_ENV] = daemon.url;
    const tid = "claude:backpressure";

    const CHUNK = TERMINAL_REPLAY_BUFFER_BYTES; // 64 KB, == MAX_POST_BYTES
    const NUM = 100; // 6.4 MB total, well over the 4 MB drop threshold
    const sentTotal = CHUNK * NUM;

    // Synchronous burst: no POST can drain mid-loop (the event loop is
    // blocked), so every drop happens against the in-memory FIFO before any
    // flush. The first chunk is already sliced into an in-flight POST, so it
    // survives; the oldest *queued* chunks are the ones dropped.
    for (let i = 0; i < NUM; i++) {
      const marker = `<<${i}>>`;
      bridgeData(tid, marker + "x".repeat(CHUNK - marker.length));
    }
    await bridgeDetach(tid);

    const got = dataPayloads(daemon.received);
    expect(got).toContain("<<0>>"); // first chunk was already in-flight → survives
    expect(got).toContain("<<99>>"); // newest output is always preserved
    expect(got).not.toContain("<<10>>"); // an early queued chunk was dropped
    expect(got.length).toBeLessThan(sentTotal); // dropping actually happened
    expect(got.length).toBeGreaterThanOrEqual(4 * 1024 * 1024); // retained near the cap
  });

  it("flushes queued output before posting exit", async () => {
    daemon = await startMockDaemon();
    process.env[CONTROL_ENV] = daemon.url;
    const tid = "claude:exit";

    bridgeData(tid, "tail-bytes");
    await bridgeExit(tid, 7);

    expect(dataPayloads(daemon.received)).toBe("tail-bytes");
    const last = daemon.received[daemon.received.length - 1];
    expect(last.path).toBe("/claude-pty/exit");
    expect(last.body.exitCode).toBe(7);
    // No data POST may arrive after the exit POST.
    const exitIdx = daemon.received.findIndex((r) => r.path === "/claude-pty/exit");
    const dataAfterExit = daemon.received
      .slice(exitIdx + 1)
      .some((r) => r.path === "/claude-pty/data");
    expect(dataAfterExit).toBe(false);
  });

  it("no-ops without throwing when no daemon control url is set", async () => {
    delete process.env[CONTROL_ENV];
    const tid = "claude:nodaemon";

    expect(bridgeAvailable()).toBe(false);
    expect(() => bridgeData(tid, "ignored")).not.toThrow();
    await expect(
      bridgeAttach({ terminalId: tid, sessionId: "s", cols: 80, rows: 24, cwd: "/tmp" }),
    ).resolves.toBeUndefined();
    await expect(bridgeDetach(tid)).resolves.toBeUndefined();
    await expect(bridgeExit(tid, 0)).resolves.toBeUndefined();
  });
});
