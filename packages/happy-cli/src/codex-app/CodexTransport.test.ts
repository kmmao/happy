import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./CodexAppServerClient";
import {
  type CodexTransport,
  type CodexTransportCloseInfo,
  resolveCodexEndpoint,
  StdioSpawnTransport,
  WebSocketTransport,
} from "./CodexTransport";

const tick = () => new Promise((resolve) => setImmediate(resolve));

vi.mock("@/ui/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// StdioSpawnTransport — spawns and *owns* a child process; close() SIGKILLs it.
// ---------------------------------------------------------------------------

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit("exit", null, signal ?? null);
    return true;
  }
}

const { mockSpawn, fakeProcesses } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  fakeProcesses: [] as FakeProcess[],
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

describe("StdioSpawnTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeProcesses.splice(0);
    mockSpawn.mockImplementation(() => {
      const child = new FakeProcess();
      fakeProcesses.push(child);
      return child as any;
    });
  });

  afterEach(() => {
    for (const child of fakeProcesses) {
      if (!child.killed) {
        child.kill();
      }
    }
  });

  it("spawns the configured command with env and cwd on open", async () => {
    const transport = new StdioSpawnTransport({
      command: "codex",
      args: ["app-server"],
      env: { FOO: "bar" },
      cwd: "/tmp/project",
    });

    await transport.open();

    expect(mockSpawn).toHaveBeenCalledWith("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { FOO: "bar" },
      cwd: "/tmp/project",
    });
  });

  it("delivers newline-delimited stdout lines to the message handler", async () => {
    const transport = new StdioSpawnTransport({
      command: "codex",
      args: ["app-server"],
      env: {},
      cwd: "/tmp",
    });
    const messages: string[] = [];
    transport.onMessage((frame) => messages.push(frame));

    await transport.open();
    fakeProcesses[0].stdout.write('{"id":1}\n{"id":2}\n');
    await tick();

    expect(messages).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("writes each sent frame to stdin with a trailing newline", async () => {
    const transport = new StdioSpawnTransport({
      command: "codex",
      args: ["app-server"],
      env: {},
      cwd: "/tmp",
    });

    await transport.open();
    const written: string[] = [];
    fakeProcesses[0].stdin.on("data", (chunk) => written.push(chunk.toString()));

    transport.send('{"method":"ping"}');
    await tick();

    expect(written.join("")).toBe('{"method":"ping"}\n');
  });

  it("SIGKILLs the owned process on close and reports the exit", async () => {
    const transport = new StdioSpawnTransport({
      command: "codex",
      args: ["app-server"],
      env: {},
      cwd: "/tmp",
    });
    let closeInfo: CodexTransportCloseInfo | null = null;
    transport.onClose((info) => {
      closeInfo = info;
    });

    await transport.open();
    await transport.close();

    expect(fakeProcesses[0].killed).toBe(true);
    expect(closeInfo).toEqual({ code: null, signal: "SIGKILL" });
  });

  it("propagates an unexpected process exit to the close handler", async () => {
    const transport = new StdioSpawnTransport({
      command: "codex",
      args: ["app-server"],
      env: {},
      cwd: "/tmp",
    });
    let closeInfo: CodexTransportCloseInfo | null = null;
    transport.onClose((info) => {
      closeInfo = info;
    });

    await transport.open();
    fakeProcesses[0].emit("exit", 1, null);

    expect(closeInfo).toEqual({ code: 1, signal: null });
  });
});

// ---------------------------------------------------------------------------
// WebSocketTransport — attaches to an externally-owned endpoint; close() only
// drops the socket and never kills a runtime Happy does not own.
// ---------------------------------------------------------------------------

type WsListener = (event: any) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Set<WsListener>>();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: WsListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: WsListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: any): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

describe("WebSocketTransport", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances.splice(0);
    (globalThis as any).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  const openTransport = async () => {
    const transport = new WebSocketTransport("ws://codex.test/app-server");
    const openPromise = transport.open();
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.emit("open", {});
    await openPromise;
    return { transport, socket };
  };

  it("resolves open once the socket connects", async () => {
    const { socket } = await openTransport();
    expect(socket.url).toBe("ws://codex.test/app-server");
  });

  it("rejects open when the socket errors", async () => {
    const transport = new WebSocketTransport("ws://codex.test/app-server");
    const openPromise = transport.open();
    FakeWebSocket.instances.at(-1)!.emit("error", {});

    await expect(openPromise).rejects.toThrow(/Failed to connect/);
  });

  it("splits batched newline-delimited frames into individual messages", async () => {
    const messages: string[] = [];
    const transport = new WebSocketTransport("ws://codex.test/app-server");
    transport.onMessage((frame) => messages.push(frame));
    const openPromise = transport.open();
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.emit("open", {});
    await openPromise;

    socket.emit("message", { data: '{"id":1}\n\n{"id":2}\n' });

    expect(messages).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("forwards the close event with its code", async () => {
    let closeInfo: CodexTransportCloseInfo | null = null;
    const transport = new WebSocketTransport("ws://codex.test/app-server");
    transport.onClose((info) => {
      closeInfo = info;
    });
    const openPromise = transport.open();
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.emit("open", {});
    await openPromise;

    socket.emit("close", { code: 1006 });

    expect(closeInfo).toEqual({ code: 1006 });
  });

  it("delegates sent frames straight to the socket", async () => {
    const { transport, socket } = await openTransport();
    transport.send('{"method":"ping"}');
    expect(socket.sent).toEqual(['{"method":"ping"}']);
  });

  it("closes the socket without killing the externally-owned runtime", async () => {
    const { transport, socket } = await openTransport();
    await transport.close();
    // Unlike the stdio transport there is no process to kill — close() only
    // drops the socket of a runtime Happy does not own.
    expect(socket.closed).toBe(true);
  });

  it("throws when no global WebSocket is available", async () => {
    (globalThis as any).WebSocket = undefined;
    const transport = new WebSocketTransport("ws://codex.test/app-server");
    await expect(transport.open()).rejects.toThrow(/global WebSocket/);
  });
});

// ---------------------------------------------------------------------------
// resolveCodexEndpoint — env-driven endpoint selection.
// ---------------------------------------------------------------------------

describe("resolveCodexEndpoint", () => {
  it("returns a trimmed endpoint when HAPPY_CODEX_ENDPOINT is set", () => {
    expect(
      resolveCodexEndpoint({ HAPPY_CODEX_ENDPOINT: "  ws://host/app  " } as any),
    ).toBe("ws://host/app");
  });

  it("returns null when the variable is missing or blank", () => {
    expect(resolveCodexEndpoint({} as any)).toBeNull();
    expect(resolveCodexEndpoint({ HAPPY_CODEX_ENDPOINT: "   " } as any)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transport independence — the client drives the whole handshake through the
// CodexTransport interface (send / onMessage / onClose / close), never
// touching child-process stdin/stdout directly.
// ---------------------------------------------------------------------------

class FakeTransport implements CodexTransport {
  readonly kind = "stdio" as const;
  opened = false;
  closed = false;
  sent: string[] = [];
  private messageHandler: ((frame: string) => void) | null = null;
  private closeHandler: ((info: CodexTransportCloseInfo) => void) | null = null;

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (info: CodexTransportCloseInfo) => void): void {
    this.closeHandler = handler;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  send(frame: string): void {
    this.sent.push(frame);
    const message = JSON.parse(frame) as { id?: string | number; method?: string };
    // Auto-reply to requests (method + id). The handshake only requires
    // model/list and config/read to return; an empty result satisfies both.
    if (message.method && message.id !== undefined) {
      queueMicrotask(() => this.inject({ id: message.id, result: {} }));
    }
  }

  inject(message: unknown): void {
    this.messageHandler?.(JSON.stringify(message));
  }

  emitClose(info: CodexTransportCloseInfo): void {
    this.closeHandler?.(info);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("CodexAppServerClient transport independence", () => {
  it("runs the connect handshake and disconnect entirely through the transport", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(undefined, { transport });

    await client.connect();

    expect(transport.opened).toBe(true);
    expect(JSON.parse(transport.sent[0]).method).toBe("initialize");
    expect(transport.sent.some((frame) => JSON.parse(frame).method === "model/list")).toBe(
      true,
    );
    // Handshake completed purely over the injected transport.
    expect(client.getCapabilities()).not.toBeNull();

    await client.disconnect();
    expect(transport.closed).toBe(true);
  });

  it("resets connection state when the transport reports a close", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(undefined, { transport });

    await client.connect();
    expect(transport.sent.length).toBeGreaterThan(0);

    // A close coming up from the transport must let a fresh connect re-handshake
    // (connect() early-returns while still marked connected).
    transport.emitClose({ code: 1, signal: null });
    transport.sent.splice(0);

    await client.connect();
    expect(transport.sent.some((frame) => JSON.parse(frame).method === "initialize")).toBe(
      true,
    );
  });
});
