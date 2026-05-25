/**
 * claudePtyReverseServer — endpoint / validation tests.
 *
 * Starts the real loopback server and drives it with the real `fetch`, so the
 * HTTP parsing, body limits, and error handling all run end to end. No mocks —
 * the handlers are plain recording closures owned by the test.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  startClaudePtyReverseServer,
  type ClaudePtyReverseHandlers,
  type ClaudePtyReverseServer,
} from "./claudePtyReverseServer";

interface Recorder {
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
  closes: number;
  handlers: ClaudePtyReverseHandlers;
}

function recorder(overrides: Partial<ClaudePtyReverseHandlers> = {}): Recorder {
  const rec: Recorder = {
    inputs: [],
    resizes: [],
    closes: 0,
    handlers: {
      input: (d) => rec.inputs.push(d),
      resize: (cols, rows) => rec.resizes.push({ cols, rows }),
      close: () => {
        rec.closes += 1;
      },
      ...overrides,
    },
  };
  return rec;
}

type PostResult = { ok: true; status: number; text: string } | { ok: false };

async function post(baseUrl: string, path: string, body: string | unknown): Promise<PostResult> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { ok: true, status: res.status, text: await res.text() };
  } catch {
    return { ok: false };
  }
}

describe("claudePtyReverseServer", () => {
  const servers: ClaudePtyReverseServer[] = [];

  async function start(handlers: ClaudePtyReverseHandlers): Promise<string> {
    const srv = await startClaudePtyReverseServer(handlers);
    servers.push(srv);
    return srv.baseUrl;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });

  it("routes /input, /resize and /close to the handlers", async () => {
    const rec = recorder();
    const url = await start(rec.handlers);

    expect(await post(url, "/input", { data: "ls -la\r" })).toMatchObject({ status: 200 });
    expect(await post(url, "/resize", { cols: 120, rows: 40 })).toMatchObject({ status: 200 });
    expect(await post(url, "/close", {})).toMatchObject({ status: 200 });

    expect(rec.inputs).toEqual(["ls -la\r"]);
    expect(rec.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(rec.closes).toBe(1);
  });

  it("rejects /input without a string data field (400)", async () => {
    const rec = recorder();
    const url = await start(rec.handlers);

    const res = await post(url, "/input", { notData: 1 });
    expect(res).toMatchObject({ ok: true, status: 400 });
    expect(rec.inputs).toHaveLength(0);
  });

  it("rejects /resize with missing or non-positive dimensions (400)", async () => {
    const rec = recorder();
    const url = await start(rec.handlers);

    expect(await post(url, "/resize", { cols: 80 })).toMatchObject({ status: 400 });
    expect(await post(url, "/resize", { cols: 0, rows: 24 })).toMatchObject({ status: 400 });
    expect(rec.resizes).toHaveLength(0);
  });

  it("returns 404 for unknown paths and non-POST methods", async () => {
    const rec = recorder();
    const url = await start(rec.handlers);

    expect(await post(url, "/nope", {})).toMatchObject({ status: 404 });
    const get = await fetch(`${url}/input`, { method: "GET" });
    expect(get.status).toBe(404);
  });

  it("returns 500 and stays alive when a handler throws", async () => {
    const rec = recorder({
      input: () => {
        throw new Error("boom");
      },
    });
    const url = await start(rec.handlers);

    expect(await post(url, "/input", { data: "x" })).toMatchObject({ status: 500 });
    // Server survives the throw — a subsequent good request still works.
    expect(await post(url, "/close", {})).toMatchObject({ status: 200 });
    expect(rec.closes).toBe(1);
  });

  it("rejects an over-large body without invoking the handler", async () => {
    const rec = recorder();
    const url = await start(rec.handlers);

    // > MAX_BODY_BYTES (256 KB). The server aborts the read; the client either
    // sees a non-200 or a reset connection — either way the byte stream must
    // never reach the input handler.
    const huge = "x".repeat(300 * 1024);
    const res = await post(url, "/input", JSON.stringify({ data: huge }));
    if (res.ok) expect(res.status).not.toBe(200);
    expect(rec.inputs).toHaveLength(0);
  });

  it("stop() is idempotent", async () => {
    const rec = recorder();
    const srv = await startClaudePtyReverseServer(rec.handlers);
    await srv.stop();
    await expect(srv.stop()).resolves.toBeUndefined();
  });
});
