/**
 * Horizontal status bar for preview tunnel state.
 * Shows candidate detection, tunnel creation, and lease countdown.
 */

import * as React from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import type { PreviewCandidate, PreviewConnection } from "@kmmao/happy-wire";

interface PreviewStatusBarProps {
    candidate: PreviewCandidate | null;
    connection: PreviewConnection | null;
    creating: boolean;
    error?: string;
    onCreate: () => Promise<void>;
    onRevoke: () => Promise<void>;
    onRefreshLease?: () => Promise<void>;
}

function formatLeaseTime(remainingSeconds: number): string {
    if (remainingSeconds < 60) return "< 1m";
    const minutes = Math.floor(remainingSeconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

// leaseExpiresAt is a unix ms timestamp from PreviewConnectionSchema
function getRemainingSeconds(leaseExpiresAt: number): number {
    return Math.max(0, Math.floor((leaseExpiresAt - Date.now()) / 1000));
}

export const PreviewStatusBar = React.memo<PreviewStatusBarProps>(
    function PreviewStatusBar({ candidate, connection, creating, error, onCreate, onRevoke, onRefreshLease }) {
        const { theme } = useUnistyles();
        const [leaseTime, setLeaseTime] = React.useState<string>("");
        const leaseCheckIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

        // Update lease countdown every 30 seconds
        React.useEffect(() => {
            if (!connection?.leaseExpiresAt) {
                setLeaseTime("");
                return;
            }

            const updateLeaseTime = () => {
                const remainingSeconds = getRemainingSeconds(connection.leaseExpiresAt);
                setLeaseTime(formatLeaseTime(remainingSeconds));
            };

            updateLeaseTime();
            leaseCheckIntervalRef.current = setInterval(updateLeaseTime, 30000);

            return () => {
                if (leaseCheckIntervalRef.current) {
                    clearInterval(leaseCheckIntervalRef.current);
                }
            };
        }, [connection?.leaseExpiresAt]);

        // useHappyAction returns `[loading, doAction]` tuple
        const [createLoading, doCreate] = useHappyAction(onCreate);
        const [revokeLoading, doRevoke] = useHappyAction(onRevoke);
        const [refreshLoading, doRefresh] = useHappyAction(onRefreshLease ?? (async () => {}));

        // U10: error takes priority
        if (error) {
            return (
                <View style={[styles.container, { backgroundColor: theme.colors.textDestructive + "18" }]}>
                    <View style={styles.contentRow}>
                        <Ionicons
                            name="alert-circle-outline"
                            size={16}
                            color={theme.colors.textDestructive}
                        />
                        <Text
                            style={[styles.text, { color: theme.colors.textDestructive }]}
                            numberOfLines={1}
                        >
                            {t("preview.tunnelError")}: {error}
                        </Text>
                    </View>
                </View>
            );
        }

        // Hide if no candidate
        if (!candidate && !connection) {
            return null;
        }

        // Show creating state
        if (creating) {
            return (
                <View style={[styles.container, { backgroundColor: theme.colors.surfaceHighest }]}>
                    <View style={styles.contentRow}>
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.textLink}
                            style={styles.spinner}
                        />
                        <Text style={[styles.text, { color: theme.colors.text }]}>
                            {t("preview.tunnelCreating")}
                        </Text>
                    </View>
                </View>
            );
        }

        // Show active connection
        if (connection) {
            const remainingSeconds = getRemainingSeconds(connection.leaseExpiresAt);
            const isNearExpiry = remainingSeconds < 30 * 60; // < 30 minutes

            return (
                <View
                    style={[
                        styles.container,
                        {
                            backgroundColor: isNearExpiry
                                ? theme.colors.textDestructive + "15"
                                : theme.colors.surfaceHighest,
                        },
                    ]}
                >
                    <View style={styles.contentRow}>
                        <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color={isNearExpiry ? theme.colors.textDestructive : theme.colors.success}
                        />
                        <Text style={[styles.text, { color: theme.colors.text }]}>
                            {t("preview.tunnelActive")}
                        </Text>
                        {leaseTime && (
                            <Text
                                style={[
                                    styles.leaseText,
                                    {
                                        color: isNearExpiry
                                            ? theme.colors.textDestructive
                                            : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {leaseTime}
                            </Text>
                        )}
                    </View>
                    {onRefreshLease && (
                        <Pressable
                            onPress={doRefresh}
                            disabled={refreshLoading}
                            hitSlop={6}
                            style={({ pressed }) => [
                                styles.iconOnlyButton,
                                { opacity: pressed || refreshLoading ? 0.5 : 1 },
                            ]}
                        >
                            {refreshLoading ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Ionicons
                                    name="refresh-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                />
                            )}
                        </Pressable>
                    )}
                    <Pressable
                        onPress={doRevoke}
                        disabled={revokeLoading}
                        style={({ pressed }) => [
                            styles.button,
                            { opacity: pressed || revokeLoading ? 0.6 : 1 },
                        ]}
                    >
                        {revokeLoading ? (
                            <ActivityIndicator size="small" color={theme.colors.textDestructive} />
                        ) : (
                            <>
                                <Ionicons
                                    name="power-outline"
                                    size={14}
                                    color={theme.colors.textDestructive}
                                />
                                <Text style={[styles.buttonText, { color: theme.colors.textDestructive }]}>
                                    {t("preview.revokeTunnel")}
                                </Text>
                            </>
                        )}
                    </Pressable>
                </View>
            );
        }

        // Show candidate available (no connection yet)
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surfaceHighest }]}>
                <View style={styles.contentRow}>
                    <Ionicons name="link-outline" size={16} color={theme.colors.textLink} />
                    <Text style={[styles.text, { color: theme.colors.text }]} numberOfLines={1}>
                        🟠 {t("preview.devServers")}: {candidate!.host}:{candidate!.port}
                        {candidate!.devServerType && (
                            <Text style={[styles.typeText, { color: theme.colors.textSecondary }]}>
                                {" "}({candidate!.devServerType})
                            </Text>
                        )}
                    </Text>
                </View>
                <Pressable
                    onPress={doCreate}
                    disabled={createLoading}
                    style={({ pressed }) => [
                        styles.button,
                        {
                            backgroundColor: theme.colors.button.primary.background,
                            opacity: pressed || createLoading ? 0.7 : 1,
                        },
                    ]}
                >
                    {createLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.buttonText}>{t("preview.createTunnel")}</Text>
                    )}
                </Pressable>
            </View>
        );
    },
);

const styles = StyleSheet.create((_theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 8,
        marginBottom: 8,
        borderRadius: 8,
        gap: 8,
    },
    contentRow: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    text: {
        fontSize: 13,
        fontWeight: "500",
        flex: 1,
    },
    typeText: {
        fontSize: 12,
        fontWeight: "400",
    },
    leaseText: {
        fontSize: 12,
        fontWeight: "500",
        marginLeft: 4,
    },
    spinner: {
        marginRight: 2,
    },
    button: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    buttonText: {
        fontSize: 12,
        fontWeight: "600",
        color: "#fff",
    },
    iconOnlyButton: {
        padding: 6,
    },
}));
