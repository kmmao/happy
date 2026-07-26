/**
 * toggle_mcp_server RPC handler tests.
 *
 * In PTY mode the Claude TUI has no programmatic toggle API, so happy-cli
 * implements the behaviour itself:
 *   1. Reject mutations to the protected name (happy).
 *   2. Persist the new `disabledMcpServers` list to ~/.claude.json.
 *   3. Mutate the live in-memory map so the next mcpServerStatus() poll
 *      reflects the new state without restarting the session.
 *
 * These tests pin all three contracts. The RpcHandlerManager is stubbed
 * so the handler can be invoked directly; the ClaudePtyController is a
 * minimal stub that records calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { registerClaudeControlHandlers } from './claudeControlHandlers';
import { createMcpServerState } from '@/claude/utils/mcpServerManager';
import type { ClaudePtyController } from '@/claude/pty/claudePtyController';
import { CLAUDE_CONTROL_SCOPE } from '@kmmao/happy-wire';

// ── RpcHandlerManager stub ────────────────────────────────────────────────────

/**
 * Captures every handler the production code registers in a Map keyed by
 * the fully-qualified method name (e.g. `claude-control:toggle_mcp_server`).
 * Tests look up the toggle handler by name and invoke it directly.
 */
function makeRpcHandlerManagerStub() {
  const handlers = new Map<string, (req: any) => Promise<any>>();
  return {
    handlers,
    registerHandler<TReq, TRes>(method: string, fn: (req: TReq) => Promise<TRes>) {
      handlers.set(method, fn as unknown as (req: any) => Promise<any>);
    },
  };
}

// ── ClaudePtyController stub ──────────────────────────────────────────────────

function makeControllerStub(): { controller: ClaudePtyController } {
  // toggle_mcp_server does not call into the controller in PTY mode — it
  // only needs `getCurrentQuery()` to return a truthy value. Every other
  // method on the interface is unused by these tests.
  const controller: Partial<ClaudePtyController> = {};
  return { controller: controller as ClaudePtyController };
}

// ── Test scaffolding ─────────────────────────────────────────────────────────

describe('registerClaudeControlHandlers — toggle_mcp_server', () => {
  let testClaudeDir: string;
  let testRootConfigPath: string;
  let originalClaudeConfigDir: string | undefined;
  const cwd = '/Users/test/project';

  beforeEach(() => {
    testClaudeDir = join(tmpdir(), `test-control-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testClaudeDir, { recursive: true });
    testRootConfigPath = join(dirname(testClaudeDir), '.claude.json');
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = testClaudeDir;
  });

  afterEach(() => {
    if (originalClaudeConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    if (existsSync(testClaudeDir)) rmSync(testClaudeDir, { recursive: true, force: true });
    if (existsSync(testRootConfigPath)) rmSync(testRootConfigPath, { force: true });
  });

  function setup(opts: { liveMcpServers?: Record<string, unknown> } = {}) {
    const rpc = makeRpcHandlerManagerStub();
    const { controller } = makeControllerStub();
    const liveMcpServers = opts.liveMcpServers ?? {};
    registerClaudeControlHandlers({
      rpcHandlerManager: rpc as any,
      getCurrentQuery: () => controller,
      cwd,
      mcpServerState: createMcpServerState(),
      liveMcpServers,
    });
    const handler = rpc.handlers.get(`${CLAUDE_CONTROL_SCOPE}:toggle_mcp_server`)!;
    return { handler, liveMcpServers };
  }

  function readDisk(): any {
    return JSON.parse(readFileSync(testRootConfigPath, 'utf-8'));
  }

  it('persists disable to ~/.claude.json and mutates liveMcpServers', async () => {
    const liveMcpServers: Record<string, unknown> = {
      'chrome-devtools': { type: 'stdio', command: 'npx' },
      happy: { type: 'http', url: 'http://localhost' },
    };
    const { handler } = setup({ liveMcpServers });

    const result = await handler({ serverName: 'chrome-devtools', enabled: false });
    expect(result).toEqual({ success: true });

    // Disk: project slot now records the disabled name.
    expect(readDisk().projects[cwd].disabledMcpServers).toEqual(['chrome-devtools']);

    // Live map: entry stayed (config preserved), `disabled: true` annotated.
    expect(liveMcpServers['chrome-devtools']).toEqual({
      type: 'stdio',
      command: 'npx',
      disabled: true,
    });
  });

  it('persists enable by removing the name from the disabled list', async () => {
    // Pre-existing disabled state on disk + live map.
    writeFileSync(
      testRootConfigPath,
      JSON.stringify({
        projects: { [cwd]: { disabledMcpServers: ['chrome-devtools', 'figma'] } },
      }),
    );
    const liveMcpServers: Record<string, unknown> = {
      'chrome-devtools': { type: 'stdio', command: 'npx', disabled: true },
      figma: { type: 'http', url: 'https://figma', disabled: true },
    };
    const { handler } = setup({ liveMcpServers });

    await handler({ serverName: 'chrome-devtools', enabled: true });

    expect(readDisk().projects[cwd].disabledMcpServers).toEqual(['figma']);
    expect(liveMcpServers['chrome-devtools']).toEqual({
      type: 'stdio',
      command: 'npx',
    });
    // The untouched server is left alone.
    expect(liveMcpServers.figma).toEqual({
      type: 'http',
      url: 'https://figma',
      disabled: true,
    });
  });

  it('rejects toggling the protected name (happy)', async () => {
    const { handler } = setup({
      liveMcpServers: { happy: { command: 'node' } },
    });

    await expect(handler({ serverName: 'happy', enabled: false })).rejects.toThrow(/protected/);

    // Disk never written.
    expect(existsSync(testRootConfigPath)).toBe(false);
  });

  it('throws when no active query is available', async () => {
    const rpc = makeRpcHandlerManagerStub();
    registerClaudeControlHandlers({
      rpcHandlerManager: rpc as any,
      getCurrentQuery: () => null,
      cwd,
      mcpServerState: createMcpServerState(),
      liveMcpServers: {},
    });
    const handler = rpc.handlers.get(`${CLAUDE_CONTROL_SCOPE}:toggle_mcp_server`)!;

    await expect(handler({ serverName: 'x', enabled: false })).rejects.toThrow(/No active query/);
  });

  it('disables an entry even when liveMcpServers does not contain it (disk still wins)', async () => {
    // The user might toggle a server that vanished from the live map (e.g.
    // installed by Claude Code outside happy-cli). We still persist the
    // disable so the next launch honours it.
    const liveMcpServers: Record<string, unknown> = {};
    const { handler } = setup({ liveMcpServers });

    await handler({ serverName: 'ghost', enabled: false });

    expect(readDisk().projects[cwd].disabledMcpServers).toEqual(['ghost']);
    // No entry was conjured into the live map.
    expect(liveMcpServers).toEqual({});
  });

  it('composes with concurrent edits — second toggle sees the first on disk', async () => {
    const liveMcpServers: Record<string, unknown> = {
      a: { command: 'a' },
      b: { command: 'b' },
    };
    const { handler } = setup({ liveMcpServers });

    await handler({ serverName: 'a', enabled: false });
    await handler({ serverName: 'b', enabled: false });

    expect(readDisk().projects[cwd].disabledMcpServers).toEqual(['a', 'b']);
    expect(liveMcpServers.a).toMatchObject({ disabled: true });
    expect(liveMcpServers.b).toMatchObject({ disabled: true });
  });

  it('deduplicates when the same name is disabled twice', async () => {
    const liveMcpServers: Record<string, unknown> = { dup: { command: 'd' } };
    const { handler } = setup({ liveMcpServers });

    await handler({ serverName: 'dup', enabled: false });
    await handler({ serverName: 'dup', enabled: false });

    expect(readDisk().projects[cwd].disabledMcpServers).toEqual(['dup']);
  });
});

// ── read_file blacklist regression ─────────────────────────────────────────────

/**
 * read_file gates the path BEFORE touching the controller: blacklisted
 * prefixes (~/.ssh, /etc/shadow, …) return `blacklisted_path` and the
 * controller's readFile is never invoked. Now that the controller actually
 * reads from disk (D), this regression pins that the gate still fires — the
 * disk read must not become a back door around the blacklist.
 */
describe('registerClaudeControlHandlers — read_file blacklist', () => {
  const cwd = '/Users/test/project';

  function setupReadFile() {
    const rpc = makeRpcHandlerManagerStub();
    let readFileCalls = 0;
    const controller: Partial<ClaudePtyController> = {
      async readFile() {
        readFileCalls++;
        return { contents: 'leaked', absPath: '/x', truncated: false };
      },
    };
    registerClaudeControlHandlers({
      rpcHandlerManager: rpc as any,
      getCurrentQuery: () => controller as ClaudePtyController,
      cwd,
      mcpServerState: createMcpServerState(),
      liveMcpServers: {},
    });
    const handler = rpc.handlers.get(`${CLAUDE_CONTROL_SCOPE}:read_file`)!;
    return { handler, readFileCalls: () => readFileCalls };
  }

  it('rejects ~/.ssh/id_rsa with blacklisted_path and never reads disk', async () => {
    const { handler, readFileCalls } = setupReadFile();

    const result = await handler({ path: join(homedir(), '.ssh', 'id_rsa') });

    expect(result).toEqual({ result: null, deniedReason: 'blacklisted_path' });
    expect(readFileCalls()).toBe(0);
  });

  it('rejects a relative path that resolves into a blacklisted dir', async () => {
    const { handler, readFileCalls } = setupReadFile();
    // Relative path is resolved against homedir-based blacklist only after
    // joining cwd; craft one that climbs out of cwd into ~/.aws.
    const result = await handler({ path: join(homedir(), '.aws', 'credentials') });

    expect(result).toEqual({ result: null, deniedReason: 'blacklisted_path' });
    expect(readFileCalls()).toBe(0);
  });

  it('rejects /etc/shadow with blacklisted_path', async () => {
    const { handler, readFileCalls } = setupReadFile();

    const result = await handler({ path: '/etc/shadow' });

    expect(result).toEqual({ result: null, deniedReason: 'blacklisted_path' });
    expect(readFileCalls()).toBe(0);
  });

  it('allows a non-blacklisted path through to the controller readFile', async () => {
    const { handler, readFileCalls } = setupReadFile();

    const result = await handler({ path: join(cwd, 'src', 'index.ts') });

    expect(result).toEqual({ result: { contents: 'leaked', absPath: '/x', truncated: false } });
    expect(readFileCalls()).toBe(1);
  });
});
