/**
 * Network services page for a machine.
 *
 * Combines Tailscale Serve/Funnel, Caddy HTTPS reverse proxy,
 * and UPnP port mappings into a unified management page.
 *
 * Route: /machine/{id}/network
 */

import * as React from "react";
import { ScrollView, View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { t } from "@/text";
import { useMachine } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { TailscaleServeContent } from "@/components/machine/TailscaleServeSection";
import { CaddyTunnelContent } from "@/components/machine/CaddyTunnelSection";
import { UpnpTunnelContent } from "@/components/machine/UpnpTunnelSection";

export default React.memo(function NetworkPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const machine = useMachine(machineId);
    const { theme } = useUnistyles();

    if (!machine) {
        return (
            <View style={styles.empty}>
                <Text style={{ color: theme.colors.textSecondary }}>
                    {t("common.loading")}
                </Text>
            </View>
        );
    }

    const ds = machine.daemonState as any;
    const hasTailscale = ds?.tailscale?.status === "connected";

    const caddyProvider = ds?.tunnels?.providers?.find?.((p: any) => p.provider === "caddy");
    const hasCaddy = caddyProvider?.status === "available";

    const upnpProvider = ds?.tunnels?.providers?.find?.((p: any) => p.provider === "upnp");
    const hasUpnp = upnpProvider?.status === "available";

    const noServices = !hasTailscale && !hasCaddy && !hasUpnp;

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
        >
            {noServices && (
                <ItemGroup>
                    <Item
                        title={t("machine.networkServicesEmpty")}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Tailscale Serve / Funnel */}
            {hasTailscale && (
                <ItemGroup title="Tailscale Serve / Funnel">
                    <TailscaleServeContent machineId={machineId} machine={machine} />
                </ItemGroup>
            )}

            {/* Caddy HTTPS Reverse Proxy */}
            {hasCaddy && (
                <CaddyTunnelContent machineId={machineId} machine={machine} />
            )}

            {/* UPnP Port Mapping */}
            {hasUpnp && (
                <ItemGroup
                    title={`UPnP ${t("machine.upnpTitle")}`}
                    footer={upnpProvider?.metadata?.externalIp ? `IP: ${upnpProvider.metadata.externalIp}` : undefined}
                >
                    <UpnpTunnelContent machineId={machineId} machine={machine} />
                </ItemGroup>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        paddingBottom: 40,
    },
    empty: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
}));
