import type { Machine } from "@/sync/storageTypes";

/**
 * Build a preview URL for a web service listening on `port`.
 *
 * When the machine has a connected Tailscale with an IPv4 address,
 * the URL uses the Tailscale IP so the service is reachable from
 * any device on the same tailnet.
 * Falls back to `localhost` when Tailscale is unavailable.
 */
export function buildPreviewUrl(port: number, machine: Machine | null): string {
    const ts = machine?.daemonState?.tailscale;
    if (ts?.status === "connected" && ts.ipv4) {
        return `http://${ts.ipv4}:${port}`;
    }
    return `http://localhost:${port}`;
}
