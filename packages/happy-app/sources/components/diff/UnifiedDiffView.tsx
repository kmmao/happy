/**
 * UnifiedDiffView — GitHub-style renderer for a unified-diff text blob.
 * Used by SidePanelFilePreview (working-tree diff) and CommitDiffView
 * (commit-scoped diff via `git show`). Shares one styling surface so both
 * paths look identical: stats header, collapsible hunks, side-by-side line
 * numbers, inline syntax + diff-token highlighting.
 */

import * as React from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import {
    parseUnifiedPatch,
    type DiffLine,
    type DiffToken,
} from "@/components/diff/calculateDiff";
import {
    tokenizeLine,
    getSyntaxColor,
    type SyntaxToken,
} from "@/components/diff/syntaxTokenizer";

interface UnifiedDiffViewProps {
    readonly diffContent: string;
    readonly language?: string | null;
}

export const UnifiedDiffView = React.memo<UnifiedDiffViewProps>(
    function UnifiedDiffView({ diffContent, language }) {
        const { theme } = useUnistyles();
        const colors = theme.colors.diff;

        const { hunks, stats } = React.useMemo(
            () => parseUnifiedPatch(diffContent),
            [diffContent],
        );

        // Collapsible hunk state
        const [collapsedHunks, setCollapsedHunks] = React.useState<Set<number>>(
            new Set(),
        );
        const toggleHunk = React.useCallback((hunkIndex: number) => {
            setCollapsedHunks((prev) => {
                const next = new Set(prev);
                if (next.has(hunkIndex)) {
                    next.delete(hunkIndex);
                } else {
                    next.add(hunkIndex);
                }
                return next;
            });
        }, []);

        // Compute max line number width for alignment
        const lineNumWidth = React.useMemo(() => {
            let max = 0;
            for (const hunk of hunks) {
                for (const line of hunk.lines) {
                    if (line.oldLineNumber && line.oldLineNumber > max)
                        max = line.oldLineNumber;
                    if (line.newLineNumber && line.newLineNumber > max)
                        max = line.newLineNumber;
                }
            }
            return String(max).length;
        }, [hunks]);

        // Replace leading spaces with non-breaking spaces (\u00A0) to prevent
        // React Native <Text> from collapsing indentation whitespace
        const preserveIndent = (s: string) =>
            s.replace(/^ +/, (m) => "\u00A0".repeat(m.length));

        const renderInlineContent = (
            content: string,
            baseColor: string,
            tokens?: DiffToken[],
            syntaxTokens?: SyntaxToken[],
        ) => {
            if (tokens && tokens.length > 0) {
                let first = true;
                return tokens.map((token, idx) => {
                    const val = first ? preserveIndent(token.value) : token.value;
                    if (token.value) first = false;
                    if (token.added || token.removed) {
                        return (
                            <Text
                                key={idx}
                                style={{
                                    backgroundColor: token.added
                                        ? colors.inlineAddedBg
                                        : colors.inlineRemovedBg,
                                    color: token.added
                                        ? colors.inlineAddedText
                                        : colors.inlineRemovedText,
                                }}
                            >
                                {val}
                            </Text>
                        );
                    }
                    return (
                        <Text key={idx} style={{ color: baseColor }}>
                            {val}
                        </Text>
                    );
                });
            }

            if (syntaxTokens && syntaxTokens.length > 0) {
                let first = true;
                return syntaxTokens.map((token, idx) => {
                    const val = first ? preserveIndent(token.text) : token.text;
                    if (token.text) first = false;
                    return (
                        <Text
                            key={idx}
                            style={{
                                color: getSyntaxColor(token.type, token.nestLevel, theme),
                            }}
                        >
                            {val}
                        </Text>
                    );
                });
            }

            return preserveIndent(content);
        };

        const renderDiffLine = (line: DiffLine, key: string) => {
            const isAdded = line.type === "add";
            const isRemoved = line.type === "remove";
            const textColor = isAdded
                ? colors.addedText
                : isRemoved
                    ? colors.removedText
                    : colors.contextText;
            const bgColor = isAdded
                ? colors.addedBg
                : isRemoved
                    ? colors.removedBg
                    : colors.contextBg;

            const hasDiffTokens = line.tokens && line.tokens.length > 0;
            const syntaxToks =
                language && !hasDiffTokens
                    ? tokenizeLine(line.content, language)
                    : undefined;

            const oldNum = line.oldLineNumber != null
                ? String(line.oldLineNumber).padStart(lineNumWidth, " ")
                : " ".repeat(lineNumWidth);
            const newNum = line.newLineNumber != null
                ? String(line.newLineNumber).padStart(lineNumWidth, " ")
                : " ".repeat(lineNumWidth);

            const sign = isAdded ? " + " : isRemoved ? " - " : "   ";

            return (
                <Text
                    key={key}
                    numberOfLines={1}
                    style={{
                        ...Typography.mono(),
                        fontSize: 12,
                        lineHeight: 18,
                        backgroundColor: bgColor,
                        color: textColor,
                        paddingRight: 6,
                    }}
                >
                    <Text
                        style={{
                            color: colors.lineNumberText,
                            backgroundColor: colors.lineNumberBg,
                        }}
                    >
                        {` ${oldNum} `}
                    </Text>
                    <Text
                        style={{
                            color: colors.lineNumberText,
                            backgroundColor: colors.lineNumberBg,
                        }}
                    >
                        {` ${newNum} `}
                    </Text>
                    {sign}
                    {renderInlineContent(line.content, textColor, line.tokens, syntaxToks)}
                </Text>
            );
        };

        return (
            <View
                style={{
                    borderRadius: 8,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: colors.outline,
                }}
            >
                {/* Stats header */}
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        backgroundColor: theme.colors.surfaceHigh,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.outline,
                        gap: 8,
                    }}
                >
                    <Text
                        style={{
                            ...Typography.mono(),
                            fontSize: 11,
                            color: colors.addedText,
                            fontWeight: "600",
                        }}
                    >
                        +{stats.additions}
                    </Text>
                    <Text
                        style={{
                            ...Typography.mono(),
                            fontSize: 11,
                            color: colors.removedText,
                            fontWeight: "600",
                        }}
                    >
                        -{stats.deletions}
                    </Text>
                </View>

                {/* Hunks */}
                {hunks.map((hunk, hunkIndex) => {
                    const isCollapsed = collapsedHunks.has(hunkIndex);
                    return (
                        <View key={`hunk-${hunkIndex}`}>
                            <Pressable
                                onPress={() => toggleHunk(hunkIndex)}
                                style={{
                                    backgroundColor: colors.hunkHeaderBg,
                                    paddingVertical: 6,
                                    paddingHorizontal: 10,
                                    borderTopWidth: hunkIndex > 0 ? 1 : 0,
                                    borderTopColor: colors.outline,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 4,
                                }}
                            >
                                <Ionicons
                                    name={isCollapsed ? "chevron-forward" : "chevron-down"}
                                    size={12}
                                    color={colors.hunkHeaderText}
                                />
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        ...Typography.mono(),
                                        fontSize: 11,
                                        color: colors.hunkHeaderText,
                                        flex: 1,
                                    }}
                                >
                                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                                </Text>
                                <Text
                                    style={{
                                        ...Typography.mono(),
                                        fontSize: 10,
                                        color: colors.hunkHeaderText,
                                        opacity: 0.7,
                                    }}
                                >
                                    {hunk.lines.filter((l) => l.type !== "normal").length}
                                </Text>
                            </Pressable>
                            {!isCollapsed &&
                                hunk.lines.map((line, lineIndex) =>
                                    renderDiffLine(line, `l-${hunkIndex}-${lineIndex}`),
                                )}
                        </View>
                    );
                })}
            </View>
        );
    },
);
