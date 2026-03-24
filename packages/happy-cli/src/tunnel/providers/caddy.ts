/**
 * Caddy tunnel provider — uses Caddy Admin API for HTTPS reverse proxy management.
 *
 * Caddy automatically handles Let's Encrypt certificates.
 * Routes are managed via the Caddy REST API (default: localhost:2019).
 */

import type { TunnelProviderInfo, TunnelEntry } from "@kmmao/happy-wire";
import type { TunnelProvider, TunnelAddParams, TunnelRemoveParams, TunnelOpResult } from "../types";
import { logger } from "@/ui/logger";
import http from "http";

const DEFAULT_ADMIN_URL = "http://127.0.0.1:2019";
const REQUEST_TIMEOUT_MS = 5_000;

export class CaddyProvider implements TunnelProvider {
  readonly name = "caddy";
  private adminUrl: string;

  constructor(adminUrl = DEFAULT_ADMIN_URL) {
    this.adminUrl = adminUrl;
  }

  async detect(): Promise<TunnelProviderInfo> {
    try {
      const config = await this.apiGet("/config/");
      if (!config) {
        return { provider: this.name, status: "unavailable", entries: [] };
      }

      const servers = config?.apps?.http?.servers ?? {};
      const entries: TunnelEntry[] = [];
      const httpsPort = config?.apps?.http?.https_port ?? 443;

      for (const [_name, server] of Object.entries(servers) as [string, any][]) {
        const routes = server?.routes ?? [];
        // Extract domain from terminal_host match
        const domain = extractDomain(routes);

        // Walk all routes to find reverse_proxy handlers, deduplicate by path+target
        const seen = new Set<string>();
        walkRoutes(routes, "", (path, upstream) => {
          const key = `${path}|${upstream}`;
          if (seen.has(key)) return;
          seen.add(key);
          const port = extractPort(upstream);
          entries.push({
            provider: this.name,
            localPort: port,
            remotePort: httpsPort,
            protocol: "HTTPS",
            path: path || "/",
            target: upstream,
            publicUrl: `https://${domain}${httpsPort === 443 ? "" : `:${httpsPort}`}${path || "/"}`,
            accessScope: "public",
            hostname: domain,
          });
        });
      }

      return {
        provider: this.name,
        status: "available",
        entries,
        metadata: {
          adminUrl: this.adminUrl,
          ...(entries[0]?.hostname ? { domain: entries[0].hostname } : {}),
        },
      };
    } catch (err) {
      const msg = String(err);
      const isConnRefused = msg.includes("ECONNREFUSED") || msg.includes("ENOENT");
      logger.debug(`[TUNNEL:caddy] detect failed: ${msg}`);
      return {
        provider: this.name,
        status: isConnRefused ? "not-installed" : "unavailable",
        entries: [],
      };
    }
  }

  async add(params: TunnelAddParams): Promise<TunnelOpResult> {
    // Read current Caddyfile, append new route, reload
    // Caddy API approach: POST a new route to the config
    const { localPort, path } = params;
    const mountPath = path && path !== "/" ? path : "";

    try {
      // Get current config to find the domain and server
      const config = await this.apiGet("/config/");
      const servers = config?.apps?.http?.servers ?? {};
      const serverName = Object.keys(servers)[0];
      if (!serverName) return { success: false, error: "No Caddy server configured" };

      const routes = servers[serverName]?.routes ?? [];
      if (routes.length === 0) return { success: false, error: "No routes configured" };

      // Find the main route (first one with subroute handler)
      const mainRoute = routes[0];
      const subroute = mainRoute?.handle?.[0];
      if (!subroute || subroute.handler !== "subroute") {
        return { success: false, error: "Unexpected Caddy config structure" };
      }

      // Build new route entry
      const newRoute = mountPath
        ? {
            group: `group_${mountPath.replace(/\//g, "_")}`,
            handle: [{
              handler: "subroute",
              routes: [
                { handle: [{ handler: "rewrite", strip_path_prefix: mountPath }] },
                { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `host.docker.internal:${localPort}` }] }] },
              ],
            }],
            match: [{ path: [`${mountPath}`, `${mountPath}/*`] }],
          }
        : {
            handle: [{
              handler: "subroute",
              routes: [
                { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `host.docker.internal:${localPort}` }] }] },
              ],
            }],
          };

      // Insert before the last (default) route
      const existingRoutes = subroute.routes ?? [];
      const insertIdx = mountPath ? existingRoutes.length - 1 : existingRoutes.length;
      existingRoutes.splice(Math.max(0, insertIdx), 0, newRoute);

      // PATCH the routes
      await this.apiPatch(
        `/config/apps/http/servers/${serverName}/routes/0/handle/0/routes`,
        existingRoutes,
      );

      return { success: true };
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] add failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  async remove(params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const { path } = params;
    if (!path || path === "/") return { success: false, error: "Cannot remove the default route" };

    try {
      const config = await this.apiGet("/config/");
      const servers = config?.apps?.http?.servers ?? {};
      const serverName = Object.keys(servers)[0];
      if (!serverName) return { success: false, error: "No server" };

      const mainRoute = servers[serverName]?.routes?.[0];
      const subroute = mainRoute?.handle?.[0];
      if (!subroute) return { success: false, error: "No subroute" };

      const routes: any[] = subroute.routes ?? [];
      const filtered = routes.filter((r: any) => {
        const matchers = r?.match ?? [];
        for (const m of matchers) {
          const paths: string[] = m?.path ?? [];
          if (paths.includes(path) || paths.includes(`${path}/*`)) return false;
        }
        return true;
      });

      if (filtered.length === routes.length) {
        return { success: false, error: `Route ${path} not found` };
      }

      await this.apiPatch(
        `/config/apps/http/servers/${serverName}/routes/0/handle/0/routes`,
        filtered,
      );

      return { success: true };
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] remove failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  // Caddy routes are always public HTTPS — no toggle needed

  // ---------------------------------------------------------------------------
  // Admin API helpers
  // ---------------------------------------------------------------------------

  private apiGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.adminUrl);
      const req = http.get(url.toString(), { timeout: REQUEST_TIMEOUT_MS }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    });
  }

  private apiPatch(path: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.adminUrl);
      const body = JSON.stringify(data);
      const req = http.request(url.toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: REQUEST_TIMEOUT_MS,
      }, (res) => {
        let respBody = "";
        res.on("data", (chunk) => { respBody += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Caddy API ${res.statusCode}: ${respBody}`));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body);
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Config parsing helpers
// ---------------------------------------------------------------------------

function extractDomain(routes: any[]): string {
  for (const route of routes) {
    const matchers = route?.match ?? [];
    for (const m of matchers) {
      const hosts: string[] = m?.host ?? [];
      if (hosts.length > 0) return hosts[0];
    }
  }
  return "localhost";
}

function extractPort(dial: string): number {
  const match = dial.match(/:(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function walkRoutes(
  routes: any[],
  currentPath: string,
  onProxy: (path: string, upstream: string) => void,
): void {
  for (const route of routes) {
    // Check for path matcher
    let routePath = currentPath;
    const matchers = route?.match ?? [];
    for (const m of matchers) {
      const paths: string[] = m?.path ?? [];
      // Prefer non-wildcard path, fallback to stripping /* from wildcard
      const nonWild = paths.find((p: string) => !p.endsWith("/*"));
      if (nonWild) {
        routePath = nonWild;
      } else {
        const wild = paths.find((p: string) => p.endsWith("/*"));
        if (wild) routePath = wild.slice(0, -2);
      }
    }

    const handlers = route?.handle ?? [];
    for (const handler of handlers) {
      if (handler.handler === "reverse_proxy") {
        const upstreams = handler.upstreams ?? [];
        if (upstreams.length > 0) {
          onProxy(routePath, upstreams[0].dial ?? "unknown");
        }
      } else if (handler.handler === "subroute") {
        walkRoutes(handler.routes ?? [], routePath, onProxy);
      }
    }
  }
}
