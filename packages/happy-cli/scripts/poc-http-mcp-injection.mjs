#!/usr/bin/env node
/**
 * Phase 4 PoC — claude TUI ← HTTP MCP injection via --mcp-config.
 *
 * What this validates
 * -------------------
 * The original plan considered putting `mcpServers` inside the temp
 * settings.json (`--settings <path>`). Empirical result: **claude TUI
 * does NOT load mcpServers from --settings** — the HTTP server gets
 * zero requests. Use `--mcp-config <json|path>` instead, which works
 * end-to-end:
 *
 *     [poc] result: initialized=true                    # claude reached our server
 *     Available MCP tool: `mcp__phase4_poc__phase4_ping` # claude saw the tool
 *
 * Phase 5 wires this through `claudeCliFlags.mcpServers` → `--mcp-config`
 * (already implemented in src/claude/pty/claudeCliFlags.ts).
 *
 * Usage
 * -----
 *   node scripts/poc-http-mcp-injection.mjs           # boot server, print instructions
 *   node scripts/poc-http-mcp-injection.mjs --spawn   # also auto-spawn claude --print
 *   node scripts/poc-http-mcp-injection.mjs --settings  # legacy: --settings path (negative control)
 *
 * Exit codes
 * ----------
 *   0  HTTP MCP server received at least one MCP request from claude (initialize/list-tools).
 *   1  Server never reached, claude failed to start, etc.
 */

import { createServer } from "node:http";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const TOOL_NAME = "phase4_ping";

function createMcpServer({ onCall }) {
  const mcp = new McpServer({ name: "Phase4 PoC", version: "1.0.0" });
  mcp.registerTool(
    TOOL_NAME,
    {
      title: "Phase 4 ping",
      description:
        "Phase 4 PoC tool. Returns 'pong' to prove the HTTP MCP transport works.",
      inputSchema: { message: z.string().optional() },
    },
    async (args) => {
      onCall?.(args ?? {});
      return {
        content: [
          {
            type: "text",
            text: `pong (message=${typeof args?.message === "string" ? args.message : ""})`,
          },
        ],
      };
    },
  );
  return mcp;
}

async function startHttpMcpServer() {
  let initialized = false;
  let toolCalls = 0;

  const server = createServer(async (req, res) => {
    initialized = true;
    const mcp = createMcpServer({ onCall: () => (toolCalls += 1) });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcp.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end();
      console.error("[poc] transport error:", err);
    }
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    stop: () => server.close(),
    get initialized() {
      return initialized;
    },
    get toolCalls() {
      return toolCalls;
    },
  };
}

function writeTempJson(prefix, value) {
  const dir = join(tmpdir(), `happy-phase4-poc`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${prefix}-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

async function main() {
  const argv = process.argv.slice(2);
  const autoSpawn = argv.includes("--spawn");
  const negativeControl = argv.includes("--settings");

  const server = await startHttpMcpServer();

  // Two payloads. The one we *expect* to work goes via --mcp-config; the
  // negative control puts mcpServers in --settings to demonstrate the
  // empty-result failure mode.
  const mcpConfigPath = writeTempJson("mcp-config", {
    mcpServers: { phase4_poc: { type: "http", url: server.url } },
  });
  const settingsPath = writeTempJson("settings", {
    mcpServers: { phase4_poc: { type: "http", url: server.url } },
  });

  console.log(`[poc] HTTP MCP server: ${server.url}`);
  console.log(`[poc] --mcp-config:    ${mcpConfigPath}  (expected to work)`);
  console.log(`[poc] --settings:      ${settingsPath}  (negative control)`);
  console.log(`[poc] tool name:       ${TOOL_NAME}`);

  if (!autoSpawn) {
    console.log("");
    console.log("Run one of these in another terminal:");
    console.log("");
    console.log("  # Positive case — claude SHOULD see mcp__phase4_poc__phase4_ping");
    console.log(
      `  claude --mcp-config ${mcpConfigPath} --strict-mcp-config --print 'List available MCP tools.'`,
    );
    console.log("");
    console.log("  # Negative case — claude reports NO tools, HTTP server gets nothing");
    console.log(
      `  claude --settings ${settingsPath} --strict-mcp-config --print 'List available MCP tools.'`,
    );
    console.log("");
    console.log("Press Ctrl-C here when finished.");
    process.on("SIGINT", () => {
      console.log("");
      console.log(
        `[poc] result: initialized=${server.initialized} toolCalls=${server.toolCalls}`,
      );
      for (const p of [mcpConfigPath, settingsPath]) {
        try {
          if (existsSync(p)) unlinkSync(p);
        } catch {}
      }
      server.stop();
      process.exit(server.initialized ? 0 : 1);
    });
    return;
  }

  // Auto-spawn mode.
  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const prompt = `List available MCP tools by name. Do not call any.`;
  const args = negativeControl
    ? ["--settings", settingsPath, "--strict-mcp-config", "--print", prompt]
    : ["--mcp-config", mcpConfigPath, "--strict-mcp-config", "--print", prompt];
  console.log(`[poc] spawn: ${claudeBin} ${args.join(" ")}`);

  const child = spawn(claudeBin, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  child.on("close", (code) => {
    console.log(`[poc] claude exit code: ${code}`);
    if (stdout.trim()) console.log(`[poc] claude stdout:\n${stdout.trim()}`);
    if (stderr.trim()) console.log(`[poc] claude stderr:\n${stderr.trim()}`);
    console.log(
      `[poc] result: initialized=${server.initialized} toolCalls=${server.toolCalls}`,
    );
    for (const p of [mcpConfigPath, settingsPath]) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {}
    }
    server.stop();
    process.exit(server.initialized && code === 0 ? 0 : 1);
  });
}

main().catch((err) => {
  console.error("[poc] fatal:", err);
  process.exit(1);
});
