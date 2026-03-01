import * as React from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
    IDEATION_STATUSES,
    IDEATION_STATUS_LABELS,
    type IdeationStatus,
} from "@/sync/ideationTypes";

type FilterOption = IdeationStatus | "all";

const FILTER_OPTIONS: ReadonlyArray<{
    readonly key: FilterOption;
    readonly label: string;
}> = [
    { key: "all", label: "ideation.filter.all" },
    ...IDEATION_STATUSES.map((s) => ({
        key: s as FilterOption,
        label: IDEATION_STATUS_LABELS[s],
    })),
];

interface IdeationFilterBarProps {
    activeFilter: FilterOption;
    counts: Record<IdeationStatus, number>;
    totalCount: number;
    onSelect: (filter: FilterOption) => void;
}

export const IdeationFilterBar = React.memo(
    ({ activeFilter, counts, totalCount, onSelect }: IdeationFilterBarProps) => {
        const { theme } = useUnistyles();

        return (
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.container}
            >
                {FILTER_OPTIONS.map((opt) => {
                    const isActive = opt.key === activeFilter;
                    const count =
                        opt.key === "all" ? totalCount : counts[opt.key];

                    return (
                        <Pressable
                            key={opt.key}
                            onPress={() => onSelect(opt.key)}
                            style={[
                                styles.tab,
                                isActive && {
                                    backgroundColor: theme.colors.text,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.tabText,
                                    {
                                        color: isActive
                                            ? theme.colors.surface
                                            : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {t(opt.label)}
                            </Text>
                            {count > 0 && (
                                <View
                                    style={[
                                        styles.badge,
                                        {
                                            backgroundColor: isActive
                                                ? theme.colors.surface
                                                : theme.colors.textSecondary,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.badgeText,
                                            {
                                                color: isActive
                                                    ? theme.colors.text
                                                    : theme.colors.surface,
                                            },
                                        ]}
                                    >
                                        {count}
                                    </Text>
                                </View>
                            )}
                        </Pressable>
                    );
                })}
            </ScrollView>
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
    tab: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: theme.colors.surface,
        gap: 6,
    },
    tabText: {
        fontSize: 13,
        ...Typography.default("semiBold"),
    },
    badge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 5,
        justifyContent: "center",
        alignItems: "center",
    },
    badgeText: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
}));
