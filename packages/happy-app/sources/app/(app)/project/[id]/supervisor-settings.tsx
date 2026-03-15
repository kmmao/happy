import * as React from "react";
import { View, Text, ScrollView, Switch, Pressable, TextInput } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateSupervisorConfig } from "@/sync/apiSupervisor";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";

type SupervisorMode = "suggest" | "semi-auto" | "auto";

const SCHEDULE_INTERVALS = [6, 12, 24, 48, 168] as const;
type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number];

/**
 * Default supervisor config values.
 */
const defaultConfig = {
    mode: "suggest" as SupervisorMode,
    schedule: {
        enabled: false,
        intervalHours: 24 as ScheduleInterval,
    },
    analysis: {
        security: true,
        dependencies: true,
        architecture: true,
        techDebt: false,
        codeQuality: false,
        testCoverage: false,
        documentation: false,
        performance: false,
    },
    pushTrigger: {
        enabled: false,
    },
    customRules: "",
    constraints: {
        maxIssuesPerRun: 3,
        requireApprovalForPR: true,
    },
    notifications: {
        onAnalysisComplete: true,
        onIssueCreated: true,
        onPRCreated: true,
        onError: true,
    },
};

type SupervisorConfig = typeof defaultConfig;

export default function SupervisorSettingsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const project = useProject(id);
    const { theme } = useUnistyles();

    const [config, setConfig] = React.useState<SupervisorConfig>(defaultConfig);
    const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: t("supervisor.settings"),
        });
    }, [navigation]);

    // Load config from project's supervisorConfig (if any)
    React.useEffect(() => {
        if (project?.supervisorConfig) {
            try {
                const parsed = JSON.parse(
                    project.supervisorConfig,
                ) as Partial<SupervisorConfig>;
                setConfig((prev) => ({
                    ...prev,
                    ...parsed,
                    customRules: parsed.customRules ?? prev.customRules,
                    schedule: { ...prev.schedule, ...parsed.schedule },
                    analysis: { ...prev.analysis, ...parsed.analysis },
                    pushTrigger: {
                        ...prev.pushTrigger,
                        ...parsed.pushTrigger,
                    },
                    constraints: {
                        ...prev.constraints,
                        ...parsed.constraints,
                    },
                    notifications: {
                        ...prev.notifications,
                        ...parsed.notifications,
                    },
                }));
            } catch {
                // Invalid JSON — use defaults
            }
        }
    }, [project?.supervisorConfig]);

    // Debounced save to server
    const saveConfig = React.useCallback(
        (newConfig: SupervisorConfig) => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            saveTimeoutRef.current = setTimeout(async () => {
                if (!project?.serverId) return;
                try {
                    const credentials =
                        await TokenStorage.getCredentials();
                    if (!credentials) return;
                    await updateSupervisorConfig(
                        credentials,
                        project.serverId,
                        JSON.stringify(newConfig),
                        {
                            supervisorMode: newConfig.mode,
                            supervisorScheduleEnabled:
                                newConfig.schedule.enabled,
                            supervisorScheduleIntervalHours:
                                newConfig.schedule.intervalHours,
                            supervisorEnabledDimensions: Object.entries(
                                newConfig.analysis,
                            )
                                .filter(([, v]) => v)
                                .map(([k]) => k)
                                .join(","),
                            supervisorPushTriggerEnabled:
                                newConfig.pushTrigger.enabled,
                            supervisorNotifyPrefs:
                                Object.entries(newConfig.notifications)
                                    .filter(([, v]) => v)
                                    .map(([k]) => k)
                                    .join(",") || null,
                            supervisorCustomRules:
                                newConfig.customRules.trim() || null,
                        },
                    );
                    Modal.toast(t("supervisor.settingsSaved"));
                } catch {
                    Modal.toast(t("supervisor.settingsSaveError"));
                }
            }, 1000);
        },
        [project?.serverId],
    );

    // Clean up timeout on unmount
    React.useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    const updateConfig = React.useCallback(
        (updater: (prev: SupervisorConfig) => SupervisorConfig) => {
            setConfig((prev) => {
                const next = updater(prev);
                saveConfig(next);
                return next;
            });
        },
        [saveConfig],
    );

    const setMode = React.useCallback(
        async (mode: SupervisorMode) => {
            if (mode === "auto") {
                const confirmed = await Modal.confirm(
                    t("supervisor.autoWarningTitle"),
                    t("supervisor.autoWarningBody"),
                    {
                        confirmText: t("supervisor.autoWarningConfirm"),
                        cancelText: t("common.cancel"),
                        destructive: true,
                    },
                );
                if (!confirmed) return;
            }
            updateConfig((prev) => ({ ...prev, mode }));
        },
        [updateConfig],
    );

    const toggleSchedule = React.useCallback(() => {
        updateConfig((prev) => ({
            ...prev,
            schedule: {
                ...prev.schedule,
                enabled: !prev.schedule.enabled,
            },
        }));
    }, [updateConfig]);

    const setScheduleInterval = React.useCallback(
        (intervalHours: ScheduleInterval) => {
            updateConfig((prev) => ({
                ...prev,
                schedule: {
                    ...prev.schedule,
                    intervalHours,
                },
            }));
        },
        [updateConfig],
    );

    const toggleDimension = React.useCallback(
        (key: keyof typeof defaultConfig.analysis) => {
            updateConfig((prev) => ({
                ...prev,
                analysis: {
                    ...prev.analysis,
                    [key]: !prev.analysis[key],
                },
            }));
        },
        [updateConfig],
    );

    const toggleNotification = React.useCallback(
        (key: keyof typeof defaultConfig.notifications) => {
            updateConfig((prev) => ({
                ...prev,
                notifications: {
                    ...prev.notifications,
                    [key]: !prev.notifications[key],
                },
            }));
        },
        [updateConfig],
    );

    const togglePushTrigger = React.useCallback(() => {
        updateConfig((prev) => ({
            ...prev,
            pushTrigger: {
                ...prev.pushTrigger,
                enabled: !prev.pushTrigger.enabled,
            },
        }));
    }, [updateConfig]);

    const setCustomRules = React.useCallback(
        (text: string) => {
            updateConfig((prev) => ({
                ...prev,
                customRules: text,
            }));
        },
        [updateConfig],
    );

    if (!project) {
        return (
            <View style={styles.notFound}>
                <Text style={styles.notFoundText}>
                    {t("projects.notFound")}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Mode Selection */}
            <ItemGroup title={t("supervisor.modeSection")}>
                <ModeOption
                    label={t("supervisor.modeSuggest")}
                    subtitle={t("supervisor.modeSuggestDesc")}
                    selected={config.mode === "suggest"}
                    onPress={() => setMode("suggest")}
                />
                <ModeOption
                    label={t("supervisor.modeSemiAuto")}
                    subtitle={t("supervisor.modeSemiAutoDesc")}
                    selected={config.mode === "semi-auto"}
                    onPress={() => setMode("semi-auto")}
                />
                <ModeOption
                    label={t("supervisor.modeAuto")}
                    subtitle={t("supervisor.modeAutoDesc")}
                    selected={config.mode === "auto"}
                    onPress={() => setMode("auto")}
                    isLast
                />
            </ItemGroup>

            {/* Scan Schedule */}
            <ItemGroup title={t("supervisor.scheduleSection")}>
                <ToggleRow
                    label={t("supervisor.scheduleEnabled")}
                    value={config.schedule.enabled}
                    onToggle={toggleSchedule}
                />
                {config.schedule.enabled && (
                    <>
                        <IntervalOption
                            label={t("supervisor.scheduleEvery6h")}
                            selected={
                                config.schedule.intervalHours === 6
                            }
                            onPress={() => setScheduleInterval(6)}
                        />
                        <IntervalOption
                            label={t("supervisor.scheduleEvery12h")}
                            selected={
                                config.schedule.intervalHours === 12
                            }
                            onPress={() => setScheduleInterval(12)}
                        />
                        <IntervalOption
                            label={t("supervisor.scheduleEvery24h")}
                            selected={
                                config.schedule.intervalHours === 24
                            }
                            onPress={() => setScheduleInterval(24)}
                        />
                        <IntervalOption
                            label={t("supervisor.scheduleEvery48h")}
                            selected={
                                config.schedule.intervalHours === 48
                            }
                            onPress={() => setScheduleInterval(48)}
                        />
                        <IntervalOption
                            label={t("supervisor.scheduleEveryWeek")}
                            selected={
                                config.schedule.intervalHours === 168
                            }
                            onPress={() => setScheduleInterval(168)}
                            isLast
                        />
                    </>
                )}
            </ItemGroup>

            {/* Analysis Dimensions */}
            <ItemGroup title={t("supervisor.dimensionsSection")}>
                <ToggleRow
                    label={t("supervisor.dimSecurity")}
                    value={config.analysis.security}
                    onToggle={() => toggleDimension("security")}
                />
                <ToggleRow
                    label={t("supervisor.dimDependencies")}
                    value={config.analysis.dependencies}
                    onToggle={() => toggleDimension("dependencies")}
                />
                <ToggleRow
                    label={t("supervisor.dimArchitecture")}
                    value={config.analysis.architecture}
                    onToggle={() => toggleDimension("architecture")}
                />
                <ToggleRow
                    label={t("supervisor.dimTechDebt")}
                    value={config.analysis.techDebt}
                    onToggle={() => toggleDimension("techDebt")}
                />
                <ToggleRow
                    label={t("supervisor.dimCodeQuality")}
                    value={config.analysis.codeQuality}
                    onToggle={() => toggleDimension("codeQuality")}
                    subtitle={t("supervisor.dimCodeQualityNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimTestCoverage")}
                    value={config.analysis.testCoverage}
                    onToggle={() => toggleDimension("testCoverage")}
                    subtitle={t("supervisor.dimTestCoverageNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimDocumentation")}
                    value={config.analysis.documentation}
                    onToggle={() => toggleDimension("documentation")}
                />
                <ToggleRow
                    label={t("supervisor.dimPerformance")}
                    value={config.analysis.performance}
                    onToggle={() => toggleDimension("performance")}
                    isLast
                />
            </ItemGroup>

            {/* Push Trigger (Incremental Scan) */}
            <ItemGroup title={t("supervisor.pushTriggerSection")}>
                <ToggleRow
                    label={t("supervisor.pushTriggerEnabled")}
                    value={config.pushTrigger.enabled}
                    onToggle={togglePushTrigger}
                    subtitle={t("supervisor.pushTriggerDesc")}
                    isLast
                />
            </ItemGroup>

            {/* Custom Analysis Rules */}
            <ItemGroup title={t("supervisor.customRulesSection")}>
                <View style={styles.customRulesCard}>
                    <Text style={styles.customRulesDesc}>
                        {t("supervisor.customRulesDesc")}
                    </Text>
                    <TextInput
                        style={styles.customRulesInput}
                        value={config.customRules}
                        onChangeText={setCustomRules}
                        placeholder={t("supervisor.customRulesPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        maxLength={2000}
                    />
                    <Text style={styles.customRulesCharCount}>
                        {config.customRules.length}/2000
                    </Text>
                </View>
            </ItemGroup>

            {/* Notifications */}
            <ItemGroup title={t("supervisor.notificationsSection")}>
                <ToggleRow
                    label={t("supervisor.notifAnalysisComplete")}
                    value={config.notifications.onAnalysisComplete}
                    onToggle={() =>
                        toggleNotification("onAnalysisComplete")
                    }
                />
                <ToggleRow
                    label={t("supervisor.notifIssueCreated")}
                    value={config.notifications.onIssueCreated}
                    onToggle={() => toggleNotification("onIssueCreated")}
                />
                <ToggleRow
                    label={t("supervisor.notifPRCreated")}
                    value={config.notifications.onPRCreated}
                    onToggle={() => toggleNotification("onPRCreated")}
                />
                <ToggleRow
                    label={t("supervisor.notifError")}
                    value={config.notifications.onError}
                    onToggle={() => toggleNotification("onError")}
                    isLast
                />
            </ItemGroup>

            {/* Safety note */}
            <ItemGroup>
                <View style={styles.safetyCard}>
                    <Text style={styles.safetyText}>
                        {config.mode === "auto"
                            ? t("supervisor.autoModeSafetyNote")
                            : t("supervisor.safetyNote")}
                    </Text>
                    <Text style={[styles.safetyText, { marginTop: 8 }]}>
                        {t("supervisor.dailyLimitNote")}
                    </Text>
                </View>
            </ItemGroup>
        </ScrollView>
    );
}

// --- Mode Option ---

interface ModeOptionProps {
    label: string;
    subtitle: string;
    selected: boolean;
    onPress: () => void;
    isLast?: boolean;
}

const ModeOption = React.memo(
    ({ label, subtitle, selected, onPress, isLast }: ModeOptionProps) => {
        const { theme } = useUnistyles();

        return (
            <Pressable
                style={[
                    styles.modeOption,
                    !isLast && styles.toggleRowBorder,
                ]}
                onPress={onPress}
            >
                <View style={styles.toggleRowContent}>
                    <Text style={styles.toggleRowLabel}>{label}</Text>
                    <Text style={styles.toggleRowSubtitle}>{subtitle}</Text>
                </View>
                <Ionicons
                    name={
                        selected
                            ? "checkmark-circle"
                            : "ellipse-outline"
                    }
                    size={24}
                    color={
                        selected
                            ? theme.colors.header.tint
                            : theme.colors.textSecondary
                    }
                />
            </Pressable>
        );
    },
);

// --- Interval Option ---

interface IntervalOptionProps {
    label: string;
    selected: boolean;
    onPress: () => void;
    isLast?: boolean;
}

const IntervalOption = React.memo(
    ({ label, selected, onPress, isLast }: IntervalOptionProps) => {
        const { theme } = useUnistyles();

        return (
            <Pressable
                style={[
                    styles.intervalOption,
                    !isLast && styles.toggleRowBorder,
                ]}
                onPress={onPress}
            >
                <Text style={styles.toggleRowLabel}>{label}</Text>
                {selected && (
                    <Ionicons
                        name="checkmark"
                        size={20}
                        color={theme.colors.header.tint}
                    />
                )}
            </Pressable>
        );
    },
);

// --- Toggle Row ---

interface ToggleRowProps {
    label: string;
    value: boolean;
    onToggle: () => void;
    subtitle?: string;
    isLast?: boolean;
}

const ToggleRow = React.memo(
    ({ label, value, onToggle, subtitle, isLast }: ToggleRowProps) => {
        const { theme } = useUnistyles();

        return (
            <View
                style={[
                    styles.toggleRow,
                    !isLast && styles.toggleRowBorder,
                ]}
            >
                <View style={styles.toggleRowContent}>
                    <Text style={styles.toggleRowLabel}>{label}</Text>
                    {subtitle && (
                        <Text style={styles.toggleRowSubtitle}>
                            {subtitle}
                        </Text>
                    )}
                </View>
                <Switch
                    value={value}
                    onValueChange={onToggle}
                    trackColor={{
                        false: theme.colors.surface,
                        true: theme.colors.header.tint,
                    }}
                />
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 32,
    },
    notFound: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    notFoundText: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
    modeOption: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    intervalOption: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        paddingLeft: 32,
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    toggleRowBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    toggleRowContent: {
        flex: 1,
        marginRight: 12,
    },
    toggleRowLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    toggleRowSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    safetyCard: {
        padding: 16,
    },
    safetyText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    customRulesCard: {
        padding: 16,
        gap: 8,
    },
    customRulesDesc: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    customRulesInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 12,
        minHeight: 100,
        textAlignVertical: "top",
    },
    customRulesCharCount: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "right",
    },
}));
