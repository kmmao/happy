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
        const serverId = project.serverId;

        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [loading, setLoading] = React.useState(true);
        const [refreshing, setRefreshing] = React.useState(false);
        const [reportModalRun, setReportModalRun] = React.useState<SupervisorRun | null>(null);

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
        const [customRules, setCustomRules] = React.useState(
            savedPrefs?.customRules ?? "",
        );

        // Persist all research prefs on change
        const prefsRef = React.useRef({ dimensions, knownCompetitors, additionalNotes, customRules });
        prefsRef.current = { dimensions, knownCompetitors, additionalNotes, customRules };

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
                        <ItemGroup title={t("competitorResearch.title")}>
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
}));
