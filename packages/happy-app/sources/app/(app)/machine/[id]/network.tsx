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
import { Ionicons } from "@expo/vector-icons";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { t } from "@/text";
import { useMachine } from "@/sync/storage";
import { TailscaleServeContent } from "@/components/machine/TailscaleServeSection";
import { CaddyTunnelContent } from "@/components/machine/CaddyTunnelSection";
import { UpnpTunnelContent } from "@/components/machine/UpnpTunnelSection";

// ---------------------------------------------------------------------------
// Section header with icon + label
// ---------------------------------------------------------------------------

function SectionHeader({ icon, iconColor, label, badge }: {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    label: string;
    badge?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.sectionHeader}>
            <View style={[styles.iconBadge, { backgroundColor: iconColor + "18" }]}>
                <Ionicons name={icon} size={16} color={iconColor} />
            </View>
            <Text style={[styles.sectionLabel, { color: theme.colors.text }]}>
                {label}
            </Text>
            {badge ? (
                <Text style={[styles.sectionBadge, { color: theme.colors.textSecondary }]}>
                    {badge}
                </Text>
            ) : null}
        </View>
    );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function SectionDivider() {
    const { theme } = useUnistyles();
    return <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

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
    const tsServes = ds?.tailscale?.serves ?? [];

    const caddyProvider = ds?.tunnels?.providers?.find?.((p: any) => p.provider === "caddy");
    const hasCaddy = caddyProvider?.status === "available";
    const caddyEntries = caddyProvider?.entries ?? [];

    const upnpProvider = ds?.tunnels?.providers?.find?.((p: any) => p.provider === "upnp");
    const hasUpnp = upnpProvider?.status === "available";
    const upnpEntries = upnpProvider?.entries ?? [];

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
                <>
                    <SectionHeader
                        icon="logo-electron"
                        iconColor="#4F46E5"
                        label="Tailscale Serve / Funnel"
                        badge={tsServes.length > 0 ? `${tsServes.length}` : undefined}
                    />
                    <ItemGroup>
                        <TailscaleServeContent machineId={machineId} machine={machine} />
                    </ItemGroup>
                </>
            )}

            {/* Caddy HTTPS Reverse Proxy */}
            {hasCaddy && (
                <>
                    {hasTailscale && <SectionDivider />}
                    <SectionHeader
                        icon="lock-closed-outline"
                        iconColor="#10B981"
                        label="Caddy HTTPS"
                        badge={caddyEntries.length > 0 ? `${caddyEntries.length}` : undefined}
                    />
                    <CaddyTunnelContent machineId={machineId} machine={machine} />
                </>
            )}

            {/* UPnP Port Mapping */}
            {hasUpnp && (
                <>
                    {(hasTailscale || hasCaddy) && <SectionDivider />}
                    <SectionHeader
                        icon="swap-horizontal-outline"
                        iconColor="#F59E0B"
                        label={t("machine.upnpTitle")}
                        badge={upnpEntries.length > 0 ? `${upnpEntries.length}` : undefined}
                    />
                    <ItemGroup
                        footer={upnpProvider?.metadata?.externalIp ? `IP: ${upnpProvider.metadata.externalIp}` : undefined}
                    >
                        <UpnpTunnelContent machineId={machineId} machine={machine} />
                    </ItemGroup>
                </>
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
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 8,
        gap: 10,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionLabel: {
        fontSize: 16,
        fontWeight: "700",
        flex: 1,
    },
    sectionBadge: {
        fontSize: 13,
        fontWeight: "500",
    },
    divider: {
        height: 1,
        marginHorizontal: 16,
        marginTop: 12,
    },
}));
