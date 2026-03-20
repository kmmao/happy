import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchLoopDetail,
    type LoopDetail,
    type LoopDetailRun,
    type LoopDetailAction,
} from "@/sync/apiSupervisor";
import { Ionicons } from "@expo/vector-icons";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";

// --- Helpers ---

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(startMs: number, endMs: number | null): string {
    if (!endMs) return "--";
    const seconds = Math.round((endMs - startMs) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

const exitReasonLabels: Record<string, () => string> = {
    max_iterations: () => t("supervisor.loopExit_max_iterations"),
    cost_cap: () => t("supervisor.loopExit_cost_cap"),
    health_target: () => t("supervisor.loopExit_health_target"),
    no_new_actions: () => t("supervisor.loopExit_no_new_actions"),
    consecutive_failures: () => t("supervisor.loopExit_consecutive_failures"),
    user_stopped: () => t("supervisor.loopExit_user_stopped"),
    timeout: () => t("supervisor.loopExit_timeout"),
};

const statusLabels: Record<string, () => string> = {
    completed: () => t("supervisor.loopStatus_completed"),
    failed: () => t("supervisor.loopStatus_failed"),
    stopped: () => t("supervisor.loopStatus_stopped"),
    running: () => t("supervisor.loopStatus_running"),
    paused: () => t("supervisor.loopStatus_paused"),
};

const severityColors: Record<string, string> = {
    critical: "#FF3B30",
    high: "#FF9500",
    medium: "#FFCC00",
    low: "#34C759",
};

// --- Components ---

function MetadataRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
        <View style={metaStyles.row}>
            <Text style={metaStyles.label}>{label}</Text>
            <Text style={[metaStyles.value, valueColor ? { color: valueColor } : undefined]}>
                {value}
            </Text>
        </View>
    );
}

const metaStyles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
    },
    label: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    value: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
}));

function IterationTimeline({ runs }: { runs: LoopDetailRun[] }) {
    const { theme } = useUnistyles();
    return (
        <View style={timelineStyles.container}>
            {runs.map((run, index) => {
                const isLast = index === runs.length - 1;
                const iconColor =
                    run.status === "completed" ? "#34C759" :
                    run.status === "failed" ? "#FF3B30" :
                    run.status === "running" ? theme.colors.header.tint :
                    theme.colors.textSecondary;
                const phaseLabel = run.loopPhase === "analyzing"
                    ? t("supervisor.loopPhase_analyzing")
                    : run.loopPhase === "fixing"
                      ? t("supervisor.loopPhase_fixing")
                      : (run.loopPhase ?? run.trigger);

                return (
                    <View key={run.id} style={timelineStyles.item}>
                        <View style={timelineStyles.dotColumn}>
                            <View style={[timelineStyles.dot, { backgroundColor: iconColor }]} />
                            {!isLast && <View style={[timelineStyles.line, { backgroundColor: theme.colors.divider }]} />}
                        </View>
                        <View style={[timelineStyles.content, !isLast && { paddingBottom: 12 }]}>
                            <View style={timelineStyles.headerRow}>
                                <Text style={timelineStyles.phaseText}>
                                    {run.loopIteration != null ? `#${run.loopIteration} ` : ""}{phaseLabel}
                                </Text>
                                <Text style={timelineStyles.durationText}>
                                    {formatDuration(run.createdAt, run.completedAt)}
                                </Text>
                            </View>
                            <View style={timelineStyles.metaRow}>
                                {run.actionsCount > 0 && (
                                    <Text style={timelineStyles.metaText}>
                                        {t("supervisor.actionsCount", { count: run.actionsCount })}
                                    </Text>
                                )}
                                {run.healthScore != null && (
                                    <Text style={timelineStyles.metaText}>
                                        {t("supervisor.healthScore")}: {run.healthScore}
                                    </Text>
                                )}
                                {run.costUsd != null && run.costUsd > 0 && (
                                    <Text style={timelineStyles.metaText}>
                                        ${run.costUsd.toFixed(4)}
                                    </Text>
                                )}
                            </View>
                            {run.errorMessage && (
                                <Text style={timelineStyles.errorText} numberOfLines={2}>
                                    {run.errorMessage}
                                </Text>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const timelineStyles = StyleSheet.create((theme) => ({
    container: {},
    item: {
        flexDirection: "row",
    },
    dotColumn: {
        alignItems: "center",
        width: 20,
        paddingTop: 4,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    line: {
        width: 2,
        flex: 1,
        marginTop: 2,
    },
    content: {
        flex: 1,
        paddingLeft: 10,
    },
    headerRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    phaseText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
    durationText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    metaRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 2,
    },
    metaText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 11,
        color: "#FF3B30",
        marginTop: 2,
    },
}));

function ActionItem({ action }: { action: LoopDetailAction }) {
    const { theme } = useUnistyles();
    const sevColor = severityColors[action.severity] ?? theme.colors.textSecondary;
    const fixLabel =
        action.fixStatus === "completed" ? t("supervisor.status_completed") :
        action.fixStatus === "failed" ? t("supervisor.status_failed") :
        action.fixStatus === "running" ? t("supervisor.status_running") :
        action.fixStatus === "pending" ? t("supervisor.status_pending") :
        null;

    return (
        <View style={actionStyles.container}>
            <View style={[actionStyles.severityDot, { backgroundColor: sevColor }]} />
            <View style={actionStyles.content}>
                <Text style={actionStyles.title} numberOfLines={2}>{action.title}</Text>
                <View style={actionStyles.metaRow}>
                    <Text style={actionStyles.category}>{action.category}</Text>
                    {action.confidence != null && (
                        <Text style={actionStyles.confidence}>{action.confidence}%</Text>
                    )}
                    {fixLabel && (
                        <Text style={[
                            actionStyles.fixStatus,
                            action.fixStatus === "completed" ? { color: "#34C759" } :
                            action.fixStatus === "failed" ? { color: "#FF3B30" } :
                            undefined,
                        ]}>
                            {fixLabel}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    );
}

const actionStyles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    severityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 5,
    },
    content: {
        flex: 1,
    },
    title: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    metaRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 2,
    },
    category: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    confidence: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    fixStatus: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
}));

// --- Main Screen ---

function SupervisorLoopDetailScreen() {
    const { id, loopId } = useLocalSearchParams<{
        id: string;
        loopId: string;
    }>();
    const navigation = useNavigation();
    const { theme } = useUnistyles();

    const [detail, setDetail] = React.useState<LoopDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                setLoading(true);
                setError(null);
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchLoopDetail(credentials, id, loopId);
                if (!cancelled) setDetail(data);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error ? err.message : t("supervisor.loadLoopError"),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [id, loopId]);

    React.useLayoutEffect(() => {
        const title = detail
            ? formatDate(detail.loop.createdAt)
            : t("supervisor.loopHistory");
        navigation.setOptions({ headerTitle: title });
    }, [navigation, detail]);

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.header.tint} />
            </View>
        );
    }

    if (error || !detail) {
        return (
            <View style={styles.centered}>
                <Text style={styles.errorText}>
                    {error ?? t("supervisor.loadLoopError")}
                </Text>
            </View>
        );
    }

    const { loop, runs, actions } = detail;

    const healthDelta =
        loop.initialHealthScore != null && loop.currentHealthScore != null
            ? loop.currentHealthScore - loop.initialHealthScore
            : null;

    const statusText = statusLabels[loop.status]?.() ?? loop.status;
    const exitText = loop.exitReason
        ? (exitReasonLabels[loop.exitReason]?.() ?? loop.exitReason)
        : null;

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Summary */}
            <ItemGroup title={statusText}>
                <View style={styles.metadataCard}>
                    <MetadataRow
                        label={t("supervisor.loopIteration", { current: loop.currentIteration, max: loop.maxIterations })}
                        value={formatDuration(loop.createdAt, loop.completedAt)}
                    />
                    <MetadataRow
                        label={t("supervisor.loopFound")}
                        value={String(loop.totalActionsFound)}
                    />
                    <MetadataRow
                        label={t("supervisor.loopFixed")}
                        value={String(loop.totalActionsFixed)}
                    />
                    <MetadataRow
                        label={t("supervisor.loopCost")}
                        value={`$${loop.totalCostUsd.toFixed(2)}`}
                    />
                    {healthDelta !== null && (
                        <MetadataRow
                            label={t("supervisor.loopHealthDelta")}
                            value={`${loop.initialHealthScore} → ${loop.currentHealthScore} (${healthDelta > 0 ? "+" : ""}${healthDelta})`}
                            valueColor={
                                healthDelta < 0 ? "#34C759" :
                                healthDelta > 0 ? "#FF3B30" :
                                undefined
                            }
                        />
                    )}
                    <MetadataRow
                        label={t("supervisor.loopConfigThreshold")}
                        value={`${loop.autoApproveThreshold}%`}
                    />
                    {loop.costCapUsd != null && (
                        <MetadataRow
                            label={t("supervisor.loopConfigCostCap")}
                            value={`$${loop.costCapUsd}`}
                        />
                    )}
                    {exitText && (
                        <MetadataRow
                            label={t("supervisor.loopDetailExitReason")}
                            value={exitText}
                        />
                    )}
                </View>
            </ItemGroup>

            {/* Iteration Timeline */}
            {runs.length > 0 && (
                <ItemGroup title={t("supervisor.loopDetailTimeline")}>
                    <View style={styles.timelineContainer}>
                        <IterationTimeline runs={runs} />
                    </View>
                </ItemGroup>
            )}

            {/* Actions */}
            {actions.length > 0 && (
                <ItemGroup title={t("supervisor.loopDetailActions", { count: actions.length })}>
                    {actions.map((action) => (
                        <ActionItem key={action.id} action={action} />
                    ))}
                </ItemGroup>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 40,
        maxWidth: layout.maxWidth,
    },
    centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 14,
        color: "#FF3B30",
        textAlign: "center" as const,
    },
    metadataCard: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    timelineContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
}));

export default React.memo(SupervisorLoopDetailScreen);
