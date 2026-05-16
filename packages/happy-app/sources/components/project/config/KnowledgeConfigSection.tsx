import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { Switch } from "@/components/Switch";
import { Modal } from "@/modal";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import {
    useProjectKnowledgeConfig,
    type KnowledgeConfig,
} from "@/hooks/useProjectKnowledgeConfig";
import { useProject } from "@/hooks/useProjects";
import { showKnowledgeFlowModal } from "@/components/knowledge/KnowledgeFlowDiagram";

interface Props {
    project: Project;
}

type ModeKey = KnowledgeConfig["mode"];
type SensitivityKey = KnowledgeConfig["sensitivity"];

interface SegmentedOption<K extends string> {
    key: K;
    labelKey:
        | "knowledgeModeAuto"
        | "knowledgeModeFull"
        | "knowledgeModeMinimal"
        | "knowledgeSensitivityConservative"
        | "knowledgeSensitivityBalanced"
        | "knowledgeSensitivityAggressive";
    hintKey:
        | "knowledgeConfigModeAutoHint"
        | "knowledgeConfigModeFullHint"
        | "knowledgeConfigModeMinimalHint"
        | "knowledgeConfigSensitivityConservativeHint"
        | "knowledgeConfigSensitivityBalancedHint"
        | "knowledgeConfigSensitivityAggressiveHint";
    icon: keyof typeof Ionicons.glyphMap;
}

const MODE_OPTIONS: SegmentedOption<ModeKey>[] = [
    { key: "auto", labelKey: "knowledgeModeAuto", hintKey: "knowledgeConfigModeAutoHint", icon: "flash-outline" },
    { key: "full", labelKey: "knowledgeModeFull", hintKey: "knowledgeConfigModeFullHint", icon: "server-outline" },
    { key: "minimal", labelKey: "knowledgeModeMinimal", hintKey: "knowledgeConfigModeMinimalHint", icon: "leaf-outline" },
];

const SENSITIVITY_OPTIONS: SegmentedOption<SensitivityKey>[] = [
    { key: "conservative", labelKey: "knowledgeSensitivityConservative", hintKey: "knowledgeConfigSensitivityConservativeHint", icon: "shield-outline" },
    { key: "balanced", labelKey: "knowledgeSensitivityBalanced", hintKey: "knowledgeConfigSensitivityBalancedHint", icon: "options-outline" },
    { key: "aggressive", labelKey: "knowledgeSensitivityAggressive", hintKey: "knowledgeConfigSensitivityAggressiveHint", icon: "rocket-outline" },
];

const COLLECTION_ITEMS: {
    key: "trackFileEdits" | "trackTokens" | "summaryEnabled";
    icon: keyof typeof Ionicons.glyphMap;
    labelKey: "knowledgeConfigTrackFileEdits" | "knowledgeConfigTrackTokens" | "knowledgeConfigSummary";
    hintKey: "knowledgeConfigTrackFileEditsHint" | "knowledgeConfigTrackTokensHint" | "knowledgeConfigSummaryHint";
}[] = [
    { key: "trackFileEdits", icon: "document-text-outline", labelKey: "knowledgeConfigTrackFileEdits", hintKey: "knowledgeConfigTrackFileEditsHint" },
    { key: "trackTokens", icon: "chatbubbles-outline", labelKey: "knowledgeConfigTrackTokens", hintKey: "knowledgeConfigTrackTokensHint" },
    { key: "summaryEnabled", icon: "reader-outline", labelKey: "knowledgeConfigSummary", hintKey: "knowledgeConfigSummaryHint" },
];

const LIFECYCLE_ITEMS: {
    key: "refineEnabled" | "decayEnabled" | "mergeEnabled";
    icon: keyof typeof Ionicons.glyphMap;
    iconTone: "purple" | "magenta";
    labelKey: "knowledgeConfigRefine" | "knowledgeConfigDecay" | "knowledgeConfigMerge";
    hintKey: "knowledgeConfigRefineHint" | "knowledgeConfigDecayHint" | "knowledgeConfigMergeHint";
}[] = [
    { key: "refineEnabled", icon: "sparkles-outline", iconTone: "purple", labelKey: "knowledgeConfigRefine", hintKey: "knowledgeConfigRefineHint" },
    { key: "decayEnabled", icon: "timer-outline", iconTone: "magenta", labelKey: "knowledgeConfigDecay", hintKey: "knowledgeConfigDecayHint" },
    { key: "mergeEnabled", icon: "git-merge-outline", iconTone: "magenta", labelKey: "knowledgeConfigMerge", hintKey: "knowledgeConfigMergeHint" },
];

export const KnowledgeConfigSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const fullProject = useProject(project.id);
    const projectServerId = fullProject?.serverId ?? undefined;

    const {
        config,
        isCustomized,
        saving,
        update: updateConfig,
        resetToDefaults: resetConfig,
    } = useProjectKnowledgeConfig(projectServerId);

    const handleReset = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t("projects.knowledgeConfigResetToDefault"),
            t("projects.knowledgeConfigResetConfirm"),
            { confirmText: t("common.reset"), cancelText: t("common.cancel") },
        );
        if (confirmed) resetConfig();
    }, [resetConfig]);

    if (!config) {
        return (
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                <SectionHeader theme={theme} />
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t("projectConfig.knowledgeNotAvailable")}
                </Text>
            </View>
        );
    }

    const selectedMode = MODE_OPTIONS.find((o) => o.key === config.mode);
    const selectedSensitivity = SENSITIVITY_OPTIONS.find((o) => o.key === config.sensitivity);

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <SectionHeader
                theme={theme}
                rightAction={
                    isCustomized ? (
                        <Pressable onPress={handleReset} disabled={saving} hitSlop={8}>
                            <Ionicons
                                name="refresh-outline"
                                size={18}
                                color={saving ? theme.colors.textSecondary : theme.colors.header.tint}
                            />
                        </Pressable>
                    ) : null
                }
            />

            {!isCustomized && (
                <Text style={[styles.inheritHint, { color: theme.colors.textSecondary }]}>
                    {t("projects.knowledgeConfigInheritingDefaults")}
                </Text>
            )}

            {/* Master toggle */}
            <View style={styles.mainToggleRow}>
                <View style={styles.mainToggleLeft}>
                    <Text style={[styles.mainToggleLabel, { color: theme.colors.text }]}>
                        {t("projects.knowledgeConfigEnabled")}
                    </Text>
                </View>
                <Switch
                    value={config.enabled}
                    onValueChange={(v) => updateConfig({ enabled: v })}
                />
            </View>

            {config.enabled && (
                <>
                    <Pressable style={styles.learnMoreBtn} onPress={showKnowledgeFlowModal} hitSlop={4}>
                        <Ionicons name="information-circle-outline" size={13} color={theme.colors.header.tint} />
                        <Text style={[styles.learnMoreText, { color: theme.colors.header.tint }]}>
                            {t("projects.knowledgeFlowLearnMore")}
                        </Text>
                    </Pressable>

                    {/* Mode */}
                    <SubSectionLabel theme={theme} label={t("projects.knowledgeConfigMode")} />
                    <Segmented
                        options={MODE_OPTIONS}
                        current={config.mode}
                        onChange={(k) => updateConfig({ mode: k })}
                        theme={theme}
                    />
                    {selectedMode && (
                        <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                            {t(`projects.${selectedMode.hintKey}`)}
                        </Text>
                    )}

                    {/* Sensitivity */}
                    <SubSectionLabel theme={theme} label={t("projects.knowledgeConfigSensitivity")} />
                    <Segmented
                        options={SENSITIVITY_OPTIONS}
                        current={config.sensitivity}
                        onChange={(k) => updateConfig({ sensitivity: k })}
                        theme={theme}
                    />
                    {selectedSensitivity && (
                        <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                            {t(`projects.${selectedSensitivity.hintKey}`)}
                        </Text>
                    )}

                    {/* Collection */}
                    <SubSectionLabel theme={theme} label={t("projects.knowledgeConfigCollection")} />
                    {COLLECTION_ITEMS.map((item, idx) => (
                        <ToggleRow
                            key={item.key}
                            icon={item.icon}
                            iconColor={theme.colors.accentBlue}
                            label={t(`projects.${item.labelKey}`)}
                            hint={t(`projects.${item.hintKey}`)}
                            value={config[item.key]}
                            onChange={(v) => updateConfig({ [item.key]: v } as Partial<KnowledgeConfig>)}
                            showDivider={idx < COLLECTION_ITEMS.length - 1}
                            theme={theme}
                        />
                    ))}

                    {/* Lifecycle */}
                    <SubSectionLabel theme={theme} label={t("projects.knowledgeConfigLifecycle")} />
                    {LIFECYCLE_ITEMS.map((item, idx) => (
                        <ToggleRow
                            key={item.key}
                            icon={item.icon}
                            iconColor={item.iconTone === "purple" ? theme.colors.accentPurple : theme.colors.accentMagenta}
                            label={t(`projects.${item.labelKey}`)}
                            hint={t(`projects.${item.hintKey}`)}
                            value={config[item.key]}
                            onChange={(v) => updateConfig({ [item.key]: v } as Partial<KnowledgeConfig>)}
                            showDivider={idx < LIFECYCLE_ITEMS.length - 1}
                            theme={theme}
                        />
                    ))}
                </>
            )}
        </View>
    );
});

function SectionHeader({ theme, rightAction }: { theme: any; rightAction?: React.ReactNode }) {
    return (
        <View style={styles.header}>
            <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.accentPurple}1A` }]}>
                <Ionicons name="library-outline" size={16} color={theme.colors.accentPurple} />
            </View>
            <Text style={[styles.title, { color: theme.colors.text }]}>
                {t("projectConfig.sectionKnowledge")}
            </Text>
            {rightAction}
        </View>
    );
}

function SubSectionLabel({ theme, label }: { theme: any; label: string }) {
    return (
        <Text style={[styles.subSectionLabel, { color: theme.colors.textSecondary }]}>
            {label}
        </Text>
    );
}

function Segmented<K extends string>({
    options,
    current,
    onChange,
    theme,
}: {
    options: SegmentedOption<K>[];
    current: K;
    onChange: (key: K) => void;
    theme: any;
}) {
    return (
        <View style={styles.segmented}>
            {options.map((opt) => {
                const active = current === opt.key;
                return (
                    <Pressable
                        key={opt.key}
                        style={[
                            styles.segmentedItem,
                            {
                                backgroundColor: active
                                    ? resolveActiveTint(theme)
                                    : theme.colors.surfaceHighest,
                            },
                        ]}
                        onPress={() => onChange(opt.key)}
                    >
                        <Ionicons
                            name={opt.icon}
                            size={14}
                            color={active ? "#FFF" : theme.colors.textSecondary}
                        />
                        <Text
                            style={[
                                styles.segmentedText,
                                { color: active ? "#FFF" : theme.colors.textSecondary },
                            ]}
                        >
                            {t(`projects.${opt.labelKey}`)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

function ToggleRow({
    icon,
    iconColor,
    label,
    hint,
    value,
    onChange,
    showDivider,
    theme,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    label: string;
    hint: string;
    value: boolean;
    onChange: (v: boolean) => void;
    showDivider: boolean;
    theme: any;
}) {
    return (
        <View style={[styles.toggleRow, showDivider && { borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <Ionicons name={icon} size={18} color={iconColor} style={styles.toggleIcon} />
            <View style={styles.toggleBody}>
                <Text style={[styles.toggleLabel, { color: theme.colors.text }]} numberOfLines={1}>
                    {label}
                </Text>
                <Text style={[styles.toggleHint, { color: theme.colors.textSecondary }]}>
                    {hint}
                </Text>
            </View>
            <Switch value={value} onValueChange={onChange} />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    emptyText: {
        ...Typography.default("regular"),
        fontSize: 13,
    },
    inheritHint: {
        ...Typography.default("regular"),
        fontSize: 12,
        fontStyle: "italic",
        marginBottom: 10,
    },
    mainToggleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 6,
    },
    mainToggleLeft: {
        flex: 1,
    },
    mainToggleLabel: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    learnMoreBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        alignSelf: "flex-start",
    },
    learnMoreText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    subSectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 16,
        marginBottom: 8,
    },
    segmented: {
        flexDirection: "row",
        gap: 6,
    },
    segmentedItem: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 8,
        borderRadius: 8,
    },
    segmentedText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    hint: {
        ...Typography.default("regular"),
        fontSize: 11,
        fontStyle: "italic",
        marginTop: 6,
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 10,
    },
    toggleIcon: {
        marginTop: 2,
    },
    toggleBody: {
        flex: 1,
        gap: 2,
    },
    toggleLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    toggleHint: {
        ...Typography.default("regular"),
        fontSize: 11,
        lineHeight: 15,
    },
}));
