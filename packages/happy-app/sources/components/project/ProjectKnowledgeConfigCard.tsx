import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Switch } from "@/components/Switch";
import { t } from "@/text";
import type { KnowledgeConfig } from "@/hooks/useProjectKnowledgeConfig";

interface Props {
    config: KnowledgeConfig;
    isCustomized: boolean;
    saving: boolean;
    onUpdate: (partial: Partial<KnowledgeConfig>) => void;
    onReset: () => void;
}

type ModeKey = KnowledgeConfig["mode"];
type SensitivityKey = KnowledgeConfig["sensitivity"];

const MODE_OPTIONS: { key: ModeKey; labelKey: "knowledgeModeAuto" | "knowledgeModeFull" | "knowledgeModeMinimal"; hintKey: "knowledgeConfigModeAutoHint" | "knowledgeConfigModeFullHint" | "knowledgeConfigModeMinimalHint"; icon: string }[] = [
    { key: "auto", labelKey: "knowledgeModeAuto", hintKey: "knowledgeConfigModeAutoHint", icon: "flash-outline" },
    { key: "full", labelKey: "knowledgeModeFull", hintKey: "knowledgeConfigModeFullHint", icon: "server-outline" },
    { key: "minimal", labelKey: "knowledgeModeMinimal", hintKey: "knowledgeConfigModeMinimalHint", icon: "leaf-outline" },
];

const SENSITIVITY_OPTIONS: { key: SensitivityKey; labelKey: "knowledgeSensitivityConservative" | "knowledgeSensitivityBalanced" | "knowledgeSensitivityAggressive"; hintKey: "knowledgeConfigSensitivityConservativeHint" | "knowledgeConfigSensitivityBalancedHint" | "knowledgeConfigSensitivityAggressiveHint"; icon: string }[] = [
    { key: "conservative", labelKey: "knowledgeSensitivityConservative", hintKey: "knowledgeConfigSensitivityConservativeHint", icon: "shield-outline" },
    { key: "balanced", labelKey: "knowledgeSensitivityBalanced", hintKey: "knowledgeConfigSensitivityBalancedHint", icon: "options-outline" },
    { key: "aggressive", labelKey: "knowledgeSensitivityAggressive", hintKey: "knowledgeConfigSensitivityAggressiveHint", icon: "rocket-outline" },
];

export const ProjectKnowledgeConfigCard = React.memo<Props>(
    ({ config, isCustomized, saving, onUpdate, onReset }) => {
        const { theme } = useUnistyles();
        const [collapsed, setCollapsed] = React.useState(true);

        const selectedMode = MODE_OPTIONS.find((o) => o.key === config.mode);
        const selectedSensitivity = SENSITIVITY_OPTIONS.find((o) => o.key === config.sensitivity);

        return (
            <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
                {/* Header — tappable to toggle collapse */}
                <Pressable style={styles.header} onPress={() => setCollapsed((v) => !v)} hitSlop={4}>
                    <View style={styles.headerLeft}>
                        <Ionicons name="settings-outline" size={16} color={theme.colors.header.tint} />
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                            {t("projects.knowledgeConfig")}
                        </Text>
                    </View>
                    <View style={styles.headerRight}>
                        {isCustomized && !collapsed && (
                            <Pressable onPress={onReset} disabled={saving} hitSlop={8}>
                                <Text style={[styles.resetText, { color: theme.colors.header.tint }]}>
                                    {t("projects.knowledgeConfigResetToDefault")}
                                </Text>
                            </Pressable>
                        )}
                        <Ionicons
                            name={collapsed ? "chevron-down" : "chevron-up"}
                            size={16}
                            color={theme.colors.textSecondary}
                        />
                    </View>
                </Pressable>

                {collapsed ? null : (
                    <>
                        {!isCustomized && (
                            <Text style={[styles.inheritHint, { color: theme.colors.textSecondary }]}>
                                {t("projects.knowledgeConfigInheritingDefaults")}
                            </Text>
                        )}

                        {/* Main toggle */}
                        <ConfigRow
                            icon="bulb-outline"
                            iconColor={theme.colors.accentOrange}
                            label={t("projects.knowledgeConfigEnabled")}
                            right={<Switch value={config.enabled} onValueChange={(v) => onUpdate({ enabled: v })} />}
                            theme={theme}
                        />

                        {config.enabled && (
                            <>
                                {/* Mode selector */}
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeConfigMode")}
                                </Text>
                                <View style={styles.segmented}>
                                    {MODE_OPTIONS.map((opt) => (
                                        <Pressable
                                            key={opt.key}
                                            style={[
                                                styles.segmentedItem,
                                                {
                                                    backgroundColor: config.mode === opt.key
                                                        ? theme.colors.header.tint
                                                        : theme.colors.surfaceHighest,
                                                },
                                            ]}
                                            onPress={() => onUpdate({ mode: opt.key })}
                                        >
                                            <Ionicons
                                                name={opt.icon as any}
                                                size={14}
                                                color={config.mode === opt.key ? "#FFF" : theme.colors.textSecondary}
                                            />
                                            <Text style={[
                                                styles.segmentedText,
                                                { color: config.mode === opt.key ? "#FFF" : theme.colors.textSecondary },
                                            ]}>
                                                {t(`projects.${opt.labelKey}`)}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                                {selectedMode && (
                                    <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                                        {t(`projects.${selectedMode.hintKey}`)}
                                    </Text>
                                )}

                                {/* Sensitivity selector */}
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeConfigSensitivity")}
                                </Text>
                                <View style={styles.segmented}>
                                    {SENSITIVITY_OPTIONS.map((opt) => (
                                        <Pressable
                                            key={opt.key}
                                            style={[
                                                styles.segmentedItem,
                                                {
                                                    backgroundColor: config.sensitivity === opt.key
                                                        ? theme.colors.header.tint
                                                        : theme.colors.surfaceHighest,
                                                },
                                            ]}
                                            onPress={() => onUpdate({ sensitivity: opt.key })}
                                        >
                                            <Ionicons
                                                name={opt.icon as any}
                                                size={14}
                                                color={config.sensitivity === opt.key ? "#FFF" : theme.colors.textSecondary}
                                            />
                                            <Text style={[
                                                styles.segmentedText,
                                                { color: config.sensitivity === opt.key ? "#FFF" : theme.colors.textSecondary },
                                            ]}>
                                                {t(`projects.${opt.labelKey}`)}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                                {selectedSensitivity && (
                                    <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
                                        {t(`projects.${selectedSensitivity.hintKey}`)}
                                    </Text>
                                )}

                                {/* Collection toggles */}
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeConfigCollection")}
                                </Text>
                                <ConfigRow
                                    icon="document-text-outline"
                                    iconColor={theme.colors.accentBlue}
                                    label={t("projects.knowledgeConfigTrackFileEdits")}
                                    hint={t("projects.knowledgeConfigTrackFileEditsHint")}
                                    right={<Switch value={config.trackFileEdits} onValueChange={(v) => onUpdate({ trackFileEdits: v })} />}
                                    theme={theme}
                                />
                                <ConfigRow
                                    icon="hammer-outline"
                                    iconColor={theme.colors.accentBlue}
                                    label={t("projects.knowledgeConfigTrackToolCalls")}
                                    hint={t("projects.knowledgeConfigTrackToolCallsHint")}
                                    right={<Switch value={config.trackToolCalls} onValueChange={(v) => onUpdate({ trackToolCalls: v })} />}
                                    theme={theme}
                                />
                                <ConfigRow
                                    icon="chatbubbles-outline"
                                    iconColor={theme.colors.accentBlue}
                                    label={t("projects.knowledgeConfigTrackTokens")}
                                    hint={t("projects.knowledgeConfigTrackTokensHint")}
                                    right={<Switch value={config.trackTokens} onValueChange={(v) => onUpdate({ trackTokens: v })} />}
                                    theme={theme}
                                />

                                {/* Lifecycle toggles */}
                                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeConfigLifecycle")}
                                </Text>
                                <ConfigRow
                                    icon="sparkles-outline"
                                    iconColor={theme.colors.accentPurple}
                                    label={t("projects.knowledgeConfigRefine")}
                                    hint={t("projects.knowledgeConfigRefineHint")}
                                    right={<Switch value={config.refineEnabled} onValueChange={(v) => onUpdate({ refineEnabled: v })} />}
                                    theme={theme}
                                />
                                <ConfigRow
                                    icon="timer-outline"
                                    iconColor={theme.colors.accentMagenta}
                                    label={t("projects.knowledgeConfigDecay")}
                                    hint={t("projects.knowledgeConfigDecayHint")}
                                    right={<Switch value={config.decayEnabled} onValueChange={(v) => onUpdate({ decayEnabled: v })} />}
                                    theme={theme}
                                />
                                <ConfigRow
                                    icon="git-merge-outline"
                                    iconColor={theme.colors.accentMagenta}
                                    label={t("projects.knowledgeConfigMerge")}
                                    hint={t("projects.knowledgeConfigMergeHint")}
                                    right={<Switch value={config.mergeEnabled} onValueChange={(v) => onUpdate({ mergeEnabled: v })} />}
                                    theme={theme}
                                />
                            </>
                        )}
                    </>
                )}
            </View>
        );
    },
);

/** Single config row with icon, label, optional hint, and right element */
function ConfigRow({ icon, iconColor, label, hint, right, theme }: {
    icon: string;
    iconColor: string;
    label: string;
    hint?: string;
    right: React.ReactNode;
    theme: any;
}) {
    return (
        <View style={styles.configRowWrapper}>
            <View style={styles.configRow}>
                <Ionicons name={icon as any} size={18} color={iconColor} />
                <Text style={[styles.configLabel, { color: theme.colors.text }]} numberOfLines={1}>
                    {label}
                </Text>
                {right}
            </View>
            {hint ? (
                <Text style={[styles.configHint, { color: theme.colors.textSecondary }]}>
                    {hint}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    card: {
        marginHorizontal: 16,
        marginTop: 12,
        padding: 14,
        borderRadius: 12,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    headerRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    headerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    resetText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    inheritHint: {
        ...Typography.default("regular"),
        fontSize: 11,
        fontStyle: "italic",
        marginTop: 8,
        marginBottom: 4,
    },
    sectionLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        textTransform: "uppercase",
        marginTop: 12,
        marginBottom: 6,
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
        paddingVertical: 7,
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
        marginTop: 4,
        marginBottom: 2,
    },
    configRowWrapper: {
        paddingVertical: 4,
    },
    configRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 4,
    },
    configLabel: {
        ...Typography.default("regular"),
        fontSize: 13,
        flex: 1,
    },
    configHint: {
        ...Typography.default("regular"),
        fontSize: 11,
        marginLeft: 28,
        marginTop: 2,
    },
}));
