import React from "react";
import { View, Text, TextInput } from "react-native";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Switch } from "@/components/Switch";

interface Props {
    readonly theme: any;
    readonly formAutoEnabled: boolean;
    readonly formAutoLabel: string;
    readonly formAutoAuthors: string;
    readonly onAutoEnabledChange: (v: boolean) => void;
    readonly onAutoLabelChange: (v: string) => void;
    readonly onAutoAuthorsChange: (v: string) => void;
}

export const GitHostAutoIssueForm = React.memo(
    function GitHostAutoIssueForm({
        theme,
        formAutoEnabled,
        formAutoLabel,
        formAutoAuthors,
        onAutoEnabledChange,
        onAutoLabelChange,
        onAutoAuthorsChange,
    }: Props) {
        return (
            <View>
                {/* Toggle */}
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 4,
                        marginBottom: 8,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: theme.colors.text,
                            ...Typography.default("semiBold"),
                        }}
                    >
                        {t("gitHosts.autoIssueSectionTitle")}
                    </Text>
                    <Switch
                        value={formAutoEnabled}
                        onValueChange={onAutoEnabledChange}
                    />
                </View>
                <Text
                    style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        marginBottom: 12,
                        lineHeight: 16,
                        ...Typography.default(),
                    }}
                >
                    {t("gitHosts.autoIssueDescription")}
                </Text>

                {formAutoEnabled && (
                    <>
                        <FieldLabel theme={theme}>
                            {t("gitHosts.autoIssueLabel")}
                        </FieldLabel>
                        <TextInput
                            style={{
                                backgroundColor: theme.colors.surface,
                                borderRadius: 8,
                                padding: 12,
                                fontSize: 15,
                                color: theme.colors.text,
                                marginBottom: 12,
                                ...Typography.mono(),
                            }}
                            value={formAutoLabel}
                            onChangeText={onAutoLabelChange}
                            placeholder={t(
                                "gitHosts.autoIssueLabelPlaceholder",
                            )}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        <FieldLabel theme={theme}>
                            {t("gitHosts.autoIssueAllowedAuthors")}
                        </FieldLabel>
                        <TextInput
                            style={{
                                backgroundColor: theme.colors.surface,
                                borderRadius: 8,
                                padding: 12,
                                fontSize: 15,
                                color: theme.colors.text,
                                marginBottom: 8,
                                ...Typography.mono(),
                            }}
                            value={formAutoAuthors}
                            onChangeText={onAutoAuthorsChange}
                            placeholder={t(
                                "gitHosts.autoIssueAllowedAuthorsPlaceholder",
                            )}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </>
                )}
            </View>
        );
    },
);

const FieldLabel = React.memo<{
    theme: any;
    children: string;
}>(function FieldLabel({ theme, children }) {
    return (
        <Text
            style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginBottom: 6,
                ...Typography.default(),
            }}
        >
            {children}
        </Text>
    );
});
