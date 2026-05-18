import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { ToolSectionView } from "../../tools/ToolSectionView";
import { type ToolViewProps } from "./_all";
import { t } from "@/text";

interface TaskItem {
    id?: string;
    subject?: string;
    description?: string;
    status?: string;
    activeForm?: string;
    blockedBy?: string[];
}

function getStatusTone(
    theme: ReturnType<typeof useUnistyles>["theme"],
    status: string | undefined,
): {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    railColor: string;
    surfaceColor: string;
    borderColor: string;
    textColor: string;
    subtitleColor: string;
    contentStyle?: object;
} {
    if (status === "completed") {
        return {
            icon: "checkmark-circle",
            iconColor: theme.colors.success,
            railColor: theme.colors.success + "30",
            surfaceColor: theme.colors.success + "0d",
            borderColor: theme.colors.success + "18",
            textColor: theme.colors.text,
            subtitleColor: theme.colors.success,
            contentStyle: {
                textDecorationLine: "line-through" as const,
                opacity: 0.78,
            },
        };
    }

    if (status === "in_progress") {
        return {
            icon: "ellipse",
            iconColor: theme.colors.accentBlue,
            railColor: theme.colors.accentBlue + "30",
            surfaceColor: theme.colors.accentBlue + "0d",
            borderColor: theme.colors.accentBlue + "18",
            textColor: theme.colors.text,
            subtitleColor: theme.colors.accentBlue,
        };
    }

    if (status === "deleted") {
        return {
            icon: "close-circle",
            iconColor: theme.colors.textDestructive,
            railColor: theme.colors.textDestructive + "30",
            surfaceColor: theme.colors.textDestructive + "0d",
            borderColor: theme.colors.textDestructive + "18",
            textColor: theme.colors.textSecondary,
            subtitleColor: theme.colors.textDestructive,
            contentStyle: {
                textDecorationLine: "line-through" as const,
                opacity: 0.5,
            },
        };
    }

    return {
        icon: "square-outline",
        iconColor: theme.colors.textSecondary,
        railColor: theme.colors.textSecondary + "28",
        surfaceColor: theme.colors.surfaceHigh,
        borderColor: theme.colors.divider,
        textColor: theme.colors.text,
        subtitleColor: theme.colors.textSecondary,
    };
}

function extractTasksFromResult(result: any): TaskItem[] | null {
    if (!result) return null;
    if (Array.isArray(result)) {
        return result as TaskItem[];
    }
    if (typeof result === "object" && Array.isArray(result.tasks)) {
        return result.tasks as TaskItem[];
    }
    return null;
}

function countByStatus(tasks: TaskItem[]): {
    completed: number;
    inProgress: number;
    pending: number;
    total: number;
} {
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    for (const task of tasks) {
        if (task.status === "completed") completed++;
        else if (task.status === "in_progress") inProgress++;
        else pending++;
    }
    return { completed, inProgress, pending, total: tasks.length };
}

const MAX_VISIBLE_TASKS = 5;

function collapseTaskList(tasks: TaskItem[]): {
    visible: TaskItem[];
    hiddenCount: number;
    didCollapse: boolean;
} {
    if (tasks.length <= MAX_VISIBLE_TASKS) {
        return { visible: tasks, hiddenCount: 0, didCollapse: false };
    }
    const inProgress: TaskItem[] = [];
    const pending: TaskItem[] = [];
    const completed: TaskItem[] = [];
    for (const task of tasks) {
        if (task.status === "in_progress") inProgress.push(task);
        else if (task.status === "completed") completed.push(task);
        else pending.push(task);
    }
    const priority = [...inProgress, ...pending, ...completed];
    return {
        visible: priority.slice(0, MAX_VISIBLE_TASKS),
        hiddenCount: tasks.length - MAX_VISIBLE_TASKS,
        didCollapse: true,
    };
}

function MetricBadge(props: {
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
    tone: { backgroundColor: string; borderColor: string; color: string };
}) {
    return (
        <View
            style={[
                styles.metricBadge,
                {
                    backgroundColor: props.tone.backgroundColor,
                    borderColor: props.tone.borderColor,
                },
            ]}
        >
            <Ionicons name={props.icon} size={11} color={props.tone.color} />
            <Text style={[styles.metricBadgeText, { color: props.tone.color }]}>
                {props.text}
            </Text>
        </View>
    );
}

function TaskCard({ task, isLast }: { task: TaskItem; isLast: boolean }) {
    const { theme } = useUnistyles();
    const tone = getStatusTone(theme, task.status);
    const subtitle =
        task.status === "in_progress"
            ? (task.activeForm ?? task.description ?? null)
            : (task.description ?? null);
    const isBlocked =
        Array.isArray(task.blockedBy) && task.blockedBy.length > 0;

    return (
        <View style={styles.timelineRow}>
            <View style={styles.railColumn}>
                <Ionicons
                    name={tone.icon}
                    size={15}
                    color={tone.iconColor}
                    style={styles.railIcon}
                />
                {!isLast ? (
                    <View
                        style={[
                            styles.railLine,
                            { backgroundColor: tone.railColor },
                        ]}
                    />
                ) : null}
            </View>
            <View
                style={[
                    styles.todoCard,
                    {
                        backgroundColor: tone.surfaceColor,
                        borderColor: tone.borderColor,
                    },
                ]}
            >
                <Text
                    style={[
                        styles.todoContent,
                        { color: tone.textColor },
                        tone.contentStyle,
                    ]}
                    numberOfLines={2}
                >
                    {task.id ? `#${task.id} ` : ""}
                    {task.subject ?? "Task"}
                </Text>
                {subtitle ? (
                    <Text
                        style={[
                            styles.todoSubtitle,
                            { color: tone.subtitleColor },
                        ]}
                        numberOfLines={2}
                    >
                        {subtitle}
                    </Text>
                ) : null}
                {isBlocked ? (
                    <Text
                        style={[
                            styles.todoSubtitle,
                            { color: theme.colors.accentOrange },
                        ]}
                        numberOfLines={1}
                    >
                        blocked by #{task.blockedBy!.join(", #")}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

export const TaskManagementView = React.memo<ToolViewProps>(
    function TaskManagementView({ tool }) {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);

        if (tool.name === "TaskCreate") {
            const resultId =
                typeof tool.result === "string"
                    ? tool.result.match(/#(\d+)/)?.[1]
                    : undefined;
            const task: TaskItem = {
                id: resultId,
                subject: tool.input?.subject,
                description: tool.input?.description,
                status: "pending",
                activeForm: tool.input?.activeForm,
            };
            if (!task.subject) return null;
            return (
                <ToolSectionView>
                    <View style={styles.timelineList}>
                        <TaskCard task={task} isLast={true} />
                    </View>
                </ToolSectionView>
            );
        }

        if (tool.name === "TaskUpdate") {
            const task: TaskItem = {
                id: tool.input?.taskId,
                subject: tool.input?.subject,
                description: tool.input?.description,
                status: tool.input?.status,
                activeForm: tool.input?.activeForm,
            };
            if (!task.subject && !task.description) return null;
            return (
                <ToolSectionView>
                    <View style={styles.timelineList}>
                        <TaskCard task={task} isLast={true} />
                    </View>
                </ToolSectionView>
            );
        }

        if (tool.name === "TaskList") {
            const tasks = extractTasksFromResult(tool.result);
            if (!tasks || tasks.length === 0) return null;

            const counts = countByStatus(tasks);
            const collapsed = collapseTaskList(tasks);
            const visibleTasks = expanded ? tasks : collapsed.visible;

            return (
                <ToolSectionView>
                    <View style={styles.timelineList}>
                        {visibleTasks.map((task, index) => (
                            <TaskCard
                                key={task.id ?? `task-${index}`}
                                task={task}
                                isLast={index === visibleTasks.length - 1}
                            />
                        ))}
                    </View>
                    {collapsed.didCollapse ? (
                        <Pressable
                            onPress={() => setExpanded((v) => !v)}
                            hitSlop={8}
                            style={styles.toggleButton}
                        >
                            <Text
                                style={[
                                    styles.toggleText,
                                    { color: theme.colors.accentBlue },
                                ]}
                            >
                                {expanded
                                    ? t("sidePanel.collapse")
                                    : t("session.progressShowAll", {
                                          n: collapsed.hiddenCount,
                                      })}
                            </Text>
                            <Ionicons
                                name={
                                    expanded ? "chevron-up" : "chevron-down"
                                }
                                size={12}
                                color={theme.colors.accentBlue}
                            />
                        </Pressable>
                    ) : null}
                    <View style={styles.metricsRow}>
                        {counts.completed > 0 ? (
                            <MetricBadge
                                icon="checkmark-circle"
                                text={t(
                                    "session.progressLegendCompleted",
                                    { n: counts.completed },
                                )}
                                tone={{
                                    backgroundColor:
                                        theme.colors.success + "12",
                                    borderColor:
                                        theme.colors.success + "20",
                                    color: theme.colors.success,
                                }}
                            />
                        ) : null}
                        {counts.inProgress > 0 ? (
                            <MetricBadge
                                icon="ellipse"
                                text={t(
                                    "session.progressLegendInProgress",
                                    { n: counts.inProgress },
                                )}
                                tone={{
                                    backgroundColor:
                                        theme.colors.accentBlue + "12",
                                    borderColor:
                                        theme.colors.accentBlue + "20",
                                    color: theme.colors.accentBlue,
                                }}
                            />
                        ) : null}
                        {counts.pending > 0 ? (
                            <MetricBadge
                                icon="square-outline"
                                text={t(
                                    "session.progressLegendPending",
                                    { n: counts.pending },
                                )}
                                tone={{
                                    backgroundColor:
                                        theme.colors.textSecondary + "10",
                                    borderColor:
                                        theme.colors.textSecondary + "18",
                                    color: theme.colors.textSecondary,
                                }}
                            />
                        ) : null}
                    </View>
                </ToolSectionView>
            );
        }

        return null;
    },
);

const styles = StyleSheet.create((_theme) => ({
    container: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
        gap: 12,
    },
    metricsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    metricBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    metricBadgeText: {
        fontSize: 11,
        fontWeight: "600",
    },
    timelineList: {
        gap: 0,
    },
    timelineRow: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 10,
    },
    railColumn: {
        width: 18,
        alignItems: "center",
    },
    railIcon: {
        marginTop: 6,
    },
    railLine: {
        width: 2,
        flex: 1,
        marginTop: 4,
        marginBottom: -4,
        borderRadius: 999,
    },
    todoCard: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 11,
        paddingVertical: 10,
        marginBottom: 8,
        gap: 4,
    },
    todoContent: {
        fontSize: 14,
        lineHeight: 20,
    },
    todoSubtitle: {
        fontSize: 12,
        lineHeight: 17,
    },
    toggleButton: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 2,
        marginLeft: 28,
    },
    toggleText: {
        fontSize: 12,
        fontWeight: "600",
    },
}));
