/**
 * Caddy tunnel provider — uses Caddy Admin API for HTTPS reverse proxy management.
 *
 * Supports multiple domains. Each domain is a separate route in Caddy's config
 * with its own host matcher and subroute handlers.
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
      const httpsPort = config?.apps?.http?.https_port ?? 443;
      const entries: TunnelEntry[] = [];
      const domains: string[] = [];

      for (const [_name, server] of Object.entries(servers) as [string, any][]) {
        const routes: any[] = server?.routes ?? [];

        for (const route of routes) {
          // Extract domain from host match
          const hostMatch = (route?.match ?? []).find((m: any) => m?.host?.length > 0);
          const domain = hostMatch?.host?.[0] ?? "localhost";
          if (!domains.includes(domain)) domains.push(domain);

          // Walk subroute handlers for this domain
          const handlers = route?.handle ?? [];
          const seen = new Set<string>();

          for (const handler of handlers) {
            if (handler.handler === "subroute") {
              walkRoutes(handler.routes ?? [], "", (path, upstream) => {
                const key = `${domain}|${path}|${upstream}`;
                if (seen.has(key)) return;
                seen.add(key);
                entries.push({
                  provider: this.name,
                  localPort: extractPort(upstream),
                  remotePort: httpsPort,
                  protocol: "HTTPS",
                  path: path || "/",
                  target: upstream,
                  publicUrl: `https://${domain}${httpsPort === 443 ? "" : `:${httpsPort}`}${path && path !== "/" ? path : ""}`,
                  accessScope: "public",
                  hostname: domain,
                });
              });
            }
          }
        }
      }

      return {
        provider: this.name,
        status: "available",
        entries,
        metadata: {
          adminUrl: this.adminUrl,
          domains: domains.join(","),
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
    const { localPort, path, hostname } = params;
    if (!hostname) return { success: false, error: "hostname required" };
    const mountPath = path && path !== "/" ? path : "";

    try {
      const config = await this.apiGet("/config/");
      const servers = config?.apps?.http?.servers ?? {};
      const serverName = Object.keys(servers)[0];
      if (!serverName) return { success: false, error: "No Caddy server configured" };

      const routes: any[] = servers[serverName]?.routes ?? [];

      // Find existing route for this hostname
      const routeIdx = routes.findIndex((r: any) =>
        (r?.match ?? []).some((m: any) => (m?.host ?? []).includes(hostname)),
      );

      if (routeIdx >= 0) {
        // Add path to existing domain
        const subroute = routes[routeIdx]?.handle?.[0];
        if (!subroute || subroute.handler !== "subroute") {
          return { success: false, error: "Unexpected config structure" };
        }

        const subRoutes: any[] = subroute.routes ?? [];
        const newRoute = buildPathRoute(mountPath, localPort);
        // Insert before last (default) route
        const insertIdx = mountPath ? Math.max(0, subRoutes.length - 1) : subRoutes.length;
        subRoutes.splice(insertIdx, 0, newRoute);

        await this.apiPatch(
          `/config/apps/http/servers/${serverName}/routes/${routeIdx}/handle/0/routes`,
          subRoutes,
        );
      } else {
        // Create new domain site
        const tlsPolicy = this.extractTlsPolicy(config);
        const newSiteRoute = buildSiteRoute(hostname, localPort, mountPath);
        routes.push(newSiteRoute);

        await this.apiPatch(
          `/config/apps/http/servers/${serverName}/routes`,
          routes,
        );

        // Add TLS automation policy for new domain if we have a template
        if (tlsPolicy) {
          await this.addTlsPolicy(config, hostname);
        }
      }

      return { success: true };
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] add failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  async remove(params: TunnelRemoveParams): Promise<TunnelOpResult> {
    const { path, hostname, removeEntireSite } = params;
    if (!hostname) return { success: false, error: "hostname required" };

    try {
      const config = await this.apiGet("/config/");
      const servers = config?.apps?.http?.servers ?? {};
      const serverName = Object.keys(servers)[0];
      if (!serverName) return { success: false, error: "No server" };

      const routes: any[] = servers[serverName]?.routes ?? [];
      const routeIdx = routes.findIndex((r: any) =>
        (r?.match ?? []).some((m: any) => (m?.host ?? []).includes(hostname)),
      );

      if (routeIdx < 0) return { success: false, error: `Domain ${hostname} not found` };

      if (removeEntireSite) {
        // Remove entire domain route
        routes.splice(routeIdx, 1);
        await this.apiPatch(
          `/config/apps/http/servers/${serverName}/routes`,
          routes,
        );
        // Clean up TLS policy
        await this.removeTlsPolicy(config, hostname);
      } else {
        // Remove single path from domain
        if (!path || path === "/") return { success: false, error: "Cannot remove default route" };

        const subroute = routes[routeIdx]?.handle?.[0];
        if (!subroute) return { success: false, error: "No subroute" };

        const subRoutes: any[] = subroute.routes ?? [];
        const filtered = subRoutes.filter((r: any) => {
          for (const m of r?.match ?? []) {
            const paths: string[] = m?.path ?? [];
            if (paths.includes(path) || paths.includes(`${path}/*`)) return false;
          }
          return true;
        });

        if (filtered.length === subRoutes.length) {
          return { success: false, error: `Route ${path} not found` };
        }

        await this.apiPatch(
          `/config/apps/http/servers/${serverName}/routes/${routeIdx}/handle/0/routes`,
          filtered,
        );
      }

      return { success: true };
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] remove failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  // ---------------------------------------------------------------------------
  // TLS policy management
  // ---------------------------------------------------------------------------

  private extractTlsPolicy(config: any): any | null {
    const policies: any[] = config?.apps?.tls?.automation?.policies ?? [];
    // Find a policy with DNS challenge (cloudflare)
    return policies.find((p: any) =>
      p?.issuers?.some((i: any) => i?.challenges?.dns),
    ) ?? null;
  }

  private async addTlsPolicy(config: any, hostname: string): Promise<void> {
    try {
      const policies: any[] = config?.apps?.tls?.automation?.policies ?? [];
      const template = this.extractTlsPolicy(config);
      if (!template) return;

      // Clone template with new hostname
      const newPolicy = JSON.parse(JSON.stringify(template));
      newPolicy.subjects = [hostname];
      policies.push(newPolicy);

      await this.apiPatch("/config/apps/tls/automation/policies", policies);
      logger.debug(`[TUNNEL:caddy] Added TLS policy for ${hostname}`);
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] TLS policy add failed (non-fatal): ${String(err)}`);
    }
  }

  private async removeTlsPolicy(config: any, hostname: string): Promise<void> {
    try {
      const policies: any[] = config?.apps?.tls?.automation?.policies ?? [];
      const filtered = policies.filter((p: any) => {
        const subjects: string[] = p?.subjects ?? [];
        return !subjects.includes(hostname);
      });
      if (filtered.length < policies.length) {
        await this.apiPatch("/config/apps/tls/automation/policies", filtered);
        logger.debug(`[TUNNEL:caddy] Removed TLS policy for ${hostname}`);
      }
    } catch (err) {
      logger.debug(`[TUNNEL:caddy] TLS policy remove failed (non-fatal): ${String(err)}`);
    }
  }

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
// Route builders
// ---------------------------------------------------------------------------

function buildPathRoute(mountPath: string, localPort: number): any {
  if (mountPath) {
    return {
      group: `group_${mountPath.replace(/\//g, "_")}`,
      handle: [{
        handler: "subroute",
        routes: [
          { handle: [{ handler: "rewrite", strip_path_prefix: mountPath }] },
          { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `host.docker.internal:${localPort}` }] }] },
        ],
      }],
      match: [{ path: [mountPath, `${mountPath}/*`] }],
    };
  }
  return {
    handle: [{
      handler: "subroute",
      routes: [
        { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `host.docker.internal:${localPort}` }] }] },
      ],
    }],
  };
}

function buildSiteRoute(hostname: string, localPort: number, mountPath: string): any {
  const subRoutes = [];
  if (mountPath) {
    subRoutes.push(buildPathRoute(mountPath, localPort));
  }
  // Default route
  subRoutes.push({
    handle: [{
      handler: "subroute",
      routes: [
        { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `host.docker.internal:${localPort}` }] }] },
      ],
    }],
  });

  return {
    match: [{ host: [hostname] }],
    handle: [{
      handler: "subroute",
      routes: subRoutes,
    }],
    terminal: true,
  };
}

// ---------------------------------------------------------------------------
// Config parsing helpers
// ---------------------------------------------------------------------------

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
    let routePath = currentPath;
    for (const m of route?.match ?? []) {
      const paths: string[] = m?.path ?? [];
      const nonWild = paths.find((p: string) => !p.endsWith("/*"));
      if (nonWild) {
        routePath = nonWild;
      } else {
        const wild = paths.find((p: string) => p.endsWith("/*"));
        if (wild) routePath = wild.slice(0, -2);
      }
    }

    for (const handler of route?.handle ?? []) {
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
