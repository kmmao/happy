import { describe, it, expect, vi } from 'vitest';
import {
  validateMcpServerConfig,
  applyMcpServers,
  addMcpServer,
  removeMcpServer,
  syncMcpServersFromRegistry,
  createMcpServerState,
} from "./mcpServerManager";
// ─── Mock SDK Query ───────────────────────────────────────────────────────────

function makeMockQuery(opts?: {
  setResult?: { added: string[]; removed: string[]; errors: Record<string, string> };
  statusResult?: Array<{ name: string; status: string }>;
  shouldThrow?: Error;
}) {
  return {
    setMcpServers: vi.fn().mockImplementation(async () => {
      if (opts?.shouldThrow) throw opts.shouldThrow;
      return opts?.setResult ?? { added: [], removed: [], errors: {} };
    }),
    mcpServerStatus: vi.fn().mockResolvedValue(opts?.statusResult ?? []),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@anthropic-ai/claude-agent-sdk").Query;
}

// ─── validateMcpServerConfig ──────────────────────────────────────────────────

describe("validateMcpServerConfig", () => {
  it("accepts valid stdio config", () => {
    const r = validateMcpServerConfig("test-server", {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server"],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts stdio config without explicit type (default)", () => {
    const r = validateMcpServerConfig("test-server", {
      command: "npx",
      args: ["-y", "mcp-server"],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts valid sse config", () => {
    const r = validateMcpServerConfig("test-server", {
      type: "sse",
      url: "https://example.com/mcp",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts valid http config", () => {
    const r = validateMcpServerConfig("test-server", {
      type: "http",
      url: "https://example.com/mcp",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts valid streamable-http config", () => {
    const r = validateMcpServerConfig("test-server", {
      type: "streamable-http",
      url: "https://example.com/mcp",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts valid url config", () => {
    const r = validateMcpServerConfig("test-server", {
      type: "url",
      url: "https://example.com/mcp",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-object config", () => {
    const r = validateMcpServerConfig("test", "not an object");
    expect(r.ok).toBe(false);
  });

  it("rejects stdio without command", () => {
    const r = validateMcpServerConfig("test", { type: "stdio" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/command/);
  });

  it("rejects sse/http without url", () => {
    const r = validateMcpServerConfig("test", { type: "sse" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/url/);
  });

  it("rejects unknown transport type", () => {
    const r = validateMcpServerConfig("test", { type: "websocket" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });

  it("rejects protected server names", () => {
    const r = validateMcpServerConfig("happy", {
      type: "stdio",
      command: "evil",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/protected/);
  });

  it("rejects happy-knowledge as protected", () => {
    const r = validateMcpServerConfig("happy-knowledge", {
      type: "stdio",
      command: "evil",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects args with non-string elements", () => {
    const r = validateMcpServerConfig("test", {
      type: "stdio",
      command: "npx",
      args: [42],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/args/);
  });

  it("rejects env with non-string values", () => {
    const r = validateMcpServerConfig("test", {
      type: "stdio",
      command: "npx",
      env: { FOO: 42 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/env/);
  });
});

// ─── applyMcpServers ─────────────────────────────────────────────────────────

describe("applyMcpServers", () => {
  it("validates all configs before applying", async () => {
    const q = makeMockQuery({ setResult: { added: ["a"], removed: [], errors: {} } });
    const state = createMcpServerState();

    const r = await applyMcpServers(q, {
      "server-a": { type: "stdio", command: "npx", args: ["-y", "mcp-a"] },
    }, state);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toEqual(["a"]);
    }
    expect(q.setMcpServers).toHaveBeenCalled();
  });

  it("rejects if any config is invalid", async () => {
    const q = makeMockQuery();
    const state = createMcpServerState();

    const r = await applyMcpServers(q, {
      "good": { type: "stdio", command: "npx" },
      "bad": { type: "websocket" as any },
    }, state);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bad/);
    expect(q.setMcpServers).not.toHaveBeenCalled();
  });

  it("preserves protected servers in the config", async () => {
    const q = makeMockQuery({ setResult: { added: ["new-server"], removed: [], errors: {} } });
    const state = createMcpServerState();
    state.protectedServers = { happy: { type: "sdk", name: "happy" } };

    const r = await applyMcpServers(q, {
      "new-server": { type: "sse", url: "https://example.com" },
    }, state);

    expect(r.ok).toBe(true);
    // setMcpServers should include both the new server AND the protected server
    const callArg = (q.setMcpServers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toHaveProperty("happy");
    expect(callArg).toHaveProperty("new-server");
  });

  it("captures SDK errors", async () => {
    const q = makeMockQuery({ shouldThrow: new Error("connection failed") });
    const state = createMcpServerState();

    const r = await applyMcpServers(q, {
      "server-a": { type: "sse", url: "https://example.com" },
    }, state);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/connection failed/);
  });

  it("tracks user servers in state after success", async () => {
    const q = makeMockQuery({ setResult: { added: ["s1"], removed: [], errors: {} } });
    const state = createMcpServerState();

    await applyMcpServers(q, {
      "s1": { type: "stdio", command: "npx" },
    }, state);

    expect(state.userServers).toHaveProperty("s1");
  });
});

// ─── addMcpServer ─────────────────────────────────────────────────────────────

describe("addMcpServer", () => {
  it("adds a single server by merging with existing", async () => {
    const q = makeMockQuery({ setResult: { added: ["new"], removed: [], errors: {} } });
    const state = createMcpServerState();
    state.userServers = { existing: { type: "sse", url: "https://old.com" } };

    const r = await addMcpServer(q, "new", { type: "sse", url: "https://new.com" }, state);

    expect(r.ok).toBe(true);
    const callArg = (q.setMcpServers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toHaveProperty("existing");
    expect(callArg).toHaveProperty("new");
  });

  it("rejects adding a protected server name", async () => {
    const q = makeMockQuery();
    const state = createMcpServerState();

    const r = await addMcpServer(q, "happy", { type: "stdio", command: "x" }, state);

    expect(r.ok).toBe(false);
    expect(q.setMcpServers).not.toHaveBeenCalled();
  });

  it("rejects invalid config", async () => {
    const q = makeMockQuery();
    const state = createMcpServerState();

    const r = await addMcpServer(q, "test", { type: "stdio" }, state);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/command/);
  });
});

// ─── removeMcpServer ──────────────────────────────────────────────────────────

describe("removeMcpServer", () => {
  it("removes a server by rebuilding config without it", async () => {
    const q = makeMockQuery({ setResult: { added: [], removed: ["to-remove"], errors: {} } });
    const state = createMcpServerState();
    state.userServers = {
      "keep": { type: "sse", url: "https://keep.com" },
      "to-remove": { type: "sse", url: "https://remove.com" },
    };

    const r = await removeMcpServer(q, "to-remove", state);

    expect(r.ok).toBe(true);
    const callArg = (q.setMcpServers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toHaveProperty("keep");
    expect(callArg).not.toHaveProperty("to-remove");
  });

  it("rejects removing a protected server", async () => {
    const q = makeMockQuery();
    const state = createMcpServerState();

    const r = await removeMcpServer(q, "happy", state);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/protected/);
  });

  it("returns ok when server is not found (idempotent)", async () => {
    const q = makeMockQuery({ setResult: { added: [], removed: [], errors: {} } });
    const state = createMcpServerState();

    const r = await removeMcpServer(q, "nonexistent", state);

    expect(r.ok).toBe(true);
  });
});

// ─── syncMcpServersFromRegistry ───────────────────────────────────────────────

describe("syncMcpServersFromRegistry", () => {
  it("merges registry servers into running session", async () => {
    const q = makeMockQuery({ setResult: { added: ["reg-1"], removed: [], errors: {} } });
    const state = createMcpServerState();

    const registryServers = {
      "reg-1": { type: "sse", url: "https://registry.com" },
    };

    const r = await syncMcpServersFromRegistry(
      q,
      registryServers as Record<string, Record<string, unknown>>,
      state,
    );

    expect(r.ok).toBe(true);
    expect(state.userServers).toHaveProperty("reg-1");
  });

  it("preserves protected servers during sync", async () => {
    const q = makeMockQuery({ setResult: { added: [], removed: [], errors: {} } });
    const state = createMcpServerState();
    state.protectedServers = { happy: { type: "sdk", name: "happy" } };

    await syncMcpServersFromRegistry(q, { "s1": { type: "sse", url: "https://a.com" } }, state);

    const callArg = (q.setMcpServers as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toHaveProperty("happy");
    expect(callArg).toHaveProperty("s1");
  });
});

// ─── createMcpServerState ─────────────────────────────────────────────────────

describe("createMcpServerState", () => {
  it("starts with empty state", () => {
    const state = createMcpServerState();
    expect(state.userServers).toEqual({});
    expect(state.protectedServers).toEqual({});
    expect(state.lastSyncAt).toBeNull();
  });
});
