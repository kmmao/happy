import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { layout } from "@/components/layout";
import { fetchWorldDashboard, type WorldDashboard } from "@/sync/apiWorld";

interface ProjectWorldTabProps {
    project: Project;
    isActive: boolean;
}

export const ProjectWorldTab = React.memo(
    ({ project, isActive }: ProjectWorldTabProps) => {
        const { theme } = useUnistyles();
        const [data, setData] = React.useState<WorldDashboard | null>(null);
        const [loading, setLoading] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);

        const loadData = React.useCallback(async (isRefresh = false) => {
            if (!project.serverId) return;
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const dashboard = await fetchWorldDashboard(credentials, project.serverId);
                setData(dashboard);
            } catch {
                // best effort
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        }, [project.serverId]);

        React.useEffect(() => {
            if (isActive) {
                loadData();
            }
        }, [isActive, loadData]);

        if (loading && !data) {
            return (
                <View style={styles.centerContainer}>
                    <ActivityIndicator />
                </View>
            );
        }

        if (!data) {
            return (
                <View style={styles.centerContainer}>
                    <Ionicons name="globe-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>{t("world.noDataYet")}</Text>
                    <Text style={styles.emptyHint}>{t("world.noDataHint")}</Text>
                </View>
            );
        }

        const autonomyColor = data.autonomy.score === null
            ? theme.colors.textSecondary
            : data.autonomy.score >= 80
                ? "#10B981"
                : data.autonomy.score >= 50
                    ? "#F59E0B"
                    : "#DC2626";

        return (
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />
                }
            >
                {/* Autonomy Score Card */}
                <View style={styles.autonomyCard}>
                    <Text style={styles.sectionTitle}>{t("world.dashboardTitle")}</Text>
                    <View style={styles.autonomyRow}>
                        <View style={styles.autonomyScoreContainer}>
                            <Text style={[styles.autonomyScoreText, { color: autonomyColor }]}>
                                {data.autonomy.score !== null ? `${data.autonomy.score}%` : t("world.notApplicable")}
                            </Text>
                            <Text style={styles.autonomyLabel}>{t("world.autonomyScore")}</Text>
                        </View>
                        <View style={styles.autonomyDetails}>
                            <Text style={styles.autonomyDetailText}>
                                {data.autonomy.score !== null && data.autonomy.score >= 80
                                    ? t("world.fullyAutonomous")
                                    : data.autonomy.score !== null
                                        ? t("world.needsAttention")
                                        : t("world.autonomyScoreDesc")}
                            </Text>
                            {data.autonomy.total30d > 0 && (
                                <Text style={styles.autonomyStatsText}>
                                    {data.autonomy.decided30d} decided, {data.autonomy.autoResolved30d} auto, {data.autonomy.pending30d} pending
                                </Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Metrics Grid */}
                <View style={styles.metricsGrid}>
                    <MetricCard
                        icon="people"
                        label={t("world.activeRoles")}
                        value={String(data.roles.total)}
                        color="#8B5CF6"
                    />
                    <MetricCard
                        icon="alert-circle"
                        label={t("world.pendingDecisions")}
                        value={String(data.decisions.pending)}
                        color={data.decisions.pending > 0 ? "#F59E0B" : "#10B981"}
                    />
                    <MetricCard
                        icon="document-text"
                        label={t("world.lawCount")}
                        value={String(data.lawCount)}
                        color="#3B82F6"
                    />
                    <MetricCard
                        icon="chatbubbles"
                        label={t("world.agentMessages")}
                        value={String(data.agentMessages.total30d)}
                        color="#6B7280"
                    />
                </View>

                {/* Goals Overview */}
                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>{t("world.goalsOverview")}</Text>
                    <View style={styles.goalsRow}>
                        <GoalStat label={t("world.goalsActive")} value={data.goals.active} color="#3B82F6" />
                        <GoalStat label={t("world.goalsCompleted")} value={data.goals.completed} color="#10B981" />
                        <GoalStat label={t("world.goalsBlocked")} value={data.goals.blocked} color="#F59E0B" />
                    </View>
                </View>

                {/* Agent Messages Summary */}
                {(data.agentMessages.conflicts30d > 0 || data.agentMessages.lawSuggestions30d > 0) && (
                    <View style={styles.sectionCard}>
                        <Text style={styles.sectionTitle}>{t("world.agentMessages")}</Text>
                        {data.agentMessages.conflicts30d > 0 && (
                            <View style={styles.messageRow}>
                                <Ionicons name="warning-outline" size={16} color="#F59E0B" />
                                <Text style={styles.messageText}>
                                    {t("world.conflicts")}: {data.agentMessages.conflicts30d}
                                </Text>
                            </View>
                        )}
                        {data.agentMessages.lawSuggestions30d > 0 && (
                            <View style={styles.messageRow}>
                                <Ionicons name="bulb-outline" size={16} color="#8B5CF6" />
                                <Text style={styles.messageText}>
                                    {t("world.lawSuggestions")}: {data.agentMessages.lawSuggestions30d}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Recent Decisions */}
                {data.decisions.recentDecided.length > 0 && (
                    <View style={styles.sectionCard}>
                        <Text style={styles.sectionTitle}>{t("world.recentDecisions")}</Text>
                        {data.decisions.recentDecided.map((d) => (
                            <View key={d.id} style={styles.decisionRow}>
                                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                <Text style={styles.decisionText} numberOfLines={2}>
                                    {d.question}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        );
    },
);

// === Metric Card ===

const MetricCard = React.memo(function MetricCard({
    icon,
    label,
    value,
    color,
}: {
    icon: string;
    label: string;
    value: string;
    color: string;
}) {
    return (
        <View style={styles.metricCard}>
            <Ionicons name={icon as any} size={20} color={color} />
            <Text style={[styles.metricValue, { color }]}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
        </View>
    );
});

// === Goal Stat ===

const GoalStat = React.memo(function GoalStat({
    label,
    value,
    color,
}: {
    label: string;
    value: number;
    color: string;
}) {
    return (
        <View style={styles.goalStat}>
            <Text style={[styles.goalStatValue, { color }]}>{value}</Text>
            <Text style={styles.goalStatLabel}>{label}</Text>
        </View>
    );
});

// === Styles ===

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    centerContainer: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        paddingVertical: 60,
        gap: 12,
    },
    emptyText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },
    emptyHint: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
        paddingHorizontal: 40,
    },

    // Autonomy Card
    autonomyCard: {
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
    },
    autonomyRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 12,
        gap: 16,
    },
    autonomyScoreContainer: {
        alignItems: "center" as const,
        minWidth: 80,
    },
    autonomyScoreText: {
        ...Typography.default("semiBold"),
        fontSize: 36,
    },
    autonomyLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    autonomyDetails: {
        flex: 1,
    },
    autonomyDetailText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    autonomyStatsText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },

    // Metrics Grid
    metricsGrid: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        paddingHorizontal: 12,
        gap: 8,
        marginBottom: 8,
    },
    metricCard: {
        flex: 1,
        minWidth: "45%" as any,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        alignItems: "center" as const,
        gap: 4,
    },
    metricValue: {
        ...Typography.default("semiBold"),
        fontSize: 24,
    },
    metricLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },

    // Section Card
    sectionCard: {
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },

    // Goals Row
    goalsRow: {
        flexDirection: "row" as const,
        justifyContent: "space-around" as const,
        marginTop: 12,
    },
    goalStat: {
        alignItems: "center" as const,
    },
    goalStatValue: {
        ...Typography.default("semiBold"),
        fontSize: 22,
    },
    goalStatLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },

    // Messages
    messageRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        marginTop: 8,
    },
    messageText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },

    // Decisions
    decisionRow: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
        marginTop: 8,
    },
    decisionText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
        lineHeight: 18,
    },
}));
