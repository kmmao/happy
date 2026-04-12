/**
 * Daemon mode — persistent background process that connects to the server,
 * registers RPC handlers, and processes automation triggers.
 *
 * Usage: happy-agent daemon start [--directory <dir>]
 *
 * The daemon:
 * 1. Loads credentials and config
 * 2. Registers/gets machine identity
 * 3. Detects Tailscale and tunnel state
 * 4. Creates MachineClient with all RPC handlers
 * 5. Enables automation (webhook/supervisor/task triggers)
 * 6. Runs until SIGTERM/SIGINT
 */

import { hostname } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { version } from "../../package.json";
import { loadConfig } from "../config";
import { requireCredentials } from "../credentials";
import { getOrCreateMachine } from "../api";
import { MachineClient } from "../api/machineClient";
import { detectTailscale, detectTailscaleServe } from "../utils/tailscale";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

function pidFilePath(homeDir: string): string {
  return join(homeDir, "agent-daemon.pid");
}

function writePidFile(homeDir: string, pid: number): void {
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(pidFilePath(homeDir), String(pid), "utf-8");
}

function readPidFile(homeDir: string): number | null {
  try {
    const raw = readFileSync(pidFilePath(homeDir), "utf-8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function removePidFile(homeDir: string): void {
  try {
    unlinkSync(pidFilePath(homeDir));
  } catch { /* ignore */ }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Daemon start
// ---------------------------------------------------------------------------

export async function startDaemon(options: {
  directory?: string;
  foreground?: boolean;
}): Promise<void> {
  const config = loadConfig();
  const creds = requireCredentials(config);

  // Check for existing daemon
  const existingPid = readPidFile(config.homeDir);
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Daemon already running (PID ${existingPid})`);
    process.exitCode = 1;
    return;
  }

  // Clean stale PID file
  if (existingPid) {
    removePidFile(config.homeDir);
  }

  const workDir = options.directory ?? process.cwd();
  console.log(`Starting agent daemon in ${workDir}...`);

  // 1. Register machine
  const metadata = {
    host: hostname(),
    platform: process.platform,
    happyCliVersion: version,
    homeDir: config.homeDir,
    happyHomeDir: config.homeDir,
    happyLibDir: config.homeDir,
  };
  const machine = await getOrCreateMachine(config, creds, metadata);
  console.log(`Machine: ${machine.id} (${machine.metadata.host})`);

  // 2. Detect Tailscale
  const tailscaleInfo = await detectTailscale();
  const serves = tailscaleInfo.status === "connected" ? await detectTailscaleServe() : [];
  const fullTailscale = { ...tailscaleInfo, serves };
  if (tailscaleInfo.status === "connected") {
    console.log(`Tailscale: ${tailscaleInfo.hostname} (${tailscaleInfo.ipv4})`);
  }

  // 3. Create MachineClient
  const client = new MachineClient({
    token: creds.token,
    machine,
    serverUrl: config.serverUrl,
    agentVersion: version,
    workingDirectory: workDir,
  });

  client.setTailscaleInfo(fullTailscale);
  client.enableAutomation(config.serverUrl, creds.token);

  // 4. Connect
  client.connect();

  // 5. Write PID file
  writePidFile(config.homeDir, process.pid);
  console.log(`Daemon started (PID ${process.pid})`);

  // 6. Graceful shutdown
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.debug(`[DAEMON] Received ${signal}, shutting down...`);
    console.log(`\nReceived ${signal}, shutting down...`);
    client.shutdown();
    removePidFile(config.homeDir);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep process alive
  await new Promise<never>(() => {
    // Never resolves — daemon runs until signal
  });
}

// ---------------------------------------------------------------------------
// Daemon stop
// ---------------------------------------------------------------------------

export function stopDaemon(): void {
  const config = loadConfig();
  const pid = readPidFile(config.homeDir);

  if (!pid) {
    console.log("No daemon PID file found.");
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`Daemon PID ${pid} is not running (stale PID file). Cleaning up.`);
    removePidFile(config.homeDir);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (PID ${pid})`);
    removePidFile(config.homeDir);
  } catch (error) {
    console.error(`Failed to stop daemon: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Daemon status
// ---------------------------------------------------------------------------

export function daemonStatus(): void {
  const config = loadConfig();
  const pid = readPidFile(config.homeDir);

  if (!pid) {
    console.log("Daemon is not running (no PID file).");
    return;
  }

  if (isProcessRunning(pid)) {
    console.log(`Daemon is running (PID ${pid})`);
    console.log(`PID file: ${pidFilePath(config.homeDir)}`);
  } else {
    console.log(`Daemon PID ${pid} is not running (stale PID file).`);
    console.log(`Run \`happy-agent daemon stop\` to clean up.`);
  }
}
