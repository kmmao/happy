/**
 * TriggerModelEffortSection — shared "Model" + "Reasoning effort" pickers
 * for the three trigger create/edit modals (schedule / webhook / loop).
 *
 * Both rows are plain PresetChip grids (mirroring the cron/machine/project
 * pickers already in those modals) rather than the full chat-input selector,
 * because triggers only need a quick point-and-pick that persists onto the
 * trigger row. The model value is an App model-mode KEY (e.g. "opus-4-8-1m")
 * — the CLI uses the key, not a raw model id, so 1M variants stay distinct.
 *
 * Defaults: modelModeKey "default" = CLI's configured model; effortLevel null
 * = the agent's default (medium). Picking "Default" on either row restores
 * that no-op behaviour, keeping legacy creates byte-identical.
 */

import * as React from "react";
import { View } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { PresetChip } from "@/components/BottomSheet";
import { getAvailableModels } from "@/components/modelModeOptions";
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
}));

export const TriggerModelEffortSection = React.memo(function TriggerModelEffortSection({
    modelModeKey,
    onSelectModel,
    effortLevel,
    onSelectEffort,
}: TriggerModelEffortSectionProps) {
    // Triggers always spawn Claude sessions, so the model list is the static
    // Claude set (incl. the 1M variants added in phase 1). No metadata needed.
    const models = React.useMemo(
        () => getAvailableModels("claude", null, t),
        [],
    );
    // Effort levels available for the picked model — Opus 4.7/4.8 + Fable 5
    // surface xhigh, others stay low/medium/high/max.
    const effortLevels = React.useMemo(
        () => getVisibleEffortLevels({ modelModeKey }),
        [modelModeKey],
    );

    return (
        <>
            <View>
                <Text style={styles.sectionLabel}>{t("workflows.sectionModel")}</Text>
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
