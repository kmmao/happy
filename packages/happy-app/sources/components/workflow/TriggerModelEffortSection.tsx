/**
 * TriggerModelEffortSection — shared "Model" + "Reasoning effort" pickers
 * for the three trigger create/edit modals (schedule / webhook / loop).
 *
 * The reasoning-effort row is a plain PresetChip grid. The model row is
 * COLLAPSED by default: it shows the currently-selected model on a single
 * tappable header row, and only expands the full chip grid on demand. This
 * keeps the ~15-variant Claude model list (incl. 1M variants) from dominating
 * the form — the common case is "just use my Settings → Agents default", so we
 * surface that default inline and let power users tap to override per-trigger.
 *
 * The model value is an App model-mode KEY (e.g. "opus-4-8-1m") — the CLI uses
 * the key, not a raw model id, so 1M variants stay distinct.
 *
 * `settingsDefaultModelKey` is the caller's Settings → Agents default (via
 * resolveAgentDefaultConfig). When the current pick still equals it, the
 * collapsed row shows a "follows your Settings default" hint so the user knows
 * the model is inherited, not hard-pinned.
 */

import * as React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { webInteractive } from "@/utils/interactiveSurface";
import { PresetChip } from "@/components/BottomSheet";
import { getAvailableModels, type ModelMode } from "@/components/modelModeOptions";
import { getVisibleEffortLevels } from "@/components/reasoningEffort";
import { t } from "@/text";

// Static map so t() keeps its compile-time key checking (a templated
// `agentInput.effort.${level}` would erase the arg-count inference).
const EFFORT_LABEL_KEYS = {
    low: "agentInput.effort.low",
    medium: "agentInput.effort.medium",
    high: "agentInput.effort.high",
    xhigh: "agentInput.effort.xhigh",
    max: "agentInput.effort.max",
} as const;

interface TriggerModelEffortSectionProps {
    /** App model-mode KEY; "default" means "use CLI configured model". */
    modelModeKey: string;
    onSelectModel: (key: string) => void;
    /** Reasoning effort level, or null for the agent default (medium). */
    effortLevel: string | null;
    onSelectEffort: (level: string | null) => void;
    /**
     * Settings → Agents default model KEY (resolveAgentDefaultConfig). Used
     * only for the "follows your Settings default" collapsed-row hint; does
     * NOT change the selected value. Omit to skip the hint.
     */
    settingsDefaultModelKey?: string;
    /**
     * Explicit model list to show instead of the internal Claude set. Passed
     * by callers that want the model options to follow a selected profile
     * (e.g. a custom MiniMax/GLM profile surfaces its own `customModels`).
     * Omit to keep the hardcoded Claude list.
     */
    models?: ModelMode[];
}

const styles = StyleSheet.create((theme) => ({
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
    modelHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingVertical: 6,
        ...webInteractive,
    },
    modelHeaderRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
        minWidth: 0,
    },
    modelHeaderValue: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
        flexShrink: 1,
    },
    modelFollowsHint: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        marginTop: 2,
    },
}));

export const TriggerModelEffortSection = React.memo(function TriggerModelEffortSection({
    modelModeKey,
    onSelectModel,
    effortLevel,
    onSelectEffort,
    settingsDefaultModelKey,
    models: propModels,
}: TriggerModelEffortSectionProps) {
    const { theme } = useUnistyles();
    // Model grid collapsed by default — see file header.
    const [expanded, setExpanded] = React.useState(false);

    // Prefer the caller-supplied list (profile-driven); otherwise fall back to
    // the static Claude set (incl. the 1M variants). No metadata needed.
    const models = React.useMemo(
        () => propModels ?? getAvailableModels("claude", null, t),
        [propModels],
    );
    // Effort levels available for the picked model — Opus 4.7/4.8 + Fable 5
    // surface xhigh, others stay low/medium/high/max.
    const effortLevels = React.useMemo(
        () => getVisibleEffortLevels({ modelModeKey }),
        [modelModeKey],
    );

    const selectedName = React.useMemo(() => {
        const found = models.find((m) => m.key === modelModeKey);
        return found?.name ?? modelModeKey;
    }, [models, modelModeKey]);

    // Current pick still matches the Settings → Agents default (user hasn't
    // overridden it for this trigger).
    const followsSettings =
        settingsDefaultModelKey != null && modelModeKey === settingsDefaultModelKey;

    return (
        <>
            <View>
                <Pressable
                    style={styles.modelHeader}
                    onPress={() => setExpanded((v) => !v)}
                    accessibilityRole="button"
                >
                    <Text style={styles.sectionLabel}>{t("workflows.sectionModel")}</Text>
                    <View style={styles.modelHeaderRight}>
                        <Text style={styles.modelHeaderValue} numberOfLines={1}>
                            {selectedName}
                        </Text>
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={14}
                            color={theme.colors.textSecondary}
                        />
                    </View>
                </Pressable>
                {followsSettings && !expanded ? (
                    <Text style={styles.modelFollowsHint}>
                        {t("workflows.modelFollowsSettings")}
                    </Text>
                ) : null}
                {expanded ? (
                    <View style={styles.presetGrid}>
                        {models.map((m) => (
                            <PresetChip
                                key={m.key}
                                label={m.name}
                                active={modelModeKey === m.key}
                                onPress={() => onSelectModel(m.key)}
                            />
                        ))}
                    </View>
                ) : null}
            </View>

            <View>
                <Text style={styles.sectionLabel}>{t("workflows.sectionEffort")}</Text>
                <View style={styles.presetGrid}>
                    <PresetChip
                        label={t("workflows.effortDefault")}
                        active={effortLevel === null}
                        onPress={() => onSelectEffort(null)}
                    />
                    {effortLevels.map((level) => (
                        <PresetChip
                            key={level}
                            label={t(EFFORT_LABEL_KEYS[level])}
                            active={effortLevel === level}
                            onPress={() => onSelectEffort(level)}
                        />
                    ))}
                </View>
            </View>
        </>
    );
});
