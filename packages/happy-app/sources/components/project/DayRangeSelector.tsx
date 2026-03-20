import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";

const DAY_OPTIONS = [3, 7, 14, 30] as const;

interface DayRangeSelectorProps {
    selectedDays: number;
    loading?: boolean;
    onDaysChange: (days: number) => void;
}

export const DayRangeSelector = React.memo(
    ({ selectedDays, loading, onDaysChange }: DayRangeSelectorProps) => {
        const { theme } = useUnistyles();

        return (
            <View style={styles.container}>
                {DAY_OPTIONS.map((days) => (
                    <Pressable
                        key={days}
                        style={[
                            styles.button,
                            selectedDays === days && {
                                backgroundColor: theme.colors.header.tint,
                            },
                        ]}
                        onPress={() => onDaysChange(days)}
                        disabled={loading}
                    >
                        <Text
                            style={[
                                styles.text,
                                selectedDays === days && styles.textActive,
                            ]}
                        >
                            {`${days}d`}
                        </Text>
                    </Pressable>
                ))}
                {loading && (
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.textSecondary}
                        style={styles.loader}
                    />
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
    },
    button: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
    },
    text: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    textActive: {
        color: "#FFFFFF",
    },
    loader: {
        marginLeft: 4,
    },
}));
