/**
 * mcpStatusProbe — stdio probe tests (PATH-resolve + opt-in initialize handshake).
 *
 * Per CLI rules these tests use NO mocking: every "MCP server" is a real
 * `node -e <script>` child process. The fake servers below are minimal but
 * real JSON-RPC-over-stdio responders, so the handshake path is exercised
 * end-to-end (spawn → write initialize → read newline-framed reply → kill).
 *
 * `process.execPath` (the absolute path to the node running vitest) is used as
 * the command so resolution never depends on `node` being on PATH, and so the
 * absolute-path branch of resolveStdioCommand is what we hit.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { probeMcpServer, resetMcpProbeCache } from "./mcpStatusProbe";

const NODE = process.execPath;

// A real, minimal MCP stdio server: reads newline-framed JSON-RPC from stdin
// and replies to `initialize`. `extra` is prepended raw to stdout before the
// listener attaches, used to verify the parser tolerates banners / notifications.
function fakeMcpServer(opts: { reply: "result" | "error"; banner?: string } = { reply: "result" }): string[] {
  const banner = opts.banner ? `process.stdout.write(${JSON.stringify(opts.banner)});` : "";
  const payload =
    opts.reply === "error"
      ? `{jsonrpc:'2.0',id:m.id,error:{code:-32600,message:'nope'}}`
      : `{jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'1'}}}`;
  const script =
    banner +
    `let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);let m;try{m=JSON.parse(l)}catch{continue}if(m.method==='initialize'){process.stdout.write(JSON.stringify(${payload})+'\\n')}}});`;
  return ["-e", script];
}

describe("mcpStatusProbe — stdio PATH-resolve (handshake disabled)", () => {
  beforeEach(() => {
    resetMcpProbeCache();
    delete process.env.HAPPY_MCP_HANDSHAKE_PROBE;
  });

  it("reports a resolvable command as connected without spawning it", async () => {
    const res = await probeMcpServer("node-server", { command: NODE, args: ["--version"] });
    expect(res.status).toBe("connected");
    // No handshake → cheap result, default TTL (no long handshake TTL).
    expect(res.ttlMs).toBeUndefined();
  });

  it("reports a missing command as failed", async () => {
    const res = await probeMcpServer("ghost", { command: "happy-nonexistent-binary-zzz" });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/not found/i);
  });

  it("reports a disabled server as disabled", async () => {
    const res = await probeMcpServer("off", { command: NODE, disabled: true });
    expect(res.status).toBe("disabled");
  });

  it("fails a stdio config with no command", async () => {
    const res = await probeMcpServer("nocmd", { type: "stdio" });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/missing 'command'/);
  });
});

describe("mcpStatusProbe — stdio initialize handshake (HAPPY_MCP_HANDSHAKE_PROBE=1)", () => {
  beforeEach(() => {
    resetMcpProbeCache();
    process.env.HAPPY_MCP_HANDSHAKE_PROBE = "1";
    // Keep the timeout-based degrade tests fast.
    process.env.HAPPY_MCP_HANDSHAKE_TIMEOUT_MS = "600";
  });
  afterEach(() => {
    delete process.env.HAPPY_MCP_HANDSHAKE_PROBE;
    delete process.env.HAPPY_MCP_HANDSHAKE_TIMEOUT_MS;
  });

  it("upgrades to high-confidence connected (5 min TTL) when the server completes the handshake", async () => {
    const res = await probeMcpServer("real", { command: NODE, args: fakeMcpServer() });
    expect(res.status).toBe("connected");
    // The long handshake TTL is the signal that the deep probe (not PATH-resolve) decided this.
    expect(res.ttlMs).toBe(5 * 60_000);
  });

  it("tolerates a non-JSON banner on stdout before the initialize reply", async () => {
    const res = await probeMcpServer("noisy", {
      command: NODE,
      args: fakeMcpServer({ reply: "result", banner: "MCP server starting...\n" }),
    });
    expect(res.status).toBe("connected");
    expect(res.ttlMs).toBe(5 * 60_000);
  });

  it("degrades to PATH-resolve connected when the server returns a JSON-RPC error", async () => {
    const res = await probeMcpServer("errsrv", { command: NODE, args: fakeMcpServer({ reply: "error" }) });
    // Command exists, so we degrade rather than report failed; no handshake TTL.
    expect(res.status).toBe("connected");
    expect(res.ttlMs).toBeUndefined();
  });

  it("degrades to PATH-resolve connected when the server never responds (timeout)", async () => {
    // Stays alive, never writes to stdout → handshake times out.
    const res = await probeMcpServer("silent", { command: NODE, args: ["-e", "setTimeout(()=>{},60000)"] });
    expect(res.status).toBe("connected");
    expect(res.ttlMs).toBeUndefined();
  });

  it("degrades to PATH-resolve connected when the server exits before responding", async () => {
    const res = await probeMcpServer("crasher", { command: NODE, args: ["-e", "process.exit(0)"] });
    expect(res.status).toBe("connected");
    expect(res.ttlMs).toBeUndefined();
  });

  it("never spawns a handshake for a missing command — still failed", async () => {
    const res = await probeMcpServer("ghost", { command: "happy-nonexistent-binary-zzz", args: fakeMcpServer() });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/not found/i);
  });
});
