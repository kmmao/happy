import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Reconnection gating probes for the CLI's self-managed WebSocket reconnect.
 *
 * Mac lid-close (and Power Nap) drops WiFi but keeps the CPU briefly alive, so
 * socket.io's built-in auto-reconnect can latch onto the 1–3s WiFi blips during
 * sleep and register zombie "connected-but-unreachable" sessions on the server.
 * Instead we gate reconnection on three independently testable probes:
 *
 *  - network connectivity: a non-internal IPv4 address exists;
 *  - lid state (macOS): `ioreg` reports the clamshell closed;
 *  - external display (macOS): a non-built-in display is attached.
 *
 * Combined: reconnect only when the network is up AND we are not in the
 * "lid closed without an external display" state. Lid-closed *with* an external
 * display is clamshell mode — a normal working state, so reconnection proceeds.
 * On non-macOS platforms the lid probe is always false, so only network matters.
 */

const execFileAsync = promisify(execFile);

/** True when at least one non-internal IPv4 interface is up. */
export function hasNetworkConnectivity(): boolean {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when the macOS lid is closed. Non-darwin platforms always return false
 * (no lid concept), which keeps the combined gate network-only off macOS.
 */
export async function isLidClosed(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync("ioreg", [
      "-r",
      "-k",
      "AppleClamshellState",
    ]);
    return /"AppleClamshellState"\s*=\s*Yes/.test(stdout);
  } catch {
    // If the probe fails, assume the lid is open rather than blocking reconnect.
    return false;
  }
}

/** True when a non-built-in display is attached (macOS only). */
export async function hasExternalDisplay(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync("system_profiler", [
      "SPDisplaysDataType",
      "-json",
    ]);
    const parsed = JSON.parse(stdout) as {
      SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: unknown[] }>;
    };
    const gpus = Array.isArray(parsed.SPDisplaysDataType)
      ? parsed.SPDisplaysDataType
      : [];
    for (const gpu of gpus) {
      const displays = Array.isArray(gpu?.spdisplays_ndrvs)
        ? gpu.spdisplays_ndrvs
        : [];
      for (const display of displays as Array<Record<string, unknown>>) {
        const connection = display?.spdisplays_connection_type;
        const builtIn = display?.["spdisplays_built-in"];
        const isInternal =
          connection === "spdisplays_internal" || builtIn === "spdisplays_yes";
        if (!isInternal) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Composite gate: reconnect only when the network is up and we are not in the
 * "lid closed without external display" state.
 */
export async function shouldReconnect(): Promise<boolean> {
  if (!hasNetworkConnectivity()) {
    return false;
  }
  const [lidClosed, externalDisplay] = await Promise.all([
    isLidClosed(),
    hasExternalDisplay(),
  ]);
  return !lidClosed || externalDisplay;
}
