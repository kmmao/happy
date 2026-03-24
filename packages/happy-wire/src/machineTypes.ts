/**
 * Machine-related Zod schemas shared across CLI, Agent, and Server.
 *
 * Single source of truth for MachineMetadata, DaemonState,
 * and Tailscale types. All packages import from here.
 */

import * as z from "zod";

// ---------------------------------------------------------------------------
// Machine metadata — static information (rarely changes)
// ---------------------------------------------------------------------------

export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  happyCliVersion: z.string(),
  homeDir: z.string(),
  happyHomeDir: z.string(),
  happyLibDir: z.string(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

// ---------------------------------------------------------------------------
// Tailscale
// ---------------------------------------------------------------------------

export const TailscaleServeEntrySchema = z.object({
  port: z.number(),
  path: z.string().optional(),
  protocol: z.string(),
  target: z.string(),
  funnel: z.boolean(),
  hostname: z.string(),
});

export type TailscaleServeEntry = z.infer<typeof TailscaleServeEntrySchema>;

export const TailscaleInfoSchema = z.object({
  status: z.enum(["connected", "disconnected", "not-installed"]),
  ipv4: z.string().optional(),
  ipv6: z.string().optional(),
  hostname: z.string().optional(),
  tailnetName: z.string().optional(),
  version: z.string().optional(),
  serves: z.array(TailscaleServeEntrySchema).optional(),
});

export type TailscaleInfo = z.infer<typeof TailscaleInfoSchema>;

// ---------------------------------------------------------------------------
// Tunnel — unified multi-provider tunnel abstraction
// ---------------------------------------------------------------------------

export const TunnelEntrySchema = z.object({
  /** Provider identifier: "tailscale" | "upnp" | "cloudflare" | "frp" */
  provider: z.string(),
  /** Local port the service is running on */
  localPort: z.number(),
  /** Remote/public port (e.g. UPnP external port, Tailscale HTTPS port) */
  remotePort: z.number().optional(),
  /** Protocol: "HTTPS" | "HTTP" | "TCP" | "UDP" */
  protocol: z.string(),
  /** Mount path (Tailscale serve path, e.g. "/api") */
  path: z.string().optional(),
  /** Proxy target URL "http://127.0.0.1:3000" */
  target: z.string(),
  /** Full public access URL if available */
  publicUrl: z.string().optional(),
  /** Access scope */
  accessScope: z.enum(["public", "private", "tailnet"]),
  /** Hostname (Tailscale MagicDNS, Cloudflare domain, etc.) */
  hostname: z.string().optional(),
  /** Provider-specific extra info */
  metadata: z.record(z.string(), z.string()).optional(),
});

export type TunnelEntry = z.infer<typeof TunnelEntrySchema>;

export const TunnelProviderInfoSchema = z.object({
  provider: z.string(),
  status: z.enum(["available", "unavailable", "not-installed"]),
  version: z.string().optional(),
  entries: z.array(TunnelEntrySchema),
  /** Provider-level info (e.g. Tailscale ipv4/hostname, UPnP external IP) */
  metadata: z.record(z.string(), z.string()).optional(),
});

export type TunnelProviderInfo = z.infer<typeof TunnelProviderInfoSchema>;

export const TunnelStateSchema = z.object({
  providers: z.array(TunnelProviderInfoSchema),
});

export type TunnelState = z.infer<typeof TunnelStateSchema>;

// ---------------------------------------------------------------------------
// Daemon state — dynamic runtime information (frequently updated)
// ---------------------------------------------------------------------------

export const DaemonStateSchema = z.object({
  status: z.union([
    z.enum(["running", "shutting-down"]),
    z.string(), // Forward compatibility
  ]),
  pid: z.number().optional(),
  httpPort: z.number().optional(),
  startedAt: z.number().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource: z
    .union([
      z.enum(["mobile-app", "cli", "os-signal", "unknown"]),
      z.string(), // Forward compatibility
    ])
    .optional(),
  tailscale: TailscaleInfoSchema.optional(),
  tunnels: TunnelStateSchema.optional(),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;
