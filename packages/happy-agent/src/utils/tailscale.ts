/**
 * Tailscale detection utility for happy-agent.
 *
 * Thin I/O wrapper around the shared parsing logic in @kmmao/happy-wire.
 * The parsing functions and type definitions live there so happy-cli
 * can use the same implementation without duplication.
 */

import { execFile } from "child_process";
import {
  parseTailscaleStatus,
  parseTailscaleServeStatus,
  isTailscaleNotFound,
} from "@kmmao/happy-wire";
import { logger } from "@/logger";

export type { TailscaleStatus, TailscaleServeEntry, TailscaleInfo } from "@kmmao/happy-wire";

const NOT_INSTALLED = Object.freeze({ status: "not-installed" as const });
const DISCONNECTED = Object.freeze({ status: "disconnected" as const });
const DETECT_TIMEOUT_MS = 3_000;

/**
 * Run `tailscale status --json` and parse the Self node.
 * Returns a TailscaleInfo — never throws.
 */
export async function detectTailscale() {
  try {
    const raw = await execTailscale(["status", "--json"]);
    return parseTailscaleStatus(raw, (msg) => logger.debug(msg));
  } catch (err: unknown) {
    if (isTailscaleNotFound(err)) {
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
export async function detectTailscaleServe() {
  try {
    const raw = await execTailscale(["serve", "status", "--json"]);
    return parseTailscaleServeStatus(raw, (msg) => logger.debug(msg));
  } catch (err: unknown) {
    logger.debug(`[TAILSCALE] serve detection failed: ${String(err)}`);
    return [];
  }
}

function execTailscale(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tailscale", args, { timeout: DETECT_TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}
