/**
 * Tailscale detection utility for happy-agent.
 *
 * Adapted from happy-cli/src/utils/tailscale.ts — keep in sync.
 */

import { execFile } from "child_process";
import { logger } from "@/logger";

export type TailscaleStatus = "connected" | "disconnected" | "not-installed";

export type TailscaleServeEntry = {
  port: number;
  protocol: string;
  target: string;
  funnel: boolean;
  hostname: string;
};

export type TailscaleInfo = {
  status: TailscaleStatus;
  ipv4?: string;
  ipv6?: string;
  hostname?: string;
  tailnetName?: string;
  version?: string;
  serves?: TailscaleServeEntry[];
};

const NOT_INSTALLED: Readonly<TailscaleInfo> = Object.freeze({ status: "not-installed" as const });
const DISCONNECTED: Readonly<TailscaleInfo> = Object.freeze({ status: "disconnected" as const });

const DETECT_TIMEOUT_MS = 3_000;

/**
 * Run `tailscale status --json` and parse the Self node.
 * Returns a TailscaleInfo — never throws.
 */
export async function detectTailscale(): Promise<TailscaleInfo> {
  try {
    const raw = await execTailscale(["status", "--json"]);
    return parseTailscaleStatus(raw);
  } catch (err: unknown) {
    if (isNotFound(err)) {
      logger.debug("[TAILSCALE] tailscale binary not found");
      return NOT_INSTALLED;
    }
    logger.debug(`[TAILSCALE] detection failed: ${String(err)}`);
    return DISCONNECTED;
  }
}

/**
 * Run `tailscale serve status --json` and parse active Serve/Funnel entries.
 * Returns an empty array on any failure — never throws.
 */
export async function detectTailscaleServe(): Promise<TailscaleServeEntry[]> {
  try {
    const raw = await execTailscale(["serve", "status", "--json"]);
    return parseTailscaleServeStatus(raw);
  } catch (err: unknown) {
    logger.debug(`[TAILSCALE] serve detection failed: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function execTailscale(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tailscale", args, { timeout: DETECT_TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function parseTailscaleStatus(raw: string): TailscaleInfo {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    logger.debug("[TAILSCALE] failed to parse status JSON");
    return DISCONNECTED;
  }

  const backendState: string | undefined = json.BackendState;
  if (backendState && backendState !== "Running") {
    logger.debug(`[TAILSCALE] backend state: ${backendState}`);
    return DISCONNECTED;
  }

  const self = json.Self;
  if (!self) {
    logger.debug("[TAILSCALE] no Self node in status output");
    return DISCONNECTED;
  }

  const ips: string[] = self.TailscaleIPs ?? [];
  const ipv4 = ips.find((ip: string) => ip.includes("."));
  const ipv6 = ips.find((ip: string) => ip.includes(":"));

  const dnsName: string | undefined = self.DNSName;
  const hostname = dnsName?.replace(/\.$/, "").split(".")[0];
  const tailnetName = dnsName
    ? dnsName.replace(/\.$/, "").split(".").slice(1).join(".")
    : undefined;

  const version: string | undefined = json.Version;

  logger.debug(
    `[TAILSCALE] detected: ipv4=${ipv4 ?? "none"}, hostname=${hostname ?? "none"}`,
  );

  return {
    status: "connected",
    ipv4,
    ipv6,
    hostname,
    tailnetName,
    version,
  };
}

function parseTailscaleServeStatus(raw: string): TailscaleServeEntry[] {
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    logger.debug("[TAILSCALE] failed to parse serve status JSON");
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
    const rootHandler = handlers["/"];
    const target = rootHandler?.Proxy ?? "unknown";
    const funnel = allowFunnel[hostPort] === true;

    entries.push({ port, protocol: "HTTPS", target, funnel, hostname });
  }

  logger.debug(`[TAILSCALE] detected ${entries.length} serve entries`);
  return entries;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
