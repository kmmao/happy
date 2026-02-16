import * as React from "react";
import { View, Pressable, Platform } from "react-native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { SubmoduleInfo } from "@/sync/projectManager";

interface GitRepoSelectorProps {
    readonly sessionPath: string;
    readonly submodules: readonly SubmoduleInfo[];
    readonly selectedRepoPath: string | null;
    readonly onSelect: (repoPath: string | null) => void;
}

export const GitRepoSelector = React.memo<GitRepoSelectorProps>(
    function GitRepoSelector({
        sessionPath,
        submodules,
        selectedRepoPath,
        onSelect,
    }) {
        const { theme } = useUnistyles();
        const [isExpanded, setIsExpanded] = React.useState(false);

        const rootName = sessionPath.split("/").pop() || sessionPath;

        const selectedLabel =
            selectedRepoPath === null
                ? `${rootName} (${t("git.rootRepo")})`
                : selectedRepoPath;

        const handleToggle = React.useCallback(() => {
            setIsExpanded((v) => !v);
        }, []);

        const handleSelect = React.useCallback(
            (repoPath: string | null) => {
                onSelect(repoPath);
                setIsExpanded(false);
            },
            [onSelect],
        );

        return (
            <View>
                <Pressable
                    onPress={handleToggle}
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderBottomWidth: Platform.select({
                            ios: 0.33,
                            default: 1,
                        }),
                        borderBottomColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                    }}
                >
                    <Octicons
                        name="repo"
                        size={16}
                        color={theme.colors.textSecondary}
                        style={{ marginRight: 8 }}
                    />
                    <Text
                        style={{
                            flex: 1,
                            fontSize: 14,
                            fontWeight: "500",
                            color: theme.colors.text,
                            ...Typography.default(),
                        }}
                        numberOfLines={1}
                    >
                        {selectedLabel}
                    </Text>
                    <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {isExpanded && (
                    <View
                        style={{
                            borderBottomWidth: Platform.select({
                                ios: 0.33,
                                default: 1,
                            }),
                            borderBottomColor: theme.colors.divider,
                            backgroundColor: theme.colors.surface,
                        }}
                    >
                        {/* Root repo */}
                        <Pressable
                            onPress={() => handleSelect(null)}
                            style={({ pressed }) => ({
                                flexDirection: "row",
                                alignItems: "center",
                                paddingHorizontal: 16,
                                paddingVertical: 10,
                                backgroundColor: pressed
                                    ? theme.colors.surfacePressedOverlay
                                    : "transparent",
                            })}
                        >
                            <View style={{ width: 24, alignItems: "center" }}>
                                {selectedRepoPath === null && (
                                    <Ionicons
                                        name="checkmark"
                                        size={16}
                                        color={theme.colors.textLink}
                                    />
                                )}
                            </View>
                            <Octicons
                                name="repo"
                                size={14}
                                color={theme.colors.textSecondary}
                                style={{ marginRight: 8 }}
                            />
                            <Text
                                style={{
                                    fontSize: 14,
                                    color: theme.colors.text,
                                    ...Typography.default(),
                                }}
                            >
                                {rootName} ({t("git.rootRepo")})
                            </Text>
                        </Pressable>

                        {/* Submodules */}
                        {submodules.map((sub) => (
                            <Pressable
                                key={sub.path}
                                onPress={() => handleSelect(sub.path)}
                                style={({ pressed }) => ({
                                    flexDirection: "row",
                                    alignItems: "center",
                                    paddingHorizontal: 16,
                                    paddingVertical: 10,
                                    backgroundColor: pressed
                                        ? theme.colors.surfacePressedOverlay
                                        : "transparent",
                                })}
                            >
                                <View
                                    style={{ width: 24, alignItems: "center" }}
                                >
                                    {selectedRepoPath === sub.path && (
                                        <Ionicons
                                            name="checkmark"
                                            size={16}
                                            color={theme.colors.textLink}
                                        />
                                    )}
                                </View>
                                <Octicons
                                    name={"repo-forked" as any}
                                    size={14}
                                    color={theme.colors.textSecondary}
                                    style={{ marginRight: 8 }}
                                />
                                <Text
                                    style={{
                                        fontSize: 14,
                                        color: theme.colors.text,
                                        ...Typography.default(),
                                    }}
                                    numberOfLines={1}
                                >
                                    {sub.path}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </View>
        );
    },
);
