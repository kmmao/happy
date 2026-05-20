/**
 * UPnP/NAT-PMP tunnel provider — uses miniupnpc CLI (upnpc) for port mapping.
 *
 * Requirements: `brew install miniupnpc` (macOS) or `apt install miniupnpc` (Linux)
 *
 * UPnP mappings have a lease duration. The TunnelManager handles periodic
 * renewal by re-adding mappings before they expire.
 */

import type { TunnelProviderInfo, TunnelEntry } from "@kmmao/happy-wire";
import type { TunnelProvider, TunnelAddParams, TunnelRemoveParams, TunnelOpResult } from "../types";
import { logger } from "@/ui/logger";
import { execFile } from "child_process";
import * as os from "os";

const EXEC_TIMEOUT_MS = 10_000;
const DEFAULT_LEASE_SECONDS = 7200; // 2 hours
const UPNPC_BINARY = "upnpc";
const DESCRIPTION_PREFIX = "happy-tunnel";

export class UpnpProvider implements TunnelProvider {
  readonly name = "upnp";

  async detect(): Promise<TunnelProviderInfo> {
    // Check if upnpc is available
    const statusResult = await this.execUpnpc(["-s"]);
    if (!statusResult.success) {
      const notInstalled = statusResult.error?.includes("ENOENT") || statusResult.error?.includes("not found");
      return {
        provider: this.name,
        status: notInstalled ? "not-installed" : "unavailable",
        entries: [],
        metadata: notInstalled ? { hint: "Install: brew install miniupnpc" } : undefined,
      };
    }

    // Parse external IP from status output
    const externalIp = parseExternalIp(statusResult.stdout ?? "");
    if (!externalIp) {
      return { provider: this.name, status: "unavailable", entries: [] };
    }

    // List current mappings
    const listResult = await this.execUpnpc(["-l"]);
    if (!listResult.success) {
      return {
        provider: this.name,
        status: "available",
        entries: [],
        metadata: { externalIp },
      };
    }

    const localIp = getLocalIp();
    const allMappings = parseMappingList(listResult.stdout ?? "");
    // Show mappings created by Happy OR pointing to this machine
    const entries: TunnelEntry[] = allMappings
      .filter((m) => m.description.startsWith(DESCRIPTION_PREFIX) || m.internalIp === localIp)
      .map((m) => ({
        provider: this.name,
        localPort: m.internalPort,
        remotePort: m.externalPort,
        protocol: m.protocol,
        target: `${m.internalIp}:${m.internalPort}`,
        publicUrl: `http://${externalIp}:${m.externalPort}`,
        accessScope: "public" as const,
        metadata: {
          description: m.description,
          ...(m.leaseTime > 0 ? { leaseSeconds: String(m.leaseTime) } : {}),
        },
      }));

    return {
      provider: this.name,
      status: "available",
      entries,
      metadata: { externalIp },
    };
  }

  async add(params: TunnelAddParams): Promise<TunnelOpResult> {
    const { localPort, remotePort, protocol } = params;
    const externalPort = remotePort ?? localPort;
    const proto = (protocol ?? "TCP").toUpperCase();
    const localIp = getLocalIp();
    if (!localIp) return { success: false, error: "Cannot determine local IP" };

    `${DESCRIPTION_PREFIX}-${proto.toLowerCase()}-${externalPort}`;
    // upnpc -a <localIp> <localPort> <externalPort> <protocol> <lease>
    const result = await this.execUpnpc([
      "-a", localIp,
      String(localPort),
      String(externalPort),
      proto,
      String(DEFAULT_LEASE_SECONDS),
    ]);

    if (!result.success) return result;

    // Verify mapping was created
    if (result.stdout?.includes("is redirected to")) {
      return { success: true };
    }
    return { success: false, error: result.stdout ?? "Unknown error" };
  }

  async remove(params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const { remotePort, localPort } = params;
    const externalPort = remotePort ?? localPort;
    if (!externalPort) return { success: false, error: "Port required" };

    // Try TCP first, then UDP
    const tcpResult = await this.execUpnpc(["-d", String(externalPort), "TCP"]);
    const udpResult = await this.execUpnpc(["-d", String(externalPort), "UDP"]);

    if (tcpResult.success || udpResult.success) {
      return { success: true };
    }
    return { success: false, error: tcpResult.error ?? udpResult.error ?? "Failed to remove mapping" };
  }

  // UPnP doesn't have public/private toggle — mappings are always public
  // toggleAccess is not implemented

  // ---------------------------------------------------------------------------
  // Lease renewal — called by TunnelManager periodically
  // ---------------------------------------------------------------------------

  /** Re-add all Happy-managed mappings to extend their lease */
  async renewLeases(): Promise<void> {
    const info = await this.detect();
    if (info.status !== "available") return;

    for (const entry of info.entries) {
      if (!entry.remotePort) continue;
      const localIp = getLocalIp();
      if (!localIp) continue;

      await this.execUpnpc([
        "-a", localIp,
        String(entry.localPort),
        String(entry.remotePort),
        entry.protocol,
        String(DEFAULT_LEASE_SECONDS),
      ]);
      logger.debug(`[TUNNEL:upnp] Renewed lease: ${entry.remotePort} ${entry.protocol} → ${localIp}:${entry.localPort}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private execUpnpc(args: string[]): Promise<TunnelOpResult & { stdout?: string }> {
    return new Promise((resolve) => {
      execFile(UPNPC_BINARY, args, { timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) {
          const isNotFound = (err as NodeJS.ErrnoException).code === "ENOENT";
          const msg = isNotFound ? "upnpc not found (ENOENT)" : (stderr?.trim() || err.message);
          logger.debug(`[TUNNEL:upnp] command failed: upnpc ${args.join(" ")} — ${msg}`);
          resolve({ success: false, error: msg, stdout });
        } else {
          resolve({ success: true, stdout });
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseExternalIp(output: string): string | undefined {
  const match = output.match(/ExternalIPAddress\s*=\s*([\d.]+)/);
  return match?.[1];
}

interface UpnpMapping {
  protocol: string;
  externalPort: number;
  internalIp: string;
  internalPort: number;
  description: string;
  leaseTime: number;
}

function parseMappingList(output: string): UpnpMapping[] {
  const mappings: UpnpMapping[] = [];
  // Format: " N protocol exPort->inAddr:inPort 'description' 'remoteHost' leaseTime"
  const regex = /^\s*\d+\s+(TCP|UDP)\s+(\d+)->([^:]+):(\d+)\s+'([^']*)'\s+'[^']*'\s+(\d+)/gm;
  let match;
  while ((match = regex.exec(output)) !== null) {
    mappings.push({
      protocol: match[1],
      externalPort: parseInt(match[2], 10),
      internalIp: match[3],
      internalPort: parseInt(match[4], 10),
      description: match[5],
      leaseTime: parseInt(match[6], 10),
    });
  }
  return mappings;
}

function getLocalIp(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return undefined;
}
