/**
 * Side panel tab showing session code changes (Edit/Write/MultiEdit tool diffs).
 * Adapted from the changes.tsx page to accept sessionId as a prop.
 */

import * as React from "react";
import { View, Pressable, ScrollView } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
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
import {
    createFileChangeEditEntry,
    getFileChangeEditKey,
} from "@/components/tools/fileChangeEditKey";

export interface FileChange {
    filePath: string;
    displayPath: string;
    edits: Array<ReturnType<typeof createFileChangeEditEntry>>;
    totalAdditions: number;
    totalDeletions: number;
}

export function collectToolCalls(messages: readonly Message[]): ToolCallMessage[] {
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

function appendFileChangeEdit(
    changeMap: Map<string, FileChange>,
    filePath: string,
    displayPath: string,
    edit: ReturnType<typeof createFileChangeEditEntry>,
    additions: number,
    deletions: number,
): void {
    const existing = changeMap.get(filePath);
    if (existing) {
        existing.edits.push(edit);
        existing.totalAdditions += additions;
        existing.totalDeletions += deletions;
        return;
    }

    changeMap.set(filePath, {
        filePath,
        displayPath,
        edits: [edit],
        totalAdditions: additions,
        totalDeletions: deletions,
    });
}

export function extractFileChanges(
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

            const stats = getDiffStatsLight(oldStr, newStr);
            appendFileChangeEdit(
                changeMap,
                filePath,
                displayPath,
                createFileChangeEditEntry(msg.id, "Edit", oldStr, newStr, 0),
                stats.additions,
                stats.deletions,
            );
        } else if (name === "MultiEdit") {
            const edits = Array.isArray(input.edits) ? input.edits : [];
            for (const [index, edit] of edits.entries()) {
                const oldStr = trimIdent(edit.old_string || "");
                const newStr = trimIdent(edit.new_string || "");
                if (!oldStr && !newStr) continue;

                const stats = getDiffStatsLight(oldStr, newStr);
                appendFileChangeEdit(
                    changeMap,
                    filePath,
                    displayPath,
                    createFileChangeEditEntry(msg.id, "MultiEdit", oldStr, newStr, index),
                    stats.additions,
                    stats.deletions,
                );
            }
        } else if (name === "Write") {
            const content = typeof input.content === "string" ? input.content : "";
            if (!content) continue;

            const stats = getDiffStatsLight("", content);
            appendFileChangeEdit(
                changeMap,
                filePath,
                displayPath,
                createFileChangeEditEntry(msg.id, "Write", "", content, 0),
                stats.additions,
                stats.deletions,
            );
        }
    }

    return Array.from(changeMap.values());
}

export const FileChangeItem = React.memo(({ change }: { change: FileChange }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const language = getLanguageFromPath(change.filePath);

    return (
        <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <Pressable
                style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    gap: 6,
                    opacity: pressed ? 0.6 : 1,
                })}
                onPress={() => setExpanded((v) => !v)}
            >
                <Ionicons
                    name={expanded ? "chevron-down" : "chevron-forward"}
                    size={12}
                    color={theme.colors.textSecondary}
                />
                <Text
                    style={{ flex: 1, fontSize: 12, color: theme.colors.text, ...Typography.mono() }}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {change.displayPath}
                </Text>
                {change.edits.length > 1 && (
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                        {t("changes.editCount", { count: change.edits.length })}
                    </Text>
                )}
                <DiffStatsBar
                    additions={change.totalAdditions}
                    deletions={change.totalDeletions}
                />
            </Pressable>
            {expanded && (
                <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
                    {change.edits.map((edit) => (
                        <View key={getFileChangeEditKey(edit)} style={{ marginBottom: 6 }}>
                            <ToolDiffView
                                oldText={edit.oldText}
                                newText={edit.newText}
                                collapsible={false}
                                language={language}
                                visibleLineCount={5}
                            />
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
});

interface SidePanelCodeTabProps {
    sessionId: string;
}

export const SidePanelCodeTab = React.memo<SidePanelCodeTabProps>(
    function SidePanelCodeTab({ sessionId }) {
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
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                    }}
                >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text, ...Typography.default("semiBold") }}>
                        {t("changes.summary", { files: totalFiles })}
                    </Text>
                    {totalFiles > 0 && (
                        <DiffStatsBar additions={totalAdditions} deletions={totalDeletions} />
                    )}
                </View>
                {totalFiles === 0 ? (
                    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 12 }}>
                        <Ionicons
                            name="document-text-outline"
                            size={40}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
                            {t("changes.noChanges")}
                        </Text>
                    </View>
                ) : (
                    <ScrollView style={{ flex: 1 }}>
                        {fileChanges.map((change) => (
                            <FileChangeItem key={change.filePath} change={change} />
                        ))}
                    </ScrollView>
                )}
            </View>
        );
    },
);
