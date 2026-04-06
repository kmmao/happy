import * as React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";
import { t } from "@/text";
import type { UseOneClickSetupReturn } from "./useOneClickSetup";

interface OneClickSetupCardProps {
    setup: UseOneClickSetupReturn;
    onRefresh?: () => void;
}

function OneClickIgnoredReposModal(props: {
    visible: boolean;
    onClose: () => void;
    paths: readonly string[];
    onUnignore: (path: string) => void;
}) {
    const { theme } = useUnistyles();
    const { visible, onClose, paths, onUnignore } = props;
    return (
        <BaseModal visible={visible} onClose={onClose}>
            <View style={[styles.ignoredModalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                <Text style={[styles.ignoredModalTitle, { color: theme.colors.text }]}>{t("machine.oneClickIgnoredReposTitle")}</Text>
                <Text style={[styles.ignoredModalHint, { color: theme.colors.textSecondary }]}>{t("machine.oneClickIgnoredReposHint")}</Text>
                {paths.length === 0 ? (
                    <Text style={[styles.ignoredModalEmpty, { color: theme.colors.textSecondary }]}>{t("machine.oneClickIgnoredReposEmpty")}</Text>
                ) : (
                    <ScrollView style={styles.ignoredModalScroll} keyboardShouldPersistTaps="handled">
                        {paths.map((path) => (
                            <View key={path} style={[styles.ignoredModalRow, { borderBottomColor: theme.colors.divider }]}>
                                <Text style={[styles.ignoredModalPath, { color: theme.colors.text }]} numberOfLines={3}>{path}</Text>
                                <Pressable
                                    style={[styles.unignoreButton, { borderColor: theme.colors.divider }]}
                                    onPress={() => onUnignore(path)}
                                >
                                    <Text style={{ color: theme.colors.textLink, fontSize: 13, fontWeight: "600" }}>{t("machine.oneClickUnignoreRepo")}</Text>
                                </Pressable>
                            </View>
                        ))}
                    </ScrollView>
                )}
                <Pressable
                    style={[styles.ignoredModalClose, { backgroundColor: theme.colors.button.primary.background }]}
                    onPress={onClose}
                >
                    <Text style={{ color: theme.colors.button.primary.tint, fontWeight: "600" }}>{t("common.ok")}</Text>
                </Pressable>
            </View>
        </BaseModal>
    );
}

export const OneClickSetupCard = React.memo(function OneClickSetupCard({
    setup,
    onRefresh,
}: OneClickSetupCardProps) {
    const { theme } = useUnistyles();
    const { state, ignoredRepoPaths, start, startAdvanced, confirm, toggleRepo, selectAll, setIncludeAutomationProfiles, ignoreRepo, unignoreRepo, reset } = setup;
    const { phase, repos, totalSuggestions, creatableCount, createdCount, errorMessage, includeAutomationProfiles, automationOutcome } = state;
    const [ignoredListOpen, setIgnoredListOpen] = React.useState(false);

    React.useEffect(() => {
        if (ignoredRepoPaths.length === 0) {
            setIgnoredListOpen(false);
        }
    }, [ignoredRepoPaths.length]);

    if (phase === "idle") {
        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceHigh }]}>
                <Pressable style={styles.heroCardHeader} onPress={start}>
                    <Ionicons name="rocket-outline" size={24} color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickSetupTitle")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>{t("machine.oneClickSetupSubtitle")}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
                </Pressable>
                <View style={styles.idleFooter}>
                    <Pressable onPress={startAdvanced} style={styles.advancedLink}>
                        <Ionicons name="settings-outline" size={14} color={theme.colors.textSecondary} />
                        <Text style={[styles.advancedLinkText, { color: theme.colors.textSecondary }]}>
                            {t("machine.oneClickAdvancedMode")}
                        </Text>
                    </Pressable>
                    {ignoredRepoPaths.length > 0 ? (
                        <Pressable
                            style={styles.manageIgnoredLink}
                            onPress={() => setIgnoredListOpen(true)}
                        >
                            <Ionicons name="eye-off-outline" size={16} color={theme.colors.textLink} />
                            <Text style={[styles.manageIgnoredText, { color: theme.colors.textLink }]}>
                                {`${t("machine.oneClickIgnoredReposManage")} (${ignoredRepoPaths.length})`}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
                <OneClickIgnoredReposModal
                    visible={ignoredListOpen}
                    onClose={() => setIgnoredListOpen(false)}
                    paths={ignoredRepoPaths}
                    onUnignore={unignoreRepo}
                />
            </View>
        );
    }

    if (phase === "scanning" || phase === "suggesting" || phase === "creating") {
        const stepLabel = phase === "scanning"
            ? t("machine.oneClickScanning")
            : phase === "suggesting"
                ? t("machine.oneClickSuggesting")
                : t("machine.oneClickCreating");
        const stepHint = phase === "scanning"
            ? t("machine.oneClickScanningHint")
            : phase === "suggesting"
                ? t("machine.oneClickSuggestingHint")
                : t("machine.oneClickCreatingProgress", { created: createdCount, total: creatableCount });
        const progress = phase === "scanning"
            ? 20
            : phase === "suggesting"
                ? 50
                : creatableCount > 0
                    ? 50 + Math.round((createdCount / creatableCount) * 50)
                    : 80;

        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                <View style={styles.heroCardHeader}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{stepLabel}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>{stepHint}</Text>
                    </View>
                    <Pressable onPress={reset}>
                        <Ionicons name="close-circle-outline" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${progress}%` }]} />
                </View>
            </View>
        );
    }

    if (phase === "confirming") {
        const selectedCount = repos.filter((r) => r.selected).length;
        const selectedSuggestions = repos.filter((r) => r.selected).reduce((sum, r) => sum + r.suggestions.length, 0);

        return (
            <View style={[styles.heroCard, { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceHigh }]}>
                {/* Header */}
                <View style={styles.heroCardHeader}>
                    <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.primary} />
                    <View style={styles.heroCardTextWrap}>
                        <Text style={[styles.heroCardTitle, { color: theme.colors.text }]}>{t("machine.oneClickConfirmTitle")}</Text>
                        <Text style={[styles.heroCardSubtitle, { color: theme.colors.textSecondary }]}>
                            {t("machine.oneClickConfirmSubtitle", { repos: repos.length, loops: totalSuggestions })}
                        </Text>
                    </View>
                </View>

                {/* Primary action button — above repo list for easy access */}
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
                </View>

                {/* Select All + Ignored management */}
                <View style={styles.selectAllToolbar}>
                    <Pressable
                        style={styles.selectAllRow}
                        onPress={() => selectAll(selectedCount < repos.length)}
                    >
                        <Ionicons
                            name={selectedCount === repos.length ? "checkbox" : selectedCount > 0 ? "remove-outline" : "square-outline"}
                            size={18}
                            color={selectedCount > 0 ? theme.colors.primary : theme.colors.textSecondary}
                        />
                        <Text style={[styles.selectAllText, { color: theme.colors.textSecondary }]}>
                            {selectedCount === repos.length ? t("machine.oneClickDeselectAll") : t("machine.oneClickSelectAll")}
                        </Text>
                    </Pressable>
                    {ignoredRepoPaths.length > 0 ? (
                        <Pressable
                            style={styles.manageIgnoredLink}
                            onPress={() => setIgnoredListOpen(true)}
                        >
                            <Ionicons name="eye-off-outline" size={16} color={theme.colors.textLink} />
                            <Text style={[styles.manageIgnoredText, { color: theme.colors.textLink }]}>
                                {`${t("machine.oneClickIgnoredReposManage")} (${ignoredRepoPaths.length})`}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>

                {/* Automation Toggle */}
                <View style={[styles.automationToggleRow, { borderTopColor: theme.colors.divider }]}>
                    <View style={styles.automationToggleTextWrap}>
                        <Text style={[styles.automationToggleTitle, { color: theme.colors.text }]}>{t("machine.oneClickIncludeAutomation")}</Text>
                        <Text style={[styles.automationToggleHint, { color: theme.colors.textSecondary }]}>{t("machine.oneClickIncludeAutomationHint")}</Text>
                    </View>
                    <Switch
                        value={includeAutomationProfiles}
                        onValueChange={setIncludeAutomationProfiles}
                        trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                    />
                </View>

                {/* Compact repo list */}
                <View style={styles.repoList}>
                    {repos.map((entry) => (
                        <View key={entry.repo.repoPath} style={[styles.compactRepoRow, { borderBottomColor: theme.colors.divider }]}>
                            <Pressable onPress={() => toggleRepo(entry.repo.repoPath)}>
                                <Ionicons
                                    name={entry.selected ? "checkbox" : "square-outline"}
                                    size={20}
                                    color={entry.selected ? theme.colors.primary : theme.colors.textSecondary}
                                />
                            </Pressable>
                            <Text numberOfLines={1} style={[styles.compactRepoName, { color: theme.colors.text }]}>{entry.repo.name}</Text>
                            <View style={[styles.compactRepoBadge, { backgroundColor: theme.colors.surfaceHigh }]}>
                                <Text style={[styles.compactRepoBadgeText, { color: theme.colors.textSecondary }]}>{entry.suggestions.length}</Text>
                            </View>
                            <Pressable
                                onPress={() => ignoreRepo(entry.repo.repoPath)}
                                accessibilityRole="button"
                                accessibilityLabel={t("machine.oneClickIgnoreRepo")}
                            >
                                <Ionicons name="eye-off-outline" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    ))}
                </View>

                {/* Cancel button */}
                <Pressable
                    style={[styles.secondaryButton, { borderColor: theme.colors.divider }]}
                    onPress={reset}
                >
                    <Text style={{ color: theme.colors.textSecondary }}>{t("common.cancel")}</Text>
                </Pressable>

                <OneClickIgnoredReposModal
                    visible={ignoredListOpen}
                    onClose={() => setIgnoredListOpen(false)}
                    paths={ignoredRepoPaths}
                    onUnignore={unignoreRepo}
                />
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
                            {automationOutcome === "created"
                                ? `\n${t("machine.oneClickDoneAutomationCreated")}`
                                : automationOutcome === "already"
                                    ? `\n${t("machine.oneClickDoneAutomationAlready")}`
                                    : automationOutcome === "bad_root"
                                        ? `\n${t("machine.oneClickDoneAutomationBadRoot")}`
                                        : ""}
                        </Text>
                    </View>
                    <Pressable onPress={reset}>
                        <Ionicons name="close-circle-outline" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                {(createdCount > 0 || automationOutcome === "created") && onRefresh ? (
                    <Pressable
                        style={[styles.refreshButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                        onPress={onRefresh}
                    >
                        <Ionicons name="refresh-outline" size={16} color={theme.colors.primary} />
                        <Text style={[styles.refreshButtonText, { color: theme.colors.primary }]}>{t("machine.oneClickRefreshList")}</Text>
                    </Pressable>
                ) : null}
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
    selectAllToolbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
    },
    selectAllRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 4,
        flexShrink: 0,
    },
    idleFooter: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
    },
    advancedLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
    },
    advancedLinkText: {
        fontSize: 12,
        fontWeight: "600",
    },
    manageIgnoredLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
        paddingLeft: 4,
    },
    manageIgnoredText: {
        fontSize: 12,
        fontWeight: "600",
    },
    ignoredModalCard: {
        marginHorizontal: 24,
        maxWidth: 440,
        width: "100%",
        maxHeight: "80%",
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
        gap: 10,
    },
    ignoredModalTitle: {
        fontSize: 17,
        fontWeight: "700",
    },
    ignoredModalHint: {
        fontSize: 12,
        lineHeight: 16,
    },
    ignoredModalEmpty: {
        fontSize: 14,
        paddingVertical: 12,
    },
    ignoredModalScroll: {
        maxHeight: 320,
    },
    ignoredModalRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    ignoredModalPath: {
        flex: 1,
        fontSize: 12,
    },
    unignoreButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    ignoredModalClose: {
        marginTop: 8,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    hideRepoButton: {
        padding: 6,
    },
    selectAllText: {
        fontSize: 13,
        fontWeight: "600",
    },
    automationToggleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingTop: 10,
        marginTop: 4,
        borderTopWidth: 1,
    },
    automationToggleTextWrap: {
        flex: 1,
        gap: 4,
    },
    automationToggleTitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    automationToggleHint: {
        fontSize: 12,
        lineHeight: 16,
    },
    repoList: {
        gap: 0,
    },
    compactRepoRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    compactRepoName: {
        flex: 1,
        fontSize: 14,
        fontWeight: "500",
    },
    compactRepoBadge: {
        minWidth: 24,
        height: 22,
        borderRadius: 11,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    compactRepoBadgeText: {
        fontSize: 12,
        fontWeight: "700",
    },
    refreshButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 36,
        borderRadius: 10,
        borderWidth: 1,
    },
    refreshButtonText: {
        fontSize: 13,
        fontWeight: "600",
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
