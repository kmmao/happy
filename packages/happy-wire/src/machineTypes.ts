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
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;
