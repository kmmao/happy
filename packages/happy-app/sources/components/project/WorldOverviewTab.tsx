import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
    Pressable,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import {
    fetchWorldDashboard,
    fetchSuggestions,
    refreshSuggestions,
    acceptSuggestion,
    dismissSuggestion,
    type WorldDashboard,
    type SuggestionSummary,
} from "@/sync/apiWorld";
import type { AcceptSuggestionResult } from "@/sync/apiWorld";
import { SuggestionCard } from "./SuggestionCard";

interface WorldOverviewTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldOverviewTab = React.memo(
    ({ project, isActive }: WorldOverviewTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [data, setData] = React.useState<WorldDashboard | null>(null);
        const [suggestions, setSuggestions] = React.useState<SuggestionSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const [suggestionsRefreshing, setSuggestionsRefreshing] = React.useState(false);

        const loadData = React.useCallback(async (isRefresh = false) => {
            if (!project.serverId) return;
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [dashboard, suggestionsData] = await Promise.all([
                    fetchWorldDashboard(credentials, project.serverId),
                    fetchSuggestions(credentials, project.serverId),
                ]);
                setData(dashboard);
                setSuggestions(suggestionsData);
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

        // Subscribe to ephemeral suggestion updates
        React.useEffect(() => {
            if (!isActive || !project.serverId) return;

            return sync.onWorldSuggestionUpdated((event) => {
                if (event.projectId !== project.serverId) return;
                if (event.status === "accepted" || event.status === "dismissed") {
                    setSuggestions((prev) =>
                        prev.filter((s) => s.id !== event.suggestionId),
                    );
                }
            });
        }, [isActive, project.serverId]);

        const handleRefreshSuggestions = React.useCallback(async () => {
            if (!project.serverId) return;
            setSuggestionsRefreshing(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await refreshSuggestions(credentials, project.serverId);
                const updated = await fetchSuggestions(credentials, project.serverId);
                setSuggestions(updated);
            } catch {
                // best effort
            } finally {
                setSuggestionsRefreshing(false);
            }
        }, [project.serverId]);

        const handleAccept = React.useCallback(async (suggestion: SuggestionSummary) => {
            if (!project.serverId) return;

            const typeLabel = suggestion.type === "suggested_goal"
                ? t("suggestions.typeGoal")
                : suggestion.type === "suggested_skill"
                    ? t("suggestions.typeSkill")
                    : t("suggestions.typeTask");
            const payloadTitle = suggestion.payload.goal?.title
                ?? suggestion.payload.task?.title
                ?? suggestion.payload.skill?.title
                ?? suggestion.title;

            const confirmed = await Modal.confirm(
                t("suggestions.acceptConfirmTitle"),
                t("suggestions.acceptConfirmBody", { type: typeLabel, title: payloadTitle }),
            );
            if (!confirmed) return;

            setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const result: AcceptSuggestionResult = await acceptSuggestion(credentials, project.serverId, suggestion.id);
                Modal.toast(t("suggestions.accepted"));

                if (result.createdEntityType === "goal") {
                    router.push(`/project/${project.id}/goal/${result.createdEntityId}` as any);
                    return;
                }
                if (result.createdEntityType === "skill") {
                    router.push(`/skills/${result.createdEntityId}/edit` as any);
                    return;
                }
                router.push(`/machine/${result.machineId ?? project.key.machineId}/task/${result.createdEntityId}` as any);
            } catch (e: any) {
                setSuggestions((prev) => [...prev, suggestion]);
                Modal.toast(e.message ?? t("common.error"));
            }
        }, [project.key.machineId, project.serverId, router]);

        const handleDismiss = React.useCallback(async (suggestion: SuggestionSummary) => {
            if (!project.serverId) return;

            // Optimistic remove
            setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await dismissSuggestion(credentials, project.serverId, suggestion.id);
                Modal.toast(t("suggestions.dismissed"));
            } catch {
                // Rollback on failure
                setSuggestions((prev) => [...prev, suggestion]);
            }
        }, [project.serverId]);

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
                <View style={[styles.sectionCard, { marginTop: 12 }]}>
                    <Pressable
                        style={styles.constitutionRow}
                        onPress={() => router.push(`/project/${project.id}/world-laws` as any)}
                        disabled={!project.serverId}
                    >
                        <View style={styles.constitutionContent}>
                            <Text style={styles.sectionTitle}>{t("world.title")}</Text>
                            <Text style={styles.constitutionHint}>{t("world.narrativeDesc")}</Text>
                        </View>
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                </View>

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
                                    {data.autonomy.decided30d} {t("world.autonomyDecided")}, {data.autonomy.autoResolved30d} {t("world.autonomyAuto")}, {data.autonomy.pending30d} {t("world.autonomyPending")}
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
                        onPress={project.serverId ? () => router.push(`/project/${project.id}/world-laws` as any) : undefined}
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

                {/* Suggested Next Steps */}
                <View style={styles.suggestionsSection}>
                    <View style={styles.suggestionsSectionHeader}>
                        <Ionicons name="bulb-outline" size={18} color="#F59E0B" />
                        <Text style={styles.sectionTitle}>{t("suggestions.suggestedNextSteps")}</Text>
                        <View style={{ flex: 1 }} />
                        <Pressable
                            style={styles.refreshButton}
                            onPress={handleRefreshSuggestions}
                            disabled={suggestionsRefreshing}
                        >
                            <Text style={styles.refreshButtonText}>
                                {suggestionsRefreshing ? t("suggestions.refreshing") : t("suggestions.refresh")}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                {suggestions.length === 0 ? (
                    <View style={styles.emptySuggestions}>
                        <Text style={styles.emptySuggestionsText}>{t("suggestions.noSuggestions")}</Text>
                        <Text style={styles.emptySuggestionsHint}>{t("suggestions.noSuggestionsHint")}</Text>
                    </View>
                ) : (
                    suggestions.map((s) => (
                        <SuggestionCard
                            key={s.id}
                            suggestion={s}
                            onAccept={handleAccept}
                            onDismiss={handleDismiss}
                        />
                    ))
                )}

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
                            <Pressable
                                key={d.id}
                                style={styles.decisionRow}
                                onPress={() => router.push(`/decision/${d.id}` as any)}
                            >
                                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                <Text style={styles.decisionText} numberOfLines={2}>
                                    {d.question}
                                </Text>
                                <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
                            </Pressable>
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
    onPress,
}: {
    icon: string;
    label: string;
    value: string;
    color: string;
    onPress?: () => void;
}) {
    const content = (
        <>
            <Ionicons name={icon as any} size={20} color={color} />
            <Text style={[styles.metricValue, { color }]}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
        </>
    );
    if (onPress) {
        return (
            <Pressable style={styles.metricCard} onPress={onPress}>
                {content}
            </Pressable>
        );
    }
    return <View style={styles.metricCard}>{content}</View>;
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
    constitutionRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
    },
    constitutionContent: {
        flex: 1,
    },
    constitutionHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 4,
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

    // Suggestions
    suggestionsSection: {
        marginHorizontal: 16,
        marginBottom: 8,
    },
    suggestionsSectionHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 8,
    },
    refreshButton: {
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    refreshButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textLink,
    },
    emptySuggestions: {
        marginHorizontal: 16,
        marginBottom: 8,
        paddingVertical: 16,
        alignItems: "center" as const,
        gap: 4,
    },
    emptySuggestionsText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    emptySuggestionsHint: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
        paddingHorizontal: 32,
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
