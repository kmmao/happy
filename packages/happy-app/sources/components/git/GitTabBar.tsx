import * as React from "react";
import { View, Pressable, Platform } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";

export type GitTabId = "changes" | "history" | "branches" | "stash";

interface GitTabBarProps {
    activeTab: GitTabId;
    onTabChange: (tab: GitTabId) => void;
    stashCount?: number;
}

const TABS: readonly { id: GitTabId; labelKey: "tabChanges" | "tabHistory" | "tabBranches" | "tabStash" }[] = [
    { id: "changes", labelKey: "tabChanges" },
    { id: "history", labelKey: "tabHistory" },
    { id: "branches", labelKey: "tabBranches" },
    { id: "stash", labelKey: "tabStash" },
] as const;

export const GitTabBar = React.memo<GitTabBarProps>(function GitTabBar({
    activeTab,
    onTabChange,
    stashCount,
}) {
    const { theme } = useUnistyles();

    return (
        <View
            style={{
                flexDirection: "row",
                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                borderBottomColor: theme.colors.divider,
                backgroundColor: theme.colors.surface,
            }}
        >
            {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <Pressable
                        key={tab.id}
                        onPress={() => onTabChange(tab.id)}
                        style={{
                            flex: 1,
                            alignItems: "center",
                            paddingVertical: 12,
                            borderBottomWidth: isActive ? 2 : 0,
                            borderBottomColor: isActive
                                ? theme.colors.textLink
                                : "transparent",
                        }}
                    >
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Text
                                style={{
                                    fontSize: 14,
                                    fontWeight: isActive ? "600" : "400",
                                    color: isActive
                                        ? theme.colors.textLink
                                        : theme.colors.textSecondary,
                                    ...Typography.default(),
                                }}
                            >
                                {t(`git.${tab.labelKey}`)}
                            </Text>
                            {tab.id === "stash" &&
                                stashCount !== undefined &&
                                stashCount > 0 && (
                                    <View
                                        style={{
                                            marginLeft: 4,
                                            backgroundColor: theme.colors.textLink,
                                            borderRadius: 8,
                                            minWidth: 16,
                                            height: 16,
                                            alignItems: "center",
                                            justifyContent: "center",
                                            paddingHorizontal: 4,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 10,
                                                fontWeight: "700",
                                                color: "#ffffff",
                                                ...Typography.default(),
                                            }}
                                        >
                                            {stashCount}
                                        </Text>
                                    </View>
                                )}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
});
