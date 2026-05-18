import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { ToolSectionView } from "../../tools/ToolSectionView";
import { type ToolViewProps } from "./_all";
import { t } from "@/text";
import { storage } from "@/sync/storage";
import type { Message } from "@/sync/typesMessage";

export type TaskSubjectMap = ReadonlyMap<string, string>;

const TASK_CREATED_RE = /Task #(\d+) created/;
const emptyMessages: readonly Message[] = [];
const emptyMap: TaskSubjectMap = new Map();

function extractResultText(result: any): string {
    if (typeof result === "string") return result;
    if (Array.isArray(result)) {
        for (const block of result) {
            if (block?.type === "text" && typeof block.text === "string") {
                return block.text;
            }
        }
    }
    if (result != null && typeof result === "object") {
        try { return JSON.stringify(result); } catch { /* ignore */ }
    }
    return "";
}

function buildTaskSubjectMap(messages: readonly Message[]): TaskSubjectMap {
    const map = new Map<string, string>();
    let nextAutoId = 1;
    for (const msg of messages) {
        if (msg.kind !== "tool-call") continue;
        if (msg.tool.name === "TaskCreate") {
            const subject = typeof msg.tool.input?.subject === "string" ? msg.tool.input.subject : null;
            if (!subject) continue;
            const resultStr = extractResultText(msg.tool.result);
            const match = TASK_CREATED_RE.exec(resultStr);
            if (match) {
                map.set(match[1]!, subject);
                nextAutoId = Math.max(nextAutoId, Number(match[1]!) + 1);
            } else {
                map.set(String(nextAutoId), subject);
                nextAutoId++;
            }
        }
    }
    return map;
}

export function useTaskSubjects(sessionId?: string): TaskSubjectMap {
    const messages = storage(
        (state) => (sessionId ? state.sessionMessages[sessionId]?.messages : undefined) ?? emptyMessages,
    );
    return React.useMemo(
        () => (messages.length === 0 ? emptyMap : buildTaskSubjectMap(messages)),
        [messages],
    );
}

interface TaskItem {
    id?: string;
    subject?: string;
    description?: string;
    status?: string;
    activeForm?: string;
}

type StatusTone = {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    badgeBackground: string;
    badgeBorder: string;
    badgeText: string;
    textColor: string;
    contentStyle?: object;
};

function getStatusTone(
    theme: ReturnType<typeof useUnistyles>["theme"],
    status: string | undefined,
): StatusTone {
    if (status === "completed") {
        return {
            icon: "checkmark-circle",
            iconColor: theme.colors.success,
            badgeBackground: theme.colors.success + "12",
            badgeBorder: theme.colors.success + "20",
            badgeText: theme.colors.success,
            textColor: theme.colors.textSecondary,
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
            badgeBackground: theme.colors.accentBlue + "12",
            badgeBorder: theme.colors.accentBlue + "20",
            badgeText: theme.colors.accentBlue,
            textColor: theme.colors.text,
        };
    }
    if (status === "deleted") {
        return {
            icon: "close-circle",
            iconColor: theme.colors.textDestructive,
            badgeBackground: theme.colors.textDestructive + "12",
            badgeBorder: theme.colors.textDestructive + "20",
            badgeText: theme.colors.textDestructive,
            textColor: theme.colors.textSecondary,
            contentStyle: {
                textDecorationLine: "line-through" as const,
                opacity: 0.5,
            },
        };
    }
    return {
        icon: "square-outline",
        iconColor: theme.colors.textSecondary,
        badgeBackground: theme.colors.textSecondary + "10",
        badgeBorder: theme.colors.textSecondary + "18",
        badgeText: theme.colors.textSecondary,
        textColor: theme.colors.text,
    };
}

function StatusBadge({ status, theme }: { status: string; theme: ReturnType<typeof useUnistyles>["theme"] }) {
    const tone = getStatusTone(theme, status);
    return (
        <View style={[styles.statusBadge, { backgroundColor: tone.badgeBackground, borderColor: tone.badgeBorder }]}>
            <Ionicons name={tone.icon} size={10} color={tone.badgeText} />
            <Text style={[styles.statusBadgeText, { color: tone.badgeText }]}>{status}</Text>
        </View>
    );
}

function TaskRow({ task, compact }: { task: TaskItem; compact?: boolean }) {
    const { theme } = useUnistyles();
    const tone = getStatusTone(theme, task.status);

    return (
        <View style={[styles.taskRow, compact && styles.taskRowCompact]}>
            <Ionicons name={tone.icon} size={14} color={tone.iconColor} />
            <Text
                style={[styles.taskRowText, { color: tone.textColor }, tone.contentStyle]}
                numberOfLines={1}
            >
                {task.id ? `#${task.id} ` : ""}{task.subject ?? "Task"}
            </Text>
        </View>
    );
}

function extractTasksFromResult(result: any): TaskItem[] | null {
    if (!result) return null;
    const text = extractResultText(result);
    if (text) {
        const lineRe = /^#(\d+)\s*\[([^\]]+)\]\s*(.+)$/gm;
        const tasks: TaskItem[] = [];
        let match;
        while ((match = lineRe.exec(text)) !== null) {
            tasks.push({
                id: match[1],
                status: match[2]!.trim(),
                subject: match[3]!.trim(),
            });
        }
        if (tasks.length > 0) return tasks;
    }
    if (Array.isArray(result)) {
        const items = result.filter((r: any) => r?.subject || r?.id);
        if (items.length > 0) return items as TaskItem[];
    }
    if (typeof result === "object" && Array.isArray(result?.tasks)) {
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

const MAX_VISIBLE_TASKS = 8;

function MetricBadge(props: {
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
    tone: { backgroundColor: string; borderColor: string; color: string };
}) {
    return (
        <View
            style={[
                styles.metricBadge,
                { backgroundColor: props.tone.backgroundColor, borderColor: props.tone.borderColor },
            ]}
        >
            <Ionicons name={props.icon} size={11} color={props.tone.color} />
            <Text style={[styles.metricBadgeText, { color: props.tone.color }]}>{props.text}</Text>
        </View>
    );
}

export const TaskManagementView = React.memo<ToolViewProps>(
    function TaskManagementView({ tool, sessionId }) {
        const { theme } = useUnistyles();
        const taskSubjects = useTaskSubjects(sessionId);
        const [expanded, setExpanded] = React.useState(false);

        if (tool.name === "TaskCreate") {
            const resultId =
                typeof tool.result === "string"
                    ? tool.result.match(/#(\d+)/)?.[1]
                    : extractResultText(tool.result).match(/#(\d+)/)?.[1];
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
                    <TaskRow task={task} />
                    {task.description ? (
                        <Text style={[styles.inlineDescription, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                            {task.description}
                        </Text>
                    ) : null}
                </ToolSectionView>
            );
        }

        if (tool.name === "TaskUpdate") {
            const taskId = typeof tool.input?.taskId === "string" ? tool.input.taskId : undefined;
            const subject = typeof tool.input?.subject === "string" ? tool.input.subject : undefined;
            const description = typeof tool.input?.description === "string" ? tool.input.description : undefined;
            const status = typeof tool.input?.status === "string" ? tool.input.status : undefined;
            const activeForm = typeof tool.input?.activeForm === "string" ? tool.input.activeForm : undefined;

            if (!taskId && !subject) return null;

            const resolvedSubject = subject ?? (taskId ? taskSubjects.get(taskId) : undefined);
            const tone = getStatusTone(theme, status);
            const subtitle = activeForm ?? description;

            return (
                <ToolSectionView>
                    <View
                        style={[
                            styles.updateCard,
                            {
                                backgroundColor: tone.badgeBackground,
                                borderColor: tone.badgeBorder,
                            },
                        ]}
                    >
                        <Ionicons name={tone.icon} size={14} color={tone.iconColor} />
                        <View style={styles.updateContent}>
                            <Text style={[styles.taskRowText, { color: theme.colors.text }, tone.contentStyle]} numberOfLines={1}>
                                {taskId ? `#${taskId} ` : ""}{resolvedSubject ?? "Task"}
                            </Text>
                            {subtitle ? (
                                <Text style={[styles.inlineSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                                    {subtitle}
                                </Text>
                            ) : null}
                        </View>
                        {status ? <StatusBadge status={status} theme={theme} /> : null}
                    </View>
                </ToolSectionView>
            );
        }

        if (tool.name === "TaskList") {
            const tasks = extractTasksFromResult(tool.result);
            if (!tasks || tasks.length === 0) return null;

            const counts = countByStatus(tasks);
            const visibleTasks = expanded ? tasks : tasks.slice(0, MAX_VISIBLE_TASKS);
            const hiddenCount = tasks.length - MAX_VISIBLE_TASKS;

            return (
                <ToolSectionView>
                    <View style={styles.listContainer}>
                        {visibleTasks.map((task, index) => (
                            <TaskRow key={task.id ?? `task-${index}`} task={task} />
                        ))}
                    </View>
                    {hiddenCount > 0 ? (
                        <Pressable
                            onPress={() => setExpanded((v) => !v)}
                            hitSlop={8}
                            style={styles.toggleButton}
                        >
                            <Text style={[styles.toggleText, { color: theme.colors.accentBlue }]}>
                                {expanded
                                    ? t("sidePanel.collapse")
                                    : t("session.progressShowAll", { n: hiddenCount })}
                            </Text>
                            <Ionicons
                                name={expanded ? "chevron-up" : "chevron-down"}
                                size={12}
                                color={theme.colors.accentBlue}
                            />
                        </Pressable>
                    ) : null}
                    <View style={styles.metricsRow}>
                        {counts.completed > 0 ? (
                            <MetricBadge
                                icon="checkmark-circle"
                                text={t("session.progressLegendCompleted", { n: counts.completed })}
                                tone={{
                                    backgroundColor: theme.colors.success + "12",
                                    borderColor: theme.colors.success + "20",
                                    color: theme.colors.success,
                                }}
                            />
                        ) : null}
                        {counts.inProgress > 0 ? (
                            <MetricBadge
                                icon="ellipse"
                                text={t("session.progressLegendInProgress", { n: counts.inProgress })}
                                tone={{
                                    backgroundColor: theme.colors.accentBlue + "12",
                                    borderColor: theme.colors.accentBlue + "20",
                                    color: theme.colors.accentBlue,
                                }}
                            />
                        ) : null}
                        {counts.pending > 0 ? (
                            <MetricBadge
                                icon="square-outline"
                                text={t("session.progressLegendPending", { n: counts.pending })}
                                tone={{
                                    backgroundColor: theme.colors.textSecondary + "10",
                                    borderColor: theme.colors.textSecondary + "18",
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
    taskRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 3,
    },
    taskRowCompact: {
        paddingVertical: 2,
    },
    taskRowText: {
        fontSize: 13,
        flex: 1,
    },
    updateCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    updateContent: {
        flex: 1,
        gap: 2,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    statusBadgeText: {
        fontSize: 10,
        fontWeight: "600",
    },
    inlineDescription: {
        fontSize: 12,
        marginLeft: 22,
        lineHeight: 17,
    },
    inlineSubtitle: {
        fontSize: 12,
        lineHeight: 17,
    },
    listContainer: {
        gap: 0,
    },
    metricsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 6,
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
    toggleButton: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 4,
        marginLeft: 22,
    },
    toggleText: {
        fontSize: 12,
        fontWeight: "600",
    },
}));
