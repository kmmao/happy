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
    fetchAutonomyStats,
    fetchCollaboration,
    type SuggestionStatus,
    type WorldDashboard,
    type SuggestionSummary,
    type AutonomyStats,
    type CollaborationSummary,
} from "@/sync/apiWorld";
import type { AcceptSuggestionResult } from "@/sync/apiWorld";
import { AutonomyStatusSection } from "./AutonomyStatusSection";
import { GovernanceDashboard } from "./GovernanceDashboard";
import { AuditLogSection } from "./AuditLogSection";
import { MemberStatsSection } from "./MemberStatsSection";
import { RoleCollaborationSection } from "./RoleCollaborationSection";
import { SuggestionCard } from "./SuggestionCard";
import { WorldConfigSection } from "./WorldConfigSection";
import {
    applySuggestionStatusUpdate,
    getSuggestionTypeLabelKey,
    getSuggestionPayloadTitle,
    groupSuggestionsByBucket,
    mergeFetchedSuggestions,
    mergeVisibleSuggestions,
    removeSuggestionOptimistically,
    restoreSuggestionAtIndex,
    shouldRefetchSuggestions,
} from "./worldSuggestionViewModel";

interface WorldOverviewTabProps {
    project: Project;
    isActive: boolean;
}

function isSuggestionStatus(value: string): value is SuggestionStatus {
    return value === "open"
        || value === "processing"
        || value === "accepted"
        || value === "suspended"
        || value === "dismissed"
        || value === "expired";
}

export const WorldOverviewTab = React.memo(
    ({ project, isActive }: WorldOverviewTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [data, setData] = React.useState<WorldDashboard | null>(null);
        const [autonomyStats, setAutonomyStats] = React.useState<AutonomyStats | null>(null);
        const [collaboration, setCollaboration] = React.useState<CollaborationSummary | null>(null);
        const [suggestions, setSuggestions] = React.useState<SuggestionSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const [suggestionsRefreshing, setSuggestionsRefreshing] = React.useState(false);
        const hiddenSuggestionIdsRef = React.useRef<Set<string>>(new Set());
        const suggestionReloadSeqRef = React.useRef(0);

        const loadSuggestions = React.useCallback(async (projectServerId: string) => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                return [] as SuggestionSummary[];
            }
            const [activeSuggestions, acceptedSuggestions] = await Promise.all([
                fetchSuggestions(credentials, projectServerId),
                fetchSuggestions(credentials, projectServerId, { status: "accepted" }),
            ]);
            return mergeVisibleSuggestions(
                mergeFetchedSuggestions(activeSuggestions, hiddenSuggestionIdsRef.current),
                mergeFetchedSuggestions(acceptedSuggestions, hiddenSuggestionIdsRef.current),
            );
        }, []);

        const loadData = React.useCallback(async (isRefresh = false) => {
            if (!project.serverId) return;
            if (isRefresh) setRefreshing(true);
            else setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [dashboard, activeSuggestions, acceptedSuggestions, stats, collab] = await Promise.all([
                    fetchWorldDashboard(credentials, project.serverId),
                    fetchSuggestions(credentials, project.serverId),
                    fetchSuggestions(credentials, project.serverId, { status: "accepted" }),
                    fetchAutonomyStats(credentials, project.serverId).catch(() => null),
                    fetchCollaboration(credentials, project.serverId).catch(() => null),
                ]);
                setData(dashboard);
                setAutonomyStats(stats);
                setCollaboration(collab);
                setSuggestions(mergeVisibleSuggestions(
                    mergeFetchedSuggestions(activeSuggestions, hiddenSuggestionIdsRef.current),
                    mergeFetchedSuggestions(acceptedSuggestions, hiddenSuggestionIdsRef.current),
                ));
            } catch {
                // best effort
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        }, [loadSuggestions, project.serverId]);

        React.useEffect(() => {
            if (isActive) {
                void loadData();
            }
        }, [isActive, loadData]);

        React.useEffect(() => {
            const projectServerId = project.serverId;
            if (!isActive || !projectServerId) return;

            let isDisposed = false;
            const unsubscribe = sync.onWorldSuggestionUpdated((event) => {
                if (event.projectId !== projectServerId) return;
                if (!isSuggestionStatus(event.status)) return;

                const narrowedEvent = {
                    suggestionId: event.suggestionId,
                    status: event.status,
                } as const;

                if (shouldRefetchSuggestions(narrowedEvent)) {
                    const reloadSeq = ++suggestionReloadSeqRef.current;
                    void (async () => {
                        const updated = await loadSuggestions(projectServerId);
                        if (isDisposed || reloadSeq !== suggestionReloadSeqRef.current) return;
                        setSuggestions(updated);
                    })();
                    return;
                }

                hiddenSuggestionIdsRef.current.add(event.suggestionId);
                setSuggestions((prev) => applySuggestionStatusUpdate(prev, narrowedEvent));
            });

            return () => {
                isDisposed = true;
                unsubscribe();
            };
        }, [isActive, loadSuggestions, project.serverId]);

        const handleRefreshSuggestions = React.useCallback(async () => {
            if (!project.serverId) return;
            setSuggestionsRefreshing(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await refreshSuggestions(credentials, project.serverId);
                const updated = await loadSuggestions(project.serverId);
                setSuggestions(updated);
            } catch {
                // best effort
            } finally {
                setSuggestionsRefreshing(false);
            }
        }, [loadSuggestions, project.serverId]);

        const handleAccept = React.useCallback(async (suggestion: SuggestionSummary) => {
            if (!project.serverId) return;

            const typeLabel = t(getSuggestionTypeLabelKey(suggestion.type));
            const payloadTitle = getSuggestionPayloadTitle(suggestion);

            const confirmed = await Modal.confirm(
                t("suggestions.acceptConfirmTitle"),
                t("suggestions.acceptConfirmBody", { type: typeLabel, title: payloadTitle }),
            );
            if (!confirmed) return;

            hiddenSuggestionIdsRef.current.add(suggestion.id);
            const { removedIndex } = removeSuggestionOptimistically(suggestions, suggestion.id);
            setSuggestions((prev) => removeSuggestionOptimistically(prev, suggestion.id).suggestions);

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
                if (result.createdEntityType === "decision") {
                    router.push(`/decision/${result.createdEntityId}` as any);
                    return;
                }
                router.push(`/machine/${result.machineId ?? project.key.machineId}/task/${result.createdEntityId}` as any);
            } catch (e: any) {
                hiddenSuggestionIdsRef.current.delete(suggestion.id);
                setSuggestions((prev) => restoreSuggestionAtIndex(prev, suggestion, removedIndex));
                Modal.toast(e.message ?? t("common.error"));
            }
        }, [project.id, project.key.machineId, project.serverId, router, suggestions]);

        const handleDismiss = React.useCallback(async (suggestion: SuggestionSummary) => {
            if (!project.serverId) return;

            hiddenSuggestionIdsRef.current.add(suggestion.id);
            const { removedIndex } = removeSuggestionOptimistically(suggestions, suggestion.id);
            setSuggestions((prev) => removeSuggestionOptimistically(prev, suggestion.id).suggestions);

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await dismissSuggestion(credentials, project.serverId, suggestion.id);
                Modal.toast(t("suggestions.dismissed"));
            } catch {
                hiddenSuggestionIdsRef.current.delete(suggestion.id);
                setSuggestions((prev) => restoreSuggestionAtIndex(prev, suggestion, removedIndex));
            }
        }, [project.serverId, suggestions]);

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

        const groupedSuggestions = groupSuggestionsByBucket(suggestions);

        return (
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
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
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>

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
                            {data.autonomy.total30d > 0 ? (
                                <Text style={styles.autonomyStatsText}>
                                    {data.autonomy.decided30d} {t("world.autonomyDecided")}, {data.autonomy.autoResolved30d} {t("world.autonomyAuto")}, {data.autonomy.pending30d} {t("world.autonomyPending")}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                </View>

                {autonomyStats ? (
                    <AutonomyStatusSection stats={autonomyStats} />
                ) : null}

                {project.serverId && autonomyStats ? (
                    <GovernanceDashboard
                        projectId={project.serverId}
                        stats={autonomyStats}
                        onPolicyUpdated={() => void loadData()}
                    />
                ) : null}

                {collaboration ? (
                    <RoleCollaborationSection summary={collaboration} />
                ) : null}

                <MemberStatsSection projectId={project.serverId ?? ""} isActive={isActive} />
                <AuditLogSection projectId={project.serverId ?? ""} isActive={isActive} />

                <View style={styles.metricsGrid}>
                    <MetricCard icon="people" label={t("world.activeRoles")} value={String(data.roles.total)} color="#8B5CF6" />
                    <MetricCard icon="alert-circle" label={t("world.pendingDecisions")} value={String(data.decisions.pending)} color={data.decisions.pending > 0 ? "#F59E0B" : "#10B981"} />
                    <MetricCard icon="document-text" label={t("world.lawCount")} value={String(data.lawCount)} color="#3B82F6" onPress={project.serverId ? () => router.push(`/project/${project.id}/world-laws` as any) : undefined} />
                    <MetricCard icon="chatbubbles" label={t("world.agentMessages")} value={String(data.agentMessages.total30d)} color="#6B7280" />
                </View>

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>{t("world.goalsOverview")}</Text>
                    <View style={styles.goalsRow}>
                        <GoalStat label={t("world.goalsActive")} value={data.goals.active} color="#3B82F6" />
                        <GoalStat label={t("world.goalsCompleted")} value={data.goals.completed} color="#10B981" />
                        <GoalStat label={t("world.goalsBlocked")} value={data.goals.blocked} color="#F59E0B" />
                    </View>
                    {data.goalHealth.averageScore !== null ? (
                        <View style={styles.healthRow}>
                            <Text style={[styles.healthAvg, { color: data.goalHealth.averageScore < 30 ? "#EF4444" : data.goalHealth.averageScore <= 60 ? "#F59E0B" : "#10B981" }]}>
                                {t("world.avgHealthScore")}: {data.goalHealth.averageScore}
                            </Text>
                            <View style={styles.goalsRow}>
                                <GoalStat label={t("goals.healthCritical")} value={data.goalHealth.criticalCount} color="#EF4444" />
                                <GoalStat label={t("goals.healthWarning")} value={data.goalHealth.warningCount} color="#F59E0B" />
                                <GoalStat label={t("goals.healthHealthy")} value={data.goalHealth.healthyCount} color="#10B981" />
                            </View>
                        </View>
                    ) : null}
                </View>

                <View style={styles.suggestionsToolbar}>
                    <Text style={styles.sectionTitle}>{t("suggestions.suggestedNextSteps")}</Text>
                    <Pressable style={styles.refreshButton} onPress={handleRefreshSuggestions} disabled={suggestionsRefreshing}>
                        <Text style={styles.refreshButtonText}>
                            {suggestionsRefreshing ? t("suggestions.refreshing") : t("suggestions.refresh")}
                        </Text>
                    </Pressable>
                </View>

                <SuggestionLane
                    title={t("suggestions.suggestedNextSteps")}
                    icon="bulb-outline"
                    color="#F59E0B"
                    suggestions={groupedSuggestions.nextStep}
                    onAccept={handleAccept}
                    onDismiss={handleDismiss}
                />
                <SuggestionLane
                    title={t("decision.title")}
                    icon="help-circle-outline"
                    color="#F59E0B"
                    suggestions={groupedSuggestions.needsDecision}
                    onAccept={handleAccept}
                    onDismiss={handleDismiss}
                />
                <SuggestionLane
                    title={t("status.needsAttention")}
                    icon="hand-left-outline"
                    color="#DC2626"
                    suggestions={groupedSuggestions.needsHumanInput}
                    onAccept={handleAccept}
                    onDismiss={handleDismiss}
                />

                {suggestions.length === 0 ? (
                    <View style={styles.emptySuggestions}>
                        <Text style={styles.emptySuggestionsText}>{t("suggestions.noSuggestions")}</Text>
                        <Text style={styles.emptySuggestionsHint}>{t("suggestions.noSuggestionsHint")}</Text>
                    </View>
                ) : null}

                {(data.agentMessages.conflicts30d > 0 || data.agentMessages.lawSuggestions30d > 0) ? (
                    <View style={styles.sectionCard}>
                        <Text style={styles.sectionTitle}>{t("world.agentMessages")}</Text>
                        {data.agentMessages.conflicts30d > 0 ? (
                            <View style={styles.messageRow}>
                                <Ionicons name="warning-outline" size={16} color="#F59E0B" />
                                <Text style={styles.messageText}>{t("world.conflicts")}: {data.agentMessages.conflicts30d}</Text>
                            </View>
                        ) : null}
                        {data.agentMessages.lawSuggestions30d > 0 ? (
                            <View style={styles.messageRow}>
                                <Ionicons name="bulb-outline" size={16} color="#8B5CF6" />
                                <Text style={styles.messageText}>{t("world.lawSuggestions")}: {data.agentMessages.lawSuggestions30d}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}

                {data.decisions.recentDecided.length > 0 ? (
                    <View style={styles.sectionCard}>
                        <Text style={styles.sectionTitle}>{t("world.recentDecisions")}</Text>
                        {data.decisions.recentDecided.map((decision) => (
                            <Pressable
                                key={decision.id}
                                style={styles.decisionRow}
                                onPress={() => router.push(`/decision/${decision.id}` as any)}
                            >
                                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                                <Text style={styles.decisionText} numberOfLines={2}>{decision.question}</Text>
                                <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
                            </Pressable>
                        ))}
                    </View>
                ) : null}

                <WorldConfigSection project={project} />
            </ScrollView>
        );
    },
);

const SuggestionLane = React.memo(function SuggestionLane({
    title,
    icon,
    color,
    suggestions,
    onAccept,
    onDismiss,
}: {
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    suggestions: SuggestionSummary[];
    onAccept: (suggestion: SuggestionSummary) => void;
    onDismiss: (suggestion: SuggestionSummary) => void;
}) {
    if (suggestions.length === 0) return null;
    return (
        <View style={styles.laneSection}>
            <View style={styles.laneHeader}>
                <Ionicons name={icon} size={18} color={color} />
                <Text style={styles.sectionTitle}>{title}</Text>
            </View>
            {suggestions.map((suggestion) => (
                <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onAccept={onAccept}
                    onDismiss={onDismiss}
                />
            ))}
        </View>
    );
});

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
        return <Pressable style={styles.metricCard} onPress={onPress}>{content}</Pressable>;
    }
    return <View style={styles.metricCard}>{content}</View>;
});

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

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 24,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    centerContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
    },
    emptyText: {
        ...Typography.default("semiBold"),
        color: theme.colors.text,
        marginTop: 12,
    },
    emptyHint: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        marginTop: 4,
        textAlign: "center",
    },
    sectionCard: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
    },
    constitutionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    constitutionContent: {
        flex: 1,
        gap: 4,
    },
    constitutionHint: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.text,
    },
    autonomyCard: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
    },
    autonomyRow: {
        flexDirection: "row",
        gap: 16,
        marginTop: 12,
    },
    autonomyScoreContainer: {
        minWidth: 96,
        alignItems: "center",
        justifyContent: "center",
    },
    autonomyScoreText: {
        ...Typography.default("semiBold"),
        fontSize: 28,
    },
    autonomyLabel: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    autonomyDetails: {
        flex: 1,
        gap: 6,
    },
    autonomyDetailText: {
        ...Typography.default(),
        color: theme.colors.text,
    },
    autonomyStatsText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
    },
    metricsGrid: {
        marginHorizontal: 16,
        marginBottom: 12,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
    },
    metricCard: {
        width: "47%",
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 8,
    },
    metricValue: {
        ...Typography.default("semiBold"),
        fontSize: 22,
    },
    metricLabel: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
    },
    goalsRow: {
        flexDirection: "row",
        gap: 12,
        marginTop: 12,
    },
    healthRow: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.textSecondary + "33",
    },
    healthAvg: {
        ...Typography.default("semiBold"),
        marginBottom: 8,
    },
    goalStat: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 12,
        padding: 12,
    },
    goalStatValue: {
        ...Typography.default("semiBold"),
        fontSize: 20,
    },
    goalStatLabel: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    suggestionsToolbar: {
        marginHorizontal: 16,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    refreshButton: {
        backgroundColor: theme.colors.surface,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    refreshButtonText: {
        ...Typography.default("semiBold"),
        color: theme.colors.text,
    },
    laneSection: {
        marginBottom: 12,
    },
    laneHeader: {
        marginHorizontal: 16,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    emptySuggestions: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
    },
    emptySuggestionsText: {
        ...Typography.default("semiBold"),
        color: theme.colors.text,
    },
    emptySuggestionsHint: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    messageRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 8,
    },
    messageText: {
        ...Typography.default(),
        color: theme.colors.text,
    },
    decisionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    decisionText: {
        ...Typography.default(),
        color: theme.colors.text,
        flex: 1,
    },
}));
