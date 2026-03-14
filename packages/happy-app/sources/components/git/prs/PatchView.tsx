/**
 * PatchView — renders a unified diff patch string with syntax coloring.
 *
 * Accepts raw patch text from GitHub/Gitea PR file API (unified diff format)
 * and renders it with proper add/remove/context line coloring, line numbers,
 * and hunk headers. Uses the same theme.colors.diff palette as DiffView.
 */

import React, { useMemo } from "react";
import { View, Text, ScrollView, ViewStyle } from "react-native";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";

interface PatchViewProps {
    readonly patch: string;
    readonly style?: ViewStyle;
    readonly wrapLines?: boolean;
    readonly fontScaleX?: number;
}

interface PatchLine {
    readonly type: "add" | "remove" | "context" | "hunk";
    readonly content: string;
    readonly oldLine: number | null;
    readonly newLine: number | null;
}

function parsePatch(patch: string): readonly PatchLine[] {
    const rawLines = patch.split("\n");
    const result: PatchLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (const raw of rawLines) {
        if (raw.startsWith("@@")) {
            // Parse hunk header: @@ -oldStart,oldLen +newStart,newLen @@
            const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) {
                oldLine = parseInt(match[1]!, 10);
                newLine = parseInt(match[2]!, 10);
            }
            result.push({ type: "hunk", content: raw, oldLine: null, newLine: null });
        } else if (raw.startsWith("+")) {
            result.push({
                type: "add",
                content: raw.slice(1),
                oldLine: null,
                newLine,
            });
            newLine++;
        } else if (raw.startsWith("-")) {
            result.push({
                type: "remove",
                content: raw.slice(1),
                oldLine,
                newLine: null,
            });
            oldLine++;
        } else if (raw.startsWith("\\")) {
            // "\ No newline at end of file" — skip
        } else {
            // Context line (starts with space or is empty)
            const content = raw.startsWith(" ") ? raw.slice(1) : raw;
            result.push({
                type: "context",
                content,
                oldLine,
                newLine,
            });
            oldLine++;
            newLine++;
        }
    }

    return result;
}

export const PatchView = React.memo<PatchViewProps>(function PatchView({
    patch,
    style,
    wrapLines = false,
    fontScaleX = 1,
}) {
    const { theme } = useUnistyles();
    const colors = theme.colors.diff;

    const lines = useMemo(() => parsePatch(patch), [patch]);

    return (
        <ScrollView
            horizontal={!wrapLines}
            showsHorizontalScrollIndicator={!wrapLines}
            style={style}
        >
            <View style={{ minWidth: "100%" }}>
                {lines.map((line, idx) => {
                    if (line.type === "hunk") {
                        return (
                            <Text
                                key={idx}
                                numberOfLines={wrapLines ? undefined : 1}
                                style={{
                                    ...Typography.mono(),
                                    fontSize: 12,
                                    lineHeight: 20,
                                    backgroundColor: colors.hunkHeaderBg,
                                    color: colors.hunkHeaderText,
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    transform: [{ scaleX: fontScaleX }],
                                }}
                            >
                                {line.content}
                            </Text>
                        );
                    }

                    const isAdd = line.type === "add";
                    const isRemove = line.type === "remove";
                    const textColor = isAdd
                        ? colors.addedText
                        : isRemove
                          ? colors.removedText
                          : colors.contextText;
                    const bgColor = isAdd
                        ? colors.addedBg
                        : isRemove
                          ? colors.removedBg
                          : colors.contextBg;

                    const lineNum = isRemove
                        ? line.oldLine
                        : isAdd
                          ? line.newLine
                          : line.oldLine;

                    return (
                        <Text
                            key={idx}
                            numberOfLines={wrapLines ? undefined : 1}
                            style={{
                                ...Typography.mono(),
                                fontSize: 13,
                                lineHeight: 20,
                                backgroundColor: bgColor,
                                paddingLeft: 8,
                                paddingRight: 8,
                                transform: [{ scaleX: fontScaleX }],
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.lineNumberText,
                                    backgroundColor: colors.lineNumberBg,
                                }}
                            >
                                {lineNum != null
                                    ? String(lineNum).padStart(3, " ")
                                    : "   "}
                            </Text>
                            <Text style={{ color: textColor }}>
                                {` ${isAdd ? "+" : isRemove ? "-" : " "} `}
                            </Text>
                            <Text style={{ color: textColor }}>
                                {line.content}
                            </Text>
                        </Text>
                    );
                })}
            </View>
        </ScrollView>
    );
});
