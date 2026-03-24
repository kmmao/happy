/**
 * Unified network services section — combines Tailscale, Caddy, and UPnP
 * into a single collapsible module on the machine detail page.
 */

import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { isMachineOnline } from "@/utils/machineUtils";
import { TailscaleServeContent } from "./TailscaleServeSection";
import { CaddyTunnelContent } from "./CaddyTunnelSection";
import { UpnpTunnelContent } from "./UpnpTunnelSection";
import type { Machine } from "@/sync/storageTypes";

type Props = {
    machineId: string;
    machine: Machine;
};

export const NetworkServicesSection = React.memo(function NetworkServicesSection({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const online = isMachineOnline(machine);
    const ds = machine.daemonState as any;

    const hasTailscale = ds?.tailscale?.status === "connected";

    const caddyProvider = useMemo(() => {
        const providers = ds?.tunnels?.providers;
        if (!Array.isArray(providers)) return null;
        return providers.find((p: any) => p.provider === "caddy") ?? null;
    }, [ds]);
    const hasCaddy = caddyProvider?.status === "available";

    const upnpProvider = useMemo(() => {
        const providers = ds?.tunnels?.providers;
        if (!Array.isArray(providers)) return null;
        return providers.find((p: any) => p.provider === "upnp") ?? null;
    }, [ds]);
    const hasUpnp = upnpProvider?.status === "available";

    // Don't render if none of the providers are available
    if (!hasTailscale && !hasCaddy && !hasUpnp) return null;

    return (
        <View>
            {/* Section header */}
            <View style={styles.sectionHeader}>
                <Ionicons name="globe-outline" size={18} color={theme.colors.textSecondary} />
                <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                    {t("machine.networkServices")}
                </Text>
            </View>

            {/* Tailscale Serve / Funnel */}
            {hasTailscale && (
                <ItemGroup title="Tailscale">
                    <TailscaleServeContent machineId={machineId} machine={machine} />
                </ItemGroup>
            )}

            {/* Caddy HTTPS reverse proxy */}
            {hasCaddy && (
                <CaddyTunnelContent machineId={machineId} machine={machine} />
            )}

            {/* UPnP port mappings */}
            {hasUpnp && (
                <ItemGroup
                    title="UPnP"
                    footer={upnpProvider?.metadata?.externalIp ? `IP: ${upnpProvider.metadata.externalIp}` : undefined}
                >
                    <UpnpTunnelContent machineId={machineId} machine={machine} />
                </ItemGroup>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 4,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
}));
