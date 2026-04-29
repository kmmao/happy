/**
 * Background process manager page for a machine.
 *
 * Shows all listening web services detected on the machine,
 * with options to kill individual processes, kill all, preview web services,
 * and hide/unhide specific processes by name.
 *
 * Route: /machine/{id}/processes
 */

import * as React from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { useProcessManager } from "@/hooks/useProcessManager";
import { useHiddenProcesses } from "@/hooks/useHiddenProcesses";
import { Modal } from "@/modal";
import { screenLayoutMaxWidth } from "@/components/layout";
import { t } from "@/text";
import type { DetectedPort } from "@/hooks/portDetection";
import { useMachine } from "@/sync/storage";
import { buildPreviewUrl } from "@/utils/previewUrl";
import { SharedStateView } from "@/components/SharedStateView";

export default React.memo(function ProcessesPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const { processes, isScanning, scan, killProcess, killAll } = useProcessManager(machineId);
    const {
        showHidden, filterProcesses, isHidden,
        toggleShowHidden, hideProcess, unhideProcess,
    } = useHiddenProcesses(machineId);
    const machine = useMachine(machineId);
    const { theme } = useUnistyles();
    const router = useRouter();

    const allWebProcesses = React.useMemo(
        () => processes.filter((p) => p.isWeb),
        [processes],
    );
    const visibleProcesses = React.useMemo(
        () => filterProcesses(allWebProcesses),
        [filterProcesses, allWebProcesses],
    );
    const hiddenCount = React.useMemo(
        () => allWebProcesses.filter((p) => isHidden(p.process)).length,
        [allWebProcesses, isHidden],
    );

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
        const pids = visibleProcesses
            .filter((p) => p.pid && p.pid > 1)
            .map((p) => p.pid!);
        if (pids.length === 0) return;
        const confirmed = await Modal.confirm(
            t("processManager.killAllConfirmTitle"),
            t("processManager.killAllConfirmMessage", { count: pids.length }),
        );
        if (confirmed) {
            for (const pid of pids) {
                await killProcess(pid);
            }
        }
    }, [visibleProcesses, killProcess]);

    const handlePreview = React.useCallback((port: number) => {
        router.push({
            pathname: "/session/recent",
            params: { previewUrl: buildPreviewUrl(port, machine) },
        });
    }, [router, machine]);

    const handleHide = React.useCallback(async (p: DetectedPort) => {
        const confirmed = await Modal.confirm(
            t("processManager.hideConfirmTitle"),
            t("processManager.hideConfirmMessage", { process: p.process }),
        );
        if (confirmed) {
            hideProcess(p.process);
        }
    }, [hideProcess]);

    const handleUnhide = React.useCallback((p: DetectedPort) => {
        unhideProcess(p.process);
    }, [unhideProcess]);

    if (isScanning && allWebProcesses.length === 0) {
        return (
            <SharedStateView
                kind="loading"
                title={t("processManager.scanning")}
            />
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
                        {showHidden
                            ? t("processManager.hiddenCount", { count: visibleProcesses.length })
                            : t("processManager.count", { count: visibleProcesses.length })}
                    </Text>
                    <View style={styles.headerActions}>
                        {/* Toggle hidden view */}
                        {hiddenCount > 0 && (
                            <Pressable
                                onPress={toggleShowHidden}
                                accessibilityLabel={showHidden
                                    ? t("processManager.showActive")
                                    : t("processManager.showHidden")}
                                style={({ pressed }) => [
                                    styles.headerButton,
                                    {
                                        backgroundColor: showHidden
                                            ? theme.colors.textLink + "24"
                                            : theme.colors.surfaceHighest,
                                        opacity: pressed ? 0.7 : 1,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={showHidden ? "eye-outline" : "eye-off-outline"}
                                    size={16}
                                    color={showHidden ? theme.colors.textLink : theme.colors.text}
                                />
                                <View style={styles.badge}>
                                    <Text
                                        style={[
                                            styles.badgeText,
                                            {
                                                color: showHidden
                                                    ? theme.colors.textLink
                                                    : theme.colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        {hiddenCount}
                                    </Text>
                                </View>
                            </Pressable>
                        )}
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
                        {!showHidden && visibleProcesses.length > 0 && (
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
                {visibleProcesses.length === 0 && (
                    <SharedStateView
                        inline
                        kind="empty"
                        title={
                            showHidden
                                ? t("processManager.noHiddenProcesses")
                                : t("processManager.noProcesses")
                        }
                        description={
                            showHidden
                                ? t("processManager.noHiddenProcessesHint")
                                : t("processManager.noProcessesHint")
                        }
                        icon={
                            <Ionicons
                                name={showHidden ? "eye-off-outline" : "checkmark-circle-outline"}
                                size={36}
                                color={theme.colors.textSecondary}
                            />
                        }
                    />
                )}

                {/* Process list */}
                {visibleProcesses.map((p) => (
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
                            {showHidden ? (
                                /* Unhide button in hidden view */
                                <Pressable
                                    onPress={() => handleUnhide(p)}
                                    accessibilityLabel={t("processManager.unhide")}
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
                            ) : (
                                <>
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
                                    {/* Hide button */}
                                    <Pressable
                                        onPress={() => handleHide(p)}
                                        accessibilityLabel={t("processManager.hide")}
                                        style={({ pressed }) => [
                                            styles.actionBtn,
                                            {
                                                backgroundColor: theme.colors.textSecondary + "18",
                                                opacity: pressed ? 0.7 : 1,
                                            },
                                        ]}
                                    >
                                        <Ionicons
                                            name="eye-off-outline"
                                            size={14}
                                            color={theme.colors.textSecondary}
                                        />
                                    </Pressable>
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
                                </>
                            )}
                        </View>
                    </View>
                ))}
            </View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    contentContainer: {
        paddingBottom: 40,
    },
    innerContainer: {
        width: "100%",
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
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
    badge: {
        minWidth: 16,
        alignItems: "center",
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
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
