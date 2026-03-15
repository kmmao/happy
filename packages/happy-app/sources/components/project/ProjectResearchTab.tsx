import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    TextInput,
    RefreshControl,
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

        // Input fields
        const [knownCompetitors, setKnownCompetitors] = React.useState("");
        const [focusAreas, setFocusAreas] = React.useState("");

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
                            focusAreas: focusAreas.trim() || undefined,
                        },
                    });
                    setRuns((prev) => [run, ...prev]);
                } catch (e) {
                    if (e instanceof SupervisorAlreadyRunningError) {
                        loadData();
                    }
                    throw e;
                }
            }, [serverId, knownCompetitors, focusAreas, loadData]),
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
                                onChangeText={setKnownCompetitors}
                                multiline
                                numberOfLines={2}
                                editable={!isRunning}
                            />

                            <Text
                                style={[
                                    styles.inputLabel,
                                    styles.inputLabelSpaced,
                                    { color: theme.colors.text },
                                ]}
                            >
                                {t("competitorResearch.focusAreas")}
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
                                placeholder={t("competitorResearch.focusAreasPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={focusAreas}
                                onChangeText={setFocusAreas}
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
    inputLabelSpaced: {
        marginTop: 12,
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
}));
