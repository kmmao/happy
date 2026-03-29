/**
 * Service card for Dev configuration page.
 *
 * Uses ItemGroup + Item for native iOS settings-style look.
 * Each service is a group with: command info, config files, expose, and actions.
 * Long-press on service header to delete.
 */

import * as React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import type { DevService } from "@/utils/devYmlParser";

type Props = {
    readonly service: DevService;
    readonly sessionId: string;
    readonly onEdit: (service: DevService) => void;
    readonly onDelete: (serviceKey: string) => void;
    readonly onConfigFilePress: (path: string) => void;
    readonly onStart?: (serviceKey: string) => void;
    readonly isRunning?: boolean;
};

function buildCommandPreview(cmd: string): string {
    // Shorten long commands: show last meaningful part
    if (cmd.length <= 50) return cmd;
    // If it has && chains, show the last command
    const parts = cmd.split("&&").map((s) => s.trim());
    const last = parts[parts.length - 1];
    return parts.length > 1 ? `… && ${last}` : cmd.slice(0, 50) + "…";
}

export const DevServiceCard = React.memo(function DevServiceCard({
    service,
    onEdit,
    onDelete,
    onConfigFilePress,
    onStart,
    isRunning,
}: Props) {
    const { theme } = useUnistyles();

    const statusColor = isRunning ? "#4CAF50" : theme.colors.textSecondary;
    const hasConfigFiles = (service.configFiles?.length ?? 0) > 0;

    // Build title with status dot + name
    const titleElement = (
        <View style={styles.titleRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.titleText, { color: theme.colors.text }]}>
                {service.name}
            </Text>
        </View>
    );

    // Build right element for port + expose badges
    const rightBadges = (
        <View style={styles.badges}>
            {service.port != null && (
                <View style={[styles.badge, { backgroundColor: `${theme.colors.textLink}12` }]}>
                    <Text style={[styles.badgeText, { color: theme.colors.textLink }]}>
                        :{service.port}
                    </Text>
                </View>
            )}
            {service.expose?.caddy && (
                <Ionicons name="globe-outline" size={14} color="#4CAF50" />
            )}
            {service.expose?.tailscale?.funnel && (
                <Ionicons name="swap-horizontal-outline" size={14} color={theme.colors.textLink} />
            )}
        </View>
    );

    return (
        <ItemGroup
            title={titleElement}
            footer={service.cwd ? `📂 ${service.cwd}` : undefined}
        >
            {/* Command — tap to edit, shows preview */}
            <Item
                title={buildCommandPreview(service.command)}
                titleStyle={{
                    fontFamily: "Menlo",
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                }}
                rightElement={rightBadges}
                onPress={() => onEdit(service)}
                showChevron={false}
                copy={service.command}
            />

            {/* Config files */}
            {hasConfigFiles && service.configFiles!.map((cf) => (
                <Item
                    key={cf.path}
                    title={cf.label || cf.path.split("/").pop() || ""}
                    subtitle={cf.path}
                    subtitleStyle={{ fontFamily: "Menlo", fontSize: 10 }}
                    icon={<Ionicons name="document-text-outline" size={16} color={theme.colors.textSecondary} />}
                    onPress={() => onConfigFilePress(cf.path)}
                    showChevron
                />
            ))}

            {/* Expose: Caddy */}
            {service.expose?.caddy && (
                <Item
                    title={service.expose.caddy.hostname}
                    titleStyle={{ fontSize: 13 }}
                    icon={<Ionicons name="globe-outline" size={16} color="#4CAF50" />}
                    rightElement={
                        <View style={[styles.badge, { backgroundColor: "#4CAF5012" }]}>
                            <Ionicons name="lock-closed" size={9} color="#4CAF50" />
                            <Text style={[styles.badgeText, { color: "#4CAF50" }]}> HTTPS</Text>
                        </View>
                    }
                    showChevron={false}
                />
            )}

            {/* Expose: Tailscale */}
            {service.expose?.tailscale && (
                <Item
                    title={`Tailscale :${service.expose.tailscale.httpsPort ?? 443}`}
                    titleStyle={{ fontSize: 13 }}
                    icon={<Ionicons name="swap-horizontal-outline" size={16} color={theme.colors.textLink} />}
                    rightElement={
                        service.expose.tailscale.funnel ? (
                            <View style={[styles.badge, { backgroundColor: `${theme.colors.textLink}12` }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textLink }]}>Funnel</Text>
                            </View>
                        ) : undefined
                    }
                    showChevron={false}
                />
            )}

            {/* Actions row — Edit / Start / Delete */}
            <View style={[styles.actionsRow, { borderTopColor: theme.colors.divider }]}>
                <Item
                    title="Edit"
                    titleStyle={{ color: theme.colors.textLink, fontSize: 13 }}
                    icon={<Ionicons name="create-outline" size={15} color={theme.colors.textLink} />}
                    onPress={() => onEdit(service)}
                    showChevron={false}
                    showDivider={false}
                />
                {onStart && !isRunning && (
                    <Item
                        title="Start"
                        titleStyle={{ color: "#4CAF50", fontSize: 13, fontWeight: "600" }}
                        icon={<Ionicons name="play" size={14} color="#4CAF50" />}
                        onPress={() => onStart(service.key)}
                        showChevron={false}
                        showDivider={false}
                    />
                )}
                <Item
                    title="Delete"
                    titleStyle={{ fontSize: 13 }}
                    icon={<Ionicons name="trash-outline" size={14} color={theme.colors.textSecondary} />}
                    onPress={() => onDelete(service.key)}
                    showChevron={false}
                    showDivider={false}
                    destructive
                />
            </View>
        </ItemGroup>
    );
});

const styles = StyleSheet.create({
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    titleText: {
        fontSize: 15,
        fontWeight: "600",
    },
    badges: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    badge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: "600",
        fontFamily: "monospace",
    },
    actionsRow: {
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
});
