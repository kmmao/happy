/**
 * Single Loop history row — shows iteration count, metrics, duration, and exit reason.
 */

import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { SupervisorLoop } from "@/sync/apiSupervisor";

interface SupervisorLoopHistoryItemProps {
    readonly loop: SupervisorLoop;
    readonly isLast: boolean;
    readonly onPress?: () => void;
    readonly onDelete?: () => void;
}

const statusIcons: Record<string, { name: any; color: string }> = {
    completed: { name: "checkmark-circle", color: "#34C759" },
    failed: { name: "close-circle", color: "#FF3B30" },
    stopped: { name: "stop-circle", color: "#FF9500" },
};

export const SupervisorLoopHistoryItem = React.memo(
    ({ loop, isLast, onPress, onDelete }: SupervisorLoopHistoryItemProps) => {
        const { theme } = useUnistyles();

        const icon = statusIcons[loop.status] ?? {
            name: "help-circle",
            color: theme.colors.textSecondary,
        };

        const formattedDate = React.useMemo(() => {
            const date = new Date(loop.createdAt);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);

            if (diffMins < 1) return t("supervisor.justNow");
            if (diffMins < 60)
                return t("supervisor.minutesAgo", { count: diffMins });
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24)
                return t("supervisor.hoursAgo", { count: diffHours });
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7)
                return t("supervisor.daysAgo", { count: diffDays });
            return date.toLocaleDateString();
        }, [loop.createdAt]);

        const durationText = React.useMemo(() => {
            if (!loop.completedAt) return null;
            const durationMs = loop.completedAt - loop.createdAt;
            const secs = Math.floor(durationMs / 1000);
            if (secs < 60) return `${secs}s`;
            const mins = Math.floor(secs / 60);
            const remainSecs = secs % 60;
            if (mins < 60) return `${mins}m ${remainSecs}s`;
            const hours = Math.floor(mins / 60);
            const remainMins = mins % 60;
            return `${hours}h ${remainMins}m`;
        }, [loop.completedAt, loop.createdAt]);

        const exitReasonLabels: Record<string, string> = {
            max_iterations: t("supervisor.loopExit_max_iterations"),
            cost_cap: t("supervisor.loopExit_cost_cap"),
            health_target: t("supervisor.loopExit_health_target"),
            no_new_actions: t("supervisor.loopExit_no_new_actions"),
            consecutive_failures: t("supervisor.loopExit_consecutive_failures"),
            user_stopped: t("supervisor.loopExit_user_stopped"),
            timeout: t("supervisor.loopExit_timeout"),
        };
        const exitLabel = loop.exitReason
            ? (exitReasonLabels[loop.exitReason] ?? loop.exitReason)
            : null;

        const healthDelta =
            loop.initialHealthScore != null && loop.currentHealthScore != null
                ? loop.currentHealthScore - loop.initialHealthScore
                : null;

        return (
            <Pressable
                onPress={onPress}
                disabled={!onPress}
                style={[
                    styles.container,
                    !isLast && styles.containerBorder,
                ]}
            >
                <Ionicons
                    name={icon.name}
                    size={22}
                    color={icon.color}
                />
                <View style={styles.content}>
                    <View style={styles.headerRow}>
                        <Text style={styles.iterationText}>
                            {loop.maxIterations > 0
                                ? t("supervisor.loopIteration", {
                                      current: loop.currentIteration,
                                      max: loop.maxIterations,
                                  })
                                : t("supervisor.loopIterationUnlimited", {
                                      current: loop.currentIteration,
                                  })}
                        </Text>
                        <Text style={styles.dateText}>{formattedDate}</Text>
                    </View>

                    {/* Metrics row */}
                    <View style={styles.metricsRow}>
                        <Text style={styles.metricText}>
                            {t("supervisor.loopFound")}: {loop.totalActionsFound}
                        </Text>
                        <Text style={styles.metricText}>
                            {t("supervisor.loopFixed")}: {loop.totalActionsFixed}
                        </Text>
                        {loop.totalCostUsd > 0 && (
                            <Text style={styles.metricText}>
                                ${loop.totalCostUsd.toFixed(2)}
                            </Text>
                        )}
                        {durationText && (
                            <Text style={styles.metricText}>
                                {durationText}
                            </Text>
                        )}
                    </View>

                    {/* Health delta */}
                    {healthDelta !== null && (
                        <Text
                            style={[
                                styles.healthDelta,
                                {
                                    color:
                                        healthDelta < 0
                                            ? "#34C759"
                                            : healthDelta > 0
                                              ? "#FF3B30"
                                              : theme.colors.textSecondary,
                                },
                            ]}
                        >
                            {t("supervisor.loopHealthDelta")}: {loop.initialHealthScore} → {loop.currentHealthScore}
                            {healthDelta !== 0 && ` (${healthDelta > 0 ? "+" : ""}${healthDelta})`}
                        </Text>
                    )}

                    {/* Exit reason */}
                    {exitLabel && (
                        <Text style={styles.exitReason}>
                            {exitLabel}
                        </Text>
                    )}
                </View>
                <View style={styles.rightActions}>
                    {onDelete && (
                        <Pressable
                            onPress={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            style={styles.deleteButton}
                            hitSlop={8}
                        >
                            <Ionicons
                                name="trash-outline"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    )}
                    {onPress && (
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    )}
                </View>
            </Pressable>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    containerBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    content: {
        flex: 1,
    },
    headerRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    iterationText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    dateText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    metricsRow: {
        flexDirection: "row",
        gap: 10,
        marginTop: 2,
    },
    metricText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    healthDelta: {
        ...Typography.default(),
        fontSize: 12,
        marginTop: 2,
    },
    exitReason: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontStyle: "italic" as const,
        marginTop: 2,
    },
    rightActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
    },
    deleteButton: {
        padding: 4,
    },
}));
