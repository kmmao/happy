import * as React from "react";
import { View, Pressable } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { PatchView } from "./PatchView";
import type { PRFileDiff } from "@/sync/prTypes";

interface PRFileItemProps {
    readonly file: PRFileDiff;
}

const STATUS_ICON: Record<string, React.ComponentProps<typeof Octicons>["name"]> = {
    added: "diff-added",
    removed: "diff-removed",
    modified: "diff-modified",
    renamed: "diff-renamed",
};

export const PRFileItem = React.memo<PRFileItemProps>(function PRFileItem({
    file,
}) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);

    const statusColor =
        file.status === "added"
            ? theme.colors.success
            : file.status === "removed"
              ? theme.colors.deleteAction
              : theme.colors.textSecondary;

    const filename = file.previousFilename
        ? `${file.previousFilename} → ${file.filename}`
        : file.filename;

    return (
        <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <Pressable
                onPress={() => setExpanded((v) => !v)}
                style={(p) => [
                    styles.header,
                    {
                        backgroundColor: p.pressed
                            ? theme.colors.surfaceHigh
                            : "transparent",
                    },
                ]}
            >
                <Ionicons
                    name={expanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={theme.colors.textSecondary}
                />
                <Octicons
                    name={STATUS_ICON[file.status] ?? "diff-modified"}
                    size={14}
                    color={statusColor}
                />
                <Text
                    style={{
                        flex: 1,
                        fontSize: 13,
                        color: theme.colors.text,
                        ...Typography.mono(),
                    }}
                    numberOfLines={1}
                >
                    {filename}
                </Text>
                <View style={styles.stats}>
                    {file.additions > 0 && (
                        <Text
                            style={{
                                fontSize: 11,
                                fontWeight: "500",
                                color: theme.colors.success,
                                ...Typography.mono(),
                            }}
                        >
                            +{file.additions}
                        </Text>
                    )}
                    {file.deletions > 0 && (
                        <Text
                            style={{
                                fontSize: 11,
                                fontWeight: "500",
                                color: theme.colors.deleteAction,
                                ...Typography.mono(),
                            }}
                        >
                            -{file.deletions}
                        </Text>
                    )}
                </View>
            </Pressable>

            {expanded && file.patch && (
                <PatchView patch={file.patch} />
            )}

            {expanded && !file.patch && (
                <View style={styles.noPatch}>
                    <Text
                        style={{
                            fontSize: 12,
                            color: theme.colors.textSecondary,
                            fontStyle: "italic",
                            ...Typography.default(),
                        }}
                    >
                        Binary file or no diff available
                    </Text>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    stats: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    noPatch: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
}));
