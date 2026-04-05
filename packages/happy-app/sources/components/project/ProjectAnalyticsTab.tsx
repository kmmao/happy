import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { ItemGroup } from "@/components/ItemGroup";
import { UsageChart } from "@/components/usage/UsageChart";
import { UsageBar } from "@/components/usage/UsageBar";
import {
    getUsageForPeriod,
    calculateTotals,
    type UsageDataPoint,
} from "@/sync/apiUsage";
import {
    fetchSupervisorCost,
    fetchSupervisorRuns,
    type SupervisorCostSummary,
    type SupervisorRun,
} from "@/sync/apiSupervisor";
import { DayRangeSelector } from "./DayRangeSelector";
import { formatModelName } from "@/components/modelModeOptions";
import { log } from "@/log";

interface ProjectAnalyticsTabProps {
    project: Project;
}

type UsagePeriod = "7days" | "30days";

function formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(2)}M`;
    } else if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toLocaleString();
}

function formatCost(cost: number): string {
    return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}

export const ProjectAnalyticsTab = React.memo(
    ({ project }: ProjectAnalyticsTabProps) => {
        const { theme } = useUnistyles();
        const serverId = project.serverId;

        // Usage data state
        const [usagePeriod, setUsagePeriod] = React.useState<UsagePeriod>("7days");
        const [usageData, setUsageData] = React.useState<UsageDataPoint[]>([]);
        const [totals, setTotals] = React.useState({
            totalTokens: 0,
            totalCost: 0,
            tokensByType: {} as Record<string, number>,
            tokensByModel: {} as Record<string, number>,
            costByType: {} as Record<string, number>,
            costByModel: {} as Record<string, number>,
        });
        const [usageLoading, setUsageLoading] = React.useState(false);

        // Supervisor data state
        const [costSummary, setCostSummary] = React.useState<SupervisorCostSummary | null>(null);
        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [supervisorDays, setSupervisorDays] = React.useState(30);
        const supervisorDaysRef = React.useRef(30);
        const [supervisorLoading, setSupervisorLoading] = React.useState(false);

        const [loaded, setLoaded] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);

        // Load usage data
        const loadUsageData = React.useCallback(async (period: UsagePeriod) => {
            setUsageLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const response = await getUsageForPeriod(credentials, period);
                setUsageData(response.usage || []);
                setTotals(calculateTotals(response.usage || []));
            } catch (err) {
                log.error("Failed to load usage data:", err);
            } finally {
                setUsageLoading(false);
            }
        }, []);

        // Load supervisor data
        const loadSupervisorData = React.useCallback(async (days: number) => {
            if (!serverId) return;
            setSupervisorLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [costResult, runsResult] = await Promise.all([
                    fetchSupervisorCost(credentials, serverId, days).catch(() => null),
                    fetchSupervisorRuns(credentials, serverId, { limit: 100 }).catch(() => ({ runs: [], total: 0 })),
                ]);
                setCostSummary(costResult);
                setRuns(runsResult.runs);
            } catch (err) {
                log.error("Failed to load supervisor data:", err);
            } finally {
                setSupervisorLoading(false);
            }
        }, [serverId]);

        // Initial load
        React.useEffect(() => {
            const load = async () => {
                await Promise.all([
                    loadUsageData(usagePeriod),
                    loadSupervisorData(supervisorDaysRef.current),
                ]);
                setLoaded(true);
            };
            load();
        }, [loadUsageData, loadSupervisorData, usagePeriod]);

        // Handle usage period change
        const handleUsagePeriodChange = React.useCallback((period: UsagePeriod) => {
            setUsagePeriod(period);
        }, []);

        // Handle supervisor days change
        const handleSupervisorDaysChange = React.useCallback(async (days: number) => {
            setSupervisorDays(days);
            supervisorDaysRef.current = days;
            await loadSupervisorData(days);
        }, [loadSupervisorData]);

        const onRefresh = React.useCallback(async () => {
            setRefreshing(true);
            await Promise.all([
                loadUsageData(usagePeriod),
                loadSupervisorData(supervisorDaysRef.current),
            ]);
            setRefreshing(false);
        }, [loadUsageData, loadSupervisorData, usagePeriod]);

        // Compute efficiency metrics from runs
        const efficiency = React.useMemo(() => {
            const completedRuns = runs.filter((r) => r.status === "completed");
            const failedRuns = runs.filter((r) => r.status === "failed");
            const totalFinished = completedRuns.length + failedRuns.length;
            const completionRate = totalFinished > 0
                ? (completedRuns.length / totalFinished) * 100
                : 0;

            // Average duration for completed runs
            const durations = completedRuns
                .filter((r) => r.completedAt && r.createdAt)
                .map((r) => (r.completedAt! - r.createdAt) * 1000); // convert to ms
            const avgDuration = durations.length > 0
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0;

            // Average cost per run
            const costs = completedRuns
                .filter((r) => r.costUsd != null)
                .map((r) => r.costUsd!);
            const avgCost = costs.length > 0
                ? costs.reduce((a, b) => a + b, 0) / costs.length
                : 0;

            // Average tokens per run
            const tokens = completedRuns
                .filter((r) => r.tokenCount != null)
                .map((r) => r.tokenCount!);
            const avgTokens = tokens.length > 0
                ? tokens.reduce((a, b) => a + b, 0) / tokens.length
                : 0;

            return {
                totalRuns: runs.length,
                completedRuns: completedRuns.length,
                failedRuns: failedRuns.length,
                completionRate,
                avgDuration,
                avgCost,
                avgTokens,
            };
        }, [runs]);

        // Model breakdown
        const costModels = React.useMemo(() =>
            Object.entries(totals.costByModel)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5),
            [totals.costByModel],
        );
        const maxModelCost = React.useMemo(() =>
            Math.max(...Object.values(totals.costByModel), 0.0001),
            [totals.costByModel],
        );

        const tokenModels = React.useMemo(() =>
            Object.entries(totals.tokensByModel)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5),
            [totals.tokensByModel],
        );
        const maxModelTokens = React.useMemo(() =>
            Math.max(...Object.values(totals.tokensByModel), 1),
            [totals.tokensByModel],
        );

        if (!loaded) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.header.tint} />
                </View>
            );
        }

        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {/* Usage Overview */}
                <ItemGroup title={t("analytics.usageOverview")}>
                    <View style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <View style={styles.summaryItem}>
                                <Ionicons name="server-outline" size={20} color="#007AFF" />
                                <Text style={styles.summaryValue}>{formatTokens(totals.totalTokens)}</Text>
                                <Text style={styles.summaryLabel}>{t("analytics.totalTokens")}</Text>
                            </View>
                            <View style={styles.summaryDivider} />
                            <View style={styles.summaryItem}>
                                <Ionicons name="card-outline" size={20} color="#FF9500" />
                                <Text style={styles.summaryValue}>{formatCost(totals.totalCost)}</Text>
                                <Text style={styles.summaryLabel}>{t("analytics.totalCost")}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Period selector for usage */}
                    <View style={styles.periodRow}>
                        {(["7days", "30days"] as UsagePeriod[]).map((p) => (
                            <View
                                key={p}
                                style={[
                                    styles.periodChip,
                                    usagePeriod === p && {
                                        backgroundColor: theme.dark
                                            ? theme.colors.accentPurple
                                            : theme.colors.header.tint,
                                    },
                                ]}
                            >
                                <Text
                                    style={[styles.periodText, usagePeriod === p && styles.periodTextActive]}
                                    onPress={() => handleUsagePeriodChange(p)}
                                >
                                    {p === "7days" ? t("analytics.last7Days") : t("analytics.last30Days")}
                                </Text>
                            </View>
                        ))}
                        {usageLoading && (
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        )}
                    </View>
                </ItemGroup>

                {/* Token Usage Trend */}
                {usageData.length > 0 && (
                    <ItemGroup title={t("analytics.tokenTrend")}>
                        <UsageChart
                            data={usageData}
                            metric="tokens"
                            groupBy="day"
                            height={160}
                        />
                    </ItemGroup>
                )}

                {/* Cost Trend */}
                {usageData.length > 0 && (
                    <ItemGroup title={t("analytics.costTrend")}>
                        <UsageChart
                            data={usageData}
                            metric="cost"
                            groupBy="day"
                            height={160}
                        />
                    </ItemGroup>
                )}

                {/* Cost by Model */}
                {costModels.length > 0 && (
                    <ItemGroup title={t("analytics.costByModel")}>
                        <View style={styles.breakdownContent}>
                            {costModels.map(([model, value]) => (
                                <UsageBar
                                    key={model}
                                    label={formatModelName(model)}
                                    value={value}
                                    maxValue={maxModelCost}
                                    color="#FF9500"
                                    formatValue={(v) => formatCost(v)}
                                />
                            ))}
                        </View>
                    </ItemGroup>
                )}

                {/* Tokens by Model */}
                {tokenModels.length > 0 && (
                    <ItemGroup title={t("analytics.tokensByModel")}>
                        <View style={styles.breakdownContent}>
                            {tokenModels.map(([model, value]) => (
                                <UsageBar
                                    key={model}
                                    label={formatModelName(model)}
                                    value={value}
                                    maxValue={maxModelTokens}
                                    color="#007AFF"
                                    formatValue={(v) => formatTokens(v)}
                                />
                            ))}
                        </View>
                    </ItemGroup>
                )}

                {/* Supervisor Efficiency */}
                {serverId && (
                    <>
                        <DayRangeSelector
                            selectedDays={supervisorDays}
                            loading={supervisorLoading}
                            onDaysChange={handleSupervisorDaysChange}
                        />

                        {/* Supervisor Cost */}
                        {costSummary && costSummary.runsCount > 0 && (
                            <ItemGroup title={t("analytics.supervisorCost")}>
                                <View style={styles.summaryCard}>
                                    <View style={styles.summaryRow}>
                                        <View style={styles.summaryItem}>
                                            <Ionicons name="flash-outline" size={20} color="#34C759" />
                                            <Text style={styles.summaryValue}>{costSummary.runsCount}</Text>
                                            <Text style={styles.summaryLabel}>{t("analytics.totalRuns")}</Text>
                                        </View>
                                        <View style={styles.summaryDivider} />
                                        <View style={styles.summaryItem}>
                                            <Ionicons name="server-outline" size={20} color="#007AFF" />
                                            <Text style={styles.summaryValue}>{formatTokens(costSummary.totalTokens)}</Text>
                                            <Text style={styles.summaryLabel}>{t("analytics.totalTokens")}</Text>
                                        </View>
                                        <View style={styles.summaryDivider} />
                                        <View style={styles.summaryItem}>
                                            <Ionicons name="card-outline" size={20} color="#FF9500" />
                                            <Text style={styles.summaryValue}>{formatCost(costSummary.totalCostUsd)}</Text>
                                            <Text style={styles.summaryLabel}>{t("analytics.totalCost")}</Text>
                                        </View>
                                    </View>
                                </View>
                            </ItemGroup>
                        )}

                        {/* Agent Efficiency Metrics */}
                        {efficiency.totalRuns > 0 && (
                            <ItemGroup title={t("analytics.agentEfficiency")}>
                                <View style={styles.metricsGrid}>
                                    <View style={styles.metricCard}>
                                        <View style={[styles.metricIconWrap, { backgroundColor: "#34C75918" }]}>
                                            <Ionicons name="checkmark-circle-outline" size={20} color="#34C759" />
                                        </View>
                                        <Text style={styles.metricValue}>{`${efficiency.completionRate.toFixed(0)}%`}</Text>
                                        <Text style={styles.metricLabel}>{t("analytics.completionRate")}</Text>
                                    </View>
                                    <View style={styles.metricCard}>
                                        <View style={[styles.metricIconWrap, { backgroundColor: "#007AFF18" }]}>
                                            <Ionicons name="time-outline" size={20} color="#007AFF" />
                                        </View>
                                        <Text style={styles.metricValue}>
                                            {efficiency.avgDuration > 0 ? formatDuration(efficiency.avgDuration) : "-"}
                                        </Text>
                                        <Text style={styles.metricLabel}>{t("analytics.avgDuration")}</Text>
                                    </View>
                                    <View style={styles.metricCard}>
                                        <View style={[styles.metricIconWrap, { backgroundColor: "#FF950018" }]}>
                                            <Ionicons name="wallet-outline" size={20} color="#FF9500" />
                                        </View>
                                        <Text style={styles.metricValue}>
                                            {efficiency.avgCost > 0 ? formatCost(efficiency.avgCost) : "-"}
                                        </Text>
                                        <Text style={styles.metricLabel}>{t("analytics.avgCostPerRun")}</Text>
                                    </View>
                                    <View style={styles.metricCard}>
                                        <View style={[styles.metricIconWrap, { backgroundColor: "#AF52DE18" }]}>
                                            <Ionicons name="analytics-outline" size={20} color="#AF52DE" />
                                        </View>
                                        <Text style={styles.metricValue}>
                                            {efficiency.avgTokens > 0 ? formatTokens(efficiency.avgTokens) : "-"}
                                        </Text>
                                        <Text style={styles.metricLabel}>{t("analytics.avgTokensPerRun")}</Text>
                                    </View>
                                </View>

                                {/* Run status breakdown */}
                                <View style={styles.statusRow}>
                                    <View style={[styles.statusDot, { backgroundColor: "#34C759" }]} />
                                    <Text style={styles.statusText}>
                                        {t("analytics.completed")}: {efficiency.completedRuns}
                                    </Text>
                                    <View style={[styles.statusDot, { backgroundColor: "#FF3B30", marginLeft: 16 }]} />
                                    <Text style={styles.statusText}>
                                        {t("analytics.failed")}: {efficiency.failedRuns}
                                    </Text>
                                </View>
                            </ItemGroup>
                        )}
                    </>
                )}

                {/* Empty state */}
                {!usageData.length && !costSummary && (
                    <View style={styles.emptyContainer}>
                        <Ionicons
                            name="analytics-outline"
                            size={64}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.emptyTitle}>{t("analytics.noData")}</Text>
                        <Text style={styles.emptySubtitle}>{t("analytics.noDataSubtitle")}</Text>
                    </View>
                )}
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 32,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
    },
    summaryCard: {
        padding: 16,
    },
    summaryRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    summaryItem: {
        flex: 1,
        alignItems: "center",
        gap: 4,
    },
    summaryDivider: {
        width: 1,
        height: 40,
        backgroundColor: theme.colors.divider,
    },
    summaryValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    summaryLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    periodRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    periodChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
    },
    periodText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    periodTextActive: {
        color: "#FFFFFF",
    },
    breakdownContent: {
        padding: 16,
    },
    metricsGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        padding: 12,
        gap: 8,
    },
    metricCard: {
        width: "48%",
        flexGrow: 1,
        alignItems: "center",
        gap: 6,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
    },
    metricIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    metricValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    metricLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    statusText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    emptyContainer: {
        alignItems: "center",
        paddingVertical: 48,
        paddingHorizontal: 32,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
        marginTop: 16,
    },
    emptySubtitle: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 8,
        textAlign: "center",
    },
}));
