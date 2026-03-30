/**
 * Card displaying a single dev service from dev.yml configuration.
 *
 * Shows service name, command, port, config files, expose mappings,
 * and mode tabs when multiple launch modes are available.
 */

import * as React from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Typography } from "@/constants/Typography";
import type { DevService } from "@/utils/devYmlParser";
import { getActiveCommand, getActivePort } from "@/utils/devYmlParser";

type Props = {
    readonly service: DevService;
    readonly onEdit: (service: DevService) => void;
    readonly onDelete: (serviceKey: string) => void;
    readonly onConfigFilePress: (path: string) => void;
    readonly onStart?: (serviceKey: string) => void;
    readonly onStop?: (serviceKey: string) => void;
    readonly isRunning?: boolean;
    readonly onModeChange?: (serviceKey: string, modeKey: string) => void;
};

export const DevServiceCard = React.memo(function DevServiceCard({
    service,
    onEdit,
    onDelete,
    onConfigFilePress,
    onStart,
    onStop,
    isRunning,
    onModeChange,
}: Props) {
    const { theme } = useUnistyles();

    const statusIcon = isRunning ? "play-circle" : "play-circle-outline";
    const statusColor = isRunning ? "#4CAF50" : theme.colors.textSecondary;

    const activeCommand = getActiveCommand(service);
    const activePort = getActivePort(service);
    const hasConfigFiles = (service.configFiles?.length ?? 0) > 0;
    const hasExpose = service.expose?.caddy || service.expose?.tailscale;
    const modeKeys = service.modes ? Object.keys(service.modes) : [];
    const showTabs = modeKeys.length >= 2;

    const titleElement = (
        <View style={styles.titleRow}>
            <Ionicons name={statusIcon as any} size={16} color={statusColor} />
            <Text style={[styles.serviceName, { color: theme.colors.text }]}>
                {service.name}
            </Text>
            {activePort != null && (
                <View style={[styles.portBadge, { backgroundColor: `${theme.colors.textLink}15` }]}>
                    <Text style={[styles.portText, { color: theme.colors.textLink }]}>
                        :{activePort}
                    </Text>
                </View>
            )}
        </View>
    );

    return (
        <ItemGroup title={titleElement}>
            {/* Mode tabs */}
            {showTabs && (
                <View style={[styles.tabContainer, { borderBottomColor: theme.colors.divider }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
                        {modeKeys.map((modeKey) => {
                            const mode = service.modes![modeKey];
                            const isActive = modeKey === service.activeMode;
                            return (
                                <Pressable
                                    key={modeKey}
                                    style={[
                                        styles.tab,
                                        {
                                            backgroundColor: isActive
                                                ? `${theme.colors.textLink}15`
                                                : "transparent",
                                            borderColor: isActive
                                                ? theme.colors.textLink
                                                : theme.colors.divider,
                                        },
                                    ]}
                                    onPress={() => {
                                        if (!isActive && onModeChange) {
                                            onModeChange(service.key, modeKey);
                                        }
                                    }}
                                >
                                    <Ionicons
                                        name={modeKey === "docker" ? "cube-outline" : "desktop-outline"}
                                        size={13}
                                        color={isActive ? theme.colors.textLink : theme.colors.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            styles.tabText,
                                            {
                                                color: isActive
                                                    ? theme.colors.textLink
                                                    : theme.colors.textSecondary,
                                                fontWeight: isActive ? "600" : "400",
                                            },
                                        ]}
                                    >
                                        {mode.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>
            )}

            {/* Command */}
            <Item
                title={activeCommand}
                titleStyle={{
                    fontFamily: "Menlo",
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                }}
                icon={
                    <Ionicons
                        name="terminal-outline"
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                }
                showChevron={false}
                copy={activeCommand}
            />

            {/* Config files section */}
            {hasConfigFiles && (
                <>
                    {service.configFiles!.map((cf) => (
                        <Item
                            key={cf.path}
                            title={cf.label || cf.path}
                            subtitle={cf.path}
                            subtitleStyle={{
                                fontFamily: "Menlo",
                                fontSize: 11,
                            }}
                            icon={
                                <Ionicons
                                    name="document-text-outline"
                                    size={18}
                                    color={theme.colors.textSecondary}
                                />
                            }
                            onPress={() => onConfigFilePress(cf.path)}
                            showChevron
                        />
                    ))}
                </>
            )}

            {/* Expose / port mapping section */}
            {hasExpose && (
                <>
                    {service.expose?.caddy && (
                        <Item
                            title={`Caddy -> ${service.expose.caddy.hostname}`}
                            titleStyle={{ fontSize: 13 }}
                            icon={
                                <Ionicons
                                    name="globe-outline"
                                    size={18}
                                    color={theme.colors.success}
                                />
                            }
                            rightElement={
                                <View style={styles.httpsTag}>
                                    <Ionicons
                                        name="lock-closed"
                                        size={10}
                                        color={theme.colors.success}
                                    />
                                    <Text style={[styles.httpsText, { color: theme.colors.success }]}>
                                        HTTPS
                                    </Text>
                                </View>
                            }
                            showChevron={false}
                        />
                    )}
                    {service.expose?.tailscale && (
                        <Item
                            title={`Tailscale Funnel${service.expose.tailscale.httpsPort ? ` :${service.expose.tailscale.httpsPort}` : " :443"}`}
                            titleStyle={{ fontSize: 13 }}
                            icon={
                                <Ionicons
                                    name="swap-horizontal-outline"
                                    size={18}
                                    color={theme.colors.textLink}
                                />
                            }
                            rightElement={
                                service.expose.tailscale.funnel ? (
                                    <View style={[styles.funnelBadge, { backgroundColor: `${theme.colors.textLink}15` }]}>
                                        <Text style={[styles.funnelText, { color: theme.colors.textLink }]}>
                                            Funnel ON
                                        </Text>
                                    </View>
                                ) : undefined
                            }
                            showChevron={false}
                        />
                    )}
                </>
            )}

            {/* Dependencies */}
            {(service.depends_on?.length ?? 0) > 0 && (
                <Item
                    title={`Depends on: ${service.depends_on!.join(", ")}`}
                    titleStyle={{ fontSize: 12, color: theme.colors.textSecondary }}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    }
                    showChevron={false}
                />
            )}

            {/* Actions — compact horizontal row */}
            <View style={styles.actionsRow}>
                <Pressable
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => onEdit(service)}
                >
                    <Ionicons name="create-outline" size={15} color={theme.colors.textLink} />
                    <Text style={[styles.actionText, { color: theme.colors.textLink }]}>Edit</Text>
                </Pressable>
                {isRunning && onStop ? (
                    <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                        onPress={() => onStop(service.key)}
                    >
                        <Ionicons name="stop" size={14} color="#F44336" />
                        <Text style={[styles.actionText, { color: "#F44336", fontWeight: "600" }]}>Stop</Text>
                    </Pressable>
                ) : onStart && !isRunning ? (
                    <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                        onPress={() => onStart(service.key)}
                    >
                        <Ionicons name="play" size={14} color="#4CAF50" />
                        <Text style={[styles.actionText, { color: "#4CAF50", fontWeight: "600" }]}>Start</Text>
                    </Pressable>
                ) : null}
                <Pressable
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => onDelete(service.key)}
                >
                    <Ionicons name="trash-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>Delete</Text>
                </Pressable>
            </View>
        </ItemGroup>
    );
});

const styles = StyleSheet.create((theme) => ({
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    serviceName: {
        fontSize: 15,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    portBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    portText: {
        fontSize: 11,
        fontWeight: "600",
        fontFamily: "Menlo",
    },
    tabContainer: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tabScroll: {
        gap: 8,
    },
    tab: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    tabText: {
        fontSize: 13,
    },
    httpsTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    httpsText: {
        fontSize: 11,
        fontWeight: "600",
    },
    funnelBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    funnelText: {
        fontSize: 11,
        fontWeight: "600",
    },
    actionsRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 16,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    actionBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: 4,
    },
    actionText: {
        fontSize: 13,
    },
}));
