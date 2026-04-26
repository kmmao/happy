import * as React from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import {
    type MachineAgentLoopBootstrapProfile,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { type RepoBootstrapEntry } from "./useLoopSuggestions";
import {
    getAutoDreamProfileDetailMessage,
    getAutoDreamProfileStatusColor,
    getAutoDreamProfileSubtitle,
    getBootstrapProfileDetailMessage,
    getBootstrapProfileStatusColor,
    getBootstrapProfileSubtitle,
} from "./loopsLabels";

interface LoopAutomationSectionProps {
    readonly bootstrapProfiles: readonly MachineAgentLoopBootstrapProfile[];
    readonly autoDreamProfiles: readonly MachineAutoDreamProfile[];
    readonly bootstrapEntries: readonly RepoBootstrapEntry[];
    readonly showAutomation: boolean;
    readonly setShowAutomation: (fn: (prev: boolean) => boolean) => void;
    readonly mutatingBootstrapProfileId: string | null;
    readonly mutatingAutoDreamProfileId: string | null;
    readonly bootstrapScanning: boolean;
    readonly bootstrappingRepoPath: string | null;
    readonly setEditingBootstrapProfile: (p: MachineAgentLoopBootstrapProfile | null) => void;
    readonly setBootstrapProfileEditorVisible: (v: boolean) => void;
    readonly setEditingAutoDreamProfile: (p: MachineAutoDreamProfile | null) => void;
    readonly setAutoDreamProfileEditorVisible: (v: boolean) => void;
    readonly mutateBootstrapProfile: (profile: MachineAgentLoopBootstrapProfile, action: "pause" | "resume" | "run-now" | "remove") => Promise<void>;
    readonly mutateAutoDreamProfile: (profile: MachineAutoDreamProfile, action: "pause" | "resume" | "run-now" | "remove") => Promise<void>;
    readonly scanBootstrapRepos: () => Promise<void>;
    readonly adoptRepoSuggestions: (entry: RepoBootstrapEntry, runNow: boolean) => Promise<void>;
    readonly openMachineFileViewer: (title: string, filePath: string) => void;
    readonly formLayoutStacked: boolean;
}

function renderSectionBanner(
    title: string,
    subtitle: string,
    badge: string | undefined,
    icon: React.ComponentProps<typeof Ionicons>["name"] | undefined,
    options: { readonly compact?: boolean } | undefined,
    theme: ReturnType<typeof useUnistyles>["theme"],
    _formLayoutStacked: boolean,
) {
    return (
        <View style={[
            styles.sectionBanner,
            options?.compact ? styles.sectionBannerCompact : null,
            { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface },
        ]}>
            {icon ? <Ionicons name={icon} size={options?.compact ? 16 : 18} color={theme.colors.textSecondary} /> : null}
            <View style={styles.sectionBannerTextWrap}>
                {/* 标题 + 数字徽章内联同行 */}
                <View style={styles.sectionBannerTitleRow}>
                    <Text style={[
                        styles.sectionBannerTitle,
                        options?.compact ? styles.sectionBannerTitleCompact : null,
                        { color: theme.colors.text },
                    ]}>{title}</Text>
                    {badge !== undefined ? (
                        <View style={[styles.sectionBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                            <Text style={[styles.sectionBadgeText, { color: theme.colors.textSecondary }]}>{badge}</Text>
                        </View>
                    ) : null}
                </View>
                {subtitle ? (
                    <Text style={[styles.sectionBannerSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={2}>{subtitle}</Text>
                ) : null}
            </View>
        </View>
    );
}

function renderEmptyStateCard(
    icon: React.ComponentProps<typeof Ionicons>["name"],
    title: string,
    subtitle: string | undefined,
    options: { readonly compact?: boolean } | undefined,
    theme: ReturnType<typeof useUnistyles>["theme"],
) {
    return (
        <View
            style={[
                styles.emptyStateCard,
                options?.compact ? styles.emptyStateCardCompact : null,
                { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
            ]}
        >
            <Ionicons name={icon} size={options?.compact ? 18 : 20} color={theme.colors.textSecondary} />
            <View style={styles.emptyStateTextWrap}>
                <Text style={[styles.emptyStateTitle, options?.compact ? styles.emptyStateTitleCompact : null, { color: theme.colors.text }]}>{title}</Text>
                {subtitle ? <Text style={[styles.emptyStateSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text> : null}
            </View>
        </View>
    );
}

export const LoopAutomationSection = React.memo(function LoopAutomationSection(props: LoopAutomationSectionProps) {
    const {
        bootstrapProfiles,
        autoDreamProfiles,
        bootstrapEntries,
        showAutomation,
        setShowAutomation,
        mutatingBootstrapProfileId,
        mutatingAutoDreamProfileId,
        bootstrapScanning,
        bootstrappingRepoPath,
        setEditingBootstrapProfile,
        setBootstrapProfileEditorVisible,
        setEditingAutoDreamProfile,
        setAutoDreamProfileEditorVisible,
        mutateBootstrapProfile,
        mutateAutoDreamProfile,
        scanBootstrapRepos,
        adoptRepoSuggestions,
        openMachineFileViewer,
        formLayoutStacked,
    } = props;
    const { theme } = useUnistyles();

    const openBootstrapProfileActions = React.useCallback((profile: MachineAgentLoopBootstrapProfile) => {
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("machine.agentLoopEdit"), onPress: () => { setEditingBootstrapProfile(profile); setBootstrapProfileEditorVisible(true); } },
            { text: t("machine.agentLoopRunNow"), onPress: () => void mutateBootstrapProfile(profile, "run-now") },
            profile.enabled
                ? { text: t("machine.agentLoopPause"), onPress: () => void mutateBootstrapProfile(profile, "pause") }
                : { text: t("machine.agentLoopResume"), onPress: () => void mutateBootstrapProfile(profile, "resume") },
            {
                text: t("machine.agentLoopRemove"),
                style: "destructive",
                onPress: () => Modal.alert(
                    t("machine.agentLoopRemove"),
                    t("machine.agentLoopRemoveMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("machine.agentLoopRemove"), style: "destructive", onPress: () => void mutateBootstrapProfile(profile, "remove") },
                    ],
                ),
            },
        ];
        Modal.alert(profile.name || profile.id, getBootstrapProfileDetailMessage(profile), buttons);
    }, [mutateBootstrapProfile, setEditingBootstrapProfile, setBootstrapProfileEditorVisible]);

    const openAutoDreamProfileActions = React.useCallback((profile: MachineAutoDreamProfile) => {
        const buttons = [
            { text: t("common.ok") },
            { text: t("machine.agentLoopEdit"), onPress: () => { setEditingAutoDreamProfile(profile); setAutoDreamProfileEditorVisible(true); } },
            profile.latestDreamFilePath ? { text: t("machine.autoDreamViewReport"), onPress: () => openMachineFileViewer(profile.name || profile.id, profile.latestDreamFilePath!) } : undefined,
            { text: t("machine.agentLoopRunNow"), onPress: () => void mutateAutoDreamProfile(profile, "run-now") },
            profile.enabled
                ? { text: t("machine.agentLoopPause"), onPress: () => void mutateAutoDreamProfile(profile, "pause") }
                : { text: t("machine.agentLoopResume"), onPress: () => void mutateAutoDreamProfile(profile, "resume") },
            {
                text: t("machine.agentLoopRemove"),
                style: "destructive" as const,
                onPress: () => {
                    Modal.alert(
                        t("machine.agentLoopRemove"),
                        t("machine.autoDreamRemoveMessage"),
                        [
                            { text: t("common.cancel"), style: "cancel" },
                            { text: t("machine.agentLoopRemove"), style: "destructive", onPress: () => void mutateAutoDreamProfile(profile, "remove") },
                        ],
                    );
                },
            },
        ].filter(Boolean) as Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }>;
        Modal.alert(profile.name || profile.id, getAutoDreamProfileDetailMessage(profile), buttons);
    }, [mutateAutoDreamProfile, openMachineFileViewer, setEditingAutoDreamProfile, setAutoDreamProfileEditorVisible]);

    return (
        <ItemGroup
            title={(
                <Pressable
                    style={styles.automationGroupHeaderPressable}
                    onPress={() => setShowAutomation((current) => !current)}
                    accessibilityRole="button"
                    accessibilityLabel={t("machine.loopsAutomation")}
                >
                    <Text style={[styles.automationGroupHeaderText, { color: theme.colors.groupped.sectionTitle }]}>
                        {t("machine.loopsAutomation")}
                    </Text>
                    <Ionicons
                        name={showAutomation ? "chevron-up-outline" : "chevron-down-outline"}
                        size={18}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            )}
            headerStyle={styles.automationGroupHeaderWrap}
        >
            {showAutomation ? (
                <>
                    {/* ── AI 扫描（主操作，替代一键按钮）── */}
                    <Item
                        title={t("machine.agentLoopAIGenerate")}
                        subtitle={t("machine.agentLoopAIScanHint")}
                        subtitleLines={2}
                        icon={<Ionicons name="sparkles-outline" size={20} color={theme.colors.header.tint} />}
                        onPress={() => void scanBootstrapRepos()}
                        showChevron
                        style={styles.automationQuickRow}
                        rightElement={bootstrapScanning ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                    />
                    {bootstrapEntries.length > 0 && bootstrapEntries.map((entry) => {
                        const missingCount = entry.suggestions.filter((s) => !s.alreadyConfigured).length;
                        return (
                            <View key={entry.repo.repoPath} style={[styles.suggestionCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                <View style={styles.cardHeaderRow}>
                                    <View style={styles.cardHeaderTextWrap}>
                                        <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{entry.repo.name}</Text>
                                        <Text style={[styles.cardPathText, { color: theme.colors.textSecondary }]}>{entry.repo.repoPath}</Text>
                                    </View>
                                    <Ionicons name="sparkles-outline" size={16} color={theme.colors.header.tint} />
                                </View>
                                <View style={styles.metaPillRow}>
                                    <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                        <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopSuggestionCount", { count: entry.suggestions.length })}</Text>
                                    </View>
                                    <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                        <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCreatableCount", { count: missingCount })}</Text>
                                    </View>
                                </View>
                                <View style={styles.suggestionActions}>
                                    <Pressable
                                        style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: missingCount === 0 ? 0.6 : 1 }]}
                                        onPress={() => void adoptRepoSuggestions(entry, false)}
                                        disabled={missingCount === 0 || bootstrappingRepoPath === entry.repo.repoPath}
                                    >
                                        {bootstrappingRepoPath === entry.repo.repoPath
                                            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                            : <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopBootstrapCreateAll")}</Text>}
                                    </Pressable>
                                    <Pressable
                                        style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: missingCount === 0 ? 0.6 : 1 }]}
                                        onPress={() => void adoptRepoSuggestions(entry, true)}
                                        disabled={missingCount === 0 || bootstrappingRepoPath === entry.repo.repoPath}
                                    >
                                        <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopBootstrapCreateAndRun")}</Text>
                                    </Pressable>
                                </View>
                            </View>
                        );
                    })}

                    {/* ── Bootstrap 配置（定期自动扫描档案）── */}
                    <View style={[styles.sectionBlock, { borderTopColor: theme.colors.divider }]}>
                        {renderSectionBanner(t("machine.agentLoopBootstrapProfiles"), t("machine.agentLoopBootstrapHint"), String(bootstrapProfiles.length), "git-branch-outline", undefined, theme, formLayoutStacked)}
                        <Item
                            title={t("machine.automationCreateBootstrapProfile")}
                            icon={<Ionicons name="add-circle-outline" size={20} color={theme.colors.primary} />}
                            onPress={() => { setEditingBootstrapProfile(null); setBootstrapProfileEditorVisible(true); }}
                            showChevron
                            style={styles.automationActionRow}
                        />
                        {bootstrapProfiles.length === 0
                            ? renderEmptyStateCard("git-branch-outline", t("machine.agentLoopBootstrapProfilesEmpty"), undefined, { compact: true }, theme)
                            : bootstrapProfiles.map((profile) => (
                                <Item
                                    key={profile.id}
                                    title={profile.name || profile.id}
                                    subtitle={getBootstrapProfileSubtitle(profile)}
                                    detail={profile.status}
                                    detailStyle={{ color: getBootstrapProfileStatusColor(profile, theme) }}
                                    icon={<Ionicons name="git-branch-outline" size={20} color={getBootstrapProfileStatusColor(profile, theme)} />}
                                    onPress={() => openBootstrapProfileActions(profile)}
                                    showChevron
                                    style={styles.automationProfileRow}
                                    rightElement={mutatingBootstrapProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                            ))}
                    </View>

                    {/* ── Auto-Dream 档案 ── */}
                    <View style={[styles.sectionBlock, { borderTopColor: theme.colors.divider }]}>
                        {renderSectionBanner(t("machine.autoDreamProfiles"), t("machine.autoDreamHint"), String(autoDreamProfiles.length), "moon-outline", undefined, theme, formLayoutStacked)}
                        <Item
                            title={t("machine.automationCreateAutoDreamProfile")}
                            icon={<Ionicons name="add-circle-outline" size={20} color={theme.colors.textLink} />}
                            onPress={() => { setEditingAutoDreamProfile(null); setAutoDreamProfileEditorVisible(true); }}
                            showChevron
                            style={styles.automationActionRow}
                        />
                        {autoDreamProfiles.length === 0
                            ? renderEmptyStateCard("moon-outline", t("machine.autoDreamProfilesEmpty"), undefined, { compact: true }, theme)
                            : autoDreamProfiles.map((profile) => (
                                <Item
                                    key={profile.id}
                                    title={profile.name || profile.id}
                                    subtitle={getAutoDreamProfileSubtitle(profile)}
                                    detail={profile.status === "running" ? `${profile.status} (${profile.stage})` : profile.status}
                                    detailStyle={{ color: getAutoDreamProfileStatusColor(profile, theme) }}
                                    icon={<Ionicons name="moon-outline" size={20} color={getAutoDreamProfileStatusColor(profile, theme)} />}
                                    onPress={() => openAutoDreamProfileActions(profile)}
                                    showChevron
                                    style={styles.automationProfileRow}
                                    rightElement={mutatingAutoDreamProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                            ))}
                    </View>
                </>
            ) : null}
        </ItemGroup>
    );
});

const styles = StyleSheet.create((_theme) => ({
    automationGroupHeaderWrap: {
        width: "100%",
        paddingBottom: Platform.select({ ios: 6, default: 8 }),
    },
    automationGroupHeaderPressable: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        gap: 8,
    },
    automationGroupHeaderText: {
        flex: 1,
        fontSize: Platform.select({ ios: 13, default: 14 }),
        lineHeight: Platform.select({ ios: 18, default: 20 }),
        letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
        textTransform: "uppercase",
        fontWeight: Platform.select({ ios: "normal", default: "500" }),
    },
    automationDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 16,
    },
    automationQuickRow: {
        minHeight: 48,
        paddingVertical: 4,
    },
    quickSetupSubtitle: {
        fontSize: 11,
        lineHeight: 15,
    },
    automationActionRow: {
        minHeight: 46,
        paddingVertical: 4,
    },
    automationProfileRow: {
        minHeight: 50,
        paddingVertical: 4,
    },
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
    suggestionActions: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
        paddingTop: 2,
    },
    emptyStateCard: {
        marginHorizontal: 12,
        marginVertical: 12,
        padding: 16,
        borderWidth: 1,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    emptyStateCardCompact: {
        marginHorizontal: 10,
        marginVertical: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    emptyStateTextWrap: {
        flex: 1,
        gap: 2,
    },
    emptyStateTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    emptyStateTitleCompact: {
        fontSize: 13,
        lineHeight: 18,
    },
    emptyStateSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    sectionBanner: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    sectionBannerCompact: {
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    sectionBannerTitleCompact: {
        fontSize: 14,
        fontWeight: "700",
    },
    sectionBannerTextWrap: {
        flex: 1,
        gap: 3,
    },
    sectionBannerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    sectionBannerTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    sectionBannerSubtitle: {
        fontSize: 12,
        lineHeight: 17,
    },
    sectionBadge: {
        minHeight: 20,
        paddingHorizontal: 7,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionBadgeText: {
        fontSize: 12,
        fontWeight: "700",
    },
    sectionBlock: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
}));
