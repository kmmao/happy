import * as React from "react";
import { View, Text, ScrollView, Switch, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateSupervisorConfig, fetchActionStats, reprocessPendingActions } from "@/sync/apiSupervisor";
import { projectManager } from "@/sync/projectManager";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { SEVERITY_COLORS, SEVERITY_KEY_MAP } from "@/components/project/supervisorConstants";

type SupervisorMode = "suggest" | "semi-auto" | "auto";

const SCHEDULE_INTERVALS = [6, 12, 24, 48, 168] as const;
type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number];

/**
 * Default supervisor config values.
 */
type Severity = "low" | "medium" | "high" | "critical";
const ALL_SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"] as const;

const defaultConfig = {
    mode: "suggest" as SupervisorMode,
    fixStrategy: "direct" as "direct" | "pr",
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
        uiUx: false,
    },
    autoApprove: {
        semiAutoSeverities: ["low", "medium"] as Severity[],
        autoSeverities: ["low", "medium", "high", "critical"] as Severity[],
    },
    pushTrigger: {
        enabled: false,
    },
    customRules: "",
    constraints: {
        maxIssuesPerRun: 3,
        requireApprovalForPR: true,
    },
    concurrency: {
        maxAnalysisSessions: 3,
        maxFixSessions: 2,
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
    const [initialConfig, setInitialConfig] =
        React.useState<SupervisorConfig>(defaultConfig);
    const [saving, setSaving] = React.useState(false);

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
                const merged: SupervisorConfig = {
                    ...defaultConfig,
                    ...parsed,
                    customRules: parsed.customRules ?? defaultConfig.customRules,
                    schedule: { ...defaultConfig.schedule, ...parsed.schedule },
                    analysis: { ...defaultConfig.analysis, ...parsed.analysis },
                    autoApprove: {
                        ...defaultConfig.autoApprove,
                        ...parsed.autoApprove,
                    },
                    pushTrigger: {
                        ...defaultConfig.pushTrigger,
                        ...parsed.pushTrigger,
                    },
                    constraints: {
                        ...defaultConfig.constraints,
                        ...parsed.constraints,
                    },
                    notifications: {
                        ...defaultConfig.notifications,
                        ...parsed.notifications,
                    },
                };
                setConfig(merged);
                setInitialConfig(merged);
            } catch {
                // Invalid JSON — use defaults
            }
        }
    }, [project?.supervisorConfig]);

    const isDirty = React.useMemo(
        () => JSON.stringify(config) !== JSON.stringify(initialConfig),
        [config, initialConfig],
    );

    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    const handleSave = React.useCallback(async () => {
        if (!project?.serverId || !isDirty) return;
        setSaving(true);
        // Capture before setInitialConfig mutates the ref
        const previousMode = initialConfig.mode;
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const configJson = JSON.stringify(config);
            await updateSupervisorConfig(
                credentials,
                project.serverId,
                configJson,
                {
                    supervisorMode: config.mode,
                    supervisorScheduleEnabled: config.schedule.enabled,
                    supervisorScheduleIntervalHours:
                        config.schedule.intervalHours,
                    supervisorEnabledDimensions: Object.entries(config.analysis)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(","),
                    supervisorPushTriggerEnabled: config.pushTrigger.enabled,
                    supervisorNotifyPrefs:
                        Object.entries(config.notifications)
                            .filter(([, v]) => v)
                            .map(([k]) => k)
                            .join(",") || null,
                    supervisorCustomRules:
                        config.customRules.trim() || null,
                    fixStrategy: config.fixStrategy,
                },
            );
            // Update local projectManager cache so re-entering this page shows fresh data
            const localProject = projectManager.getProject(id);
            if (localProject) {
                localProject.supervisorConfig = configJson;
                localProject.supervisorMode = config.mode;
                localProject.supervisorScheduleEnabled = config.schedule.enabled;
                localProject.supervisorScheduleIntervalHours = config.schedule.intervalHours;
                localProject.supervisorEnabledDimensions = Object.entries(config.analysis)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                    .join(",");
                localProject.supervisorPushTriggerEnabled = config.pushTrigger.enabled;
                localProject.supervisorCustomRules = config.customRules.trim() || null;
            }
            if (!mountedRef.current) return;
            setInitialConfig(config);
            Modal.toast(t("supervisor.settingsSaved"));

            // Check if mode was upgraded and offer to reprocess pending actions
            const modeOrder: Record<string, number> = { suggest: 0, "semi-auto": 1, auto: 2 };
            const oldOrder = modeOrder[previousMode] ?? 0;
            const newOrder = modeOrder[config.mode] ?? 0;
            if (newOrder > oldOrder && (config.mode === "semi-auto" || config.mode === "auto")) {
                try {
                    const stats = await fetchActionStats(credentials, project.serverId);
                    if (!mountedRef.current || stats.pending === 0) return;
                    const modeLabel = config.mode === "auto"
                        ? t("supervisor.modeAuto")
                        : t("supervisor.modeSemiAuto");
                    const confirmed = await Modal.confirm(
                        t("supervisor.reprocessTitle"),
                        t("supervisor.reprocessBody", { count: stats.pending, mode: modeLabel }),
                        {
                            confirmText: t("supervisor.reprocessConfirm"),
                            cancelText: t("common.cancel"),
                        },
                    );
                    if (confirmed && mountedRef.current) {
                        const result = await reprocessPendingActions(
                            credentials,
                            project.serverId,
                            config.mode,
                        );
                        if (mountedRef.current) {
                            Modal.toast(
                                t("supervisor.reprocessSuccess", {
                                    approved: result.approvedCount,
                                    remaining: result.remainingPending,
                                }),
                            );
                        }
                    }
                } catch {
                    // Reprocess is best-effort — don't fail the save
                }
            }
        } catch {
            Modal.toast(t("supervisor.settingsSaveError"));
        } finally {
            if (mountedRef.current) {
                setSaving(false);
            }
        }
    }, [project?.serverId, isDirty, config, initialConfig.mode]);

    const updateConfig = React.useCallback(
        (updater: (prev: SupervisorConfig) => SupervisorConfig) => {
            setConfig(updater);
        },
        [],
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

    const toggleSeverity = React.useCallback(
        (severity: Severity, target: "semiAutoSeverities" | "autoSeverities") => {
            updateConfig((prev) => {
                const current = prev.autoApprove[target];
                const next = current.includes(severity)
                    ? current.filter((s) => s !== severity)
                    : [...current, severity];
                return {
                    ...prev,
                    autoApprove: { ...prev.autoApprove, [target]: next },
                };
            });
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
                >
                    {config.mode === "semi-auto" && (
                        <SeverityChips
                            severities={config.autoApprove.semiAutoSeverities}
                            onToggle={(sev) => toggleSeverity(sev, "semiAutoSeverities")}
                        />
                    )}
                    {config.mode !== "semi-auto" && config.autoApprove.semiAutoSeverities.length > 0 && (
                        <SeverityTags severities={config.autoApprove.semiAutoSeverities} />
                    )}
                </ModeOption>
                <ModeOption
                    label={t("supervisor.modeAuto")}
                    subtitle={t("supervisor.modeAutoDesc")}
                    selected={config.mode === "auto"}
                    onPress={() => setMode("auto")}
                    isLast
                >
                    {config.mode === "auto" && (
                        <SeverityChips
                            severities={config.autoApprove.autoSeverities}
                            onToggle={(sev) => toggleSeverity(sev, "autoSeverities")}
                        />
                    )}
                    {config.mode !== "auto" && config.autoApprove.autoSeverities.length > 0 && (
                        <SeverityTags severities={config.autoApprove.autoSeverities} />
                    )}
                </ModeOption>
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
                    subtitle={t("supervisor.dimSecurityNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimDependencies")}
                    value={config.analysis.dependencies}
                    onToggle={() => toggleDimension("dependencies")}
                    subtitle={t("supervisor.dimDependenciesNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimArchitecture")}
                    value={config.analysis.architecture}
                    onToggle={() => toggleDimension("architecture")}
                    subtitle={t("supervisor.dimArchitectureNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimTechDebt")}
                    value={config.analysis.techDebt}
                    onToggle={() => toggleDimension("techDebt")}
                    subtitle={t("supervisor.dimTechDebtNote")}
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
                    subtitle={t("supervisor.dimDocumentationNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimPerformance")}
                    value={config.analysis.performance}
                    onToggle={() => toggleDimension("performance")}
                    subtitle={t("supervisor.dimPerformanceNote")}
                />
                <ToggleRow
                    label={t("supervisor.dimUiUx")}
                    value={config.analysis.uiUx}
                    onToggle={() => toggleDimension("uiUx")}
                    subtitle={t("supervisor.dimUiUxNote")}
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

            {/* Fix Strategy */}
            <ItemGroup title={t("supervisor.fixStrategySection")}>
                <ModeOption
                    label={t("supervisor.fixStrategyDirect")}
                    subtitle={t("supervisor.fixStrategyDirectDesc")}
                    selected={config.fixStrategy === "direct"}
                    onPress={() =>
                        updateConfig((prev) => ({
                            ...prev,
                            fixStrategy: "direct" as const,
                        }))
                    }
                />
                <ModeOption
                    label={t("supervisor.fixStrategyPr")}
                    subtitle={t("supervisor.fixStrategyPrDesc")}
                    selected={config.fixStrategy === "pr"}
                    onPress={() =>
                        updateConfig((prev) => ({
                            ...prev,
                            fixStrategy: "pr" as const,
                        }))
                    }
                    isLast
                />
            </ItemGroup>

            {/* Concurrency Limits */}
            <ItemGroup title={t("supervisor.concurrencySection")}>
                <View style={styles.concurrencyRow}>
                    <View style={styles.toggleRowContent}>
                        <Text style={styles.toggleRowLabel}>
                            {t("supervisor.maxAnalysisSessions")}
                        </Text>
                        <Text style={styles.toggleRowSubtitle}>
                            {t("supervisor.maxAnalysisSessionsNote")}
                        </Text>
                    </View>
                    <View style={styles.concurrencyPicker}>
                        {([1, 2, 3, 4, 5] as const).map((n) => (
                            <Pressable
                                key={n}
                                style={[
                                    styles.concurrencyOption,
                                    config.concurrency.maxAnalysisSessions === n &&
                                        styles.concurrencyOptionSelected,
                                ]}
                                onPress={() =>
                                    updateConfig((prev) => ({
                                        ...prev,
                                        concurrency: {
                                            ...prev.concurrency,
                                            maxAnalysisSessions: n,
                                        },
                                    }))
                                }
                            >
                                <Text
                                    style={[
                                        styles.concurrencyOptionText,
                                        config.concurrency.maxAnalysisSessions === n &&
                                            styles.concurrencyOptionTextSelected,
                                    ]}
                                >
                                    {n}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
                <View style={[styles.concurrencyRow, { borderTopWidth: 0.5, borderTopColor: theme.colors.divider }]}>
                    <View style={styles.toggleRowContent}>
                        <Text style={styles.toggleRowLabel}>
                            {t("supervisor.maxFixSessions")}
                        </Text>
                        <Text style={styles.toggleRowSubtitle}>
                            {t("supervisor.maxFixSessionsNote")}
                        </Text>
                    </View>
                    <View style={styles.concurrencyPicker}>
                        {([1, 2, 3] as const).map((n) => (
                            <Pressable
                                key={n}
                                style={[
                                    styles.concurrencyOption,
                                    config.concurrency.maxFixSessions === n &&
                                        styles.concurrencyOptionSelected,
                                ]}
                                onPress={() =>
                                    updateConfig((prev) => ({
                                        ...prev,
                                        concurrency: {
                                            ...prev.concurrency,
                                            maxFixSessions: n,
                                        },
                                    }))
                                }
                            >
                                <Text
                                    style={[
                                        styles.concurrencyOptionText,
                                        config.concurrency.maxFixSessions === n &&
                                            styles.concurrencyOptionTextSelected,
                                    ]}
                                >
                                    {n}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
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

            {/* Save Button */}
            <View style={styles.saveButtonContainer}>
                <Pressable
                    style={[
                        styles.saveButton,
                        (!isDirty || saving) && styles.saveButtonDisabled,
                    ]}
                    onPress={handleSave}
                    disabled={!isDirty || saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>
                            {t("common.save")}
                        </Text>
                    )}
                </Pressable>
            </View>
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
    children?: React.ReactNode;
}

const ModeOption = React.memo(
    ({ label, subtitle, selected, onPress, isLast, children }: ModeOptionProps) => {
        const { theme } = useUnistyles();

        return (
            <View style={[!isLast && styles.toggleRowBorder]}>
                <Pressable
                    style={styles.modeOption}
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
                {children}
            </View>
        );
    },
);

// --- Severity Chips (editable, shown when mode is active) ---

interface SeverityChipsProps {
    severities: Severity[];
    onToggle: (severity: Severity) => void;
}

const SeverityChips = React.memo(({ severities, onToggle }: SeverityChipsProps) => {
    const { theme } = useUnistyles();

    return (
        <View style={styles.severityChipsContainer}>
            <Text style={styles.severityChipsLabel}>
                {t("supervisor.autoApproveSeverities")}
            </Text>
            <View style={styles.severityChips}>
                {ALL_SEVERITIES.map((sev) => {
                    const selected = severities.includes(sev);
                    const color = SEVERITY_COLORS[sev] ?? theme.colors.textSecondary;
                    return (
                        <Pressable
                            key={sev}
                            style={[
                                styles.severityChip,
                                selected
                                    ? { backgroundColor: color }
                                    : {
                                          backgroundColor: theme.colors.surface,
                                          borderWidth: 1,
                                          borderColor: theme.colors.divider,
                                      },
                            ]}
                            onPress={() => onToggle(sev)}
                        >
                            <Text
                                style={[
                                    styles.severityChipText,
                                    selected
                                        ? styles.severityChipTextSelected
                                        : { color: theme.colors.textSecondary },
                                ]}
                            >
                                {t(SEVERITY_KEY_MAP[sev])}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
});

// --- Severity Tags (read-only summary, shown when mode is NOT active) ---

interface SeverityTagsProps {
    severities: Severity[];
}

const SeverityTags = React.memo(({ severities }: SeverityTagsProps) => (
    <View style={styles.severityTagsContainer}>
        {ALL_SEVERITIES
            .filter((sev) => severities.includes(sev))
            .map((sev) => (
                <View
                    key={sev}
                    style={[styles.severityTag, { backgroundColor: `${SEVERITY_COLORS[sev]}18` }]}
                >
                    <Text style={[styles.severityTagText, { color: SEVERITY_COLORS[sev] }]}>
                        {t(SEVERITY_KEY_MAP[sev])}
                    </Text>
                </View>
            ))}
    </View>
));

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
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
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
    concurrencyRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    concurrencyPicker: {
        flexDirection: "row",
        gap: 6,
        marginTop: 8,
    },
    concurrencyOption: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface,
    },
    concurrencyOptionSelected: {
        backgroundColor: theme.colors.header.tint,
    },
    concurrencyOptionText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    concurrencyOptionTextSelected: {
        color: "#FFFFFF",
    },
    saveButtonContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    saveButton: {
        backgroundColor: theme.colors.header.tint,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    saveButtonDisabled: {
        opacity: 0.4,
    },
    saveButtonText: {
        ...Typography.default(),
        fontSize: 16,
        fontWeight: "600",
        color: "#fff",
    },
    severityChipsContainer: {
        paddingBottom: 12,
    },
    severityChipsLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        paddingHorizontal: 16,
        marginBottom: 4,
    },
    severityChips: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        paddingHorizontal: 16,
    },
    severityChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 16,
    },
    severityChipText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    severityChipTextSelected: {
        color: "#FFFFFF",
    },
    severityTagsContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    severityTag: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    severityTagText: {
        ...Typography.default(),
        fontSize: 11,
    },
}));
