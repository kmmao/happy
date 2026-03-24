/**
 * Tailscale tunnel provider for happy-agent.
 */

import type { TunnelProviderInfo, TunnelEntry } from "@kmmao/happy-wire";
import type { TunnelProvider, TunnelAddParams, TunnelRemoveParams, TunnelOpResult } from "../types";
import { detectTailscale, detectTailscaleServe } from "@/utils/tailscale";
import { logger } from "@/logger";
import { execFile } from "child_process";

const EXEC_TIMEOUT_MS = 10_000;

export class TailscaleProvider implements TunnelProvider {
  readonly name = "tailscale";

  async detect(): Promise<TunnelProviderInfo> {
    const base = await detectTailscale();

    if (base.status === "not-installed") {
      return { provider: this.name, status: "not-installed", entries: [] };
    }
    if (base.status === "disconnected") {
      return { provider: this.name, status: "unavailable", entries: [] };
    }

    const serves = await detectTailscaleServe();
    const entries: TunnelEntry[] = serves.map((s) => ({
      provider: this.name,
      localPort: extractLocalPort(s.target),
      remotePort: s.port,
      protocol: s.protocol,
      path: s.path,
      target: s.target,
      publicUrl: buildPublicUrl(s),
      accessScope: s.funnel ? "public" : "tailnet",
      hostname: s.hostname,
    }));

    return {
      provider: this.name,
      status: "available",
      version: base.version,
      entries,
      metadata: {
        ...(base.ipv4 ? { ipv4: base.ipv4 } : {}),
        ...(base.ipv6 ? { ipv6: base.ipv6 } : {}),
        ...(base.hostname ? { hostname: base.hostname } : {}),
        ...(base.tailnetName ? { tailnetName: base.tailnetName } : {}),
      },
    };
  }

  async add(params: TunnelAddParams): Promise<TunnelOpResult> {
    const { localPort, remotePort, path, publicAccess } = params;
    const httpsPort = remotePort ?? 443;
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    const target = `http://localhost:${localPort}`;
    const base = publicAccess ? "tailscale funnel" : "tailscale serve";
    const cmd = `${base} --bg --https=${httpsPort}${pathFlag} ${target}`;
    return this.exec(cmd);
  }

  async remove(params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const { remotePort, path } = params;
    if (!remotePort) return { success: false, error: "remotePort required for Tailscale" };
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    const cmd = `tailscale serve --https=${remotePort}${pathFlag} off`;
    return this.exec(cmd);
  }

  async toggleAccess(entry: TunnelEntry, publicAccess: boolean): Promise<TunnelOpResult> {
    const httpsPort = entry.remotePort ?? 443;
    const pathFlag = entry.path && entry.path !== "/" ? ` --set-path=${entry.path}` : "";
    const base = publicAccess ? "tailscale funnel" : "tailscale serve";
    const cmd = `${base} --bg --https=${httpsPort}${pathFlag} ${entry.target}`;
    return this.exec(cmd);
  }

  private exec(cmd: string): Promise<TunnelOpResult> {
    const [binary, ...args] = cmd.split(" ").filter(Boolean);
    return new Promise((resolve) => {
      execFile(binary, args, { timeout: EXEC_TIMEOUT_MS }, (err, _stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          logger.debug(`[TUNNEL:tailscale] command failed: ${cmd} — ${msg}`);
          resolve({ success: false, error: msg });
        } else {
          resolve({ success: true });
        }
      });
    });
  }
}

function extractLocalPort(target: string): number {
  const match = target.match(/:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function buildPublicUrl(serve: { hostname: string; port: number; path?: string; funnel: boolean }): string {
  const portSuffix = serve.port === 443 ? "" : `:${serve.port}`;
  const pathSuffix = !serve.path || serve.path === "/" ? "/" : serve.path;
  return `https://${serve.hostname}${portSuffix}${pathSuffix}`;
}
