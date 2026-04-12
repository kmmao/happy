import * as React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { useRouter } from "expo-router";
import {
    fetchGoals,
    cancelGoal,
    decomposeGoal,
    deleteGoal,
    replanGoal,
    type GoalSummary,
} from "@/sync/apiProjects";
import { sync } from "@/sync/sync";
import {
    STATUS_COLORS,
    type GoalFilterKey,
    filterLabel,
    isSafeId,
} from "./worldGoalConstants";
import { GoalCard } from "./GoalCard";
import { GoalCreateSheet } from "./GoalCreateSheet";

interface WorldGoalsTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldGoalsTab = React.memo(
    ({ project, isActive }: WorldGoalsTabProps) => {
        const { theme } = useUnistyles();
        const [goals, setGoals] = React.useState<GoalSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [showCreate, setShowCreate] = React.useState(false);
        const [nowTs, setNowTs] = React.useState(Date.now());
        const [filter, setFilter] = React.useState<GoalFilterKey>("all");

        const loadGoals = React.useCallback(async () => {
            if (!project.serverId) return;
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const fetched = await fetchGoals(credentials, project.serverId);
                setGoals(fetched);
            } catch {
                // best effort
            } finally {
                setLoading(false);
            }
        }, [project.serverId]);

        React.useEffect(() => {
            if (isActive) {
                void loadGoals();
            }
        }, [isActive, loadGoals]);

        React.useEffect(() => {
            if (!isActive) return;
            const timer = setInterval(() => setNowTs(Date.now()), 1000);
            return () => clearInterval(timer);
        }, [isActive]);

        React.useEffect(() => {
            if (!isActive || !project.serverId) return;

            return sync.onGoalProgress((event) => {
                if (event.projectId !== project.serverId) return;

                let shouldRefresh = false;
                setGoals((prev) => prev.map((goal) => {
                    if (goal.id !== event.goalId) return goal;
                    shouldRefresh = [
                        goal.status === "planning" && event.status === "in_progress",
                        goal.status === "planning" && event.status === "blocked",
                        goal.status === "in_progress" && event.status === "completed",
                    ].some(Boolean);
                    return {
                        ...goal,
                        status: event.status,
                        progress: event.progress,
                    };
                }));

                if (shouldRefresh) {
                    void loadGoals();
                }
            });
        }, [isActive, loadGoals, project.serverId]);

        const handleCancel = React.useCallback(async (goal: GoalSummary) => {
            const confirmed = await Modal.confirm(
                t("goals.cancelGoal"),
                t("goals.cancelGoalConfirm"),
            );
            if (!confirmed) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || !project.serverId) return;
                const updated = await cancelGoal(credentials, project.serverId, goal.id);
                setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
                Modal.toast(t("goals.cancelled"));
            } catch {
                Modal.toast(t("goals.createError"));
            }
        }, [project.serverId]);

        const handleDelete = React.useCallback(async (goal: GoalSummary) => {
            const confirmed = await Modal.confirm(
                t("goals.deleteGoal"),
                t("goals.deleteGoalConfirm"),
            );
            if (!confirmed) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || !project.serverId) return;
                await deleteGoal(credentials, project.serverId, goal.id);
                setGoals((prev) => prev.filter((g) => g.id !== goal.id));
                Modal.toast(t("goals.deleted"));
            } catch {
                Modal.toast(t("goals.createError"));
            }
        }, [project.serverId]);

        const handleDecompose = React.useCallback(async (goal: GoalSummary) => {
            if (!project.serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const updated = await decomposeGoal(credentials, project.serverId, goal.id);
                setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
                Modal.toast(t("goals.decomposeTriggered"));
            } catch {
                Modal.toast(t("goals.decomposeError"));
            }
        }, [project.serverId]);

        const handleReplan = React.useCallback(async (goal: GoalSummary) => {
            const confirmed = await Modal.confirm(
                t("goals.replan"),
                t("goals.replanConfirm"),
            );
            if (!confirmed) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || !project.serverId) return;
                await replanGoal(credentials, project.serverId, goal.id);
                setGoals((prev) => prev.map((g) =>
                    g.id === goal.id ? { ...g, status: "planning", progress: 0 } : g,
                ));
                Modal.toast(t("goals.replanTriggered"));
            } catch {
                Modal.toast(t("goals.replanError"));
            }
        }, [project.serverId]);

        const router = useRouter();

        const handleOpenGoal = React.useCallback((goalId: string) => {
            router.push(`/project/${project.id}/goal/${goalId}` as any);
        }, [project.id, router]);

        const handleViewSession = React.useCallback((sessionId: string) => {
            if (!isSafeId(sessionId)) return;
            router.push(`/session/${sessionId}` as any);
        }, [router]);

        const handleCreated = React.useCallback((goal: GoalSummary) => {
            setGoals((prev) => [goal, ...prev]);
            setShowCreate(false);
            Modal.toast(t("goals.created"));
        }, []);

        const summary = React.useMemo(() => ({
            total: goals.length,
            blocked: goals.filter((goal) => goal.status === "blocked").length,
            active: goals.filter((goal) => ["planning", "in_progress", "blocked"].includes(goal.status)).length,
            done: goals.filter((goal) => ["completed", "cancelled"].includes(goal.status)).length,
            unhealthy: goals.filter((goal) => goal.healthScore !== null && goal.healthScore < 50).length,
        }), [goals]);

        const filteredGoals = React.useMemo(() => {
            if (filter === "blocked") {
                return goals.filter((goal) => goal.status === "blocked");
            }
            if (filter === "active") {
                return goals.filter((goal) => ["planning", "in_progress", "blocked"].includes(goal.status));
            }
            if (filter === "done") {
                return goals.filter((goal) => ["completed", "cancelled"].includes(goal.status));
            }
            if (filter === "unhealthy") {
                return goals.filter((goal) => goal.healthScore !== null && goal.healthScore < 50);
            }
            return goals;
        }, [filter, goals]);

        return (
            <View style={styles.container}>
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                >
                    <View style={styles.header}>
                        <Text style={styles.title}>{t("goals.title")}</Text>
                        <Pressable style={styles.createButton} onPress={() => setShowCreate(true)}>
                            <Ionicons name="add-circle" size={22} color={theme.colors.accentPurple} />
                            <Text style={styles.createButtonText}>{t("goals.createGoal")}</Text>
                        </Pressable>
                    </View>

                    {goals.length > 0 ? (
                        <View style={styles.summaryCard}>
                            <View style={styles.summaryRow}>
                                <View style={styles.summaryItem}>
                                    <Text style={styles.summaryValue}>{summary.total}</Text>
                                    <Text style={styles.summaryLabel}>{filterLabel("all")}</Text>
                                </View>
                                <View style={styles.summaryItem}>
                                    <Text style={[styles.summaryValue, { color: STATUS_COLORS.blocked }]}>{summary.blocked}</Text>
                                    <Text style={styles.summaryLabel}>{filterLabel("blocked")}</Text>
                                </View>
                                <View style={styles.summaryItem}>
                                    <Text style={styles.summaryValue}>{summary.active}</Text>
                                    <Text style={styles.summaryLabel}>{filterLabel("active")}</Text>
                                </View>
                                <View style={styles.summaryItem}>
                                    <Text style={styles.summaryValue}>{summary.done}</Text>
                                    <Text style={styles.summaryLabel}>{filterLabel("done")}</Text>
                                </View>
                            </View>
                            <View style={styles.filterRow}>
                                {(["all", "blocked", "active", "done", "unhealthy"] as GoalFilterKey[]).map((item) => (
                                    <Pressable
                                        key={item}
                                        style={[
                                            styles.filterChip,
                                            filter === item && styles.filterChipActive,
                                        ]}
                                        onPress={() => setFilter(item)}
                                    >
                                        <Text style={[
                                            styles.filterChipText,
                                            filter === item && styles.filterChipTextActive,
                                        ]}>
                                            {filterLabel(item)}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>
                    ) : null}

                    {loading && goals.length === 0 ? (
                        <ActivityIndicator style={{ marginTop: 40 }} />
                    ) : filteredGoals.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="flag-outline" size={48} color={theme.colors.textSecondary} />
                            <Text style={styles.emptyText}>{t("goals.emptyGoals")}</Text>
                            <Text style={styles.emptyHint}>{t("goals.emptyGoalsHint")}</Text>
                        </View>
                    ) : (
                        filteredGoals.map((goal) => (
                            <GoalCard
                                key={goal.id}
                                goal={goal}
                                nowTs={nowTs}
                                onDecompose={handleDecompose}
                                onCancel={handleCancel}
                                onDelete={handleDelete}
                                onOpenGoal={handleOpenGoal}
                                onViewSession={handleViewSession}
                                onReplan={handleReplan}
                            />
                        ))
                    )}
                </ScrollView>

                {showCreate && (
                    <GoalCreateSheet
                        project={project}
                        onCreated={handleCreated}
                        onClose={() => setShowCreate(false)}
                    />
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 17,
        color: theme.colors.text,
    },
    createButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
    },
    createButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.accentPurple,
    },
    summaryCard: {
        marginHorizontal: 16,
        marginBottom: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        gap: 12,
    },
    summaryRow: {
        flexDirection: "row" as const,
        gap: 10,
    },
    summaryItem: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 10,
        padding: 10,
    },
    summaryValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    summaryLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    filterRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
    },
    filterChipActive: {
        backgroundColor: theme.colors.accentPurple,
    },
    filterChipText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    filterChipTextActive: {
        color: "#fff",
    },
    emptyContainer: {
        alignItems: "center" as const,
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
}));
