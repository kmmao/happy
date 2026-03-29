/**
 * Compact card displaying a single dev service from dev.yml configuration.
 * Uses custom layout instead of ItemGroup/Item for tighter spacing.
 */

import * as React from "react";
import { View, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
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
    const hasExpose = service.expose?.caddy || service.expose?.tailscale;

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceHigh, borderColor: theme.colors.divider }]}>
            {/* Header: name + port */}
            <View style={styles.header}>
                <Ionicons
                    name={isRunning ? "radio-button-on" : "ellipse-outline"}
                    size={12}
                    color={statusColor}
                />
                <Text style={[styles.name, { color: theme.colors.text }]}>{service.name}</Text>
                {service.port != null && (
                    <View style={[styles.portBadge, { backgroundColor: `${theme.colors.textLink}15` }]}>
                        <Text style={[styles.portText, { color: theme.colors.textLink }]}>:{service.port}</Text>
                    </View>
                )}
            </View>

            {/* Command */}
            <Text
                style={[styles.command, { color: theme.colors.textSecondary }]}
                numberOfLines={2}
                selectable
            >
                $ {service.command}
            </Text>

            {/* Config files — compact list */}
            {hasConfigFiles && (
                <View style={[styles.section, { borderTopColor: theme.colors.divider }]}>
                    {service.configFiles!.map((cf) => (
                        <Pressable
                            key={cf.path}
                            style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.6 }]}
                            onPress={() => onConfigFilePress(cf.path)}
                        >
                            <Ionicons name="document-text-outline" size={13} color={theme.colors.textSecondary} />
                            <Text style={[styles.fileLabel, { color: theme.colors.text }]} numberOfLines={1}>
                                {cf.label || cf.path.split("/").pop()}
                            </Text>
                            <Text style={[styles.filePath, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                {cf.path}
                            </Text>
                            <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                        </Pressable>
                    ))}
                </View>
            )}

            {/* Expose — compact */}
            {hasExpose && (
                <View style={[styles.section, { borderTopColor: theme.colors.divider }]}>
                    {service.expose?.caddy && (
                        <View style={styles.exposeRow}>
                            <Ionicons name="globe-outline" size={13} color="#4CAF50" />
                            <Text style={[styles.exposeText, { color: theme.colors.text }]}>
                                {service.expose.caddy.hostname}
                            </Text>
                            <View style={[styles.tag, { backgroundColor: "#4CAF5015" }]}>
                                <Text style={[styles.tagText, { color: "#4CAF50" }]}>HTTPS</Text>
                            </View>
                        </View>
                    )}
                    {service.expose?.tailscale && (
                        <View style={styles.exposeRow}>
                            <Ionicons name="swap-horizontal-outline" size={13} color={theme.colors.textLink} />
                            <Text style={[styles.exposeText, { color: theme.colors.text }]}>
                                Tailscale :{service.expose.tailscale.httpsPort ?? 443}
                            </Text>
                            {service.expose.tailscale.funnel && (
                                <View style={[styles.tag, { backgroundColor: `${theme.colors.textLink}15` }]}>
                                    <Text style={[styles.tagText, { color: theme.colors.textLink }]}>Funnel</Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>
            )}

            {/* Dependencies — inline */}
            {(service.depends_on?.length ?? 0) > 0 && (
                <View style={[styles.depsRow, { borderTopColor: theme.colors.divider }]}>
                    <Ionicons name="git-branch-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={[styles.depsText, { color: theme.colors.textSecondary }]}>
                        {service.depends_on!.join(" → ")}
                    </Text>
                </View>
            )}

            {/* Actions — compact horizontal */}
            <View style={[styles.actions, { borderTopColor: theme.colors.divider }]}>
                <Pressable
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.5 }]}
                    onPress={() => onEdit(service)}
                >
                    <Ionicons name="create-outline" size={14} color={theme.colors.textLink} />
                    <Text style={[styles.actionLabel, { color: theme.colors.textLink }]}>Edit</Text>
                </Pressable>
                {onStart && !isRunning && (
                    <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.5 }]}
                        onPress={() => onStart(service.key)}
                    >
                        <Ionicons name="play" size={13} color="#4CAF50" />
                        <Text style={[styles.actionLabel, { color: "#4CAF50", fontWeight: "600" }]}>Start</Text>
                    </Pressable>
                )}
                <Pressable
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.5 }]}
                    onPress={() => onDelete(service.key)}
                >
                    <Ionicons name="trash-outline" size={13} color={theme.colors.textSecondary} />
                    <Text style={[styles.actionLabel, { color: theme.colors.textSecondary }]}>Delete</Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16,
        marginVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        overflow: "hidden",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 4,
    },
    name: {
        fontSize: 15,
        fontWeight: "600",
        flex: 1,
    },
    portBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },
    portText: {
        fontSize: 11,
        fontWeight: "600",
        fontFamily: "monospace",
    },
    command: {
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 16,
        paddingHorizontal: 14,
        paddingBottom: 8,
    },
    section: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingVertical: 4,
    },
    fileRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 5,
    },
    fileLabel: {
        fontSize: 12,
        fontWeight: "500",
    },
    filePath: {
        fontSize: 10,
        fontFamily: "monospace",
        flex: 1,
        textAlign: "right",
    },
    exposeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 4,
    },
    exposeText: {
        fontSize: 12,
        flex: 1,
    },
    tag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 3,
    },
    tagText: {
        fontSize: 10,
        fontWeight: "600",
    },
    depsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    depsText: {
        fontSize: 11,
    },
    actions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 14,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    actionBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    actionLabel: {
        fontSize: 12,
    },
});
