import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { TranslationKey } from "@/text";
import type { SupervisorSummary, SupervisorLoop } from "@/sync/apiSupervisor";

interface SupervisorSummaryCardProps {
    summary: SupervisorSummary | null;
    scoreDelta?: number | null;
    activeLoop?: SupervisorLoop | null;
    onPressLoop?: () => void;
    onPressSettings?: () => void;
}

const gradeColors: Record<SupervisorSummary["grade"], string> = {
    A: "#34C759",
    B: "#007AFF",
    C: "#FFD60A",
    D: "#FF9500",
    F: "#FF3B30",
};

const severityColors: Record<string, string> = {
    critical: "#FF3B30",
    high: "#FF9500",
    medium: "#FFD60A",
    low: "#8E8E93",
};

const trendConfig: Record<
    SupervisorSummary["trendDirection"],
    { icon: "trending-up" | "remove-outline" | "trending-down"; color: string; key: TranslationKey }
> = {
    improving: { icon: "trending-up", color: "#34C759", key: "supervisor.trendImproving" },
    stable: { icon: "remove-outline", color: "#8E8E93", key: "supervisor.trendStable" },
    declining: { icon: "trending-down", color: "#FF3B30", key: "supervisor.trendDeclining" },
};


function getLoopStatusKey(status: string): TranslationKey {
    switch (status) {
        case "running":
            return "supervisor.loopStatus_running";
        case "paused":
            return "supervisor.loopStatus_paused";
        case "completed":
            return "supervisor.loopStatus_completed";
        case "failed":
            return "supervisor.loopStatus_failed";
        case "stopped":
            return "supervisor.loopStatus_stopped";
        default:
            return "supervisor.loopMode";
    }
}

function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) return "<1m";
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
}

function formatFutureTime(timestamp: number): string {
    const now = Date.now();
    const diffMs = timestamp - now;
    if (diffMs <= 0) return "<1m";
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

function formatDurationMs(durationMs: number): string {
    const diffMins = Math.floor(durationMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

export const SupervisorSummaryCard = React.memo(
    ({ summary, scoreDelta, activeLoop, onPressLoop, onPressSettings }: SupervisorSummaryCardProps) => {
        const { theme } = useUnistyles();

        if (!summary) {
            return null;
        }

        const gradeColor = gradeColors[summary.grade];
        const trend = trendConfig[summary.trendDirection];
        const counts = summary.openCounts;
        const totalOpen = counts.critical + counts.high + counts.medium + counts.low;

        const lastScanLabel = summary.lastScanAt
            ? `${t("supervisor.lastScan")}: ${formatRelativeTime(summary.lastScanAt)}`
            : `${t("supervisor.lastScan")}: —`;
        const scheduleStatusColor = summary.scheduleEnabled ? "#34C759" : theme.colors.textSecondary;

        return (
            <View style={styles.card}>
                {/* Top row: Grade + Score + Trend */}
                <View style={styles.topRow}>
                    <View style={styles.gradeContainer}>
                        <Text style={[styles.gradeLetter, { color: gradeColor }]}>
                            {summary.grade}
                        </Text>
                        <Text style={styles.gradeLabel}>
                            {t("supervisor.summaryGrade")}
                        </Text>
                    </View>

                    <View style={styles.scoreSection}>
                        <View style={styles.scoreRow}>
                            <Text style={styles.scoreValue}>{summary.score}</Text>
                            {scoreDelta != null && scoreDelta !== 0 && (
                                <Text
                                    style={[
                                        styles.scoreDelta,
                                        {
                                            color:
                                                scoreDelta < 0
                                                    ? "#34C759"
                                                    : "#FF3B30",
                                        },
                                    ]}
                                >
                                    {scoreDelta > 0 ? `+${scoreDelta}` : `${scoreDelta}`}
                                </Text>
                            )}
                        </View>
                        <View style={styles.trendRow}>
                            <Ionicons
                                name={trend.icon}
                                size={16}
                                color={trend.color}
                            />
                            <Text style={[styles.trendText, { color: trend.color }]}>
                                {t(trend.key)}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Severity pills */}
                {totalOpen > 0 && (
                    <View style={styles.pillsSection}>
                        <Text style={styles.pillsSectionLabel}>
                            {t("supervisor.openIssues")}
                        </Text>
                        <View style={styles.pillsRow}>
                            {(
                                [
                                    ["critical", counts.critical],
                                    ["high", counts.high],
                                    ["medium", counts.medium],
                                    ["low", counts.low],
                                ] as const
                            )
                                .filter(([, count]) => count > 0)
                                .map(([severity, count]) => (
                                    <View
                                        key={severity}
                                        style={[
                                            styles.pill,
                                            {
                                                backgroundColor:
                                                    severityColors[severity] + "20",
                                            },
                                        ]}
                                    >
                                        <View
                                            style={[
                                                styles.pillDot,
                                                {
                                                    backgroundColor:
                                                        severityColors[severity],
                                                },
                                            ]}
                                        />
                                        <Text
                                            style={[
                                                styles.pillText,
                                                { color: severityColors[severity] },
                                            ]}
                                        >
                                            {count}
                                        </Text>
                                    </View>
                                ))}
                        </View>
                    </View>
                )}

                {/* Bottom meta row */}
                <View style={styles.metaRow}>
                    <Text style={styles.metaText}>{lastScanLabel}</Text>
                    <Text style={styles.metaText}>
                        {t("supervisor.runs30d")}: {summary.totalRuns30d}
                    </Text>
                </View>

                <View style={styles.statusRow}>
                    <View style={[styles.statusChip, { backgroundColor: `${scheduleStatusColor}18` }]}>
                        <Ionicons
                            name={summary.scheduleEnabled ? "calendar-outline" : "pause-circle-outline"}
                            size={12}
                            color={scheduleStatusColor}
                        />
                        <Text style={[styles.statusChipText, { color: scheduleStatusColor }]}>
                            {summary.scheduleEnabled ? t("supervisor.scheduleEnabledShort") : t("supervisor.scheduleDisabledShort")}
                        </Text>
                    </View>
                    {summary.scheduleEnabled && summary.scheduleIntervalHours != null && (
                        <View style={styles.statusChip}>
                            <Text style={styles.statusChipText}>
                                {t("supervisor.scheduleCadence", { hours: summary.scheduleIntervalHours })}
                            </Text>
                        </View>
                    )}
                    {activeLoop && (
                        <View style={[styles.statusChip, { backgroundColor: "#0A84FF18" }]}>
                            <Ionicons name="sync-outline" size={12} color="#0A84FF" />
                            <Text style={[styles.statusChipText, { color: "#0A84FF" }]}>
                                {t(getLoopStatusKey(activeLoop.status))}
                            </Text>
                        </View>
                    )}
                </View>
                {summary.nextRunAt && (
                    <View style={styles.nextRunRow}>
                        <Ionicons
                            name="time-outline"
                            size={12}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.metaText}>
                            {t("supervisor.nextRun")}: {formatFutureTime(summary.nextRunAt)}
                        </Text>
                    </View>
                )}
                {summary.scheduleOverdueByMs != null && (
                    <View style={styles.nextRunRow}>
                        <Ionicons
                            name="warning-outline"
                            size={12}
                            color="#FF9500"
                        />
                        <Text style={[styles.metaText, { color: "#FF9500" }]}>
                            {t("supervisor.scheduleOverdue")}: {formatDurationMs(summary.scheduleOverdueByMs)}
                        </Text>
                    </View>
                )}
                {summary.scheduleMissedRuns > 0 && (
                    <View style={styles.nextRunRow}>
                        <Ionicons
                            name="play-skip-forward-outline"
                            size={12}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.metaText}>
                            {t("supervisor.scheduleMissedRuns", { count: summary.scheduleMissedRuns })}
                        </Text>
                    </View>
                )}
                {(onPressLoop || onPressSettings) && (
                    <View style={styles.actionRow}>
                        {activeLoop && onPressLoop ? (
                            <Pressable style={styles.linkButton} onPress={onPressLoop}>
                                <Ionicons name="git-branch-outline" size={14} color={theme.colors.header.tint} />
                                <Text style={styles.linkButtonText}>
                                    {t("supervisor.viewActiveLoop", { iteration: activeLoop.currentIteration })}
                                </Text>
                            </Pressable>
                        ) : null}
                        {onPressSettings ? (
                            <Pressable style={styles.linkButton} onPress={onPressSettings}>
                                <Ionicons name="settings-outline" size={14} color={theme.colors.header.tint} />
                                <Text style={styles.linkButtonText}>{t("supervisor.settings")}</Text>
                            </Pressable>
                        ) : null}
                    </View>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        padding: 16,
        gap: 14,
    },
    topRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
    },
    gradeContainer: {
        alignItems: "center",
        gap: 2,
    },
    gradeLetter: {
        ...Typography.default("semiBold"),
        fontSize: 32,
        lineHeight: 38,
    },
    gradeLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
    },
    scoreSection: {
        flex: 1,
        gap: 4,
    },
    scoreRow: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 6,
    },
    scoreValue: {
        ...Typography.default("semiBold"),
        fontSize: 20,
        color: theme.colors.text,
    },
    scoreDelta: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    trendRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    trendText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    pillsSection: {
        gap: 6,
    },
    pillsSectionLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    pillsRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    pill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    pillDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    pillText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    metaRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    statusRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    statusChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceHigh,
    },
    statusChipText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    nextRunRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    metaText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    actionRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    linkButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 4,
    },
    linkButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.header.tint,
    },
}));
