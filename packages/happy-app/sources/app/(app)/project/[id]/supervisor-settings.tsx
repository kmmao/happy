import * as React from "react";
import { View, Text, ScrollView, Switch, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useProject } from "@/hooks/useProjects";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateSupervisorConfig, fetchActionStats, reprocessPendingActions, fetchCustomDimensions, createCustomDimension, updateCustomDimension, deleteCustomDimension, generateDimensionPrompt, type SupervisorDimension } from "@/sync/apiSupervisor";
import { setCustomDimensionLabels } from "@/components/project/supervisorDimensionLabels";
import { getDimensionPrompt } from "@/components/project/supervisorDimensionPrompts";
import { projectManager } from "@/sync/projectManager";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { screenLayoutMaxWidth } from "@/components/layout";
import { SEVERITY_COLORS, SEVERITY_KEY_MAP } from "@/components/project/supervisorConstants";
import { useSettings } from "@/sync/storage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { sync } from "@/sync/sync";
import {
    getMissingSupervisorProfileName,
    getSupervisorAvailableProfiles,
    getSupervisorDefaultProfileId,
} from "@/components/project/supervisorProfileSelection";
import { ProfilePicker } from "@/components/ProfilePicker";
import { useRuntimeProfileEffectiveLabel } from "@/hooks/useRuntimeProfilePreview";

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
        typeSafety: false,
        observability: false,
        apiDesign: false,
        buildCI: false,
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
    analyzeAutoFix: false,
    maxFindings: 0,
    notifications: {
        onAnalysisComplete: true,
        onIssueCreated: true,
        onPRCreated: true,
        onError: true,
    },
    defaultProfileId: null as string | null,
    // Purpose-specific overrides. When null the supervisor resolver falls
    // back to `defaultProfileId`; when set, the server's unified
    // runtimeProfileResolver uses this value for the matching purpose.
    healthCheckProfileId: null as string | null,
    researchProfileId: null as string | null,
    dimensionAiProfileId: null as string | null,
};

type SupervisorConfig = typeof defaultConfig;

function SupervisorSettingsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const project = useProject(id);
    const { theme } = useUnistyles();

    const settings = useSettings();
    const allProfiles = React.useMemo(() => {
        const userProfiles = settings.profiles ?? [];
        const builtInProfiles = DEFAULT_PROFILES.map((profile) => ({
            id: profile.id,
            name: profile.name,
            isBuiltIn: true as const,
        }));
        const userDefinedProfiles = userProfiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
        }));
        return getSupervisorAvailableProfiles(
            builtInProfiles,
            userDefinedProfiles,
        );
    }, [settings.profiles]);
    const [profilePickerOpen, setProfilePickerOpen] = React.useState(false);

    const [config, setConfig] = React.useState<SupervisorConfig>(defaultConfig);
    const [initialConfig, setInitialConfig] =
        React.useState<SupervisorConfig>(defaultConfig);
    const [saving, setSaving] = React.useState(false);
    const [profileRefreshing, setProfileRefreshing] = React.useState(false);

    // Custom dimensions state
    // customDimensions = server-committed state (source of truth for diff)
    // localCustomDimensions = user's pending edits (synced to server on main Save)
    const [customDimensions, setCustomDimensions] = React.useState<SupervisorDimension[]>([]);
    const [localCustomDimensions, setLocalCustomDimensions] = React.useState<SupervisorDimension[]>([]);
    const [dimModalVisible, setDimModalVisible] = React.useState(false);
    const [dimEditTarget, setDimEditTarget] = React.useState<SupervisorDimension | null>(null);
    const [dimTitle, setDimTitle] = React.useState("");
    const [dimPrompt, setDimPrompt] = React.useState("");
    const [dimGenerating, setDimGenerating] = React.useState(false);

    // Dimension detail (ℹ) modal state
    const [dimInfoKey, setDimInfoKey] = React.useState<string | null>(null);
    const dimInfoPrompt = dimInfoKey
        ? (getDimensionPrompt(dimInfoKey) ?? localCustomDimensions.find((d) => d.key === dimInfoKey)?.prompt ?? null)
        : null;

    // Fetch custom dimensions on mount
    React.useEffect(() => {
        if (!project?.serverId) return;
        (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const dims = await fetchCustomDimensions(credentials, project.serverId!);
                if (!mountedRef.current) return;
                setCustomDimensions(dims);
                setLocalCustomDimensions(dims);
                setCustomDimensionLabels(dims);
            } catch {
                // best-effort
            }
        })();
    }, [project?.serverId]);

    const missingDefaultProfileName = React.useMemo(() => {
        return getMissingSupervisorProfileName(config.defaultProfileId, allProfiles);
    }, [allProfiles, config.defaultProfileId]);

    const missingHealthCheckProfileName = React.useMemo(() => {
        return getMissingSupervisorProfileName(config.healthCheckProfileId, allProfiles);
    }, [allProfiles, config.healthCheckProfileId]);

    const missingResearchProfileName = React.useMemo(() => {
        return getMissingSupervisorProfileName(config.researchProfileId, allProfiles);
    }, [allProfiles, config.researchProfileId]);

    const missingDimensionAiProfileName = React.useMemo(() => {
        return getMissingSupervisorProfileName(config.dimensionAiProfileId, allProfiles);
    }, [allProfiles, config.dimensionAiProfileId]);

    // Re-query preview API after each save so the "Effective" label matches
    // the newly-persisted config. initialConfig only changes on successful
    // save, so it works as a stable refresh signal.
    const previewRefreshKey = React.useMemo(
        () => JSON.stringify({
            d: initialConfig.defaultProfileId,
            h: initialConfig.healthCheckProfileId,
            r: initialConfig.researchProfileId,
        }),
        [initialConfig.defaultProfileId, initialConfig.healthCheckProfileId, initialConfig.researchProfileId],
    );
    const previewRefreshCounter = React.useMemo(
        () => previewRefreshKey.length, // cheap hash; value identity is what matters
        [previewRefreshKey],
    );
    const healthEffectiveLabel = useRuntimeProfileEffectiveLabel(
        project?.serverId ?? null,
        "health",
        previewRefreshCounter,
    );
    const researchEffectiveLabel = useRuntimeProfileEffectiveLabel(
        project?.serverId ?? null,
        "research",
        previewRefreshCounter,
    );

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: t("supervisor.settings"),
        });
    }, [navigation]);

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
        () =>
            JSON.stringify(config) !== JSON.stringify(initialConfig) ||
            JSON.stringify(localCustomDimensions) !== JSON.stringify(customDimensions),
        [config, initialConfig, localCustomDimensions, customDimensions],
    );

    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    const handleRefreshProfiles = React.useCallback(async () => {
        setProfileRefreshing(true);
        try {
            await Promise.all([
                sync.refreshAccountProfiles(),
                sync.refreshProjects(),
            ]);
        } finally {
            setProfileRefreshing(false);
        }
    }, []);

    const displayedDefaultProfileId = React.useMemo(() => {
        if (isDirty) {
            return config.defaultProfileId;
        }
        return getSupervisorDefaultProfileId(project?.supervisorConfig) ?? config.defaultProfileId;
    }, [config.defaultProfileId, isDirty, project?.supervisorConfig]);

    const handleSave = React.useCallback(async () => {
        if (!project?.serverId || !isDirty) return;
        setSaving(true);
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
            // Sync custom dimension changes (create / update / delete)
            const serverIds = new Set(customDimensions.map((d) => d.id));
            const localPersisted = localCustomDimensions.filter((d) => !d.id.startsWith("local_"));
            const localPersistedIds = new Set(localPersisted.map((d) => d.id));

            const toCreate = localCustomDimensions.filter((d) => d.id.startsWith("local_"));
            const toDelete = customDimensions.filter((d) => !localPersistedIds.has(d.id));
            const toUpdate = localPersisted.filter((d) => {
                if (!serverIds.has(d.id)) return false;
                const srv = customDimensions.find((s) => s.id === d.id);
                return srv && (d.title !== srv.title || d.prompt !== srv.prompt || d.enabled !== srv.enabled);
            });

            await Promise.all([
                ...toCreate.map((d) =>
                    createCustomDimension(credentials, project.serverId!, { title: d.title, prompt: d.prompt }),
                ),
                ...toDelete.map((d) =>
                    deleteCustomDimension(credentials, project.serverId!, d.id),
                ),
                ...toUpdate.map((d) =>
                    updateCustomDimension(credentials, project.serverId!, d.id, {
                        title: d.title, prompt: d.prompt, enabled: d.enabled,
                    }),
                ),
            ]);

            // Re-fetch to get canonical server state (replaces temp IDs with real IDs)
            if (toCreate.length > 0 || toDelete.length > 0 || toUpdate.length > 0) {
                const freshDims = await fetchCustomDimensions(credentials, project.serverId!);
                if (mountedRef.current) {
                    setCustomDimensions(freshDims);
                    setLocalCustomDimensions(freshDims);
                    setCustomDimensionLabels(freshDims);
                }
            } else {
                setCustomDimensions(localCustomDimensions);
            }

            if (!mountedRef.current) return;
            setInitialConfig(config);
            Modal.toast(t("supervisor.settingsSaved"));

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
    }, [project?.serverId, isDirty, initialConfig.mode, config, id]);

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
                    onInfo={() => setDimInfoKey("security")}
                />
                <ToggleRow
                    label={t("supervisor.dimDependencies")}
                    value={config.analysis.dependencies}
                    onToggle={() => toggleDimension("dependencies")}
                    subtitle={t("supervisor.dimDependenciesNote")}
                    onInfo={() => setDimInfoKey("dependencies")}
                />
                <ToggleRow
                    label={t("supervisor.dimArchitecture")}
                    value={config.analysis.architecture}
                    onToggle={() => toggleDimension("architecture")}
                    subtitle={t("supervisor.dimArchitectureNote")}
                    onInfo={() => setDimInfoKey("architecture")}
                />
                <ToggleRow
                    label={t("supervisor.dimTechDebt")}
                    value={config.analysis.techDebt}
                    onToggle={() => toggleDimension("techDebt")}
                    subtitle={t("supervisor.dimTechDebtNote")}
                    onInfo={() => setDimInfoKey("techDebt")}
                />
                <ToggleRow
                    label={t("supervisor.dimCodeQuality")}
                    value={config.analysis.codeQuality}
                    onToggle={() => toggleDimension("codeQuality")}
                    subtitle={t("supervisor.dimCodeQualityNote")}
                    onInfo={() => setDimInfoKey("codeQuality")}
                />
                <ToggleRow
                    label={t("supervisor.dimTestCoverage")}
                    value={config.analysis.testCoverage}
                    onToggle={() => toggleDimension("testCoverage")}
                    subtitle={t("supervisor.dimTestCoverageNote")}
                    onInfo={() => setDimInfoKey("testCoverage")}
                />
                <ToggleRow
                    label={t("supervisor.dimDocumentation")}
                    value={config.analysis.documentation}
                    onToggle={() => toggleDimension("documentation")}
                    subtitle={t("supervisor.dimDocumentationNote")}
                    onInfo={() => setDimInfoKey("documentation")}
                />
                <ToggleRow
                    label={t("supervisor.dimPerformance")}
                    value={config.analysis.performance}
                    onToggle={() => toggleDimension("performance")}
                    subtitle={t("supervisor.dimPerformanceNote")}
                    onInfo={() => setDimInfoKey("performance")}
                />
                <ToggleRow
                    label={t("supervisor.dimUiUx")}
                    value={config.analysis.uiUx}
                    onToggle={() => toggleDimension("uiUx")}
                    subtitle={t("supervisor.dimUiUxNote")}
                    onInfo={() => setDimInfoKey("uiUx")}
                />
                <ToggleRow
                    label={t("supervisor.dimTypeSafety")}
                    value={config.analysis.typeSafety}
                    onToggle={() => toggleDimension("typeSafety")}
                    subtitle={t("supervisor.dimTypeSafetyNote")}
                    onInfo={() => setDimInfoKey("typeSafety")}
                />
                <ToggleRow
                    label={t("supervisor.dimObservability")}
                    value={config.analysis.observability}
                    onToggle={() => toggleDimension("observability")}
                    subtitle={t("supervisor.dimObservabilityNote")}
                    onInfo={() => setDimInfoKey("observability")}
                />
                <ToggleRow
                    label={t("supervisor.dimApiDesign")}
                    value={config.analysis.apiDesign}
                    onToggle={() => toggleDimension("apiDesign")}
                    subtitle={t("supervisor.dimApiDesignNote")}
                    onInfo={() => setDimInfoKey("apiDesign")}
                />
                <ToggleRow
                    label={t("supervisor.dimBuildCI")}
                    value={config.analysis.buildCI}
                    onToggle={() => toggleDimension("buildCI")}
                    subtitle={t("supervisor.dimBuildCINote")}
                    onInfo={() => setDimInfoKey("buildCI")}
                    isLast
                />
            </ItemGroup>

            {/* Dimension detail (ℹ) modal */}
            {dimInfoKey && dimInfoPrompt && (
                <View style={styles.dimModalOverlay}>
                    <View style={styles.dimModalCard}>
                        <Text style={styles.dimModalTitle}>
                            {localCustomDimensions.find((d) => d.key === dimInfoKey)?.title
                                ?? t(`supervisor.dim${dimInfoKey.charAt(0).toUpperCase()}${dimInfoKey.slice(1)}` as Parameters<typeof t>[0])}
                        </Text>
                        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                            <Text style={[styles.dimModalLabel, { lineHeight: 22, fontSize: 14 }]}>
                                {dimInfoPrompt}
                            </Text>
                        </ScrollView>
                        <View style={[styles.dimModalFooter, { justifyContent: "center" }]}>
                            <Pressable
                                style={styles.dimModalSaveBtn}
                                onPress={() => setDimInfoKey(null)}
                            >
                                <Text style={styles.dimModalSaveText}>{t("common.ok")}</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            )}

            {/* Custom Dimensions */}
            <ItemGroup title={t("supervisor.customDimensionsSection")}>
                {localCustomDimensions.map((dim, idx) => (
                    <View
                        key={dim.id}
                        style={[
                            styles.toggleRow,
                            idx < localCustomDimensions.length - 1 && styles.toggleRowBorder,
                        ]}
                    >
                        <View style={styles.toggleRowContent}>
                            <Text style={styles.toggleRowLabel}>{dim.title}</Text>
                            <Text
                                style={styles.toggleRowSubtitle}
                                numberOfLines={2}
                            >
                                {dim.prompt}
                            </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Switch
                                value={dim.enabled}
                                onValueChange={(val) => {
                                    setLocalCustomDimensions((prev) =>
                                        prev.map((d) => d.id === dim.id ? { ...d, enabled: val } : d),
                                    );
                                }}
                                trackColor={{
                                    false: theme.colors.surface,
                                    true: theme.colors.header.tint,
                                }}
                            />
                            <Pressable
                                onPress={() => {
                                    setDimEditTarget(dim);
                                    setDimTitle(dim.title);
                                    setDimPrompt(dim.prompt);
                                    setDimModalVisible(true);
                                }}
                                hitSlop={8}
                            >
                                <Ionicons name="pencil-outline" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    </View>
                ))}
                <Pressable
                    style={[styles.toggleRow, localCustomDimensions.length > 0 && { borderTopWidth: 0.5, borderTopColor: theme.colors.divider }]}
                    onPress={() => {
                        setDimEditTarget(null);
                        setDimTitle("");
                        setDimPrompt("");
                        setDimModalVisible(true);
                    }}
                >
                    <Ionicons name="add-circle-outline" size={18} color={theme.colors.header.tint} style={{ marginRight: 8 }} />
                    <Text style={[styles.toggleRowLabel, { color: theme.colors.header.tint }]}>
                        {t("supervisor.customDimensionsAdd")}
                    </Text>
                </Pressable>
            </ItemGroup>

            {/* Custom Dimension Add/Edit Modal */}
            {dimModalVisible && (
                <View style={styles.dimModalOverlay}>
                    <View style={styles.dimModalCard}>
                        <Text style={styles.dimModalTitle}>
                            {dimEditTarget
                                ? t("supervisor.customDimensionEditTitle")
                                : t("supervisor.customDimensionAddTitle")}
                        </Text>

                        <Text style={styles.dimModalLabel}>{t("supervisor.customDimensionNameLabel")}</Text>
                        <TextInput
                            style={styles.dimModalInput}
                            value={dimTitle}
                            onChangeText={setDimTitle}
                            placeholder={t("supervisor.customDimensionNamePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            maxLength={50}
                            editable={!dimEditTarget}
                        />

                        <Text style={styles.dimModalLabel}>{t("supervisor.customDimensionPromptLabel")}</Text>
                        <TextInput
                            style={styles.dimModalTextarea}
                            value={dimPrompt}
                            onChangeText={setDimPrompt}
                            placeholder={t("supervisor.customDimensionPromptPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            multiline
                            maxLength={5000}
                        />

                        <View style={styles.dimModalActions}>
                            {dimEditTarget && (
                                <Pressable
                                    style={styles.dimModalDeleteBtn}
                                    onPress={async () => {
                                        const confirmed = await Modal.confirm(
                                            dimEditTarget.title,
                                            t("supervisor.customDimensionDeleteConfirm"),
                                            { confirmText: t("common.delete"), cancelText: t("common.cancel") },
                                        );
                                        if (!confirmed) return;
                                        setLocalCustomDimensions((prev) => prev.filter((d) => d.id !== dimEditTarget.id));
                                        setDimModalVisible(false);
                                    }}
                                >
                                    <Text style={styles.dimModalDeleteText}>{t("common.delete")}</Text>
                                </Pressable>
                            )}
                            <Pressable
                                style={styles.dimModalAiBtn}
                                disabled={dimGenerating || !dimTitle.trim()}
                                onPress={async () => {
                                    if (!dimTitle.trim() || !project?.serverId) return;
                                    setDimGenerating(true);
                                    try {
                                        const credentials = await TokenStorage.getCredentials();
                                        if (!credentials) return;
                                        const generated = await generateDimensionPrompt(credentials, project.serverId, dimTitle.trim(), config.dimensionAiProfileId ?? undefined);
                                        if (mountedRef.current) setDimPrompt(generated);
                                    } catch {
                                        Modal.toast(t("errors.unknownError"));
                                    } finally {
                                        if (mountedRef.current) setDimGenerating(false);
                                    }
                                }}
                            >
                                {dimGenerating
                                    ? <ActivityIndicator size="small" color={theme.colors.header.tint} />
                                    : <Text style={styles.dimModalAiText}>
                                        {t("supervisor.customDimensionAiGenerate")}
                                    </Text>
                                }
                            </Pressable>
                        </View>

                        <View style={styles.dimModalFooter}>
                            <Pressable
                                style={styles.dimModalCancelBtn}
                                onPress={() => setDimModalVisible(false)}
                            >
                                <Text style={styles.dimModalCancelText}>{t("common.cancel")}</Text>
                            </Pressable>
                            <Pressable
                                style={[
                                    styles.dimModalSaveBtn,
                                    (!dimTitle.trim() || !dimPrompt.trim()) && { opacity: 0.5 },
                                ]}
                                disabled={!dimTitle.trim() || !dimPrompt.trim()}
                                onPress={() => {
                                    if (dimEditTarget) {
                                        setLocalCustomDimensions((prev) =>
                                            prev.map((d) =>
                                                d.id === dimEditTarget.id
                                                    ? { ...d, title: dimTitle.trim(), prompt: dimPrompt.trim() }
                                                    : d,
                                            ),
                                        );
                                    } else {
                                        const tempDim: SupervisorDimension = {
                                            id: `local_${Date.now()}`,
                                            key: dimTitle.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"),
                                            title: dimTitle.trim(),
                                            prompt: dimPrompt.trim(),
                                            enabled: true,
                                            sortOrder: localCustomDimensions.length,
                                            createdAt: Date.now(),
                                            updatedAt: Date.now(),
                                        };
                                        setLocalCustomDimensions((prev) => [...prev, tempDim]);
                                    }
                                    setDimModalVisible(false);
                                }}
                            >
                                <Text style={styles.dimModalSaveText}>{t("common.save")}</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            )}

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

            {/* Analyze Auto-Fix */}
            <ItemGroup title={t("supervisor.analyzeAutoFixSection")}>
                <ToggleRow
                    label={t("supervisor.analyzeAutoFixLabel")}
                    value={config.analyzeAutoFix}
                    onToggle={() =>
                        updateConfig((prev) => ({
                            ...prev,
                            analyzeAutoFix: !prev.analyzeAutoFix,
                        }))
                    }
                />
                <Text style={styles.safetyText}>
                    {t("supervisor.analyzeAutoFixDesc")}
                </Text>
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

            {/* Analysis Limits */}
            <ItemGroup title={t("supervisor.analysisLimitsSection")}>
                <View style={styles.concurrencyRow}>
                    <View style={styles.toggleRowContent}>
                        <Text style={styles.toggleRowLabel}>
                            {t("supervisor.maxFindings")}
                        </Text>
                        <Text style={styles.toggleRowSubtitle}>
                            {t("supervisor.maxFindingsNote")}
                        </Text>
                    </View>
                    <View style={styles.concurrencyPicker}>
                        {([0, 10, 20, 30, 50] as const).map((n) => (
                            <Pressable
                                key={n}
                                style={[
                                    styles.concurrencyOption,
                                    (config.maxFindings ?? 0) === n &&
                                        styles.concurrencyOptionSelected,
                                ]}
                                onPress={() =>
                                    updateConfig((prev) => ({
                                        ...prev,
                                        maxFindings: n,
                                    }))
                                }
                            >
                                <Text
                                    style={[
                                        styles.concurrencyOptionText,
                                        (config.maxFindings ?? 0) === n &&
                                            styles.concurrencyOptionTextSelected,
                                    ]}
                                >
                                    {n === 0 ? "∞" : n}
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

            {/* Health-check Profile Override — takes priority over the default for scheduled/manual health runs */}
            <ItemGroup title={t("supervisor.healthProfileSection")}>
                <View style={styles.customRulesCard}>
                    <ProfilePicker
                        value={config.healthCheckProfileId}
                        onChange={(profileId) =>
                            updateConfig((prev) => ({ ...prev, healthCheckProfileId: profileId }))
                        }
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("supervisor.healthProfileDesc")}
                        missingProfileName={missingHealthCheckProfileName}
                        missingMessage={
                            missingHealthCheckProfileName
                                ? t("supervisor.defaultProfileMissing", {
                                    profileName: missingHealthCheckProfileName,
                                })
                                : undefined
                        }
                        refreshLabel={t("suggestions.refresh")}
                        onRefresh={handleRefreshProfiles}
                        refreshing={profileRefreshing}
                        effectiveLabel={healthEffectiveLabel}
                    />
                </View>
            </ItemGroup>

            {/* Research Profile Override — for research/competitive analysis runs */}
            <ItemGroup title={t("supervisor.researchProfileSection")}>
                <View style={styles.customRulesCard}>
                    <ProfilePicker
                        value={config.researchProfileId}
                        onChange={(profileId) =>
                            updateConfig((prev) => ({ ...prev, researchProfileId: profileId }))
                        }
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("supervisor.researchProfileDesc")}
                        missingProfileName={missingResearchProfileName}
                        missingMessage={
                            missingResearchProfileName
                                ? t("supervisor.defaultProfileMissing", {
                                    profileName: missingResearchProfileName,
                                })
                                : undefined
                        }
                        refreshLabel={t("suggestions.refresh")}
                        onRefresh={handleRefreshProfiles}
                        refreshing={profileRefreshing}
                        effectiveLabel={researchEffectiveLabel}
                    />
                </View>
            </ItemGroup>

            {/* Dimension AI Profile — model used for "AI Generate" in custom dimension editor */}
            <ItemGroup title={t("supervisor.dimAiProfileSection")}>
                <View style={styles.customRulesCard}>
                    <ProfilePicker
                        value={config.dimensionAiProfileId}
                        onChange={(profileId) =>
                            updateConfig((prev) => ({ ...prev, dimensionAiProfileId: profileId }))
                        }
                        profiles={allProfiles}
                        defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                        description={t("supervisor.dimAiProfileDesc")}
                        missingProfileName={missingDimensionAiProfileName}
                        missingMessage={
                            missingDimensionAiProfileName
                                ? t("supervisor.defaultProfileMissing", {
                                    profileName: missingDimensionAiProfileName,
                                })
                                : undefined
                        }
                        refreshLabel={t("suggestions.refresh")}
                        onRefresh={handleRefreshProfiles}
                        refreshing={profileRefreshing}
                    />
                </View>
            </ItemGroup>

            {/* Default Run Profile — collapsible picker */}
            <ItemGroup title={t("supervisor.defaultProfileSection")}>
                <View style={styles.customRulesCard}>
                    <Text style={styles.customRulesDesc}>
                        {t("supervisor.defaultProfileDesc")}
                    </Text>
                    {/* Current selection — tap to expand/collapse */}
                    <View style={styles.defaultProfileHeaderRow}>
                        <Pressable
                            style={styles.defaultProfileTrigger}
                            onPress={() => setProfilePickerOpen((v) => !v)}
                        >
                            <Text style={styles.defaultProfileTriggerText}>
                                {displayedDefaultProfileId
                                    ? allProfiles.find((p) => p.id === displayedDefaultProfileId)?.name ?? displayedDefaultProfileId
                                    : t("supervisor.defaultProfileDefault")}
                            </Text>
                            <Ionicons
                                name={profilePickerOpen ? "chevron-up" : "chevron-down"}
                                size={18}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                        <Pressable
                            style={styles.defaultProfileRefreshButton}
                            onPress={handleRefreshProfiles}
                            disabled={profileRefreshing}
                        >
                            {profileRefreshing ? (
                                <ActivityIndicator size="small" color={theme.colors.header.tint} />
                            ) : (
                                <Ionicons
                                    name="refresh"
                                    size={14}
                                    color={theme.colors.header.tint}
                                />
                            )}
                            <Text style={styles.defaultProfileRefreshText}>
                                {t("suggestions.refresh")}
                            </Text>
                        </Pressable>
                    </View>
                    {missingDefaultProfileName && (
                        <View style={[styles.safetyCard, { marginTop: 8, flexDirection: "row", alignItems: "flex-start", gap: 8 }] }>
                            <Ionicons
                                name="alert-circle-outline"
                                size={16}
                                color="#FF9500"
                            />
                            <Text style={[styles.safetyText, { flex: 1, marginTop: 0 }] }>
                                {t("supervisor.defaultProfileMissing", {
                                    profileName: missingDefaultProfileName,
                                })}
                            </Text>
                        </View>
                    )}
                    {/* Expanded option list */}
                    {profilePickerOpen && (
                        <View style={{ borderTopWidth: 0.5, borderTopColor: theme.colors.divider }}>
                            {/* Default (no profile) */}
                            <Pressable
                                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 }}
                                onPress={() => {
                                    updateConfig((prev) => ({ ...prev, defaultProfileId: null }));
                                    setProfilePickerOpen(false);
                                }}
                            >
                                <Ionicons
                                    name={config.defaultProfileId === null ? "radio-button-on" : "radio-button-off"}
                                    size={18}
                                    color={config.defaultProfileId === null ? theme.colors.header.tint : theme.colors.textSecondary}
                                />
                                <Text style={{ fontSize: 14, color: theme.colors.text, ...Typography.default() }}>
                                    {t("supervisor.defaultProfileDefault")}
                                </Text>
                            </Pressable>
                            {allProfiles.map((p) => (
                                <Pressable
                                    key={p.id}
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        paddingVertical: 10,
                                        gap: 8,
                                        borderTopWidth: 0.5,
                                        borderTopColor: theme.colors.divider,
                                    }}
                                    onPress={() => {
                                        updateConfig((prev) => ({ ...prev, defaultProfileId: p.id }));
                                        setProfilePickerOpen(false);
                                    }}
                                >
                                    <Ionicons
                                        name={config.defaultProfileId === p.id ? "radio-button-on" : "radio-button-off"}
                                        size={18}
                                        color={config.defaultProfileId === p.id ? theme.colors.header.tint : theme.colors.textSecondary}
                                    />
                                    <Text style={{ fontSize: 14, color: theme.colors.text, flex: 1, ...Typography.default() }}>
                                        {p.name}
                                    </Text>
                                    {p.isBuiltIn && (
                                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>
                                            Built-in
                                        </Text>
                                    )}
                                </Pressable>
                            ))}
                        </View>
                    )}
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
                        <ActivityIndicator size="small" color={theme.colors.header.background} />
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
    onInfo?: () => void;
}

const ToggleRow = React.memo(
    ({ label, value, onToggle, subtitle, isLast, onInfo }: ToggleRowProps) => {
        const { theme } = useUnistyles();

        return (
            <View
                style={[
                    styles.toggleRow,
                    !isLast && styles.toggleRowBorder,
                ]}
            >
                <View style={styles.toggleRowContent}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.toggleRowLabel}>{label}</Text>
                        {onInfo && (
                            <Pressable onPress={onInfo} hitSlop={8}>
                                <Ionicons
                                    name="information-circle-outline"
                                    size={16}
                                    color={theme.colors.textSecondary}
                                />
                            </Pressable>
                        )}
                    </View>
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

const styles = StyleSheet.create((theme, rt) => ({
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
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
    defaultProfileHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 8,
    },
    defaultProfileTrigger: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 10,
    },
    defaultProfileTriggerText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    defaultProfileRefreshButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderWidth: 1,
        borderColor: `${theme.colors.header.tint}22`,
        backgroundColor: `${theme.colors.header.tint}12`,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
    },
    defaultProfileRefreshText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.header.tint,
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
        backgroundColor: resolveActiveTint(theme),
    },
    concurrencyOptionText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    concurrencyOptionTextSelected: {
        color: theme.colors.header.background,
    },
    saveButtonContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    saveButton: {
        backgroundColor: resolveActiveTint(theme),
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
        color: theme.colors.header.background,
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
        color: theme.colors.button.primary.tint,
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
    dimModalOverlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "center" as const,
        alignItems: "center" as const,
        zIndex: 100,
        padding: 16,
    },
    dimModalCard: {
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 16,
        padding: 20,
        width: "100%" as const,
        maxWidth: 480,
        gap: 12,
    },
    dimModalTitle: {
        ...Typography.default(),
        fontSize: 17,
        fontWeight: "600" as const,
        color: theme.colors.text,
        marginBottom: 4,
    },
    dimModalLabel: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 2,
    },
    dimModalInput: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    dimModalTextarea: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 120,
        textAlignVertical: "top" as const,
    },
    dimModalActions: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 8,
        marginTop: 4,
    },
    dimModalDeleteBtn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
    },
    dimModalDeleteText: {
        ...Typography.default(),
        fontSize: 14,
        color: "#FF3B30",
    },
    dimModalAiBtn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
        minWidth: 90,
        alignItems: "center" as const,
    },
    dimModalAiText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.header.tint,
    },
    dimModalFooter: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 8,
        marginTop: 4,
    },
    dimModalCancelBtn: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
    },
    dimModalCancelText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    dimModalSaveBtn: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.header.tint,
        minWidth: 80,
        alignItems: "center" as const,
    },
    dimModalSaveText: {
        ...Typography.default(),
        fontSize: 15,
        fontWeight: "600" as const,
        color: "#fff",
    },
}));

export default React.memo(SupervisorSettingsScreen);
