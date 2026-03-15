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
import { useRouter } from "expo-router";
import {
    loadResearchPrefs,
    saveResearchPrefs,
} from "@/sync/persistence";

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

interface ProjectResearchTabProps {
    project: Project;
}

export const ProjectResearchTab = React.memo(
    ({ project }: ProjectResearchTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const serverId = project.serverId;

        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [loading, setLoading] = React.useState(true);
        const [refreshing, setRefreshing] = React.useState(false);

        // Input fields — load saved preferences
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

        // Persist all research prefs on change
        const prefsRef = React.useRef({ dimensions, knownCompetitors, additionalNotes });
        prefsRef.current = { dimensions, knownCompetitors, additionalNotes };

        const persistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

        const debouncedPersist = React.useCallback(() => {
            if (persistTimerRef.current) {
                clearTimeout(persistTimerRef.current);
            }
            persistTimerRef.current = setTimeout(() => {
                if (serverId) {
                    saveResearchPrefs(serverId, prefsRef.current);
                }
            }, 500);
        }, [serverId]);

        // Flush on unmount
        React.useEffect(() => {
            return () => {
                if (persistTimerRef.current) {
                    clearTimeout(persistTimerRef.current);
                    if (serverId) {
                        saveResearchPrefs(serverId, prefsRef.current);
                    }
                }
            };
        }, [serverId]);

        // Active run tracking
        const activeRun = React.useMemo(
            () => runs.find((r) => r.status === "pending" || r.status === "running"),
            [runs],
        );

        // Latest completed report
        const latestReport = React.useMemo(
            () => runs.find((r) => r.status === "completed" && r.reportContent),
            [runs],
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

        // Listen for supervisor status changes
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                if (
                    event.status === "completed" ||
                    event.status === "failed" ||
                    event.status === "cancelled"
                ) {
                    loadData();
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        const toggleDimension = React.useCallback(
            (key: ResearchDimension) => {
                setDimensions((prev) => {
                    const next = { ...prev, [key]: !prev[key] };
                    prefsRef.current = { ...prefsRef.current, dimensions: next };
                    if (serverId) {
                        saveResearchPrefs(serverId, prefsRef.current);
                    }
                    return next;
                });
            },
            [serverId],
        );

        const handleKnownCompetitorsChange = React.useCallback(
            (text: string) => {
                setKnownCompetitors(text);
                prefsRef.current = { ...prefsRef.current, knownCompetitors: text };
                debouncedPersist();
            },
            [debouncedPersist],
        );

        const handleAdditionalNotesChange = React.useCallback(
            (text: string) => {
                setAdditionalNotes(text);
                prefsRef.current = { ...prefsRef.current, additionalNotes: text };
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
                            additionalNotes: additionalNotes.trim() || undefined,
                        },
                    });
                    setRuns((prev) => [run, ...prev]);
                } catch (e) {
                    if (e instanceof SupervisorAlreadyRunningError) {
                        loadData();
                    }
                    throw e;
                }
            }, [serverId, knownCompetitors, selectedDimensions, additionalNotes, loadData]),
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
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.contentContainer}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                <View style={styles.innerContainer}>
                    {/* Trigger Section */}
                    <ItemGroup
                        title={t("competitorResearch.title")}
                    >
                        <View style={styles.inputSection}>
                            <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                                {t("competitorResearch.knownCompetitors")}
                            </Text>
                            <TextInput
                                style={[
                                    styles.textInput,
                                    {
                                        color: theme.colors.text,
                                        backgroundColor: theme.colors.surface,
                                        borderColor: theme.colors.divider,
                                    },
                                ]}
                                placeholder={t("competitorResearch.knownCompetitorsPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={knownCompetitors}
                                onChangeText={handleKnownCompetitorsChange}
                                multiline
                                numberOfLines={2}
                                editable={!isRunning}
                            />
                        </View>
                    </ItemGroup>

                    {/* Analysis Dimensions */}
                    <ItemGroup title={t("competitorResearch.dimensionsSection")}>
                        {RESEARCH_DIMENSIONS.map((dim, index) => (
                            <DimensionToggle
                                key={dim}
                                label={DIMENSION_LABELS[dim].label()}
                                subtitle={DIMENSION_LABELS[dim].note()}
                                value={dimensions[dim]}
                                onToggle={() => toggleDimension(dim)}
                                isLast={index === RESEARCH_DIMENSIONS.length - 1}
                                disabled={isRunning}
                            />
                        ))}
                    </ItemGroup>

                    {/* Additional Notes */}
                    <ItemGroup title={t("competitorResearch.additionalNotes")}>
                        <View style={styles.inputSection}>
                            <TextInput
                                style={[
                                    styles.textInput,
                                    {
                                        color: theme.colors.text,
                                        backgroundColor: theme.colors.surface,
                                        borderColor: theme.colors.divider,
                                    },
                                ]}
                                placeholder={t("competitorResearch.additionalNotesPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={additionalNotes}
                                onChangeText={handleAdditionalNotesChange}
                                multiline
                                numberOfLines={2}
                                editable={!isRunning}
                            />
                        </View>

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
                                            <Ionicons
                                                name="close-circle"
                                                size={18}
                                                color="#fff"
                                            />
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

                        {isRunning && (
                            <View style={styles.runningIndicator}>
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.header.tint}
                                />
                                <Text
                                    style={[
                                        styles.runningText,
                                        { color: theme.colors.textSecondary },
                                    ]}
                                >
                                    {t("competitorResearch.analyzing")}
                                </Text>
                            </View>
                        )}
                    </ItemGroup>

                    {/* Latest Report */}
                    {latestReport && (
                        <ItemGroup title={latestReport.reportTitle ?? t("competitorResearch.latestReport")}>
                            <View style={styles.reportContainer}>
                                <MarkdownView markdown={latestReport.reportContent!} />
                            </View>
                            <Text
                                style={[
                                    styles.reportDate,
                                    { color: theme.colors.textSecondary },
                                ]}
                            >
                                {new Date(latestReport.completedAt!).toLocaleString()}
                            </Text>
                        </ItemGroup>
                    )}

                    {/* History */}
                    {completedRuns.length > 1 && (
                        <ItemGroup title={t("competitorResearch.reportHistory")}>
                            {completedRuns.slice(1).map((run) => (
                                <Pressable
                                    key={run.id}
                                    style={styles.historyItem}
                                    onPress={() =>
                                        router.push(
                                            `/project/${project.serverId}/research-report/${run.id}`,
                                        )
                                    }
                                >
                                    <View style={styles.historyItemContent}>
                                        <Text
                                            style={[
                                                styles.historyTitle,
                                                { color: theme.colors.text },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {run.reportTitle ?? t("competitorResearch.untitledReport")}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.historyDate,
                                                { color: theme.colors.textSecondary },
                                            ]}
                                        >
                                            {new Date(run.completedAt!).toLocaleDateString()}
                                        </Text>
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
        );
    },
);

// --- Dimension Toggle ---

interface DimensionToggleProps {
    label: string;
    subtitle: string;
    value: boolean;
    onToggle: () => void;
    isLast?: boolean;
    disabled?: boolean;
}

const DimensionToggle = React.memo(
    ({ label, subtitle, value, onToggle, isLast, disabled }: DimensionToggleProps) => {
        const { theme } = useUnistyles();

        return (
            <View
                style={[
                    styles.toggleRow,
                    !isLast && styles.toggleRowBorder,
                ]}
            >
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
    runningIndicator: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingBottom: 12,
        gap: 8,
    },
    runningText: {
        ...Typography.default(),
        fontSize: 13,
    },
    reportContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
    },
    reportDate: {
        ...Typography.default(),
        fontSize: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    historyItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    historyItemContent: {
        flex: 1,
        gap: 2,
    },
    historyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
    },
    historyDate: {
        ...Typography.default(),
        fontSize: 12,
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
    },
    toggleRowSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        marginTop: 2,
    },
}));
