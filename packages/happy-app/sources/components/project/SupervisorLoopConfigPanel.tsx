/**
 * Inline config panel for starting a Supervisor Loop.
 * Shown when user taps "Loop Mode" — lets them adjust parameters before launching.
 */

import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { TokenStorage } from "@/auth/tokenStorage";
import { type SupervisorLoop, type LoopConfig, startSupervisorLoop } from "@/sync/apiSupervisor";
import { useSettings } from "@/sync/storage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";

interface SupervisorLoopConfigPanelProps {
    readonly projectId: string;
    readonly defaultProfileId?: string | null;
    readonly onStarted: (loop: SupervisorLoop) => void;
    readonly onCancel: () => void;
}

/** Stepper: displays a value with -/+ buttons */
function Stepper({
    value,
    min,
    max,
    step,
    suffix,
    prefix,
    onChange,
}: {
    value: number;
    min: number;
    max: number;
    step: number;
    suffix?: string;
    prefix?: string;
    onChange: (v: number) => void;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={stepperStyles.container}>
            <Pressable
                style={[stepperStyles.button, { backgroundColor: theme.colors.surface }]}
                onPress={() => onChange(Math.max(min, value - step))}
                disabled={value <= min}
            >
                <Ionicons
                    name="remove"
                    size={16}
                    color={value <= min ? theme.colors.textSecondary : theme.colors.text}
                />
            </Pressable>
            <Text style={[stepperStyles.value, { color: theme.colors.header.tint }]}>
                {prefix}{value}{suffix}
            </Text>
            <Pressable
                style={[stepperStyles.button, { backgroundColor: theme.colors.surface }]}
                onPress={() => onChange(Math.min(max, value + step))}
                disabled={value >= max}
            >
                <Ionicons
                    name="add"
                    size={16}
                    color={value >= max ? theme.colors.textSecondary : theme.colors.text}
                />
            </Pressable>
        </View>
    );
}

const stepperStyles = StyleSheet.create(() => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    button: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    value: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        minWidth: 40,
        textAlign: "center" as const,
    },
}));

export const SupervisorLoopConfigPanel = React.memo(
    ({ projectId, defaultProfileId, onStarted, onCancel }: SupervisorLoopConfigPanelProps) => {
        const { theme } = useUnistyles();
        const settings = useSettings();
        const allProfiles = React.useMemo(() => {
            const userProfiles = settings.profiles ?? [];
            const builtIn = DEFAULT_PROFILES.map((p) => ({ id: p.id, name: p.name, isBuiltIn: true as const }));
            const userList = userProfiles.map((p) => ({ id: p.id, name: p.name, isBuiltIn: false as const }));
            return [...builtIn, ...userList];
        }, [settings.profiles]);

        const [maxIterations, setMaxIterations] = React.useState(5);
        const [autoApproveThreshold, setAutoApproveThreshold] = React.useState(80);
        const [costCapEnabled, setCostCapEnabled] = React.useState(false);
        const [costCapUsd, setCostCapUsd] = React.useState(10);
        // Profile selection: inherit default from supervisor settings, allow per-run override
        const [selectedProfileId, setSelectedProfileId] = React.useState<string | null>(defaultProfileId ?? null);

        const [startLoading, doStart] = useHappyAction(
            React.useCallback(async () => {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const config: LoopConfig = {
                    maxIterations,
                    autoApproveThreshold,
                    ...(costCapEnabled ? { costCapUsd } : {}),
                    ...(selectedProfileId ? { profileId: selectedProfileId } : {}),
                };
                const loop = await startSupervisorLoop(credentials, projectId, config);
                onStarted(loop);
            }, [projectId, maxIterations, autoApproveThreshold, costCapEnabled, costCapUsd, selectedProfileId, onStarted]),
        );

        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Ionicons
                        name="repeat-outline"
                        size={20}
                        color={theme.colors.header.tint}
                    />
                    <Text style={styles.title}>{t("supervisor.loopConfig")}</Text>
                    <Pressable onPress={onCancel} hitSlop={12}>
                        <Ionicons
                            name="close"
                            size={20}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                </View>

                {/* Max Iterations */}
                <View style={styles.configRow}>
                    <View style={styles.configLabelRow}>
                        <Text style={styles.configLabel}>
                            {t("supervisor.loopConfigIterations")}
                        </Text>
                        <Stepper
                            value={maxIterations}
                            min={0}
                            max={20}
                            step={1}
                            onChange={setMaxIterations}
                        />
                    </View>
                    <Text style={styles.configHint}>
                        {maxIterations === 0
                            ? t("supervisor.loopConfigIterationsHintUnlimited")
                            : t("supervisor.loopConfigIterationsHint")}
                    </Text>
                </View>

                {/* Auto-Approve Threshold */}
                <View style={styles.configRow}>
                    <View style={styles.configLabelRow}>
                        <Text style={styles.configLabel}>
                            {t("supervisor.loopConfigThreshold")}
                        </Text>
                        <Stepper
                            value={autoApproveThreshold}
                            min={50}
                            max={100}
                            step={5}
                            suffix="%"
                            onChange={setAutoApproveThreshold}
                        />
                    </View>
                    <Text style={styles.configHint}>
                        {t("supervisor.loopConfigThresholdHint")}
                    </Text>
                </View>

                {/* Cost Cap */}
                <View style={styles.configRow}>
                    <Pressable
                        style={styles.configLabelRow}
                        onPress={() => setCostCapEnabled((v) => !v)}
                    >
                        <Text style={styles.configLabel}>
                            {t("supervisor.loopConfigCostCap")}
                        </Text>
                        <Ionicons
                            name={costCapEnabled ? "checkbox" : "square-outline"}
                            size={20}
                            color={costCapEnabled ? theme.colors.header.tint : theme.colors.textSecondary}
                        />
                    </Pressable>
                    {costCapEnabled && (
                        <View style={styles.costCapStepper}>
                            <Stepper
                                value={costCapUsd}
                                min={1}
                                max={100}
                                step={5}
                                prefix="$"
                                onChange={setCostCapUsd}
                            />
                        </View>
                    )}
                    <Text style={styles.configHint}>
                        {t("supervisor.loopConfigCostCapHint")}
                    </Text>
                </View>

                {/* Profile selection */}
                <View style={styles.configRow}>
                    <View style={styles.configLabelRow}>
                        <Text style={styles.configLabel}>
                            {t("supervisor.defaultProfileSection")}
                        </Text>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        <Pressable
                            style={[
                                styles.profileChip,
                                selectedProfileId === null && { backgroundColor: theme.colors.header.tint },
                            ]}
                            onPress={() => setSelectedProfileId(null)}
                        >
                            <Text style={[styles.profileChipText, selectedProfileId === null && { color: "#fff" }]}>
                                {t("supervisor.defaultProfileDefault")}
                            </Text>
                        </Pressable>
                        {allProfiles.map((p) => (
                            <Pressable
                                key={p.id}
                                style={[
                                    styles.profileChip,
                                    selectedProfileId === p.id && { backgroundColor: theme.colors.header.tint },
                                ]}
                                onPress={() => setSelectedProfileId(p.id)}
                            >
                                <Text style={[styles.profileChipText, selectedProfileId === p.id && { color: "#fff" }]}>
                                    {p.name}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </View>

                {/* Safety note */}
                <View style={styles.safetyNote}>
                    <Ionicons
                        name="shield-checkmark-outline"
                        size={14}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={styles.safetyNoteText}>
                        {t("supervisor.loopConfigSafety")}
                    </Text>
                </View>

                {/* Action buttons */}
                <View style={styles.buttonRow}>
                    <Pressable
                        style={[styles.button, styles.cancelButton]}
                        onPress={onCancel}
                    >
                        <Text style={styles.cancelButtonText}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[styles.button, styles.startButton, { backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint }]}
                        onPress={doStart}
                        disabled={startLoading}
                    >
                        {startLoading ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <>
                                <Ionicons name="play" size={16} color="#FFFFFF" />
                                <Text style={styles.startButtonText}>
                                    {t("supervisor.loopConfigStart")}
                                </Text>
                            </>
                        )}
                    </Pressable>
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 16,
        width: "100%",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    configRow: {
        gap: 6,
    },
    configLabelRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    configLabel: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        flex: 1,
    },
    costCapStepper: {
        alignItems: "flex-end",
        paddingTop: 4,
    },
    configHint: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    profileChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface,
    },
    profileChipText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text,
    },
    safetyNote: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
    },
    safetyNoteText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    buttonRow: {
        flexDirection: "row",
        gap: 8,
    },
    button: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 10,
        borderRadius: 8,
    },
    cancelButton: {
        backgroundColor: theme.colors.surface,
    },
    cancelButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    startButton: {},
    startButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#FFFFFF",
    },
}));
