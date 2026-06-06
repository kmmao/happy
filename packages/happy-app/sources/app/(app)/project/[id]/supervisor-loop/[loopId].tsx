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
import { screenLayoutMaxWidth } from "@/components/layout";
import { useProject } from "@/hooks/useProjects";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";

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

// Mirror of supervisorLoopBrief.composeSummary on the server so the brief
// card renders identically whether or not the live ephemeral was observed.
// If the formats diverge, the live ephemeral's `summary` field wins (the
// listener overwrites this with a toast and a fetched detail refresh).
function buildBriefSummaryLine(params: {
    currentIteration: number;
    maxIterations: number;
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    healthDelta: number | null;
    totalActionsFound: number;
    totalActionsFixed: number;
    totalCostUsd: number;
    exitReason: string | null;
}): string {
    const parts: string[] = [];

    if (params.healthDelta != null && params.initialHealthScore != null && params.currentHealthScore != null) {
        const arrow = params.healthDelta < 0 ? "↓" : params.healthDelta > 0 ? "↑" : "→";
        parts.push(`Health ${params.initialHealthScore}${arrow}${params.currentHealthScore}`);
    }
    if (params.totalActionsFixed > 0) {
        parts.push(`fixed ${params.totalActionsFixed}`);
    }
    const pending = params.totalActionsFound - params.totalActionsFixed;
    if (pending > 0) {
        parts.push(`pending ${pending}`);
    }
    if (params.totalCostUsd > 0) {
        parts.push(`$${params.totalCostUsd.toFixed(2)}`);
    }
    const stats = parts.length > 0 ? parts.join(", ") : "no changes";
    const itersLabel = params.maxIterations > 0
        ? `${params.currentIteration}/${params.maxIterations} iters`
        : `${params.currentIteration} iters`;
    const reason = params.exitReason ? ` — ${params.exitReason}` : "";
    return `Loop done (${itersLabel}): ${stats}${reason}`;
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

const metaStyles = StyleSheet.create((theme, rt) => ({
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

const timelineStyles = StyleSheet.create((theme, rt) => ({
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

const actionStyles = StyleSheet.create((theme, rt) => ({
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
    const project = useProject(id);
    const navigation = useNavigation();
    const { theme } = useUnistyles();

    const [detail, setDetail] = React.useState<LoopDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const waitingForProject = Boolean(id && !project?.serverId);

    React.useEffect(() => {
        let cancelled = false;

        async function load() {
            if (waitingForProject) {
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const credentials = await TokenStorage.getCredentials();
                const projectServerId = project?.serverId;
                if (!credentials || cancelled || !projectServerId) return;
                const data = await fetchLoopDetail(credentials, projectServerId, loopId);
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
    }, [id, project?.serverId, loopId, waitingForProject]);

    // Subscribe to brief ephemeral (ADR-0022 cherry-pick): when this loop
    // completes (or completion is observed live), refresh detail so the
    // "Latest Brief" card reflects the final state, and surface the summary
    // as a toast so the completion is noticeable even if the user is
    // scrolled past the summary card.
    React.useEffect(() => {
        if (!loopId) return;
        return sync.onSupervisorLoopBrief(async (event) => {
            if (event.loopId !== loopId) return;
            Modal.toast(event.summary);
            try {
                const credentials = await TokenStorage.getCredentials();
                const projectServerId = project?.serverId;
                if (!credentials || !projectServerId) return;
                const data = await fetchLoopDetail(credentials, projectServerId, loopId);
                setDetail(data);
            } catch {
                // best-effort refresh; the toast already conveyed the event
            }
        });
    }, [loopId, project?.serverId]);

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

    // Terminal loops show a "Latest Brief" card — a post-mortem digest of
    // exit reason, health movement, action throughput, and cost. Computed
    // locally from loop fields so it's available regardless of whether the
    // brief ephemeral arrived in this session (matches what the server
    // composes in supervisorLoopBrief.ts).
    const isTerminal = loop.status === "completed" || loop.status === "failed" || loop.status === "stopped";
    const briefLine = isTerminal
        ? buildBriefSummaryLine({
            currentIteration: loop.currentIteration,
            maxIterations: loop.maxIterations,
            initialHealthScore: loop.initialHealthScore,
            currentHealthScore: loop.currentHealthScore,
            healthDelta,
            totalActionsFound: loop.totalActionsFound,
            totalActionsFixed: loop.totalActionsFixed,
            totalCostUsd: loop.totalCostUsd,
            exitReason: loop.exitReason,
        })
        : null;

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Latest Brief (ADR-0022) — terminal loops only */}
            {briefLine && (
                <ItemGroup title={t("supervisor.loopBriefTitle")}>
                    <View style={styles.briefCard}>
                        <View style={styles.briefHeaderRow}>
                            <Ionicons
                                name="sparkles-outline"
                                size={18}
                                color={theme.colors.textLink}
                            />
                            <Text style={styles.briefHeaderText}>
                                {t("supervisor.loopBriefHeader", {
                                    completedAt: loop.completedAt
                                        ? formatDate(loop.completedAt)
                                        : "",
                                })}
                            </Text>
                        </View>
                        <Text style={styles.briefSummary} selectable>
                            {briefLine}
                        </Text>
                        <Text style={styles.briefHint}>
                            {t("supervisor.loopBriefHint")}
                        </Text>
                    </View>
                </ItemGroup>
            )}

            {/* Summary */}
            <ItemGroup title={statusText}>
                <View style={styles.metadataCard}>
                    <MetadataRow
                        label={loop.maxIterations > 0
                            ? t("supervisor.loopIteration", { current: loop.currentIteration, max: loop.maxIterations })
                            : t("supervisor.loopIterationUnlimited", { current: loop.currentIteration })}
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
            <ItemGroup title={t("supervisor.loopDetailTimeline")}>
                {runs.length > 0 ? (
                    <View style={styles.timelineContainer}>
                        <IterationTimeline runs={runs} />
                    </View>
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateText}>
                            {t("supervisor.loopDetailNoRuns")}
                        </Text>
                    </View>
                )}
            </ItemGroup>

            {/* Actions */}
            <ItemGroup title={t("supervisor.loopDetailActions", { count: actions.length })}>
                {actions.length > 0 ? (
                    actions.map((action) => (
                        <ActionItem key={action.id} action={action} />
                    ))
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateText}>
                            {t("supervisor.loopDetailNoActions")}
                        </Text>
                    </View>
                )}
            </ItemGroup>
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme, rt) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 40,
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
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
    briefCard: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
    },
    briefHeaderRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    briefHeaderText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    briefSummary: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        lineHeight: 22,
    },
    briefHint: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    timelineContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    emptyState: {
        paddingHorizontal: 16,
        paddingVertical: 24,
        alignItems: "center" as const,
    },
    emptyStateText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
    },
}));

export default React.memo(SupervisorLoopDetailScreen);
