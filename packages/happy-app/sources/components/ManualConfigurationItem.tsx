import React from "react";
import { View, Text, Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import type { ManualConfigurationItemProps } from "./NewSessionWizardTypes";

export function ManualConfigurationItem({
    isSelected,
    onSelect,
    onUseCliVars,
    onConfigureManually,
}: ManualConfigurationItemProps) {
    const { theme } = useUnistyles();

    return (
        <View
            style={{
                backgroundColor: isSelected
                    ? theme.colors.input.background
                    : "transparent",
                borderRadius: 12,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected
                    ? theme.colors.button.primary.background
                    : theme.colors.divider,
                marginBottom: 12,
                padding: 4,
            }}
        >
            {/* Profile Header */}
            <Pressable onPress={onSelect} style={{ padding: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            backgroundColor: theme.colors.textSecondary,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 12,
                        }}
                    >
                        <Ionicons name="settings" size={20} color="white" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text
                            style={{
                                fontSize: 16,
                                fontWeight: "600",
                                color: theme.colors.text,
                                marginBottom: 4,
                                ...Typography.default("semiBold"),
                            }}
                        >
                            Manual Configuration
                        </Text>
                        <Text
                            style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            Use CLI environment variables or configure manually
                        </Text>
                    </View>
                    {isSelected && (
                        <Ionicons
                            name="checkmark-circle"
                            size={20}
                            color={theme.colors.button.primary.background}
                        />
                    )}
                </View>
            </Pressable>

            {/* Action Buttons - Only show when selected */}
            {isSelected && (
                <View
                    style={{
                        flexDirection: "row",
                        paddingHorizontal: 12,
                        paddingBottom: 12,
                        gap: 8,
                    }}
                >
                    <Pressable
                        style={{
                            flex: 1,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: theme.colors.button.primary.background,
                        }}
                        onPress={onUseCliVars}
                    >
                        <Ionicons name="terminal-outline" size={16} color="white" />
                        <Text
                            style={{
                                color: "white",
                                fontSize: 14,
                                fontWeight: "600",
                                marginLeft: 6,
                                ...Typography.default("semiBold"),
                            }}
                        >
                            Use CLI Vars
                        </Text>
                    </Pressable>

                    <Pressable
                        style={{
                            flex: 1,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: "transparent",
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                        }}
                        onPress={onConfigureManually}
                    >
                        <Ionicons
                            name="create-outline"
                            size={16}
                            color={theme.colors.text}
                        />
                        <Text
                            style={{
                                color: theme.colors.text,
                                fontSize: 14,
                                fontWeight: "600",
                                marginLeft: 6,
                                ...Typography.default("semiBold"),
                            }}
                        >
                            Configure
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}
