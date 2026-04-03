import * as React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { type MachineAgentLoopSuggestion } from "@/sync/ops";
import { t } from "@/text";
import { formatIntervalMs } from "./loopsUtils";

interface LoopSuggestionsSectionProps {
    readonly suggestions: readonly MachineAgentLoopSuggestion[];
    readonly suggestionCreatableCount: number;
    readonly adoptingAllSuggestions: boolean;
    readonly creatingSuggestionKey: string | null;
    readonly adoptSuggestion: (s: MachineAgentLoopSuggestion) => Promise<void>;
    readonly adoptAllSuggestions: () => Promise<void>;
    readonly formLayoutStacked: boolean;
}

function renderSectionBanner(
    title: string,
    subtitle: string,
    badge: string | undefined,
    icon: React.ComponentProps<typeof Ionicons>["name"] | undefined,
    options: { readonly compact?: boolean } | undefined,
    theme: ReturnType<typeof useUnistyles>["theme"],
    formLayoutStacked: boolean,
) {
    return (
        <View style={[
            styles.sectionBanner,
            options?.compact ? styles.sectionBannerCompact : null,
            formLayoutStacked ? styles.sectionBannerStacked : null,
            { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface },
        ]}>
            <View style={styles.sectionBannerLeading}>
                {icon ? <Ionicons name={icon} size={options?.compact ? 16 : 18} color={theme.colors.textSecondary} /> : null}
                <View style={styles.sectionBannerTextWrap}>
                    <Text style={[
                        styles.sectionBannerTitle,
                        options?.compact ? styles.sectionBannerTitleCompact : null,
                        { color: theme.colors.text },
                    ]}>{title}</Text>
                    {!options?.compact ? (
                        <Text style={[styles.sectionBannerSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>
                    ) : null}
                </View>
            </View>
            {badge ? (
                <View style={[styles.sectionBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.sectionBadgeText, { color: theme.colors.text }]}>{badge}</Text>
                </View>
            ) : null}
        </View>
    );
}

export const LoopSuggestionsSection = React.memo(function LoopSuggestionsSection(props: LoopSuggestionsSectionProps) {
    const {
        suggestions,
        suggestionCreatableCount,
        adoptingAllSuggestions,
        creatingSuggestionKey,
        adoptSuggestion,
        adoptAllSuggestions,
        formLayoutStacked,
    } = props;
    const { theme } = useUnistyles();

    if (suggestions.length === 0) {
        return null;
    }

    return (
        <>
            {renderSectionBanner(t("machine.agentLoopSuggestions"), t("machine.agentLoopSuggestions"), String(suggestions.length), "sparkles-outline", { compact: true }, theme, formLayoutStacked)}
            <Item
                title={t("machine.agentLoopSuggestionAdoptAll")}
                subtitle={t("machine.agentLoopSuggestions")}
                detail={String(suggestionCreatableCount)}
                icon={<Ionicons name="sparkles-outline" size={22} color={theme.colors.header.tint} />}
                onPress={() => void adoptAllSuggestions()}
                rightElement={adoptingAllSuggestions ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
            />
            {suggestions.map((suggestion) => (
                <View key={suggestion.key} style={[styles.suggestionCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                    <View style={styles.cardHeaderRow}>
                        <View style={styles.cardHeaderTextWrap}>
                            <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{suggestion.name}</Text>
                            <Text style={[styles.cardPathText, { color: theme.colors.textSecondary }]}>{suggestion.directory}</Text>
                        </View>
                        <Ionicons name="sparkles-outline" size={18} color={theme.colors.header.tint} />
                    </View>
                    <View style={styles.metaPillRow}>
                        <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                            <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{formatIntervalMs(suggestion.intervalMs)}</Text>
                        </View>
                        <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                            <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{suggestion.agent}</Text>
                        </View>
                    </View>
                    <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]}>{suggestion.prompt}</Text>
                    <View style={styles.suggestionActions}>
                        <Pressable
                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: suggestion.alreadyConfigured ? 0.6 : 1 }]}
                            onPress={() => void adoptSuggestion(suggestion)}
                            disabled={suggestion.alreadyConfigured || creatingSuggestionKey === suggestion.key}
                        >
                            {creatingSuggestionKey === suggestion.key ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Text style={{ color: theme.colors.text }}>
                                    {suggestion.alreadyConfigured ? t("machine.agentLoopSuggestionConfigured") : t("machine.agentLoopSuggestionAdopt")}
                                </Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            ))}
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    inlineSecondaryButton: {
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
        marginTop: 4,
    },
    suggestionCard: {
        padding: 16,
        gap: 8,
        marginHorizontal: 12,
        marginVertical: 8,
        borderWidth: 1,
        borderRadius: 14,
    },
    suggestionTitle: {
        fontSize: 15,
        fontWeight: "600",
    },
    cardHeaderRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    cardHeaderTextWrap: {
        flex: 1,
        gap: 4,
    },
    cardPathText: {
        fontSize: 13,
        lineHeight: 18,
    },
    metaPillRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    metaPill: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    metaPillText: {
        fontSize: 12,
        fontWeight: "600",
    },
    cardDescription: {
        fontSize: 13,
        lineHeight: 18,
    },
    suggestionActions: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
        paddingTop: 2,
    },
    sectionBanner: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionBannerCompact: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    sectionBannerTitleCompact: {
        fontSize: 14,
        fontWeight: "700",
    },
    sectionBannerStacked: {
        alignItems: "flex-start",
        flexDirection: "column",
    },
    sectionBannerLeading: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    sectionBannerTextWrap: {
        flex: 1,
        gap: 4,
    },
    sectionBannerTitle: {
        fontSize: 15,
        fontWeight: "700",
    },
    sectionBannerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    sectionBadge: {
        minWidth: 44,
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionBadgeText: {
        fontSize: 13,
        fontWeight: "700",
    },
}));
