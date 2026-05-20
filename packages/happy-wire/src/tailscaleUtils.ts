/**
 * Pure Tailscale parsing utilities — no I/O, no Node.js built-ins.
 * Safe for all environments (Node.js, React Native, etc.).
 *
 * Shared between happy-cli and happy-agent so both packages use a
 * single implementation and never drift out of sync.
 */

import type { TailscaleInfo, TailscaleServeEntry } from "./machineTypes";

const DISCONNECTED: Readonly<TailscaleInfo> = Object.freeze({ status: "disconnected" as const });

/**
 * Parse the JSON output of `tailscale status --json`.
 *
 * @param log - Optional debug callback (called with `[TAILSCALE] …` messages).
 */
export function parseTailscaleStatus(
  raw: string,
  log?: (msg: string) => void,
): TailscaleInfo {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    log?.("[TAILSCALE] failed to parse status JSON");
    return DISCONNECTED;
  }

  // `tailscale status --json` may return BackendState = "NeedsLogin" / "Stopped"
  const backendState: string | undefined = json.BackendState;
  if (backendState && backendState !== "Running") {
    log?.(`[TAILSCALE] backend state: ${backendState}`);
    return DISCONNECTED;
  }

  const self = json.Self;
  if (!self) {
    log?.("[TAILSCALE] no Self node in status output");
    return DISCONNECTED;
  }

  const ips: string[] = self.TailscaleIPs ?? [];
  const ipv4 = ips.find((ip: string) => ip.includes("."));
  const ipv6 = ips.find((ip: string) => ip.includes(":"));

  // DNSName is like "my-box.tail1234.ts.net." (trailing dot)
  const dnsName: string | undefined = self.DNSName;
  const hostname = dnsName?.replace(/\.$/, "").split(".")[0];
  const tailnetName = dnsName
    ? dnsName.replace(/\.$/, "").split(".").slice(1).join(".")
    : undefined;

  const version: string | undefined = json.Version;

  log?.(`[TAILSCALE] detected: ipv4=${ipv4 ?? "none"}, hostname=${hostname ?? "none"}`);

  return {
    status: "connected",
    ipv4,
    ipv6,
    hostname,
    tailnetName,
    version,
  };
}

/**
 * Parse the JSON output of `tailscale serve status --json`.
 *
 * @param log - Optional debug callback.
 */
export function parseTailscaleServeStatus(
  raw: string,
  log?: (msg: string) => void,
): TailscaleServeEntry[] {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    log?.("[TAILSCALE] failed to parse serve status JSON");
    return [];
  }

  const web: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> =
    json.Web ?? {};
  const allowFunnel: Record<string, boolean> = json.AllowFunnel ?? {};
  const entries: TailscaleServeEntry[] = [];

  for (const [hostPort, config] of Object.entries(web)) {
    const colonIdx = hostPort.lastIndexOf(":");
    if (colonIdx === -1) continue;

    const hostname = hostPort.slice(0, colonIdx);
    const port = parseInt(hostPort.slice(colonIdx + 1), 10);
    if (!Number.isFinite(port)) continue;

    const handlers = config.Handlers ?? {};
    const funnel = allowFunnel[hostPort] === true;

    for (const [path, handler] of Object.entries(handlers)) {
      const target = handler?.Proxy ?? "unknown";
      entries.push({ port, path, protocol: "HTTPS", target, funnel, hostname });
    }
  }

  log?.(`[TAILSCALE] detected ${entries.length} serve entries`);
  return entries;
}

/**
 * Returns true if the error indicates the tailscale binary was not found (ENOENT).
 */
export function isTailscaleNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
