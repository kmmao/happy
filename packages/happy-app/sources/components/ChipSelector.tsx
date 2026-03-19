import * as React from "react";
import { View, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";

export interface ChipOption<T extends string> {
    readonly value: T;
    readonly label: string;
    readonly icon: keyof typeof Ionicons.glyphMap;
    readonly color: string;
}

interface ChipSelectorProps<T extends string> {
    readonly options: readonly ChipOption<T>[];
    readonly selected: readonly T[];
    readonly onToggle: (value: T) => void;
    readonly multiSelect?: boolean;
}

function ChipSelectorInner<T extends string>({
    options,
    selected,
    onToggle,
    multiSelect = false,
}: ChipSelectorProps<T>) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                    <Pressable
                        key={option.value}
                        style={[
                            styles.chip,
                            {
                                backgroundColor: isSelected
                                    ? option.color + "20"
                                    : theme.colors.surfaceHigh,
                                borderColor: isSelected
                                    ? option.color
                                    : theme.colors.divider,
                            },
                        ]}
                        onPress={() => onToggle(option.value)}
                    >
                        <View
                            style={[
                                styles.iconCircle,
                                {
                                    backgroundColor: isSelected
                                        ? option.color + "30"
                                        : theme.colors.surfaceHighest,
                                },
                            ]}
                        >
                            <Ionicons
                                name={option.icon}
                                size={16}
                                color={isSelected ? option.color : theme.colors.textSecondary}
                            />
                        </View>
                        <Text
                            style={[
                                styles.label,
                                {
                                    color: isSelected
                                        ? option.color
                                        : theme.colors.text,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {option.label}
                        </Text>
                        {isSelected && (
                            <Ionicons
                                name={multiSelect ? "checkmark-circle" : "checkmark"}
                                size={16}
                                color={option.color}
                            />
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1.5,
    },
    iconCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
    },
    label: {
        ...Typography.default(),
        fontSize: 14,
    },
}));

export const ChipSelector = React.memo(ChipSelectorInner) as typeof ChipSelectorInner;
