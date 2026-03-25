/**
 * Network services summary — shows a single Item on the machine detail page
 * that navigates to the full /machine/{id}/network page.
 */

import React, { useMemo } from "react";
import { useRouter } from "expo-router";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { Machine } from "@/sync/storageTypes";

type Props = {
    machineId: string;
    machine: Machine;
};

/** Hook to compute summary info for network services */
export function useNetworkServicesSummary(machine: Machine) {
    const ds = machine.daemonState as any;

    return useMemo(() => {
        // Tailscale: show if present and not "not-installed"
        const ts = ds?.tailscale;
        const hasTailscale = ts && ts.status !== "not-installed";
        const tsConnected = ts?.status === "connected";
        const tsServes = ts?.serves ?? [];

        const providers = ds?.tunnels?.providers;
        const caddy = Array.isArray(providers) ? providers.find((p: any) => p.provider === "caddy") : null;
        const hasCaddy = caddy?.status === "available";
        const caddyEntries = caddy?.entries ?? [];

        const upnp = Array.isArray(providers) ? providers.find((p: any) => p.provider === "upnp") : null;
        const hasUpnp = upnp?.status === "available";
        const upnpEntries = upnp?.entries ?? [];

        const hasAny = hasTailscale || hasCaddy || hasUpnp;

        // Build subtitle parts
        const parts: string[] = [];
        if (hasTailscale) {
            const tsLabel = tsConnected
                ? `Tailscale${tsServes.length > 0 ? ` (${tsServes.length})` : ""}`
                : "Tailscale ⚠";
            parts.push(tsLabel);
        }
        if (hasCaddy) parts.push(`Caddy${caddyEntries.length > 0 ? ` (${caddyEntries.length})` : ""}`);
        if (hasUpnp) parts.push(`UPnP${upnpEntries.length > 0 ? ` (${upnpEntries.length})` : ""}`);

        const totalEntries = tsServes.length + caddyEntries.length + upnpEntries.length;

        return {
            hasAny,
            subtitle: parts.join("  ·  "),
            totalEntries,
        };
    }, [ds]);
}

/** Summary Item that navigates to /machine/{id}/network */
export const NetworkServicesSummaryItem = React.memo(function NetworkServicesSummaryItem({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { hasAny, subtitle } = useNetworkServicesSummary(machine);

    if (!hasAny) return null;

    return (
        <ItemGroup title={t("machine.networkServices")}>
            <Item
                title={t("machine.networkServices")}
                subtitle={subtitle}
                icon={
                    <Ionicons
                        name="globe-outline"
                        size={20}
                        color={theme.colors.textLink}
                    />
                }
                onPress={() => router.push(`/machine/${machineId}/network` as any)}
                showChevron
            />
        </ItemGroup>
    );
});
