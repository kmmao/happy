import * as React from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { UseOneClickSetupReturn } from "./useOneClickSetup";

interface OneClickSetupCardProps {
    setup: UseOneClickSetupReturn;
}

const PHASE_STEPS = ["scanning", "suggesting", "confirming", "creating", "done"] as const;

function getStepIndex(phase: string): number {
    const idx = PHASE_STEPS.indexOf(phase as any);
    return idx >= 0 ? idx : 0;
}

export const OneClickSetupCard = React.memo(function OneClickSetupCard({ setup }: OneClickSetupCardProps) {
    const { theme } = useUnistyles();
    const { state, start, confirm, toggleRepo, reset } = setup;
    const { phase, repos, totalSuggestions, creatableCount, createdCount, errorMessage } = state;

    if (phase === "idle") {
        return (
            <Pressable
                style={[styles.heroCard, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceHigh }]}
                onPress={start}
            >
                <View style={styles.heroCardHeader}>
                    <Ionicons name="rocket-outline" size={24} color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickSetupTitle")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>{t("machine.oneClickSetupSubtitle")}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                </View>
            </Pressable>
        );
    }

    if (phase === "scanning" || phase === "suggesting") {
        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                <View style={styles.heroCardHeader}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>
                            {phase === "scanning" ? t("machine.oneClickScanning") : t("machine.oneClickSuggesting")}
                        </Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>
                            {phase === "scanning" ? t("machine.oneClickScanningHint") : t("machine.oneClickSuggestingHint")}
                        </Text>
                    </View>
                </View>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: phase === "scanning" ? "30%" : "60%" }]} />
                </View>
            </View>
        );
    }

    if (phase === "confirming") {
        const selectedCount = repos.filter((r) => r.selected).length;
        const selectedSuggestions = repos.filter((r) => r.selected).reduce((sum, r) => sum + r.suggestions.length, 0);

        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceHigh }]}>
                <View style={styles.heroCardHeader}>
                    <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickConfirmTitle")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>
                            {t("machine.oneClickConfirmSubtitle", { repos: repos.length, loops: totalSuggestions })}
                        </Text>
                    </View>
                </View>

                <View style={styles.repoList}>
                    {repos.map((entry) => (
                        <Pressable
                            key={entry.repo.repoPath}
                            style={[styles.repoItem, { borderColor: theme.colors.divider, backgroundColor: entry.selected ? theme.colors.surface : "transparent" }]}
                            onPress={() => toggleRepo(entry.repo.repoPath)}
                        >
                            <Ionicons
                                name={entry.selected ? "checkbox" : "square-outline"}
                                size={20}
                                color={entry.selected ? theme.colors.primary : theme.colors.textSecondary}
                            />
                            <View style={styles.repoItemTextWrap}>
                                <Text style={[styles.repoItemTitle, { color: theme.colors.text }]}>{entry.repo.name}</Text>
                                <Text style={[styles.repoItemPath, { color: theme.colors.textSecondary }]}>{entry.repo.repoPath}</Text>
                            </View>
                            <View style={[styles.badge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>{entry.suggestions.length}</Text>
                            </View>
                        </Pressable>
                    ))}
                </View>

                <View style={styles.actionsRow}>
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: theme.colors.button.primary.background, opacity: selectedCount === 0 ? 0.5 : 1 }]}
                        onPress={confirm}
                        disabled={selectedCount === 0}
                    >
                        <Text style={[styles.primaryButtonText, { color: theme.colors.button.primary.tint }]}>
                            {t("machine.oneClickConfirmCreate", { count: selectedSuggestions })}
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[styles.secondaryButton, { borderColor: theme.colors.divider }]}
                        onPress={reset}
                    >
                        <Text style={{ color: theme.colors.textSecondary }}>{t("common.cancel")}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    if (phase === "creating") {
        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                <View style={styles.heroCardHeader}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickCreating")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>
                            {t("machine.oneClickCreatingProgress", { created: createdCount, total: creatableCount })}
                        </Text>
                    </View>
                </View>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${creatableCount > 0 ? Math.round((createdCount / creatableCount) * 100) : 0}%` }]} />
                </View>
            </View>
        );
    }

    if (phase === "done") {
        return (
            <View style={[styles.heroCard, { borderColor: "#34C759", backgroundColor: theme.colors.surfaceHigh }]}>
                <View style={styles.heroCardHeader}>
                    <Ionicons name="checkmark-circle" size={24} color="#34C759" />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickDone")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>
                            {createdCount > 0
                                ? t("machine.oneClickDoneCreated", { count: createdCount })
                                : t("machine.oneClickDoneNone")}
                        </Text>
                    </View>
                    <Pressable onPress={reset}>
                        <Ionicons name="close-circle-outline" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            </View>
        );
    }

    // error phase
    return (
        <View style={[styles.heroCard, { borderColor: "#FF3B30", backgroundColor: theme.colors.surfaceHigh }]}>
            <View style={styles.heroCardHeader}>
                <Ionicons name="alert-circle" size={24} color="#FF3B30" />
                <View style={styles.heroCardTextWrap}>
                    <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickError")}</Text>
                    <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>{errorMessage}</Text>
                </View>
            </View>
            <View style={styles.actionsRow}>
                <Pressable
                    style={[styles.primaryButton, { backgroundColor: theme.colors.button.primary.background }]}
                    onPress={start}
                >
                    <Text style={[styles.primaryButtonText, { color: theme.colors.button.primary.tint }]}>{t("common.retry")}</Text>
                </Pressable>
                <Pressable
                    style={[styles.secondaryButton, { borderColor: theme.colors.divider }]}
                    onPress={reset}
                >
                    <Text style={{ color: theme.colors.textSecondary }}>{t("common.cancel")}</Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    heroCard: {
        margin: 16,
        marginBottom: 8,
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 16,
        gap: 12,
    },
    heroCardHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    heroCardTextWrap: {
        flex: 1,
        gap: 4,
    },
    heroCardTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    heroCardSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    progressBar: {
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: 2,
    },
    repoList: {
        gap: 6,
    },
    repoItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderWidth: 1,
        borderRadius: 10,
    },
    repoItemTextWrap: {
        flex: 1,
        gap: 2,
    },
    repoItemTitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    repoItemPath: {
        fontSize: 12,
        lineHeight: 16,
    },
    badge: {
        minWidth: 28,
        minHeight: 24,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "700",
    },
    actionsRow: {
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 8,
    },
    primaryButton: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: "600",
    },
    secondaryButton: {
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
}));
