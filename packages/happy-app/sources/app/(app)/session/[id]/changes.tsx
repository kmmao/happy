import * as React from "react";
import { View, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { useSessionMessages, useSession } from "@/sync/storage";
import { Message, ToolCallMessage } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { trimIdent } from "@/utils/trimIdent";
import { getDiffStatsLight } from "@/components/diff/calculateDiff";
import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";
import { DiffStatsBar } from "@/components/diff/DiffStatsBar";
import { ToolDiffView } from "@/components/tools/ToolDiffView";

interface FileChange {
    filePath: string;
    displayPath: string;
    edits: Array<{
        oldText: string;
        newText: string;
        toolName: string;
    }>;
    totalAdditions: number;
    totalDeletions: number;
}

function collectToolCalls(messages: readonly Message[]): ToolCallMessage[] {
    const result: ToolCallMessage[] = [];
    for (const msg of messages) {
        if (msg.kind === "tool-call") {
            result.push(msg);
            if (msg.children.length > 0) {
                result.push(...collectToolCalls(msg.children));
            }
        }
    }
    return result;
}

function extractFileChanges(
    toolCalls: readonly ToolCallMessage[],
    metadata: Metadata | null,
): FileChange[] {
    const changeMap = new Map<string, FileChange>();

    for (const msg of toolCalls) {
        const tool = msg.tool;
        if (!tool || tool.state !== "completed") continue;

        const name = tool.name;
        const input = tool.input;
        if (!input || typeof input.file_path !== "string") continue;

        const filePath = input.file_path;
        const displayPath = resolvePath(filePath, metadata);

        if (name === "Edit" || name === "edit") {
            const oldStr = trimIdent(input.old_string || "");
            const newStr = trimIdent(input.new_string || "");
            if (!oldStr && !newStr) continue;

            const existing = changeMap.get(filePath);
            const stats = getDiffStatsLight(oldStr, newStr);
            if (existing) {
                existing.edits.push({ oldText: oldStr, newText: newStr, toolName: "Edit" });
                existing.totalAdditions += stats.additions;
                existing.totalDeletions += stats.deletions;
            } else {
                changeMap.set(filePath, {
                    filePath,
                    displayPath,
                    edits: [{ oldText: oldStr, newText: newStr, toolName: "Edit" }],
                    totalAdditions: stats.additions,
                    totalDeletions: stats.deletions,
                });
            }
        } else if (name === "MultiEdit") {
            const edits = Array.isArray(input.edits) ? input.edits : [];
            for (const edit of edits) {
                const oldStr = trimIdent(edit.old_string || "");
                const newStr = trimIdent(edit.new_string || "");
                if (!oldStr && !newStr) continue;

                const existing = changeMap.get(filePath);
                const stats = getDiffStatsLight(oldStr, newStr);
                if (existing) {
                    existing.edits.push({ oldText: oldStr, newText: newStr, toolName: "MultiEdit" });
                    existing.totalAdditions += stats.additions;
                    existing.totalDeletions += stats.deletions;
                } else {
                    changeMap.set(filePath, {
                        filePath,
                        displayPath,
                        edits: [{ oldText: oldStr, newText: newStr, toolName: "MultiEdit" }],
                        totalAdditions: stats.additions,
                        totalDeletions: stats.deletions,
                    });
                }
            }
        } else if (name === "Write") {
            const content = typeof input.content === "string" ? input.content : "";
            if (!content) continue;

            const existing = changeMap.get(filePath);
            const stats = getDiffStatsLight("", content);
            if (existing) {
                existing.edits.push({ oldText: "", newText: content, toolName: "Write" });
                existing.totalAdditions += stats.additions;
                existing.totalDeletions += stats.deletions;
            } else {
                changeMap.set(filePath, {
                    filePath,
                    displayPath,
                    edits: [{ oldText: "", newText: content, toolName: "Write" }],
                    totalAdditions: stats.additions,
                    totalDeletions: stats.deletions,
                });
            }
        }
    }

    return Array.from(changeMap.values());
}

const FileChangeItem = React.memo(({ change }: { change: FileChange }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const language = getLanguageFromPath(change.filePath);

    return (
        <View style={[styles.fileItem, { borderBottomColor: theme.colors.divider }]}>
            <Pressable
                style={({ pressed }) => [
                    styles.fileHeader,
                    pressed && { opacity: 0.6 },
                ]}
                onPress={() => setExpanded((v) => !v)}
            >
                <Ionicons
                    name={expanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={theme.colors.textSecondary}
                />
                <Text
                    style={[styles.filePath, { color: theme.colors.text }]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {change.displayPath}
                </Text>
                <Text style={[styles.editCount, { color: theme.colors.textSecondary }]}>
                    {change.edits.length > 1
                        ? t("changes.editCount", { count: change.edits.length })
                        : ""}
                </Text>
                <DiffStatsBar
                    additions={change.totalAdditions}
                    deletions={change.totalDeletions}
                />
            </Pressable>
            {expanded && (
                <View style={styles.diffContainer}>
                    {change.edits.map((edit, index) => (
                        <View key={index} style={styles.diffBlock}>
                            <ToolDiffView
                                oldText={edit.oldText}
                                newText={edit.newText}
                                collapsible={false}
                                language={language}
                            />
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
});

export default React.memo(function ChangesScreen() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const { theme } = useUnistyles();
    const { messages } = useSessionMessages(sessionId);
    const session = useSession(sessionId);
    const metadata = session?.metadata ?? null;

    const fileChanges = React.useMemo(() => {
        const toolCalls = collectToolCalls(messages);
        return extractFileChanges(toolCalls, metadata);
    }, [messages, metadata]);

    const totalFiles = fileChanges.length;
    const totalAdditions = fileChanges.reduce((sum, f) => sum + f.totalAdditions, 0);
    const totalDeletions = fileChanges.reduce((sum, f) => sum + f.totalDeletions, 0);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.summaryBar, { borderBottomColor: theme.colors.divider }]}>
                <Text style={[styles.summaryText, { color: theme.colors.text }]}>
                    {t("changes.summary", { files: totalFiles })}
                </Text>
                {totalFiles > 0 && (
                    <DiffStatsBar additions={totalAdditions} deletions={totalDeletions} />
                )}
            </View>
            {totalFiles === 0 ? (
                <View style={styles.emptyContainer}>
                    <Ionicons
                        name="document-text-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        {t("changes.noChanges")}
                    </Text>
                </View>
            ) : (
                <ScrollView style={styles.scrollView}>
                    {fileChanges.map((change) => (
                        <FileChangeItem key={change.filePath} change={change} />
                    ))}
                </ScrollView>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%",
    },
    summaryBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    summaryText: {
        fontSize: 14,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
    },
    emptyText: {
        fontSize: 15,
    },
    scrollView: {
        flex: 1,
    },
    fileItem: {
        borderBottomWidth: 1,
    },
    fileHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    filePath: {
        flex: 1,
        fontSize: 13,
        ...Typography.mono(),
    },
    editCount: {
        fontSize: 12,
        flexShrink: 0,
    },
    diffContainer: {
        paddingHorizontal: 8,
        paddingBottom: 8,
    },
    diffBlock: {
        marginBottom: 8,
    },
}));
