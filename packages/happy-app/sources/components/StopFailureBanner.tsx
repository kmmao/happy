import * as React from "react";
import { View, Text, Pressable, ScrollView, Linking } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Typography } from "@/constants/Typography";

interface StopFailureData {
    error: string;
    errorType?: string | null;
    lastAssistantMessage?: string | null;
}

interface Props {
    stopFailure: StopFailureData;
}

const BILLING_URL = "https://console.anthropic.com/settings/billing";

type KnownErrorType =
    | "billing_error"
    | "rate_limit"
    | "authentication_failed"
    | "oauth_org_not_allowed"
    | "invalid_request"
    | "server_error"
    | "max_output_tokens"
    | "unknown";

const KNOWN_ERROR_TYPES: KnownErrorType[] = [
    "billing_error",
    "rate_limit",
    "authentication_failed",
    "oauth_org_not_allowed",
    "invalid_request",
    "server_error",
    "max_output_tokens",
    "unknown",
];

function getErrorLabel(errorType: string | null | undefined): string | null {
    if (!errorType) return null;
    if (KNOWN_ERROR_TYPES.includes(errorType as KnownErrorType)) {
        return t(`stopFailure.errorLabels.${errorType as KnownErrorType}`);
    }
    return errorType;
}

export const StopFailureBanner = React.memo(({ stopFailure }: Props) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);

    React.useEffect(() => {
        setDismissed(false);
        setExpanded(false);
    }, [stopFailure.error]);

    if (dismissed) return null;

    const hasLastMessage = !!stopFailure.lastAssistantMessage;
    const errorLabel = getErrorLabel(stopFailure.errorType);
    const isBillingError = stopFailure.errorType === "billing_error";
    const isRateLimit = stopFailure.errorType === "rate_limit";

    const labelColor = isBillingError
        ? theme.colors.warningCritical
        : isRateLimit
        ? theme.colors.warning
        : theme.colors.textSecondary;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.warningCritical }]}>
            <View style={styles.header}>
                <Ionicons name="warning-outline" size={16} color={theme.colors.warningCritical} />
                <Text style={[styles.title, { color: theme.colors.warningCritical }]}>
                    {t("stopFailure.title")}
                </Text>
                {errorLabel && (
                    <Text style={[styles.errorType, { color: labelColor }]}>
                        {errorLabel}
                    </Text>
                )}
                <Pressable onPress={() => setDismissed(true)} hitSlop={8} style={styles.dismissButton}>
                    <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            <Text style={[styles.errorMessage, { color: theme.colors.text }]} numberOfLines={5}>
                {stopFailure.error}
            </Text>

            {isBillingError && (
                <Pressable onPress={() => Linking.openURL(BILLING_URL)} style={styles.actionRow}>
                    <Ionicons name="card-outline" size={14} color={theme.colors.textLink} />
                    <Text style={[styles.actionText, { color: theme.colors.textLink }]}>
                        {t("stopFailure.billingAction")}
                    </Text>
                </Pressable>
            )}

            {isRateLimit && (
                <View style={styles.actionRow}>
                    <Ionicons name="time-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                        {t("stopFailure.rateLimitHint")}
                    </Text>
                </View>
            )}

            {hasLastMessage && (
                <>
                    <Pressable
                        onPress={() => setExpanded((prev) => !prev)}
                        style={styles.expandRow}
                    >
                        <Text style={[styles.expandLabel, { color: theme.colors.textLink }]}>
                            {t("stopFailure.lastMessage")}
                        </Text>
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={14}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                    {expanded && (
                        <ScrollView style={[styles.messageScroll, { backgroundColor: theme.colors.surfaceHighest }]}>
                            <Text style={[styles.messageText, { color: theme.colors.text }]}>
                                {stopFailure.lastAssistantMessage}
                            </Text>
                        </ScrollView>
                    )}
                </>
            )}
        </View>
    );
});

const styles = StyleSheet.create((_, rt) => ({
    container: {
        marginHorizontal: 12,
        marginVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        gap: 8,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    title: {
        fontSize: 13,
        fontWeight: "600",
        flex: 1,
        ...Typography.default(),
    },
    errorType: {
        fontSize: 11,
        fontWeight: "500",
        ...Typography.default(),
    },
    dismissButton: {
        marginLeft: 4,
    },
    errorMessage: {
        fontSize: 14,
        lineHeight: 20,
        ...Typography.default(),
    },
    actionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    actionText: {
        fontSize: 13,
        fontWeight: "500",
        ...Typography.default(),
    },
    expandRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    expandLabel: {
        fontSize: 13,
        fontWeight: "500",
        ...Typography.default(),
    },
    messageScroll: {
        maxHeight: 120,
        borderRadius: 8,
        padding: 10,
    },
    messageText: {
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
}));
