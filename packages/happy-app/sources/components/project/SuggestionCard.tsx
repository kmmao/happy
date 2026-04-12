import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { type SuggestionSummary } from "@/sync/apiWorld";
import {
    getSuggestionAcceptanceLabelKey,
    getSuggestionAutoAcceptFailureDetailKey,
    getSuggestionAutoAcceptOutcomeKey,
    getSuggestionAutoAcceptReasonKey,
    getSuggestionTypeConfig,
    getSuggestionTypeLabelKey,
    shouldShowSuggestionActions,
} from "./worldSuggestionViewModel";

interface SuggestionCardProps {
    suggestion: SuggestionSummary;
    onAccept: (suggestion: SuggestionSummary) => void;
    onDismiss: (suggestion: SuggestionSummary) => void;
}

export const SuggestionCard = React.memo(function SuggestionCard({
    suggestion,
    onAccept,
    onDismiss,
}: SuggestionCardProps) {
    const config = getSuggestionTypeConfig(suggestion.type);
    const typeLabel = t(getSuggestionTypeLabelKey(suggestion.type));
    const acceptanceLabelKey = getSuggestionAcceptanceLabelKey(suggestion);
    const autoAcceptReasonKey = getSuggestionAutoAcceptReasonKey(suggestion);
    const autoAcceptOutcomeKey = getSuggestionAutoAcceptOutcomeKey(suggestion);
    const autoAcceptFailureDetailKey = getSuggestionAutoAcceptFailureDetailKey(suggestion);
    const showActions = shouldShowSuggestionActions(suggestion);

    return (
        <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
                <Ionicons name={config.icon as any} size={18} color={config.color} />
                <View style={styles.headerText}>
                    <Text style={styles.title} numberOfLines={2}>{suggestion.title}</Text>
                </View>
                <View style={styles.badgesColumn}>
                    <View style={[styles.typeBadge, { backgroundColor: config.color + "20" }]}>
                        <Text style={[styles.typeBadgeText, { color: config.color }]}>
                            {typeLabel}
                        </Text>
                    </View>
                    {acceptanceLabelKey ? (
                        <View style={styles.acceptanceBadge}>
                            <Text style={styles.acceptanceBadgeText}>
                                {t(acceptanceLabelKey)}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </View>

            {/* Summary */}
            <Text style={styles.summary} numberOfLines={3}>{suggestion.summary}</Text>

            {/* Reason */}
            <Text style={styles.reason} numberOfLines={2}>{suggestion.reason}</Text>

            {autoAcceptReasonKey ? (
                <Text style={styles.autoAcceptReason} numberOfLines={2}>
                    {t(autoAcceptReasonKey)}
                </Text>
            ) : null}

            {autoAcceptOutcomeKey ? (
                <Text style={styles.autoAcceptReason} numberOfLines={2}>
                    {t(autoAcceptOutcomeKey)}
                </Text>
            ) : null}

            {autoAcceptFailureDetailKey ? (
                <Text style={styles.autoAcceptReason} numberOfLines={2}>
                    {t(autoAcceptFailureDetailKey)}
                </Text>
            ) : null}

            {/* Evidence */}
            {suggestion.evidence.length > 0 && (
                <View style={styles.evidenceRow}>
                    <Text style={styles.evidenceLabel}>{t("suggestions.evidence")}:</Text>
                    <Text style={styles.evidenceText} numberOfLines={1}>
                        {suggestion.evidence.map((e) => e.label).join(", ")}
                    </Text>
                </View>
            )}

            {/* Recommended Role */}
            {suggestion.recommendedRole && (
                <View style={styles.evidenceRow}>
                    <Text style={styles.evidenceLabel}>{t("suggestions.recommendedRole")}:</Text>
                    <Text style={styles.evidenceText}>{suggestion.recommendedRole}</Text>
                </View>
            )}

            {showActions ? (
                <View style={styles.actionRow}>
                    <Pressable
                        style={styles.dismissButton}
                        onPress={() => onDismiss(suggestion)}
                    >
                        <Ionicons name="close" size={16} color="#6B7280" />
                        <Text style={styles.dismissText}>{t("suggestions.dismiss")}</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.acceptButton, { backgroundColor: config.color }]}
                        onPress={() => onAccept(suggestion)}
                    >
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                        <Text style={styles.acceptText}>{t("suggestions.accept")}</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
});

// === Styles ===

const styles = StyleSheet.create((theme) => ({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        marginHorizontal: 16,
        marginBottom: 8,
        gap: 8,
    },
    header: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
    },
    headerText: {
        flex: 1,
    },
    badgesColumn: {
        alignItems: "flex-end" as const,
        gap: 6,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
        lineHeight: 20,
    },
    typeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    typeBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    acceptanceBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: "rgba(107, 114, 128, 0.12)",
    },
    acceptanceBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    summary: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
    },
    reason: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 16,
        fontStyle: "italic" as const,
    },
    autoAcceptReason: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        lineHeight: 16,
    },
    evidenceRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
    },
    evidenceLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    evidenceText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    actionRow: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        alignItems: "center" as const,
        gap: 12,
        marginTop: 4,
    },
    dismissButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 10,
    },
    dismissText: {
        ...Typography.default(),
        fontSize: 13,
        color: "#6B7280",
    },
    acceptButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderRadius: 8,
    },
    acceptText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: "#FFFFFF",
    },
}));

