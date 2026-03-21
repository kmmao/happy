import React from "react";
import { View, Text, Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import type { ProfileSelectionItemProps } from "./NewSessionWizardTypes";

export function ProfileSelectionItem({
    profile,
    isSelected,
    onSelect,
    onUseAsIs,
    onEdit,
    onDuplicate,
    onDelete,
    showManagementActions = false,
}: ProfileSelectionItemProps) {
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
                            backgroundColor: theme.colors.button.primary.background,
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 12,
                        }}
                    >
                        <Ionicons name="person-outline" size={20} color="white" />
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
                            {profile.name}
                        </Text>
                        <Text
                            style={{
                                fontSize: 14,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                            }}
                        >
                            {profile.description}
                        </Text>
                        {profile.isBuiltIn && (
                            <Text
                                style={{
                                    fontSize: 12,
                                    color: theme.colors.textSecondary,
                                    marginTop: 2,
                                }}
                            >
                                {t('newSession.builtInProfile')}
                            </Text>
                        )}
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
                        flexDirection: "column",
                        paddingHorizontal: 12,
                        paddingBottom: 12,
                        gap: 8,
                    }}
                >
                    {/* Primary Actions */}
                    <View
                        style={{
                            flexDirection: "row",
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
                            onPress={onUseAsIs}
                        >
                            <Ionicons name="checkmark" size={16} color="white" />
                            <Text
                                style={{
                                    color: "white",
                                    fontSize: 14,
                                    fontWeight: "600",
                                    marginLeft: 6,
                                    ...Typography.default("semiBold"),
                                }}
                            >
                                Use As-Is
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
                            onPress={onEdit}
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
                                Edit
                            </Text>
                        </Pressable>
                    </View>

                    {/* Management Actions - Only show for custom profiles */}
                    {showManagementActions && !profile.isBuiltIn && (
                        <View
                            style={{
                                flexDirection: "row",
                                gap: 8,
                            }}
                        >
                            <Pressable
                                style={{
                                    flex: 1,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    paddingVertical: 6,
                                    paddingHorizontal: 8,
                                    borderRadius: 6,
                                    backgroundColor: "transparent",
                                    borderWidth: 1,
                                    borderColor: theme.colors.divider,
                                }}
                                onPress={onDuplicate}
                            >
                                <Ionicons
                                    name="copy-outline"
                                    size={14}
                                    color={theme.colors.textSecondary}
                                />
                                <Text
                                    style={{
                                        color: theme.colors.textSecondary,
                                        fontSize: 12,
                                        fontWeight: "600",
                                        marginLeft: 4,
                                        ...Typography.default("semiBold"),
                                    }}
                                >
                                    Duplicate
                                </Text>
                            </Pressable>

                            <Pressable
                                style={{
                                    flex: 1,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    paddingVertical: 6,
                                    paddingHorizontal: 8,
                                    borderRadius: 6,
                                    backgroundColor: "transparent",
                                    borderWidth: 1,
                                    borderColor: theme.colors.textDestructive,
                                }}
                                onPress={onDelete}
                            >
                                <Ionicons
                                    name="trash-outline"
                                    size={14}
                                    color={theme.colors.textDestructive}
                                />
                                <Text
                                    style={{
                                        color: theme.colors.textDestructive,
                                        fontSize: 12,
                                        fontWeight: "600",
                                        marginLeft: 4,
                                        ...Typography.default("semiBold"),
                                    }}
                                >
                                    Delete
                                </Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}
