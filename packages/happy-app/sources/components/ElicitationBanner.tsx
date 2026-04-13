import * as React from "react";
import { View, Text, Pressable, TextInput, Linking } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { sessionElicitationResponse } from "@/sync/ops";
import { Typography } from "@/constants/Typography";
import {
    coerceElicitationValue,
    parseElicitationFields,
} from "./elicitationSchema";

interface ElicitationData {
    id: string;
    serverName: string;
    message: string;
    mode: "form" | "url";
    url?: string | null;
    requestedSchema?: Record<string, unknown> | null;
}

interface Props {
    sessionId: string;
    elicitation: ElicitationData;
}

function parseRecommendedLabel(label: string): {
    cleanLabel: string;
    isRecommended: boolean;
} {
    const match = label.match(/^(.+?)\s*\(Recommended\)\s*$/i);
    if (!match) {
        return { cleanLabel: label, isRecommended: false };
    }
    return {
        cleanLabel: match[1].trim(),
        isRecommended: true,
    };
}

export const ElicitationBanner = React.memo(({ sessionId, elicitation }: Props) => {
    const { theme } = useUnistyles();
    const [formValues, setFormValues] = React.useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // Reset form values when elicitation changes
    React.useEffect(() => {
        setFormValues({});
        setIsSubmitting(false);
    }, [elicitation.id]);

    const fields = React.useMemo(() => {
        if (elicitation.mode !== "form") return [];
        return parseElicitationFields(elicitation.requestedSchema);
    }, [elicitation.requestedSchema, elicitation.mode]);

    const canSubmit = React.useMemo(() => {
        if (elicitation.mode !== "form") {
            return true;
        }

        return fields.every((field) => {
            if (!field.required) {
                return true;
            }
            const currentValue = (formValues[field.key] ?? field.defaultValue).trim();
            return currentValue.length > 0;
        });
    }, [elicitation.mode, fields, formValues]);

    const handleAccept = React.useCallback(async () => {
        if (isSubmitting || !canSubmit) return;
        setIsSubmitting(true);
        try {
            if (elicitation.mode === "url") {
                await sessionElicitationResponse(sessionId, elicitation.id, "accept");
            } else {
                const content: Record<string, unknown> = {};
                for (const field of fields) {
                    const value = formValues[field.key] ?? field.defaultValue;
                    if (value.trim().length === 0) {
                        continue;
                    }
                    content[field.key] = coerceElicitationValue(field, value);
                }
                await sessionElicitationResponse(sessionId, elicitation.id, "accept", content);
            }
        } finally {
            setIsSubmitting(false);
        }
    }, [canSubmit, sessionId, elicitation.id, elicitation.mode, fields, formValues, isSubmitting]);

    const handleDecline = React.useCallback(async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            await sessionElicitationResponse(sessionId, elicitation.id, "decline");
        } finally {
            setIsSubmitting(false);
        }
    }, [sessionId, elicitation.id, isSubmitting]);

    const handleOpenUrl = React.useCallback(() => {
        if (elicitation.url && (elicitation.url.startsWith("https://") || elicitation.url.startsWith("http://"))) {
            Linking.openURL(elicitation.url);
        }
    }, [elicitation.url]);

    const updateFormValue = React.useCallback((key: string, value: string) => {
        setFormValues((prev) => ({ ...prev, [key]: value }));
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceHighest }]}>
            <View style={styles.header}>
                <Ionicons name="server-outline" size={16} color={theme.colors.textLink} />
                <Text style={[styles.serverName, { color: theme.colors.textLink }]}>
                    {elicitation.serverName}
                </Text>
            </View>

            <Text style={[styles.message, { color: theme.colors.text }]}>
                {elicitation.message}
            </Text>

            {elicitation.mode === "url" && elicitation.url && (
                <Pressable onPress={handleOpenUrl} style={styles.urlRow}>
                    <Ionicons name="open-outline" size={14} color={theme.colors.textLink} />
                    <Text
                        style={[styles.urlText, { color: theme.colors.textLink }]}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                    >
                        {elicitation.url}
                    </Text>
                </Pressable>
            )}

            {elicitation.mode === "form" && fields.length > 0 && (
                <View style={styles.formContainer}>
                    {fields.map((field) => {
                        const currentValue = formValues[field.key] ?? field.defaultValue;
                        const showOtherInput =
                            field.allowOther &&
                            !field.options.some((option) => option.value === currentValue);

                        return (
                            <View key={field.key} style={styles.formField}>
                                <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>
                                    {field.label}
                                </Text>
                                {field.description ? (
                                    <Text style={[styles.fieldDescription, { color: theme.colors.textSecondary }]}>
                                        {field.description}
                                    </Text>
                                ) : null}

                                {field.options.length > 0 ? (
                                    <View style={styles.optionList}>
                                        {field.options.map((option) => {
                                            const isSelected = currentValue === option.value;
                                            const { cleanLabel, isRecommended } = parseRecommendedLabel(option.label);
                                            return (
                                                <Pressable
                                                    key={option.value}
                                                    onPress={() => updateFormValue(field.key, option.value)}
                                                    style={({ pressed }) => [
                                                        styles.optionButton,
                                                        {
                                                            borderColor: isSelected
                                                                ? theme.colors.textLink
                                                                : theme.colors.surfaceHighest,
                                                            backgroundColor: isSelected
                                                                ? theme.colors.surfaceHighest
                                                                : theme.colors.surface,
                                                        },
                                                        pressed && { opacity: 0.8 },
                                                    ]}
                                                >
                                                    <View
                                                        style={[
                                                            styles.radioOuter,
                                                            {
                                                                borderColor: isSelected
                                                                    ? theme.colors.textLink
                                                                    : theme.colors.textSecondary,
                                                            },
                                                            isSelected && { backgroundColor: theme.colors.textLink },
                                                        ]}
                                                    >
                                                        {isSelected ? <View style={styles.radioInner} /> : null}
                                                    </View>
                                                    <View style={styles.optionContent}>
                                                        <View style={styles.optionTitleRow}>
                                                            <Text style={[styles.optionTitle, { color: theme.colors.text }]}>
                                                                {cleanLabel}
                                                            </Text>
                                                            {isRecommended ? (
                                                                <View style={[styles.recommendedTag, { backgroundColor: theme.colors.textLink }]}>
                                                                    <Text style={styles.recommendedText}>
                                                                        {t("tools.askUserQuestion.recommended")}
                                                                    </Text>
                                                                </View>
                                                            ) : null}
                                                        </View>
                                                        {option.description ? (
                                                            <Text style={[styles.optionDescription, { color: theme.colors.textSecondary }]}>
                                                                {option.description}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                </Pressable>
                                            );
                                        })}
                                        {field.allowOther ? (
                                            <View style={styles.otherContainer}>
                                                <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>
                                                    {t("tools.askUserQuestion.other")}
                                                </Text>
                                                <TextInput
                                                    style={[
                                                        styles.fieldInput,
                                                        {
                                                            color: theme.colors.text,
                                                            backgroundColor: theme.colors.surfaceHighest,
                                                            borderColor: theme.colors.surfaceHighest,
                                                        },
                                                    ]}
                                                    value={showOtherInput ? currentValue : ""}
                                                    onChangeText={(value) => updateFormValue(field.key, value)}
                                                    placeholder={t("tools.askUserQuestion.other")}
                                                    placeholderTextColor={theme.colors.textSecondary}
                                                    autoCapitalize="none"
                                                    autoCorrect={false}
                                                    secureTextEntry={field.secret}
                                                />
                                            </View>
                                        ) : null}
                                    </View>
                                ) : (
                                    <TextInput
                                        style={[
                                            styles.fieldInput,
                                            {
                                                color: theme.colors.text,
                                                backgroundColor: theme.colors.surfaceHighest,
                                                borderColor: theme.colors.surfaceHighest,
                                            },
                                        ]}
                                        value={currentValue}
                                        onChangeText={(value) => updateFormValue(field.key, value)}
                                        placeholder={field.key}
                                        placeholderTextColor={theme.colors.textSecondary}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        secureTextEntry={field.secret}
                                    />
                                )}
                            </View>
                        );
                    })}
                </View>
            )}

            <View style={styles.actions}>
                <Pressable
                    onPress={handleDecline}
                    disabled={isSubmitting}
                    style={({ pressed }) => [
                        styles.button,
                        { backgroundColor: theme.colors.surfaceHighest },
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Text style={[styles.buttonText, { color: theme.colors.textSecondary }]}>
                        {t("elicitation.decline")}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={handleAccept}
                    disabled={isSubmitting || !canSubmit}
                    style={({ pressed }) => [
                        styles.button,
                        styles.acceptButton,
                        { backgroundColor: theme.colors.textLink },
                        (isSubmitting || !canSubmit) && { opacity: 0.5 },
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Text style={[styles.buttonText, { color: "#fff" }]}>
                        {elicitation.mode === "url"
                            ? t("elicitation.accept")
                            : t("elicitation.submit")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        marginHorizontal: 12,
        marginVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        gap: 10,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    serverName: {
        fontSize: 13,
        fontWeight: "600",
        ...Typography.default(),
    },
    message: {
        fontSize: 14,
        lineHeight: 20,
        ...Typography.default(),
    },
    urlRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    urlText: {
        fontSize: 13,
        flex: 1,
        ...Typography.default(),
    },
    formContainer: {
        gap: 10,
    },
    formField: {
        gap: 4,
    },
    fieldLabel: {
        fontSize: 12,
        ...Typography.default(),
    },
    fieldDescription: {
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
    fieldInput: {
        fontSize: 14,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        ...Typography.default(),
    },
    optionList: {
        gap: 8,
    },
    optionButton: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
    },
    optionContent: {
        flex: 1,
        gap: 4,
    },
    optionTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    optionTitle: {
        fontSize: 14,
        fontWeight: "600",
        ...Typography.default(),
    },
    optionDescription: {
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
    radioOuter: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 1,
    },
    radioInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#fff",
    },
    recommendedTag: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    recommendedText: {
        fontSize: 10,
        fontWeight: "700",
        color: "#fff",
        ...Typography.default(),
    },
    otherContainer: {
        gap: 6,
        marginTop: 4,
    },
    actions: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 8,
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    acceptButton: {},
    buttonText: {
        fontSize: 14,
        fontWeight: "600",
        ...Typography.default(),
    },
}));
