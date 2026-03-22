/**
 * Background process manager page for a machine.
 *
 * Shows all listening web services detected on the machine,
 * with options to kill individual processes, kill all, or preview web services.
 *
 * Route: /machine/{id}/processes
 */

import * as React from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { useProcessManager } from "@/hooks/useProcessManager";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { t } from "@/text";
import type { DetectedPort } from "@/hooks/portDetection";

export default React.memo(function ProcessesPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const { processes, isScanning, scan, killProcess, killAll } = useProcessManager(machineId);
    const { theme } = useUnistyles();
    const router = useRouter();

    const webProcesses = processes.filter((p) => p.isWeb);

    const handleKill = React.useCallback(async (p: DetectedPort) => {
        if (!p.pid) return;
        const confirmed = await Modal.confirm(
            t("processManager.killConfirmTitle"),
            t("processManager.killConfirmMessage", {
                port: p.port,
                process: p.process,
            }),
        );
        if (confirmed) {
            await killProcess(p.pid);
        }
    }, [killProcess]);

    const handleKillAll = React.useCallback(async () => {
        const count = webProcesses.filter((p) => p.pid).length;
        if (count === 0) return;
        const confirmed = await Modal.confirm(
            t("processManager.killAllConfirmTitle"),
            t("processManager.killAllConfirmMessage", { count }),
        );
        if (confirmed) {
            await killAll();
        }
    }, [webProcesses, killAll]);

    const handlePreview = React.useCallback((port: number) => {
        router.push({
            pathname: "/session/recent",
            params: { previewUrl: `http://localhost:${port}` },
        });
    }, [router]);

    if (isScanning && webProcesses.length === 0) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.text} />
                <Text style={styles.statusText}>
                    {t("processManager.scanning")}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.contentContainer}
        >
            <View style={styles.innerContainer}>
                {/* Header actions */}
                <View style={styles.headerRow}>
                    <Text style={styles.countText}>
                        {t("processManager.count", { count: webProcesses.length })}
                    </Text>
                    <View style={styles.headerActions}>
                        <Pressable
                            onPress={scan}
                            style={({ pressed }) => [
                                styles.headerButton,
                                {
                                    backgroundColor: theme.colors.surfaceHighest,
                                    opacity: pressed ? 0.7 : 1,
                                },
                            ]}
                        >
                            <Ionicons
                                name="refresh-outline"
                                size={16}
                                color={theme.colors.text}
                            />
                        </Pressable>
                        {webProcesses.length > 0 && (
                            <Pressable
                                onPress={handleKillAll}
                                style={({ pressed }) => [
                                    styles.headerButton,
                                    {
                                        backgroundColor: theme.colors.textDestructive + "18",
                                        opacity: pressed ? 0.7 : 1,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name="stop-circle-outline"
                                    size={16}
                                    color={theme.colors.textDestructive}
                                />
                                <Text
                                    style={{
                                        fontSize: 13,
                                        color: theme.colors.textDestructive,
                                        fontWeight: "600",
                                    }}
                                >
                                    {t("processManager.killAll")}
                                </Text>
                            </Pressable>
                        )}
                    </View>
                </View>

                {/* Empty state */}
                {webProcesses.length === 0 && (
                    <View style={styles.emptyState}>
                        <Ionicons
                            name="checkmark-circle-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.emptyTitle}>
                            {t("processManager.noProcesses")}
                        </Text>
                        <Text style={styles.emptySubtitle}>
                            {t("processManager.noProcessesHint")}
                        </Text>
                    </View>
                )}

                {/* Process list */}
                {webProcesses.map((p) => (
                    <View
                        key={p.port}
                        style={[
                            styles.processRow,
                            { backgroundColor: theme.colors.surfaceHighest },
                        ]}
                    >
                        <View style={styles.processInfo}>
                            <View style={styles.processHeader}>
                                <Ionicons
                                    name={
                                        p.process.startsWith("docker:")
                                            ? "cube-outline"
                                            : "globe-outline"
                                    }
                                    size={16}
                                    color={theme.colors.textLink}
                                />
                                <Text
                                    style={[
                                        styles.portText,
                                        { color: theme.colors.textLink },
                                    ]}
                                >
                                    :{p.port}
                                </Text>
                                <Text style={styles.processName} numberOfLines={1}>
                                    {p.process}
                                </Text>
                            </View>
                            {p.pid && (
                                <Text style={styles.pidText}>PID {p.pid}</Text>
                            )}
                        </View>
                        <View style={styles.processActions}>
                            {p.isWeb && (
                                <Pressable
                                    onPress={() => handlePreview(p.port)}
                                    style={({ pressed }) => [
                                        styles.actionBtn,
                                        {
                                            backgroundColor: theme.colors.textLink + "18",
                                            opacity: pressed ? 0.7 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="eye-outline"
                                        size={14}
                                        color={theme.colors.textLink}
                                    />
                                </Pressable>
                            )}
                            {p.pid && (
                                <Pressable
                                    onPress={() => handleKill(p)}
                                    style={({ pressed }) => [
                                        styles.actionBtn,
                                        {
                                            backgroundColor: theme.colors.textDestructive + "18",
                                            opacity: pressed ? 0.7 : 1,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        name="close-outline"
                                        size={14}
                                        color={theme.colors.textDestructive}
                                    />
                                </Pressable>
                            )}
                        </View>
                    </View>
                ))}
            </View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    contentContainer: {
        paddingBottom: 40,
    },
    innerContainer: {
        width: "100%",
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    centered: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
    },
    statusText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    countText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: "500",
    },
    headerActions: {
        flexDirection: "row",
        gap: 8,
    },
    headerButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
    },
    emptyState: {
        alignItems: "center",
        paddingVertical: 48,
        gap: 12,
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: "600",
        color: theme.colors.text,
    },
    emptySubtitle: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center",
        paddingHorizontal: 32,
    },
    processRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        marginBottom: 8,
    },
    processInfo: {
        flex: 1,
        gap: 4,
    },
    processHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    portText: {
        fontSize: 16,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    processName: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    pidText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        opacity: 0.6,
        marginLeft: 22,
    },
    processActions: {
        flexDirection: "row",
        gap: 6,
    },
    actionBtn: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
}));
