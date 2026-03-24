/**
 * Tailscale detection utility.
 *
 * Detects whether Tailscale is installed and running,
 * and extracts IP / MagicDNS hostname for remote access.
 */

import { execFile } from "child_process";
import { logger } from "@/ui/logger";

export type TailscaleStatus = "connected" | "disconnected" | "not-installed";

export type TailscaleInfo = {
  status: TailscaleStatus;
  ipv4?: string;
  ipv6?: string;
  hostname?: string;
  tailnetName?: string;
  version?: string;
};

const NOT_INSTALLED: TailscaleInfo = { status: "not-installed" };
const DISCONNECTED: TailscaleInfo = { status: "disconnected" };

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
  const json = JSON.parse(raw);

  // `tailscale status --json` may return BackendState = "NeedsLogin" / "Stopped"
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

  // DNSName is like "my-box.tail1234.ts.net." (trailing dot)
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

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
