import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { AutonomyStats } from "@/sync/apiWorld";
import type { SupervisorMode } from "@kmmao/happy-wire";

interface AutonomyStatusSectionProps {
    stats: AutonomyStats;
}

function modeColor(mode: SupervisorMode): string {
    switch (mode) {
        case "auto": return "#10B981";
        case "semi-auto": return "#3B82F6";
        case "suggest": return "#F59E0B";
        case "disabled": return "#9CA3AF";
    }
}

function getModeLabel(mode: SupervisorMode): string {
    switch (mode) {
        case "auto": return t("autonomy.modeAuto");
        case "semi-auto": return t("autonomy.modeSemiAuto");
        case "suggest": return t("autonomy.modeSuggest");
        case "disabled": return t("autonomy.modeDisabled");
    }
}

export const AutonomyStatusSection = React.memo(function AutonomyStatusSection({
    stats,
}: AutonomyStatusSectionProps) {
    const { theme } = useUnistyles();
    const color = modeColor(stats.mode);

    const quotaText = stats.todayQuota !== null
        ? `${stats.todayAutoAccepted} / ${stats.todayQuota}`
        : String(stats.todayAutoAccepted);

    const concurrentText = stats.maxConcurrent !== null
        ? `${stats.concurrentAutoTasks} / ${stats.maxConcurrent}`
        : String(stats.concurrentAutoTasks);

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Ionicons name="flash" size={16} color={color} />
                <Text style={styles.title}>{t("autonomy.title")}</Text>
                <View style={[styles.modeBadge, { backgroundColor: color + "22", borderColor: color + "44" }]}>
                    <Text style={[styles.modeBadgeText, { color }]}>{getModeLabel(stats.mode)}</Text>
                </View>
            </View>

            <View style={styles.statsRow}>
                <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: theme.colors.text }]}>{quotaText}</Text>
                    <Text style={styles.statLabel}>{t("autonomy.todayAccepted")}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: theme.colors.text }]}>{concurrentText}</Text>
                    <Text style={styles.statLabel}>{t("autonomy.runningTasks")}</Text>
                </View>
            </View>

            {stats.recentAutoActions.length > 0 ? (
                <View style={styles.recentSection}>
                    <Text style={styles.recentTitle}>{t("autonomy.recentActions")}</Text>
                    {stats.recentAutoActions.map((action) => (
                        <View key={action.suggestionId} style={styles.recentRow}>
                            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                            <Text style={styles.recentText} numberOfLines={1}>{action.title}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 12,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    modeBadge: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 3,
    },
    modeBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    statsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
    },
    statItem: {
        flex: 1,
        alignItems: "center",
        gap: 2,
    },
    statValue: {
        ...Typography.default("semiBold"),
        fontSize: 20,
    },
    statLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    divider: {
        width: 1,
        height: 32,
        backgroundColor: theme.colors.divider,
    },
    recentSection: {
        gap: 6,
    },
    recentTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    recentRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    recentText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
    },
}));
