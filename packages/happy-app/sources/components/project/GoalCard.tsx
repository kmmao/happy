import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import type { GoalSummary } from "@/sync/apiProjects";
import {
    STATUS_COLORS,
    STATUS_ICONS,
    PRIORITY_COLORS,
    TASK_STATUS_COLORS,
    TASK_STATUS_ICONS,
    PLANNER_TIMEOUT_MS,
    statusLabel,
    priorityLabel,
    isSafeId,
    isPlannerTimeoutBlocked,
} from "./worldGoalConstants";

interface GoalCardProps {
    goal: GoalSummary;
    nowTs: number;
    onDecompose: (goal: GoalSummary) => void;
    onCancel: (goal: GoalSummary) => void;
    onDelete: (goal: GoalSummary) => void;
    onOpenGoal: (goalId: string) => void;
    onViewSession: (sessionId: string) => void;
}

export const GoalCard = React.memo(function GoalCard({
    goal,
    nowTs,
    onDecompose,
    onCancel,
    onDelete,
    onOpenGoal,
    onViewSession,
}: GoalCardProps) {
    const { theme } = useUnistyles();
    const statusColor = STATUS_COLORS[goal.status] ?? "#6B7280";
    const statusIcon = STATUS_ICONS[goal.status] ?? "help-circle";
    const priorityColor = PRIORITY_COLORS[goal.priority] ?? "#6B7280";
    const isTerminal = ["completed", "cancelled"].includes(goal.status);
    const isPlanning = goal.status === "planning";
    const isPlanningRunning = isPlanning && Boolean(goal.plannerTaskId);
    const isPlanningPending = isPlanning && !goal.plannerTaskId;
    const showPlannerTimeoutBlocked = isPlannerTimeoutBlocked(goal);
    const canManualDecompose = (isPlanningPending || showPlannerTimeoutBlocked) && !isTerminal;
    const plannerRemainingMs = isPlanningRunning
        ? Math.max(0, goal.updatedAt + PLANNER_TIMEOUT_MS - nowTs)
        : 0;
    const plannerCountdown = `${Math.floor(plannerRemainingMs / 60000)}:${Math.floor((plannerRemainingMs % 60000) / 1000).toString().padStart(2, "0")}`;

    const nonPlannerTasks = React.useMemo(
        () => (goal.tasks ?? []).filter((t) => t.id !== goal.plannerTaskId),
        [goal.tasks, goal.plannerTaskId],
    );
    const tasksWithSession = React.useMemo(
        () => (goal.tasks ?? []).filter((t) => t.sessionId),
        [goal.tasks],
    );

    return (
        <Pressable onPress={() => onOpenGoal(goal.id)}>
            <View style={[styles.goalCard, isTerminal && { opacity: 0.6 }]}>
                <View style={styles.goalCardHeader}>
                    <Ionicons name={statusIcon as any} size={20} color={statusColor} />
                    <Text style={styles.goalTitle} numberOfLines={2}>{goal.title}</Text>
                    <View style={[styles.priorityBadge, { backgroundColor: priorityColor }]}>
                        <Text style={styles.priorityBadgeText}>{priorityLabel(goal.priority)}</Text>
                    </View>
                </View>

                {goal.blocker ? (
                    <View style={styles.blockerBanner}>
                        <Ionicons name="warning-outline" size={14} color={STATUS_COLORS.blocked} />
                        <Text style={styles.blockerText} numberOfLines={2}>{goal.blocker.summary}</Text>
                    </View>
                ) : null}

                {!isTerminal && !isPlanning ? (
                    <View style={styles.progressContainer}>
                        <View style={styles.progressBar}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        width: `${goal.progress}%` as any,
                                        backgroundColor: statusColor,
                                    },
                                ]}
                            />
                        </View>
                        <Text style={styles.progressText}>{t("goals.progress", { value: goal.progress })}</Text>
                    </View>
                ) : null}

                {isPlanningRunning ? (
                    <View style={styles.plannerRow}>
                        <ActivityIndicator size="small" color={statusColor} />
                        <Text style={styles.plannerText}>
                            {t("goals.plannerWorking")} · {t("goals.plannerCountdown", { time: plannerCountdown })}
                        </Text>
                    </View>
                ) : null}
                {isPlanningPending ? (
                    <View style={styles.plannerRow}>
                        <Ionicons name="pause-circle-outline" size={16} color={statusColor} />
                        <Text style={styles.plannerText}>{t("goals.plannerPending")}</Text>
                    </View>
                ) : null}
                {showPlannerTimeoutBlocked ? (
                    <View style={styles.plannerRow}>
                        <Ionicons name="alert-circle-outline" size={16} color={statusColor} />
                        <Text style={styles.plannerText}>{t("goals.plannerTimeoutBlocked")}</Text>
                    </View>
                ) : null}

                {nonPlannerTasks.length > 0 ? (
                    <View style={styles.taskListContainer}>
                        {nonPlannerTasks.slice(0, 2).map((task, idx) => {
                            const tColor = TASK_STATUS_COLORS[task.status] ?? "#6B7280";
                            const tIcon = TASK_STATUS_ICONS[task.status] ?? "help-circle-outline";
                            return (
                                <Pressable
                                    key={task.id}
                                    style={styles.taskRow}
                                    disabled={!task.sessionId || !isSafeId(task.sessionId)}
                                    onPress={() => task.sessionId && isSafeId(task.sessionId) && onViewSession(task.sessionId)}
                                >
                                    <Ionicons name={tIcon as any} size={14} color={tColor} />
                                    <Text style={[styles.taskLabel, { color: tColor }]} numberOfLines={1}>
                                        {task.title ?? t("goals.taskIndex", { index: idx + 1 })}
                                    </Text>
                                    <Text style={styles.taskStatus}>{task.status}</Text>
                                    {task.sessionId ? (
                                        <Ionicons name="open-outline" size={12} color={theme.colors.textLink} style={{ marginLeft: 2 }} />
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}

                <View style={styles.metaRow}>
                    <Text style={[styles.statusBadge, { color: statusColor }]}>
                        {statusLabel(goal)}
                    </Text>
                    {goal.taskCount > 0 ? (
                        <Text style={styles.metaText}>{t("goals.tasks", { count: goal.taskCount })}</Text>
                    ) : null}
                    {goal.subGoalCount > 0 ? (
                        <Text style={styles.metaText}>{t("goals.subGoals", { count: goal.subGoalCount })}</Text>
                    ) : null}
                    {goal.deadline ? (
                        <Text style={styles.metaText}>
                            {new Date(goal.deadline).toLocaleDateString()}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.actionRow}>
                    {canManualDecompose ? (
                        <Pressable
                            style={styles.actionButton}
                            onPress={() => onDecompose(goal)}
                        >
                            <Ionicons name="play-outline" size={16} color={theme.colors.accentPurple} />
                            <Text style={[styles.actionText, { color: theme.colors.accentPurple }]}>
                                {showPlannerTimeoutBlocked ? t("goals.retryDecompose") : t("goals.startDecompose")}
                            </Text>
                        </Pressable>
                    ) : null}
                    {tasksWithSession.length > 0 ? (
                        <Pressable
                            style={styles.actionButton}
                            onPress={() => onViewSession(tasksWithSession[0].sessionId!)}
                        >
                            <Ionicons name="terminal-outline" size={16} color={theme.colors.textLink} />
                            <Text style={[styles.actionText, { color: theme.colors.textLink }]}>
                                {t("goals.viewSession")}
                            </Text>
                        </Pressable>
                    ) : null}
                    {!isTerminal ? (
                        <Pressable
                            style={styles.actionButton}
                            onPress={() => onCancel(goal)}
                        >
                            <Ionicons name="close-circle-outline" size={16} color={theme.colors.deleteAction} />
                            <Text style={[styles.actionText, { color: theme.colors.deleteAction }]}>
                                {t("goals.cancelGoal")}
                            </Text>
                        </Pressable>
                    ) : null}
                    {isTerminal ? (
                        <Pressable
                            style={styles.actionButton}
                            onPress={() => onDelete(goal)}
                        >
                            <Ionicons name="trash-outline" size={16} color={theme.colors.deleteAction} />
                            <Text style={[styles.actionText, { color: theme.colors.deleteAction }]}>
                                {t("goals.deleteGoal")}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    goalCard: {
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
    },
    goalCardHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    goalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    priorityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    priorityBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        color: "#fff",
        textTransform: "uppercase" as const,
    },
    blockerBanner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        marginTop: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: theme.colors.groupped.background,
    },
    blockerText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.text,
        flex: 1,
    },
    progressContainer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 10,
        gap: 8,
    },
    progressBar: {
        flex: 1,
        height: 6,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 3,
        overflow: "hidden" as const,
    },
    progressFill: {
        height: "100%" as const,
        borderRadius: 3,
    },
    progressText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
        minWidth: 36,
        textAlign: "right" as const,
    },
    plannerRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 10,
        gap: 8,
    },
    plannerText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        fontStyle: "italic" as const,
    },
    taskListContainer: {
        marginTop: 10,
        gap: 4,
    },
    taskRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 3,
        paddingHorizontal: 4,
        borderRadius: 6,
    },
    taskLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        flex: 1,
    },
    taskStatus: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    metaRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 8,
        gap: 10,
        flexWrap: "wrap" as const,
    },
    statusBadge: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    metaText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    actionRow: {
        flexDirection: "row" as const,
        marginTop: 8,
        gap: 12,
    },
    actionButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingVertical: 4,
    },
    actionText: {
        ...Typography.default(),
        fontSize: 12,
    },
}));
