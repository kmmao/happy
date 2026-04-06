import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, Switch, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import {
    fetchGoals,
    createGoal,
    cancelGoal,
    decomposeGoal,
    deleteGoal,
    type GoalSummary,
} from "@/sync/apiProjects";

// === Status / Priority Helpers ===

const STATUS_COLORS: Record<string, string> = {
    planning: "#8B5CF6",
    in_progress: "#3B82F6",
    blocked: "#F59E0B",
    completed: "#10B981",
    cancelled: "#6B7280",
};

const STATUS_ICONS: Record<string, string> = {
    planning: "hourglass-outline",
    in_progress: "play-circle",
    blocked: "warning-outline",
    completed: "checkmark-circle",
    cancelled: "close-circle",
};

const PRIORITY_COLORS: Record<string, string> = {
    urgent: "#DC2626",
    normal: "#3B82F6",
    low: "#6B7280",
};
const PLANNER_TIMEOUT_MS = 10 * 60 * 1000;

function statusLabel(goal: GoalSummary): string {
    if (goal.status === "planning") {
        return goal.plannerTaskId ? t("goals.statusPlanningRunning") : t("goals.statusPlanningPending");
    }
    const map: Record<string, () => string> = {
        in_progress: () => t("goals.statusInProgress"),
        blocked: () => t("goals.statusBlocked"),
        completed: () => t("goals.statusCompleted"),
        cancelled: () => t("goals.statusCancelled"),
    };
    return map[goal.status]?.() ?? goal.status;
}

function priorityLabel(priority: string): string {
    const map: Record<string, () => string> = {
        urgent: () => t("goals.priorityUrgent"),
        normal: () => t("goals.priorityNormal"),
        low: () => t("goals.priorityLow"),
    };
    return map[priority]?.() ?? priority;
}

function isPlannerTimeoutBlocked(goal: GoalSummary): boolean {
    return goal.status === "blocked" && Boolean(goal.plannerTaskId) && goal.taskCount === 0;
}

// === Main Component ===

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
                loadGoals();
            }
        }, [isActive, loadGoals]);

        React.useEffect(() => {
            if (!isActive) return;
            const timer = setInterval(() => setNowTs(Date.now()), 1000);
            return () => clearInterval(timer);
        }, [isActive]);

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

        const handleCreated = React.useCallback((goal: GoalSummary) => {
            setGoals((prev) => [goal, ...prev]);
            setShowCreate(false);
            Modal.toast(t("goals.created"));
        }, []);

        // Group goals: active first, then completed/cancelled
        const activeGoals = goals.filter((g) => !["completed", "cancelled"].includes(g.status));
        const doneGoals = goals.filter((g) => ["completed", "cancelled"].includes(g.status));

        return (
            <View style={styles.container}>
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>{t("goals.title")}</Text>
                        <Pressable style={styles.createButton} onPress={() => setShowCreate(true)}>
                            <Ionicons name="add-circle" size={22} color={theme.colors.accentPurple} />
                            <Text style={styles.createButtonText}>{t("goals.createGoal")}</Text>
                        </Pressable>
                    </View>

                    {loading && goals.length === 0 ? (
                        <ActivityIndicator style={{ marginTop: 40 }} />
                    ) : goals.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="flag-outline" size={48} color={theme.colors.textSecondary} />
                            <Text style={styles.emptyText}>{t("goals.emptyGoals")}</Text>
                            <Text style={styles.emptyHint}>{t("goals.emptyGoalsHint")}</Text>
                        </View>
                    ) : (
                        <>
                            {activeGoals.map((goal) => (
                                <GoalCard
                                    key={goal.id}
                                    goal={goal}
                                    nowTs={nowTs}
                                    onDecompose={handleDecompose}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete}
                                />
                            ))}
                            {doneGoals.length > 0 && activeGoals.length > 0 && (
                                <View style={styles.divider} />
                            )}
                            {doneGoals.map((goal) => (
                                <GoalCard
                                    key={goal.id}
                                    goal={goal}
                                    nowTs={nowTs}
                                    onDecompose={handleDecompose}
                                    onCancel={handleCancel}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </>
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

// === Goal Card ===

const GoalCard = React.memo(function GoalCard({
    goal,
    nowTs,
    onDecompose,
    onCancel,
    onDelete,
}: {
    goal: GoalSummary;
    nowTs: number;
    onDecompose: (goal: GoalSummary) => void;
    onCancel: (goal: GoalSummary) => void;
    onDelete: (goal: GoalSummary) => void;
}) {
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

    return (
        <View style={[styles.goalCard, isTerminal && { opacity: 0.6 }]}>
            {/* Top row: status + title + priority badge */}
            <View style={styles.goalCardHeader}>
                <Ionicons name={statusIcon as any} size={20} color={statusColor} />
                <Text style={styles.goalTitle} numberOfLines={2}>{goal.title}</Text>
                <View style={[styles.priorityBadge, { backgroundColor: priorityColor }]}>
                    <Text style={styles.priorityBadgeText}>{priorityLabel(goal.priority)}</Text>
                </View>
            </View>

            {/* Progress bar */}
            {!isTerminal && !isPlanning && (
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
            )}

            {/* Planner working indicator */}
            {isPlanningRunning && (
                <View style={styles.plannerRow}>
                    <ActivityIndicator size="small" color={statusColor} />
                    <Text style={styles.plannerText}>
                        {t("goals.plannerWorking")} · {t("goals.plannerCountdown", { time: plannerCountdown })}
                    </Text>
                </View>
            )}
            {isPlanningPending && (
                <View style={styles.plannerRow}>
                    <Ionicons name="pause-circle-outline" size={16} color={statusColor} />
                    <Text style={styles.plannerText}>{t("goals.plannerPending")}</Text>
                </View>
            )}
            {showPlannerTimeoutBlocked && (
                <View style={styles.plannerRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={statusColor} />
                    <Text style={styles.plannerText}>{t("goals.plannerTimeoutBlocked")}</Text>
                </View>
            )}

            {/* Meta row */}
            <View style={styles.metaRow}>
                <Text style={[styles.statusBadge, { color: statusColor }]}>
                    {statusLabel(goal)}
                </Text>
                {goal.taskCount > 0 && (
                    <Text style={styles.metaText}>{t("goals.tasks", { count: goal.taskCount })}</Text>
                )}
                {goal.subGoalCount > 0 && (
                    <Text style={styles.metaText}>{t("goals.subGoals", { count: goal.subGoalCount })}</Text>
                )}
                {goal.deadline && (
                    <Text style={styles.metaText}>
                        {new Date(goal.deadline).toLocaleDateString()}
                    </Text>
                )}
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
                {canManualDecompose && (
                    <Pressable
                        style={styles.actionButton}
                        onPress={() => onDecompose(goal)}
                    >
                        <Ionicons name="play-outline" size={16} color={theme.colors.accentPurple} />
                        <Text style={[styles.actionText, { color: theme.colors.accentPurple }]}>
                            {showPlannerTimeoutBlocked ? t("goals.retryDecompose") : t("goals.startDecompose")}
                        </Text>
                    </Pressable>
                )}
                {!isTerminal && (
                    <Pressable
                        style={styles.actionButton}
                        onPress={() => onCancel(goal)}
                    >
                        <Ionicons name="close-circle-outline" size={16} color={theme.colors.deleteAction} />
                        <Text style={[styles.actionText, { color: theme.colors.deleteAction }]}>
                            {t("goals.cancelGoal")}
                        </Text>
                    </Pressable>
                )}
                {isTerminal && (
                    <Pressable
                        style={styles.actionButton}
                        onPress={() => onDelete(goal)}
                    >
                        <Ionicons name="trash-outline" size={16} color={theme.colors.deleteAction} />
                        <Text style={[styles.actionText, { color: theme.colors.deleteAction }]}>
                            {t("goals.deleteGoal")}
                        </Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
});

// === Goal Create Sheet ===

interface GoalCreateSheetProps {
    project: Project;
    onCreated: (goal: GoalSummary) => void;
    onClose: () => void;
}

const GoalCreateSheet = React.memo(function GoalCreateSheet({
    project,
    onCreated,
    onClose,
}: GoalCreateSheetProps) {
    const { theme } = useUnistyles();
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [priority, setPriority] = React.useState("normal");
    const [autoDecompose, setAutoDecompose] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    const handleSave = React.useCallback(async () => {
        if (!title.trim() || !project.serverId) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const goal = await createGoal(credentials, project.serverId, {
                title: title.trim(),
                description: description.trim() || undefined,
                priority,
                machineId: project.key.machineId,
                autoDecompose,
            });
            onCreated(goal);
        } catch {
            Modal.toast(t("goals.createError"));
        } finally {
            setSaving(false);
        }
    }, [title, description, priority, autoDecompose, project.serverId, project.key.machineId, onCreated]);

    return (
        <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={onClose} />
            <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{t("goals.createGoal")}</Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {/* Title */}
                    <Text style={styles.fieldLabel}>{t("goals.goalTitle")}</Text>
                    <TextInput
                        style={styles.textInput}
                        value={title}
                        onChangeText={setTitle}
                        placeholder={t("goals.goalTitlePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        maxLength={500}
                        autoFocus
                    />

                    {/* Description */}
                    <Text style={styles.fieldLabel}>{t("goals.goalDescription")}</Text>
                    <TextInput
                        style={[styles.textInput, { minHeight: 80 }]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder={t("goals.goalDescriptionPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        textAlignVertical="top"
                        maxLength={5000}
                    />

                    {/* Priority */}
                    <Text style={styles.fieldLabel}>{t("goals.goalPriority")}</Text>
                    <View style={styles.chipRow}>
                        {(["urgent", "normal", "low"] as const).map((p) => (
                            <Pressable
                                key={p}
                                style={[
                                    styles.chip,
                                    priority === p && { backgroundColor: PRIORITY_COLORS[p] },
                                ]}
                                onPress={() => setPriority(p)}
                            >
                                <Text style={[styles.chipText, priority === p && { color: "#fff" }]}>
                                    {priorityLabel(p)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Auto-decompose */}
                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>{t("goals.autoDecompose")}</Text>
                        <Switch value={autoDecompose} onValueChange={setAutoDecompose} />
                    </View>

                    {/* Actions */}
                    <View style={styles.modalActions}>
                        <View style={{ flex: 1 }} />
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.confirmButton, (!title.trim() || saving) && { opacity: 0.4 }]}
                            disabled={!title.trim() || saving}
                            onPress={handleSave}
                        >
                            {saving ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.confirmButtonText}>{t("common.save")}</Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
});

// === Styles ===

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
    divider: {
        height: 1,
        backgroundColor: theme.colors.textSecondary,
        opacity: 0.2,
        marginHorizontal: 16,
        marginVertical: 12,
    },

    // Goal Card
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

    // Create Sheet
    modalOverlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "flex-start" as const,
        alignItems: "center" as const,
        zIndex: 100,
    },
    modalBackdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "transparent",
    },
    modalScroll: {
        width: "90%" as const,
        maxWidth: 440,
        maxHeight: "100%" as const,
    },
    modalScrollContent: {
        flexGrow: 1,
        justifyContent: "flex-start" as const,
        paddingTop: 16,
        paddingBottom: 16,
    },
    modalContent: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 20,
    },
    modalHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: 4,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    closeButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.groupped.background,
    },
    fieldLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 6,
        marginTop: 12,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
    },
    chipRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.groupped.background,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    switchRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginTop: 16,
    },
    switchLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    modalActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 20,
        gap: 10,
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.groupped.background,
    },
    cancelButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    confirmButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    confirmButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#fff",
    },
}));
