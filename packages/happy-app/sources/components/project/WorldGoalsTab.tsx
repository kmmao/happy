import * as React from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
    STATUS_COLORS,
    type GoalFilterKey,
    filterLabel,
    isSafeId,
} from "./worldGoalConstants";
import { GoalCard } from "./GoalCard";
import { GoalCreateSheet } from "./GoalCreateSheet";
import { SharedStateView } from "@/components/SharedStateView";
import { deriveWorldTabCollectionScreenState } from "./worldTabCollectionViewModel";
import { useWorldGoalsData } from "@/hooks/useWorldGoalsData";
import { useWorldGoalsCrud } from "@/hooks/useWorldGoalsCrud";

interface WorldGoalsTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldGoalsTab = React.memo(
    ({ project, isActive }: WorldGoalsTabProps) => {
        const { theme } = useUnistyles();
        const {
            goals,
            setGoals,
            loading,
            error: loadError,
            refresh: loadGoals,
        } = useWorldGoalsData(project.serverId, isActive);
        const {
            createGoal,
            cancelGoal,
            deleteGoal,
            decomposeGoal,
            replanGoal,
        } = useWorldGoalsCrud({
            projectServerId: project.serverId,
            machineId: project.key.machineId,
            setGoals,
        });
        const [showCreate, setShowCreate] = React.useState(false);
        const [nowTs, setNowTs] = React.useState(Date.now());
        const [filter, setFilter] = React.useState<GoalFilterKey>("all");

        React.useEffect(() => {
            if (!isActive) return;
            const timer = setInterval(() => setNowTs(Date.now()), 1000);
            return () => clearInterval(timer);
        }, [isActive]);

        const router = useRouter();

        const handleOpenGoal = React.useCallback((goalId: string) => {
            router.push(`/project/${project.id}/goal/${goalId}` as any);
        }, [project.id, router]);

        const handleViewSession = React.useCallback((sessionId: string) => {
            if (!isSafeId(sessionId)) return;
            router.push(`/session/${sessionId}` as any);
        }, [router]);

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

        const goalsScreenState = React.useMemo(
            () =>
                deriveWorldTabCollectionScreenState({
                    loading,
                    error: loadError,
                    totalCount: goals.length,
                    visibleCount: filteredGoals.length,
                }),
            [filteredGoals.length, goals.length, loadError, loading],
        );

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

                    {goalsScreenState.screenKind === "loading" ? (
                        <SharedStateView
                            inline
                            kind="loading"
                            title={t("common.loading")}
                        />
                    ) : goalsScreenState.screenKind === "error" ? (
                        <SharedStateView
                            inline
                            kind="error"
                            title={t("common.error")}
                            description={goalsScreenState.requestState.error ?? undefined}
                            onAction={() => {
                                void loadGoals();
                            }}
                        />
                    ) : goalsScreenState.screenKind === "empty" ? (
                        <SharedStateView
                            inline
                            kind="empty"
                            title={t("goals.emptyGoals")}
                            description={t("goals.emptyGoalsHint")}
                            icon={
                                <Ionicons
                                    name="flag-outline"
                                    size={48}
                                    color={theme.colors.textSecondary}
                                />
                            }
                        />
                    ) : (
                        filteredGoals.map((goal) => (
                            <GoalCard
                                key={goal.id}
                                goal={goal}
                                nowTs={nowTs}
                                onDecompose={decomposeGoal}
                                onCancel={cancelGoal}
                                onDelete={deleteGoal}
                                onOpenGoal={handleOpenGoal}
                                onViewSession={handleViewSession}
                                onReplan={replanGoal}
                            />
                        ))
                    )}
                </ScrollView>

                {showCreate && (
                    <GoalCreateSheet
                        onSave={async (input) => {
                            const didCreate = await createGoal(input);
                            if (didCreate) {
                                setShowCreate(false);
                            }
                            return didCreate;
                        }}
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
