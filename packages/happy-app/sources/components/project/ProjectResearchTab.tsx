import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    TextInput,
    RefreshControl,
    Switch,
    Modal as RNModal,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { useHappyAction } from "@/hooks/useHappyAction";
import {
    type SupervisorRun,
    triggerSupervisorRun,
    fetchSupervisorRuns,
    cancelSupervisorRun,
    SupervisorAlreadyRunningError,
} from "@/sync/apiSupervisor";
import { ItemGroup } from "@/components/ItemGroup";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { sync } from "@/sync/sync";
import { layout } from "@/components/layout";
import {
    loadResearchPrefs,
    saveResearchPrefs,
    ResearchPrefsSchema,
} from "@/sync/persistence";
import { kvGet } from "@/sync/apiKv";
import { kvSetWithRetry } from "@/sync/kvConflictRetry";
import { encodeBase64, decodeBase64 } from "@/encryption/base64";
import { useElapsedSeconds, type DimensionProgress } from "./supervisorUtils";
import { resolveDimensionLabel } from "./supervisorDimensionLabels";
import { SupervisorProgressView } from "./SupervisorProgressView";

/** Encode a UTF-8 string to standard base64 (server KV stores Bytes). */
function toBase64(str: string): string {
    return encodeBase64(new TextEncoder().encode(str), "base64");
}

/** Decode a standard base64 string to UTF-8 (server KV stores Bytes). */
function fromBase64(b64: string): string {
    return new TextDecoder().decode(decodeBase64(b64, "base64"));
}

const RESEARCH_DIMENSIONS = [
    "pricing",
    "features",
    "devExperience",
    "positioning",
    "techStack",
    "community",
    "funding",
    "userFeedback",
] as const;

type ResearchDimension = (typeof RESEARCH_DIMENSIONS)[number];

const DIMENSION_LABELS: Record<ResearchDimension, { label: () => string; note: () => string }> = {
    pricing: { label: () => t("competitorResearch.dim_pricing"), note: () => t("competitorResearch.dim_pricing_note") },
    features: { label: () => t("competitorResearch.dim_features"), note: () => t("competitorResearch.dim_features_note") },
    devExperience: { label: () => t("competitorResearch.dim_devExperience"), note: () => t("competitorResearch.dim_devExperience_note") },
    positioning: { label: () => t("competitorResearch.dim_positioning"), note: () => t("competitorResearch.dim_positioning_note") },
    techStack: { label: () => t("competitorResearch.dim_techStack"), note: () => t("competitorResearch.dim_techStack_note") },
    community: { label: () => t("competitorResearch.dim_community"), note: () => t("competitorResearch.dim_community_note") },
    funding: { label: () => t("competitorResearch.dim_funding"), note: () => t("competitorResearch.dim_funding_note") },
    userFeedback: { label: () => t("competitorResearch.dim_userFeedback"), note: () => t("competitorResearch.dim_userFeedback_note") },
};

const defaultDimensions: Record<ResearchDimension, boolean> = {
    pricing: true,
    features: true,
    devExperience: false,
    positioning: false,
    techStack: false,
    community: false,
    funding: false,
    userFeedback: false,
};

export type ResearchSyncStatus = "idle" | "saving" | "saved" | "failed";

interface ProjectResearchTabProps {
    project: Project;
    onSyncStatusChange?: (status: ResearchSyncStatus) => void;
}

export const ProjectResearchTab = React.memo(
    ({ project, onSyncStatusChange }: ProjectResearchTabProps) => {
        const { theme } = useUnistyles();
        const serverId = project.serverId;

        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [loading, setLoading] = React.useState(true);
        const [refreshing, setRefreshing] = React.useState(false);
        const [reportModalRun, setReportModalRun] = React.useState<SupervisorRun | null>(null);
        const [dimensionProgress, setDimensionProgress] =
            React.useState<DimensionProgress | null>(null);

        // Input fields — load from local cache first, then sync from KV Store
        const savedPrefs = React.useMemo(() => {
            if (!serverId) return null;
            return loadResearchPrefs(serverId);
        }, [serverId]);

        const [knownCompetitors, setKnownCompetitors] = React.useState(
            savedPrefs?.knownCompetitors ?? "",
        );
        const [dimensions, setDimensions] = React.useState(
            savedPrefs ? { ...defaultDimensions, ...savedPrefs.dimensions } : defaultDimensions,
        );
        const [additionalNotes, setAdditionalNotes] = React.useState(
            savedPrefs?.additionalNotes ?? "",
        );
        const [customRules, setCustomRules] = React.useState(
            savedPrefs?.customRules ?? "",
        );

        // KV Store version tracking for optimistic concurrency
        const kvVersionRef = React.useRef(-1);

        // Sync status indicator: idle → saving → saved / failed
        const [syncStatus, setSyncStatusRaw] = React.useState<ResearchSyncStatus>("idle");
        const onSyncStatusChangeRef = React.useRef(onSyncStatusChange);
        onSyncStatusChangeRef.current = onSyncStatusChange;
        const setSyncStatus = React.useCallback((status: ResearchSyncStatus) => {
            setSyncStatusRaw(status);
            onSyncStatusChangeRef.current?.(status);
        }, []);
        const syncFadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

        // Persist prefs: local MMKV (instant) + KV Store (multi-device sync)
        const prefsRef = React.useRef({ dimensions, knownCompetitors, additionalNotes, customRules });
        prefsRef.current = { dimensions, knownCompetitors, additionalNotes, customRules };

        const persistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

        const persistToServer = React.useCallback(async () => {
            if (!serverId) return;
            setSyncStatus("saving");
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) {
                    setSyncStatus("idle");
                    return;
                }
                const kvKey = `researchConfig/${serverId}`;
                const value = toBase64(JSON.stringify(prefsRef.current));
                const result = await kvSetWithRetry(
                    credentials, kvKey, value, kvVersionRef.current,
                );
                kvVersionRef.current = result.version;
                setSyncStatus("saved");
            } catch {
                // Network errors or exhausted retries — local cache is authoritative
                setSyncStatus("failed");
            }
            // Auto-fade after 2 seconds
            if (syncFadeTimerRef.current) clearTimeout(syncFadeTimerRef.current);
            syncFadeTimerRef.current = setTimeout(() => setSyncStatus("idle"), 2000);
        }, [serverId]);

        const debouncedPersist = React.useCallback(() => {
            // Save locally immediately
            if (serverId) {
                saveResearchPrefs(serverId, prefsRef.current);
            }
            // Debounce server sync
            if (persistTimerRef.current) {
                clearTimeout(persistTimerRef.current);
            }
            persistTimerRef.current = setTimeout(persistToServer, 1000);
        }, [serverId, persistToServer]);

        // Load from KV Store on mount (overrides local cache if newer)
        React.useEffect(() => {
            if (!serverId) return;
            let cancelled = false;

            async function loadFromKv() {
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials || cancelled) return;
                    const kvKey = `researchConfig/${serverId}`;
                    const item = await kvGet(credentials, kvKey);
                    if (item && !cancelled) {
                        const parsed = ResearchPrefsSchema.safeParse(JSON.parse(fromBase64(item.value)));
                        if (!parsed.success) return;
                        kvVersionRef.current = item.version;
                        const remote = parsed.data;
                        // Update state from remote
                        setKnownCompetitors(remote.knownCompetitors ?? "");
                        setDimensions({ ...defaultDimensions, ...remote.dimensions });
                        setAdditionalNotes(remote.additionalNotes ?? "");
                        setCustomRules(remote.customRules ?? "");
                        // Update local cache
                        saveResearchPrefs(serverId!, remote);
                    }
                } catch {
                    // Fall back to local cache
                }
            }

            loadFromKv();
            return () => { cancelled = true; };
        }, [serverId]);

        // Listen for real-time KV updates from other devices
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onResearchConfigUpdate((event) => {
                if (event.projectId !== serverId) return;
                // Skip stale updates and echoes from our own writes.
                // Versions are server-managed and monotonically increasing per key,
                // so <= safely covers both cases.
                if (event.version <= kvVersionRef.current) return;
                if (event.value === null) return;
                const parsed = ResearchPrefsSchema.safeParse(
                    (() => { try { return JSON.parse(fromBase64(event.value)); } catch { return null; } })(),
                );
                if (!parsed.success) return;
                const remote = parsed.data;
                kvVersionRef.current = event.version;
                setKnownCompetitors(remote.knownCompetitors);
                setDimensions({ ...defaultDimensions, ...remote.dimensions });
                setAdditionalNotes(remote.additionalNotes);
                setCustomRules(remote.customRules);
                saveResearchPrefs(serverId!, remote);
            });
            return unsubscribe;
        }, [serverId]);

        // Flush on unmount
        React.useEffect(() => {
            return () => {
                if (syncFadeTimerRef.current) clearTimeout(syncFadeTimerRef.current);
                if (persistTimerRef.current) {
                    clearTimeout(persistTimerRef.current);
                    if (serverId) {
                        saveResearchPrefs(serverId, prefsRef.current);
                        persistToServer();
                    }
                }
            };
        }, [serverId, persistToServer]);

        // Active run tracking
        const activeRun = React.useMemo(
            () => runs.find((r) => r.status === "pending" || r.status === "running"),
            [runs],
        );

        const elapsedSeconds = useElapsedSeconds(
            activeRun ? activeRun.createdAt : null,
        );


        const loadData = React.useCallback(async () => {
            if (!serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const result = await fetchSupervisorRuns(credentials, serverId, {
                    limit: 20,
                    trigger: "research",
                });
                setRuns(result.runs);
            } catch {
                // silent
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        }, [serverId]);

        React.useEffect(() => {
            loadData();
        }, [loadData]);

        // Track known research runIds to filter WebSocket events
        const researchRunIdsRef = React.useRef(new Set<string>());
        React.useEffect(() => {
            researchRunIdsRef.current = new Set(runs.map((r) => r.id));
        }, [runs]);

        // Listen for supervisor status changes (only for research runs)
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                if (!researchRunIdsRef.current.has(event.runId)) return;
                // Terminal states: clear progress + refresh
                if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
                    setDimensionProgress(null);
                    loadData();
                    return;
                }
                // Running state: update dimension progress
                if (event.status === "running") {
                    if (event.currentDimension && event.dimensionIndex && event.totalDimensions) {
                        setDimensionProgress({
                            currentDimension: event.currentDimension,
                            dimensionIndex: event.dimensionIndex,
                            totalDimensions: event.totalDimensions,
                        });
                    }
                    setRuns((prev) =>
                        prev.map((r) =>
                            r.id === event.runId ? { ...r, status: "running" } : r,
                        ),
                    );
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        const toggleDimension = React.useCallback(
            (key: ResearchDimension) => {
                setDimensions((prev) => {
                    const next = { ...prev, [key]: !prev[key] };
                    prefsRef.current = { ...prefsRef.current, dimensions: next };
                    return next;
                });
                debouncedPersist();
            },
            [debouncedPersist],
        );

        const handleTextChange = React.useCallback(
            (field: "knownCompetitors" | "additionalNotes" | "customRules") => (text: string) => {
                if (field === "knownCompetitors") setKnownCompetitors(text);
                else if (field === "additionalNotes") setAdditionalNotes(text);
                else setCustomRules(text);
                prefsRef.current = { ...prefsRef.current, [field]: text };
                debouncedPersist();
            },
            [debouncedPersist],
        );

        const selectedDimensions = React.useMemo(
            () =>
                RESEARCH_DIMENSIONS.filter((d) => dimensions[d]).join(","),
            [dimensions],
        );

        const [triggerLoading, doTrigger] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                try {
                    const run = await triggerSupervisorRun(credentials, serverId, {
                        trigger: "research",
                        researchParams: {
                            knownCompetitors: knownCompetitors.trim() || undefined,
                            focusAreas: selectedDimensions || undefined,
                            additionalNotes: [
                                additionalNotes.trim(),
                                customRules.trim() ? `Custom rules:\n${customRules.trim()}` : "",
                            ].filter(Boolean).join("\n\n") || undefined,
                        },
                    });
                    setRuns((prev) => [run, ...prev]);
                } catch (e) {
                    if (e instanceof SupervisorAlreadyRunningError) {
                        loadData();
                    }
                    throw e;
                }
            }, [serverId, knownCompetitors, selectedDimensions, additionalNotes, customRules, loadData]),
        );

        const [cancelLoading, doCancel] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId || !activeRun) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await cancelSupervisorRun(credentials, serverId, activeRun.id);
                loadData();
            }, [serverId, activeRun, loadData]),
        );

        const onRefresh = React.useCallback(() => {
            setRefreshing(true);
            loadData();
        }, [loadData]);

        if (loading) {
            return (
                <View style={styles.center}>
                    <ActivityIndicator />
                </View>
            );
        }

        const isRunning = !!activeRun;
        const completedRuns = runs.filter(
            (r) => r.status === "completed" && r.reportContent,
        );

        return (
            <>
                <ScrollView
                    style={styles.container}
                    contentContainerStyle={styles.contentContainer}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                    }
                >
                    <View style={styles.innerContainer}>
                        {/* Single config group: inputs + dimensions + button */}
                        <ItemGroup title={
                            <SyncStatusHeader
                                title={t("competitorResearch.title")}
                                syncStatus={syncStatus}
                            />
                        }>
                            {/* Dimension toggles first */}
                            <View style={styles.dimensionHeader}>
                                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                                    {t("competitorResearch.dimensionsSection")}
                                </Text>
                            </View>
                            {RESEARCH_DIMENSIONS.map((dim) => (
                                <DimensionToggle
                                    key={dim}
                                    label={DIMENSION_LABELS[dim].label()}
                                    subtitle={DIMENSION_LABELS[dim].note()}
                                    value={dimensions[dim]}
                                    onToggle={() => toggleDimension(dim)}
                                    disabled={isRunning}
                                />
                            ))}

                            {/* Known Competitors */}
                            <View style={styles.inputSection}>
                                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                                    {t("competitorResearch.knownCompetitors")}
                                </Text>
                                <TextInput
                                    style={[
                                        styles.textInput,
                                        {
                                            color: theme.colors.text,
                                            backgroundColor: theme.colors.groupped.background,
                                            borderColor: theme.colors.divider,
                                        },
                                    ]}
                                    placeholder={t("competitorResearch.knownCompetitorsPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={knownCompetitors}
                                    onChangeText={handleTextChange("knownCompetitors")}
                                    multiline
                                    numberOfLines={2}
                                    editable={!isRunning}
                                />
                            </View>

                            {/* Custom Rules */}
                            <View style={styles.inputSection}>
                                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                                    {t("competitorResearch.customRules")}
                                </Text>
                                <TextInput
                                    style={[
                                        styles.textInput,
                                        {
                                            color: theme.colors.text,
                                            backgroundColor: theme.colors.groupped.background,
                                            borderColor: theme.colors.divider,
                                        },
                                    ]}
                                    placeholder={t("competitorResearch.customRulesPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={customRules}
                                    onChangeText={handleTextChange("customRules")}
                                    multiline
                                    numberOfLines={2}
                                    editable={!isRunning}
                                />
                            </View>

                            {/* Additional Notes */}
                            <View style={styles.inputSection}>
                                <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                                    {t("competitorResearch.additionalNotes")}
                                </Text>
                                <TextInput
                                    style={[
                                        styles.textInput,
                                        {
                                            color: theme.colors.text,
                                            backgroundColor: theme.colors.groupped.background,
                                            borderColor: theme.colors.divider,
                                        },
                                    ]}
                                    placeholder={t("competitorResearch.additionalNotesPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={additionalNotes}
                                    onChangeText={handleTextChange("additionalNotes")}
                                    multiline
                                    numberOfLines={2}
                                    editable={!isRunning}
                                />
                            </View>

                            {/* Action button */}
                            <View style={styles.buttonRow}>
                                {isRunning ? (
                                    <Pressable
                                        style={[styles.button, styles.cancelButton]}
                                        onPress={doCancel}
                                        disabled={cancelLoading}
                                    >
                                        {cancelLoading ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <>
                                                <Ionicons name="close-circle" size={18} color="#fff" />
                                                <Text style={styles.buttonText}>
                                                    {t("common.cancel")}
                                                </Text>
                                            </>
                                        )}
                                    </Pressable>
                                ) : (
                                    <Pressable
                                        style={[styles.button, styles.startButton]}
                                        onPress={doTrigger}
                                        disabled={triggerLoading}
                                    >
                                        {triggerLoading ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <>
                                                <Ionicons name="search" size={18} color="#fff" />
                                                <Text style={styles.buttonText}>
                                                    {t("competitorResearch.startAnalysis")}
                                                </Text>
                                            </>
                                        )}
                                    </Pressable>
                                )}
                            </View>

                            {isRunning && activeRun && (
                                <View style={styles.progressSection}>
                                    <SupervisorProgressView
                                        status={activeRun.status}
                                        elapsedSeconds={elapsedSeconds}
                                        dimensionProgress={dimensionProgress}
                                        analyzingLabel={t("competitorResearch.analyzing")}
                                    />
                                </View>
                            )}
                        </ItemGroup>

                        {/* Reports — compact cards */}
                        {completedRuns.length > 0 && (
                            <ItemGroup title={t("competitorResearch.reportHistory")}>
                                {completedRuns.map((run, index) => (
                                    <Pressable
                                        key={run.id}
                                        style={[
                                            styles.reportCard,
                                            index < completedRuns.length - 1 && styles.reportCardBorder,
                                        ]}
                                        onPress={() => setReportModalRun(run)}
                                    >
                                        <View style={styles.reportCardContent}>
                                            <Text
                                                style={[styles.reportCardTitle, { color: theme.colors.text }]}
                                                numberOfLines={1}
                                            >
                                                {run.reportTitle ?? t("competitorResearch.untitledReport")}
                                            </Text>
                                            <View style={styles.reportCardMeta}>
                                                <Text style={[styles.reportCardDate, { color: theme.colors.textSecondary }]}>
                                                    {new Date(run.completedAt!).toLocaleString()}
                                                </Text>
                                                {run.actionsCount > 0 && (
                                                    <View style={[styles.actionsBadge, { backgroundColor: theme.colors.header.tint + "20" }]}>
                                                        <Text style={[styles.actionsBadgeText, { color: theme.colors.header.tint }]}>
                                                            {run.actionsCount} actions
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        <Ionicons
                                            name="chevron-forward"
                                            size={18}
                                            color={theme.colors.textSecondary}
                                        />
                                    </Pressable>
                                ))}
                            </ItemGroup>
                        )}

                        {/* Empty state */}
                        {!isRunning && completedRuns.length === 0 && (
                            <View style={styles.emptyState}>
                                <Ionicons
                                    name="analytics-outline"
                                    size={48}
                                    color={theme.colors.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.emptyText,
                                        { color: theme.colors.textSecondary },
                                    ]}
                                >
                                    {t("competitorResearch.noReports")}
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>

                {/* Full-screen report modal */}
                <RNModal
                    visible={reportModalRun !== null}
                    animationType="slide"
                    presentationStyle="pageSheet"
                    onRequestClose={() => setReportModalRun(null)}
                >
                    <View style={[styles.modalContainer, { backgroundColor: theme.colors.groupped.background }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: theme.colors.divider }]}>
                            <Text
                                style={[styles.modalTitle, { color: theme.colors.text }]}
                                numberOfLines={1}
                            >
                                {reportModalRun?.reportTitle ?? t("competitorResearch.reportDetail")}
                            </Text>
                            <Pressable
                                onPress={() => setReportModalRun(null)}
                                style={styles.modalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={theme.colors.text} />
                            </Pressable>
                        </View>
                        <ScrollView
                            style={styles.modalScroll}
                            contentContainerStyle={styles.modalScrollContent}
                        >
                            {reportModalRun?.reportContent && (
                                <MarkdownView markdown={reportModalRun.reportContent} />
                            )}
                        </ScrollView>
                    </View>
                </RNModal>
            </>
        );
    },
);

// --- Sync Status Header ---

const SyncStatusHeader = React.memo(
    ({ title, syncStatus }: { title: string; syncStatus: ResearchSyncStatus }) => {
        const { theme } = useUnistyles();

        const statusLabel = syncStatus === "saving"
            ? t("competitorResearch.syncSaving")
            : syncStatus === "saved"
                ? t("competitorResearch.syncSaved")
                : syncStatus === "failed"
                    ? t("competitorResearch.syncFailed")
                    : null;

        const statusColor = syncStatus === "failed"
            ? theme.colors.deleteAction
            : syncStatus === "saved"
                ? theme.colors.header.tint
                : theme.colors.textSecondary;

        return (
            <View style={styles.syncHeaderRow}>
                <Text style={[styles.syncHeaderTitle, { color: theme.colors.groupped.sectionTitle }]}>
                    {title}
                </Text>
                {statusLabel && (
                    <View style={styles.syncStatusContainer}>
                        {syncStatus === "saving" && (
                            <ActivityIndicator size={10} color={statusColor} />
                        )}
                        {syncStatus === "saved" && (
                            <Ionicons name="checkmark-circle" size={12} color={statusColor} />
                        )}
                        {syncStatus === "failed" && (
                            <Ionicons name="alert-circle" size={12} color={statusColor} />
                        )}
                        <Text style={[styles.syncStatusText, { color: statusColor }]}>
                            {statusLabel}
                        </Text>
                    </View>
                )}
            </View>
        );
    },
);

// --- Dimension Toggle ---

interface DimensionToggleProps {
    label: string;
    subtitle: string;
    value: boolean;
    onToggle: () => void;
    disabled?: boolean;
}

const DimensionToggle = React.memo(
    ({ label, subtitle, value, onToggle, disabled }: DimensionToggleProps) => {
        const { theme } = useUnistyles();

        return (
            <View style={styles.toggleRow}>
                <View style={styles.toggleRowContent}>
                    <Text style={[styles.toggleRowLabel, { color: theme.colors.text }]}>
                        {label}
                    </Text>
                    <Text style={[styles.toggleRowSubtitle, { color: theme.colors.textSecondary }]}>
                        {subtitle}
                    </Text>
                </View>
                <Switch
                    value={value}
                    onValueChange={onToggle}
                    disabled={disabled}
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
    container: {
        flex: 1,
    },
    contentContainer: {
        paddingBottom: 32,
    },
    innerContainer: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        gap: 8,
    },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    inputSection: {
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    inputLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    dimensionHeader: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 14,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginTop: 4,
        minHeight: 44,
        textAlignVertical: "top",
    },
    buttonRow: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    button: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        borderRadius: 8,
        gap: 6,
    },
    startButton: {
        backgroundColor: theme.colors.header.tint,
    },
    cancelButton: {
        backgroundColor: theme.colors.deleteAction,
    },
    buttonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: "#fff",
    },
    progressSection: {
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    reportCard: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    reportCardBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    reportCardContent: {
        flex: 1,
        gap: 4,
    },
    reportCardTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    reportCardMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    reportCardDate: {
        ...Typography.default(),
        fontSize: 12,
    },
    actionsBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },
    actionsBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    emptyState: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 48,
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 15,
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
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
    },
    toggleRowSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        marginTop: 2,
    },
    modalContainer: {
        flex: 1,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 17,
        flex: 1,
        marginRight: 12,
    },
    modalCloseButton: {
        padding: 4,
    },
    modalScroll: {
        flex: 1,
    },
    modalScrollContent: {
        paddingHorizontal: 16,
        paddingVertical: 16,
        paddingBottom: 48,
    },
    syncHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    syncHeaderTitle: {
        ...Typography.default("regular"),
        fontSize: 13,
        textTransform: "uppercase",
        letterSpacing: -0.08,
    },
    syncStatusContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    syncStatusText: {
        ...Typography.default(),
        fontSize: 11,
    },
}));
