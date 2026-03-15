import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { SupervisorRun } from "@/sync/apiSupervisor";
import type { TranslationKey } from "@/text";
import { useSession } from "@/sync/storage";
import { useRouter } from "expo-router";

const statusKeyMap: Record<string, TranslationKey> = {
    pending: "supervisor.status_pending",
    running: "supervisor.status_running",
    completed: "supervisor.status_completed",
    failed: "supervisor.status_failed",
    cancelled: "supervisor.status_cancelled",
};

function statusLabel(status: string): string {
    const key = statusKeyMap[status];
    return key ? t(key) : status;
}

interface SupervisorRunHistoryItemProps {
    run: SupervisorRun;
    isLast: boolean;
    onPress?: () => void;
}

export const SupervisorRunHistoryItem = React.memo(
    ({ run, isLast, onPress }: SupervisorRunHistoryItemProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const linkedSession = useSession(run.sessionId ?? "");

        const statusIcon = React.useMemo(() => {
            switch (run.status) {
                case "completed":
                    return {
                        name: "checkmark-circle" as const,
                        color: "#34C759",
                    };
                case "failed":
                    return {
                        name: "close-circle" as const,
                        color: "#FF3B30",
                    };
                case "cancelled":
                    return {
                        name: "remove-circle" as const,
                        color: "#FF9500",
                    };
                case "running":
                    return {
                        name: "sync-circle" as const,
                        color: theme.colors.header.tint,
                    };
                case "pending":
                    return {
                        name: "time" as const,
                        color: theme.colors.textSecondary,
                    };
                default:
                    return {
                        name: "help-circle" as const,
                        color: theme.colors.textSecondary,
                    };
            }
        }, [run.status, theme]);

        const formattedDate = React.useMemo(() => {
            const date = new Date(run.createdAt);
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
        }, [run.createdAt]);

        const triggerLabel = React.useMemo(() => {
            switch (run.trigger) {
                case "manual":
                    return t("supervisor.triggerManual");
                case "scheduled":
                    return t("supervisor.triggerScheduled");
                case "event":
                    return t("supervisor.triggerEvent");
                case "push":
                    return t("supervisor.triggerPush");
                default:
                    return run.trigger;
            }
        }, [run.trigger]);

        const durationText = React.useMemo(() => {
            if (!run.completedAt) return null;
            const durationMs = run.completedAt - run.createdAt;
            const secs = Math.floor(durationMs / 1000);
            if (secs < 60) return `${secs}s`;
            const mins = Math.floor(secs / 60);
            const remainSecs = secs % 60;
            return `${mins}m ${remainSecs}s`;
        }, [run.completedAt, run.createdAt]);

        return (
            <Pressable
                onPress={onPress}
                disabled={!onPress}
                style={[
                    styles.runItem,
                    !isLast && styles.runItemBorder,
                ]}
            >
                <Ionicons
                    name={statusIcon.name}
                    size={22}
                    color={statusIcon.color}
                />
                <View style={styles.runItemContent}>
                    <View style={styles.runItemHeader}>
                        <Text style={styles.runItemTrigger}>
                            {triggerLabel}
                        </Text>
                        <Text style={styles.runItemDate}>{formattedDate}</Text>
                    </View>
                    <View style={styles.runItemMeta}>
                        <Text style={styles.runItemStatus}>
                            {statusLabel(run.status)}
                        </Text>
                        {durationText && (
                            <Text style={styles.runItemDuration}>
                                {durationText}
                            </Text>
                        )}
                        {run.actionsCount > 0 && (
                            <Text style={styles.runItemActions}>
                                {t("supervisor.actionsCount", {
                                    count: run.actionsCount,
                                })}
                            </Text>
                        )}
                        {run.costUsd != null && run.costUsd > 0 && (
                            <Text style={styles.runItemCost}>
                                ${run.costUsd.toFixed(4)}
                            </Text>
                        )}
                    </View>
                    {run.errorMessage && (
                        <Text
                            style={styles.runItemError}
                            numberOfLines={2}
                        >
                            {run.errorMessage}
                        </Text>
                    )}
                    {linkedSession && run.sessionId && (
                        <Pressable
                            style={styles.sessionLinkRow}
                            onPress={(e) => {
                                e.stopPropagation();
                                router.push(
                                    `/session/${run.sessionId}` as any,
                                );
                            }}
                        >
                            <Ionicons
                                name="terminal-outline"
                                size={12}
                                color={theme.colors.header.tint}
                            />
                            <Text style={styles.sessionLinkText}>
                                {t("supervisor.viewSession")}
                            </Text>
                        </Pressable>
                    )}
                </View>
                {onPress && (
                    <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                )}
            </Pressable>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    runItem: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    runItemBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    runItemContent: {
        flex: 1,
    },
    runItemHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    runItemTrigger: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    runItemDate: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    runItemMeta: {
        flexDirection: "row",
        gap: 8,
        marginTop: 2,
    },
    runItemStatus: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    runItemDuration: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    runItemActions: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
    },
    runItemError: {
        ...Typography.default(),
        fontSize: 12,
        color: "#FF3B30",
        marginTop: 4,
    },
    runItemCost: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    sessionLinkRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 4,
    },
    sessionLinkText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
    },
}));
