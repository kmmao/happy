import * as React from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Project } from "@/sync/projectManager";
import { storage, useSessionMessages } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { useShallow } from "zustand/react/shallow";
import type { ToolCallMessage, Message } from "@/sync/typesMessage";
import { t } from "@/text";
import { Typography } from "@/constants/Typography";
import { SharedStateView } from "@/components/SharedStateView";

function getToolIcon(toolName: string): keyof typeof Ionicons.glyphMap {
    const name = toolName.toLowerCase();
    if (name === "bash" || name.includes("shell") || name.includes("execute")) return "terminal-outline";
    if (name === "read") return "eye-outline";
    if (name === "edit" || name === "multiedit" || name.includes("patch")) return "create-outline";
    if (name === "write") return "document-outline";
    if (name === "grep" || name === "glob" || name.includes("search")) return "search-outline";
    if (name === "todowrite") return "checkbox-outline";
    if (name === "askuserquestion") return "help-circle-outline";
    if (name.startsWith("mcp__")) return "extension-puzzle-outline";
    if (name === "task" || name.includes("agent")) return "people-outline";
    return "construct-outline";
}

function getInputSummary(input: unknown, toolName: string): string {
    if (!input || typeof input !== "object") return "";
    const inp = input as Record<string, unknown>;
    const name = toolName.toLowerCase();

    if ((name === "bash" || name.includes("shell")) && typeof inp["command"] === "string") {
        const cmd = inp["command"].trim();
        return cmd.length > 120 ? cmd.slice(0, 120) + "…" : cmd;
    }
    if ((name === "read" || name === "write") && typeof inp["file_path"] === "string") {
        const parts = inp["file_path"].split("/");
        return parts.slice(-2).join("/");
    }
    if ((name === "edit" || name === "multiedit") && typeof inp["file_path"] === "string") {
        const parts = inp["file_path"].split("/");
        return parts.slice(-2).join("/");
    }
    if (name === "grep" && typeof inp["pattern"] === "string") {
        return inp["pattern"];
    }
    if (name === "glob" && typeof inp["pattern"] === "string") {
        return inp["pattern"];
    }
    if (name === "askuserquestion" && typeof inp["question"] === "string") {
        const q = inp["question"];
        return q.length > 100 ? q.slice(0, 100) + "…" : q;
    }

    try {
        const str = JSON.stringify(input);
        return str.length > 120 ? str.slice(0, 120) + "…" : str;
    } catch {
        return "";
    }
}

function flattenToolCalls(messages: readonly Message[]): ToolCallMessage[] {
    const result: ToolCallMessage[] = [];
    for (const msg of messages) {
        if (msg.kind === "tool-call") {
            result.push(msg);
            if (msg.children.length > 0) {
                result.push(...flattenToolCalls(msg.children));
            }
        }
    }
    return result;
}

interface ActionTraceCardProps {
    message: ToolCallMessage;
}

const ActionTraceCard = React.memo(({ message }: ActionTraceCardProps) => {
    const { theme } = useUnistyles();
    const { tool } = message;

    const statusColor =
        tool.state === "completed"
            ? theme.colors.success
            : tool.state === "error"
                ? theme.colors.status.error
                : theme.colors.accentOrange;

    const statusText =
        tool.state === "completed"
            ? t("tasks.statusCompleted")
            : tool.state === "error"
                ? t("tasks.statusFailed")
                : t("tasks.statusRunning");

    const iconName = getToolIcon(tool.name);
    const summary = React.useMemo(
        () => getInputSummary(tool.input, tool.name),
        [tool.input, tool.name],
    );

    return (
        <View style={styles.card}>
            <View style={styles.cardInner}>
                <View style={styles.cardLeft}>
                    <View style={styles.toolRow}>
                        <Ionicons
                            name={iconName}
                            size={14}
                            color={theme.colors.textSecondary}
                            style={styles.toolIcon}
                        />
                        <Text style={styles.toolName} numberOfLines={1}>
                            {tool.name}
                        </Text>
                    </View>
                    {summary ? (
                        <Text style={styles.toolSummary} numberOfLines={2}>
                            {summary}
                        </Text>
                    ) : null}
                </View>
                <View style={[styles.statusBadge, { borderColor: statusColor + "50" }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text
                        style={[styles.statusText, { color: statusColor }]}
                        numberOfLines={1}
                    >
                        {statusText}
                    </Text>
                </View>
            </View>
        </View>
    );
});

function SessionTraceView({ sessionId, isActive }: { sessionId: string; isActive: boolean }) {
    const { theme } = useUnistyles();
    const { messages, isLoaded } = useSessionMessages(sessionId, 300);

    // Messages are only fetched (and `isLoaded` flipped) once a session is
    // marked visible. Unlike the chat view, this tab never opens the session,
    // so without this the spinner would spin forever for any session not yet
    // opened this app run. Gate on `isActive` to avoid pulling messages (and
    // hijacking voice focus / lastVisibleSessionId) for every backgrounded
    // project detail page.
    React.useEffect(() => {
        if (isActive) {
            sync.onSessionVisible(sessionId);
        }
    }, [isActive, sessionId]);

    const toolCalls = React.useMemo(
        () => flattenToolCalls(messages).slice().reverse(),
        [messages],
    );

    if (!isLoaded) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            </View>
        );
    }

    if (toolCalls.length === 0) {
        return (
            <SharedStateView
                kind="empty"
                title={t("projects.tracesEmpty")}
                description={t("projects.tracesEmptySubtitle")}
            />
        );
    }

    return (
        <FlatList
            data={toolCalls}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ActionTraceCard message={item} />}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
    );
}

interface ProjectActionTraceTabProps {
    project: Project;
    isActive: boolean;
}

export const ProjectActionTraceTab = React.memo(
    ({ project, isActive }: ProjectActionTraceTabProps) => {
        const { theme } = useUnistyles();

        const targetSessionId = storage(
            useShallow((s) => {
                const sessions = project.sessionIds
                    .map((id) => s.sessions[id])
                    .filter(Boolean);

                const active = sessions.find((sess) => sess.active);
                if (active) return active.id;

                const sorted = [...sessions].sort((a, b) => b.activeAt - a.activeAt);
                return sorted[0]?.id ?? null;
            }),
        );

        if (!targetSessionId) {
            return (
                <SharedStateView
                    kind="empty"
                    icon={
                        <Ionicons
                            name="terminal-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                    }
                    title={t("projects.tracesNoSession")}
                />
            );
        }

        return <SessionTraceView sessionId={targetSessionId} isActive={isActive} />;
    },
);

const styles = StyleSheet.create((theme) => ({
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    card: {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 14,
        paddingVertical: 11,
    },
    cardInner: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    cardLeft: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    toolRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    toolIcon: {
        flexShrink: 0,
    },
    toolName: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
        flexShrink: 1,
    },
    toolSummary: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 16,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
        flexShrink: 0,
    },
    statusDot: {
        width: 5,
        height: 5,
        borderRadius: 999,
    },
    statusText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 14,
    },
    listContent: {
        paddingBottom: 32,
    },
}));
