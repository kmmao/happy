/**
 * Card displaying a single dev service from dev.yml configuration.
 *
 * Shows service name, command, port, config files, and expose mappings.
 * Uses ItemGroup/Item for consistent iOS settings-style layout.
 */

import * as React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Typography } from "@/constants/Typography";
import type { DevService } from "@/utils/devYmlParser";

type Props = {
    readonly service: DevService;
    readonly sessionId: string;
    readonly onEdit: (service: DevService) => void;
    readonly onDelete: (serviceKey: string) => void;
    readonly onConfigFilePress: (path: string) => void;
    readonly isRunning?: boolean;
};

export const DevServiceCard = React.memo(function DevServiceCard({
    service,
    sessionId,
    onEdit,
    onDelete,
    onConfigFilePress,
    isRunning,
}: Props) {
    const { theme } = useUnistyles();

    const statusIcon = isRunning ? "play-circle" : "play-circle-outline";
    const statusColor = isRunning ? "#4CAF50" : theme.colors.textSecondary;

    const hasConfigFiles = (service.configFiles?.length ?? 0) > 0;
    const hasExpose = service.expose?.caddy || service.expose?.tailscale;

    const titleElement = (
        <View style={styles.titleRow}>
            <Ionicons name={statusIcon as any} size={16} color={statusColor} />
            <Text style={[styles.serviceName, { color: theme.colors.text }]}>
                {service.name}
            </Text>
            {service.port != null && (
                <View style={[styles.portBadge, { backgroundColor: `${theme.colors.textLink}15` }]}>
                    <Text style={[styles.portText, { color: theme.colors.textLink }]}>
                        :{service.port}
                    </Text>
                </View>
            )}
        </View>
    );

    return (
        <ItemGroup title={titleElement}>
            {/* Command */}
            <Item
                title={service.command}
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
                copy={service.command}
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

            {/* Actions */}
            <Item
                title="Edit"
                titleStyle={{ color: theme.colors.textLink }}
                icon={
                    <Ionicons
                        name="create-outline"
                        size={18}
                        color={theme.colors.textLink}
                    />
                }
                onPress={() => onEdit(service)}
                showChevron={false}
            />
            <Item
                title="Delete"
                titleStyle={{ color: theme.colors.textSecondary, fontSize: 13 }}
                onPress={() => onDelete(service.key)}
                showChevron={false}
                destructive
            />
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
}));
