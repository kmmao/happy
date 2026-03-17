import * as React from "react";
import { View, Text, Pressable, TextInput, Linking } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { sessionElicitationResponse } from "@/sync/ops";
import { Typography } from "@/constants/Typography";

interface SchemaProperty {
    type?: string;
    description?: string;
    default?: unknown;
    enum?: string[];
}

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

export const ElicitationBanner = React.memo(({ sessionId, elicitation }: Props) => {
    const { theme } = useUnistyles();
    const [formValues, setFormValues] = React.useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // Reset form values when elicitation changes
    React.useEffect(() => {
        setFormValues({});
        setIsSubmitting(false);
    }, [elicitation.id]);

    // Extract properties from JSON Schema
    const properties = React.useMemo(() => {
        const schema = elicitation.requestedSchema;
        if (!schema || elicitation.mode !== "form") return {};
        return (schema.properties ?? {}) as Record<string, SchemaProperty>;
    }, [elicitation.requestedSchema, elicitation.mode]);

    const handleAccept = React.useCallback(async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (elicitation.mode === "url") {
                await sessionElicitationResponse(sessionId, elicitation.id, "accept");
            } else {
                // Convert string values to appropriate types based on schema
                const content: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(formValues)) {
                    const prop = properties[key];
                    if (prop?.type === "number" || prop?.type === "integer") {
                        const num = Number(value);
                        content[key] = Number.isNaN(num) ? 0 : num;
                    } else if (prop?.type === "boolean") {
                        content[key] = value === "true";
                    } else {
                        content[key] = value;
                    }
                }
                await sessionElicitationResponse(sessionId, elicitation.id, "accept", content);
            }
        } finally {
            setIsSubmitting(false);
        }
    }, [sessionId, elicitation.id, elicitation.mode, formValues, properties, isSubmitting]);

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

            {elicitation.mode === "form" && Object.keys(properties).length > 0 && (
                <View style={styles.formContainer}>
                    {Object.entries(properties).map(([key, prop]) => (
                        <View key={key} style={styles.formField}>
                            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>
                                {prop.description ?? key}
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
                                value={formValues[key] ?? String(prop.default ?? "")}
                                onChangeText={(v) => updateFormValue(key, v)}
                                placeholder={key}
                                placeholderTextColor={theme.colors.textSecondary}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                    ))}
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
                    disabled={isSubmitting}
                    style={({ pressed }) => [
                        styles.button,
                        styles.acceptButton,
                        { backgroundColor: theme.colors.textLink },
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
    fieldInput: {
        fontSize: 14,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        ...Typography.default(),
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
