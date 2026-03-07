import * as React from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { IssueLabel } from "@/sync/issueTypes";

interface LabelPickerProps {
    readonly availableLabels: readonly IssueLabel[];
    readonly selectedLabels: readonly string[];
    readonly loadingLabels: boolean;
    readonly onToggleLabel: (name: string) => void;
}

/**
 * Shared label picker component used by IssueCreateSheet and IssueEditSheet.
 * Shows labels with their actual colors from the repository.
 */
export const LabelPicker = React.memo<LabelPickerProps>(
    function LabelPicker({
        availableLabels,
        selectedLabels,
        loadingLabels,
        onToggleLabel,
    }) {
        const { theme } = useUnistyles();

        return (
            <View>
                <Text
                    style={{
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        marginBottom: 6,
                        ...Typography.default(),
                    }}
                >
                    {t("issues.labelSelect")}
                </Text>
                {loadingLabels && (
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.textSecondary}
                        style={{ marginVertical: 8 }}
                    />
                )}
                {!loadingLabels && availableLabels.length === 0 && (
                    <Text
                        style={{
                            fontSize: 13,
                            color: theme.colors.textSecondary,
                            fontStyle: "italic",
                            ...Typography.default(),
                        }}
                    >
                        {t("issues.noLabelsAvailable")}
                    </Text>
                )}
                {!loadingLabels && availableLabels.length > 0 && (
                    <View
                        style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 8,
                        }}
                    >
                        {availableLabels.map((label) => {
                            const isSelected = selectedLabels.includes(
                                label.name,
                            );
                            const hasColor = !!label.color;
                            // Brightness for selected state text contrast
                            const brightness = hasColor
                                ? parseInt(label.color.slice(0, 2), 16) *
                                      0.299 +
                                  parseInt(label.color.slice(2, 4), 16) *
                                      0.587 +
                                  parseInt(label.color.slice(4, 6), 16) * 0.114
                                : 200;
                            const selectedTextColor =
                                brightness > 128 ? "#000000" : "#ffffff";

                            return (
                                <Pressable
                                    key={label.name}
                                    onPress={() => onToggleLabel(label.name)}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 4,
                                        paddingHorizontal: 10,
                                        paddingVertical: 5,
                                        borderRadius: 16,
                                        backgroundColor: isSelected
                                            ? hasColor
                                                ? `#${label.color}`
                                                : theme.colors.text
                                            : hasColor
                                              ? `#${label.color}18`
                                              : theme.colors.surfaceHigh,
                                        borderWidth: 1.5,
                                        borderColor: isSelected
                                            ? hasColor
                                                ? `#${label.color}`
                                                : theme.colors.text
                                            : hasColor
                                              ? `#${label.color}40`
                                              : theme.colors.divider,
                                    }}
                                >
                                    {isSelected && (
                                        <Text
                                            style={{
                                                fontSize: 10,
                                                color: hasColor
                                                    ? selectedTextColor
                                                    : theme.colors.surface,
                                                ...Typography.default(
                                                    "semiBold",
                                                ),
                                            }}
                                        >
                                            {"✓"}
                                        </Text>
                                    )}
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            color: isSelected
                                                ? hasColor
                                                    ? selectedTextColor
                                                    : theme.colors.surface
                                                : hasColor
                                                  ? `#${label.color}`
                                                  : theme.colors.textSecondary,
                                            ...Typography.default(
                                                isSelected
                                                    ? "semiBold"
                                                    : undefined,
                                            ),
                                        }}
                                    >
                                        {label.name}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
            </View>
        );
    },
);
