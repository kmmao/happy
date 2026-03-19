import * as React from "react";
import { View, Pressable, ActionSheetIOS, Platform } from "react-native";
import { Modal } from "@/modal";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { Octicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    cancelAnimation,
    Easing,
} from "react-native-reanimated";
import type {
    PRFilterState,
    PRSortField,
    PRSortDirection,
} from "@/sync/prTypes";

interface PRFilterBarProps {
    readonly activeState: PRFilterState;
    readonly onStateChange: (state: PRFilterState) => void;
    readonly openCount?: number;
    readonly closedCount?: number;
    readonly loading?: boolean;
    readonly onRefresh?: () => void;
    readonly sort?: PRSortField;
    readonly direction?: PRSortDirection;
    readonly onSortChange?: (
        sort: PRSortField,
        direction: PRSortDirection,
    ) => void;
}

const FILTERS: readonly {
    id: PRFilterState;
    labelKey: "prs.open" | "prs.closed" | "prs.all";
}[] = [
    { id: "open", labelKey: "prs.open" },
    { id: "closed", labelKey: "prs.closed" },
    { id: "all", labelKey: "prs.all" },
] as const;

export const PRFilterBar = React.memo<PRFilterBarProps>(
    function PRFilterBar({
        activeState,
        onStateChange,
        openCount,
        closedCount,
        loading,
        onRefresh,
        sort,
        direction,
        onSortChange,
    }) {
        const { theme } = useUnistyles();
        const rotation = useSharedValue(0);

        const handleSortPress = React.useCallback(() => {
            if (!onSortChange) return;
            const options: Array<{
                label: string;
                sort: PRSortField;
                dir: PRSortDirection;
            }> = [
                { label: `${t("prs.sortCreated")} ↓`, sort: "created", dir: "desc" },
                { label: `${t("prs.sortCreated")} ↑`, sort: "created", dir: "asc" },
                { label: `${t("prs.sortUpdated")} ↓`, sort: "updated", dir: "desc" },
                { label: `${t("prs.sortUpdated")} ↑`, sort: "updated", dir: "asc" },
            ];
            const cancelLabel = t("common.cancel");
            if (Platform.OS === "ios") {
                ActionSheetIOS.showActionSheetWithOptions(
                    {
                        title: t("prs.sortBy"),
                        options: [...options.map((o) => o.label), cancelLabel],
                        cancelButtonIndex: options.length,
                    },
                    (index) => {
                        if (index < options.length) {
                            const chosen = options[index]!;
                            onSortChange(chosen.sort, chosen.dir);
                        }
                    },
                );
            } else {
                Modal.alert(t("prs.sortBy"), undefined, [
                    ...options.map((o) => ({
                        text: o.label,
                        onPress: () => onSortChange(o.sort, o.dir),
                    })),
                    { text: cancelLabel, style: "cancel" as const },
                ]);
            }
        }, [onSortChange]);

        React.useEffect(() => {
            if (loading) {
                rotation.value = 0;
                rotation.value = withRepeat(
                    withTiming(360, { duration: 800, easing: Easing.linear }),
                    -1,
                );
            } else {
                cancelAnimation(rotation);
                rotation.value = withTiming(0, { duration: 200 });
            }
        }, [loading, rotation]);

        const spinStyle = useAnimatedStyle(() => ({
            transform: [{ rotate: `${rotation.value}deg` }],
        }));

        return (
            <View
                style={[styles.container, { borderBottomColor: theme.colors.divider }]}
            >
                {FILTERS.map((filter) => {
                    const isActive = activeState === filter.id;
                    const count =
                        filter.id === "open"
                            ? openCount
                            : filter.id === "closed"
                              ? closedCount
                              : undefined;
                    return (
                        <Pressable
                            key={filter.id}
                            onPress={() => onStateChange(filter.id)}
                            style={[
                                styles.filterButton,
                                {
                                    backgroundColor: isActive
                                        ? theme.colors.textLink + "18"
                                        : "transparent",
                                    borderColor: isActive
                                        ? theme.colors.textLink
                                        : theme.colors.divider,
                                },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    fontWeight: isActive ? "600" : "400",
                                    color: isActive
                                        ? theme.colors.textLink
                                        : theme.colors.textSecondary,
                                    ...Typography.default(),
                                }}
                            >
                                {t(filter.labelKey)}
                            </Text>
                            {count !== undefined && (
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: "500",
                                        color: isActive
                                            ? theme.colors.textLink
                                            : theme.colors.textSecondary,
                                        ...Typography.mono(),
                                    }}
                                >
                                    {count}
                                </Text>
                            )}
                        </Pressable>
                    );
                })}
                <View style={{ flex: 1 }} />
                {onSortChange && (
                    <Pressable
                        onPress={handleSortPress}
                        hitSlop={8}
                        style={{
                            paddingHorizontal: 4,
                            justifyContent: "center",
                        }}
                    >
                        <Octicons
                            name="sort-desc"
                            size={16}
                            color={
                                sort && sort !== "created"
                                    ? theme.colors.textLink
                                    : theme.colors.textSecondary
                            }
                        />
                    </Pressable>
                )}
                {onRefresh && (
                    <Pressable
                        onPress={onRefresh}
                        disabled={loading}
                        hitSlop={8}
                        style={{
                            paddingHorizontal: 4,
                            justifyContent: "center",
                        }}
                    >
                        <Animated.View style={spinStyle}>
                            <Ionicons
                                name="refresh-outline"
                                size={18}
                                color={theme.colors.textSecondary}
                            />
                        </Animated.View>
                    </Pressable>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 8,
    },
    filterButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
    },
}));
