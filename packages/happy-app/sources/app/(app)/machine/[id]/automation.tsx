/**
 * Advanced automation page — read-only view of the per-machine
 * daemonState.automation extras that the Workflow IA list doesn't surface
 * (those are user-facing primitives; this page is for ops / power users).
 *
 * Section breakdown:
 *   - Guardian registry: sessions the daemon is keeping warm for the next
 *     trigger fire. Lets ops verify "is the right session bound to this
 *     loop key?"
 *   - Recent automation jobs: last N dispatched/completed/failed jobs
 *     with statuses and timestamps.
 *   - Audit timeline: recent automation events (queue/dispatch/complete/
 *     fail/recover) with kind + correlation ids.
 *   - Audit stats: rollup counters (totals, guardian reuse rate, etc).
 *   - Bootstrap profiles: CLI-side AgentLoopBootstrap configs.
 *   - Auto-dream profiles: per-directory memory consolidation configs.
 *
 * Read-only because most editing for these still happens via CLI commands
 * (`happy bootstrap`, `happy auto-dream` etc.) — surfacing them here
 * closes the visibility loop that was lost when the old machine sub-pages
 * were removed under the Workflow IA migration.
 */

import * as React from "react";
import { View, RefreshControl } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { useMachine } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { t } from "@/text";
import type {
    AgentLoopSummary,
    AutomationGuardianSummary,
    AutomationJobSummary,
    AutomationAuditEventSummary,
    AutomationAuditStats,
    BootstrapProfileSummary,
    AutoDreamProfileSummary,
} from "@kmmao/happy-wire";

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyState: {
        padding: 24,
        alignItems: "center",
        gap: 8,
    },
    emptyStateText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center",
        ...Typography.default(),
    },
}));

function formatTime(ts: number | undefined): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleString();
}

function formatRate(value: number | undefined): string {
    if (value === undefined) return "—";
    return `${Math.round(value * 100)}%`;
}

export default function AdvancedAutomationScreen() {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const machine = useMachine(machineId ?? "");
    const [refreshing, setRefreshing] = React.useState(false);

    const automation = (machine?.daemonState as any)?.automation;

    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await sync.refreshMachines();
        } finally {
            setRefreshing(false);
        }
    }, []);

    if (!machine) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t("advancedAutomation.title") }} />
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>{t("advancedAutomation.machineNotFound")}</Text>
                </View>
            </View>
        );
    }

    if (!automation) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t("advancedAutomation.title") }} />
                <View style={styles.emptyState}>
                    <Ionicons name="cube-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyStateText}>
                        {t("advancedAutomation.noData")}
                    </Text>
                </View>
            </View>
        );
    }

    const recentJobs: AutomationJobSummary[] = Array.isArray(automation.recentJobs)
        ? automation.recentJobs.slice(0, 10)
        : [];
    const guardians: AutomationGuardianSummary[] = Array.isArray(automation.guardians)
        ? automation.guardians
        : [];
    const auditEvents: AutomationAuditEventSummary[] = Array.isArray(automation.recentAuditEvents)
        ? automation.recentAuditEvents.slice(0, 10)
        : [];
    const auditStats: AutomationAuditStats | undefined = automation.auditStats;
    const loops: AgentLoopSummary[] = Array.isArray(automation.loops) ? automation.loops : [];
    const bootstrapProfiles: BootstrapProfileSummary[] = Array.isArray(automation.bootstrapProfiles)
        ? automation.bootstrapProfiles
        : [];
    const autoDreamProfiles: AutoDreamProfileSummary[] = Array.isArray(automation.autoDreamProfiles)
        ? automation.autoDreamProfiles
        : [];

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: t("advancedAutomation.title") }} />
            <ItemList
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
            >
                {/* Audit stats rollup */}
                {auditStats ? (
                    <ItemGroup title={t("advancedAutomation.sectionStats")}>
                        <Item
                            title={t("advancedAutomation.statTotal")}
                            detail={String(auditStats.totalEvents)}
                            showChevron={false}
                        />
                        <Item
                            title={t("advancedAutomation.statQueued")}
                            detail={String(auditStats.queuedCount)}
                            showChevron={false}
                        />
                        <Item
                            title={t("advancedAutomation.statCompleted")}
                            detail={String(auditStats.terminalCompletedCount)}
                            showChevron={false}
                        />
                        <Item
                            title={t("advancedAutomation.statFailed")}
                            detail={String(auditStats.terminalFailedCount)}
                            detailStyle={{ color: theme.colors.status.error }}
                            showChevron={false}
                        />
                        <Item
                            title={t("advancedAutomation.statGuardianReuse")}
                            detail={formatRate(auditStats.guardianReuseRate as any)}
                            subtitle={`${auditStats.guardianReuseCount} reuses · ${auditStats.guardianResetCount} resets`}
                            showChevron={false}
                        />
                        <Item
                            title={t("advancedAutomation.statWatchdog")}
                            detail={String(auditStats.watchdogStopCount)}
                            showChevron={false}
                        />
                    </ItemGroup>
                ) : null}

                {/* Guardian registry */}
                <ItemGroup title={t("advancedAutomation.sectionGuardians", guardians.length)}>
                    {guardians.length === 0 ? (
                        <Item
                            title={t("advancedAutomation.guardiansEmpty")}
                            subtitle={t("advancedAutomation.guardiansEmptyHint")}
                            showChevron={false}
                        />
                    ) : (
                        guardians.slice(0, 20).map((g) => (
                            <Item
                                key={g.key}
                                title={g.key}
                                subtitle={`${g.sessionId} · ${formatTime(g.updatedAt)}`}
                                detail={g.attached ? t("advancedAutomation.guardianAttached") : t("advancedAutomation.guardianDetached")}
                                detailStyle={{
                                    color: g.attached ? theme.colors.success : theme.colors.warning,
                                }}
                                showChevron={false}
                            />
                        ))
                    )}
                </ItemGroup>

                {/* Recent jobs */}
                <ItemGroup title={t("advancedAutomation.sectionRecentJobs", recentJobs.length)}>
                    {recentJobs.length === 0 ? (
                        <Item title={t("advancedAutomation.jobsEmpty")} showChevron={false} />
                    ) : (
                        recentJobs.map((job) => (
                            <Item
                                key={job.id}
                                title={job.label || job.id}
                                subtitle={`${job.kind} · ${formatTime(job.updatedAt)}`}
                                detail={job.status}
                                detailStyle={{
                                    color: job.status === "completed" ? theme.colors.success
                                        : job.status === "failed" ? theme.colors.status.error
                                        : job.status === "cancelled" ? theme.colors.textSecondary
                                        : theme.colors.textLink,
                                }}
                                showChevron={false}
                            />
                        ))
                    )}
                </ItemGroup>

                {/* Audit timeline */}
                <ItemGroup title={t("advancedAutomation.sectionAudit", auditEvents.length)}>
                    {auditEvents.length === 0 ? (
                        <Item title={t("advancedAutomation.auditEmpty")} showChevron={false} />
                    ) : (
                        auditEvents.map((e) => (
                            <Item
                                key={e.id}
                                title={e.kind}
                                subtitle={e.message || `${e.jobId ?? e.dedupeKey ?? ""} · ${formatTime(e.occurredAt)}`}
                                detail={e.status || "-"}
                                showChevron={false}
                            />
                        ))
                    )}
                </ItemGroup>

                {/* Loop summaries (daemon-reported) */}
                {loops.length > 0 ? (
                    <ItemGroup title={t("advancedAutomation.sectionLoops", loops.length)}>
                        {loops.map((loop) => (
                            <Item
                                key={loop.id}
                                title={loop.name || loop.directory.split("/").pop() || loop.id}
                                subtitle={`${loop.agent} · iter ${loop.iteration} · ${loop.phase}`}
                                detail={loop.runtimeState}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>
                ) : null}

                {/* Bootstrap profiles (CLI-local agent loop bootstraps) */}
                {bootstrapProfiles.length > 0 ? (
                    <ItemGroup title={t("advancedAutomation.sectionBootstrap", bootstrapProfiles.length)}>
                        {bootstrapProfiles.map((p) => (
                            <Item
                                key={p.id}
                                title={p.name || p.rootDirectory}
                                subtitle={`${p.status} · ${t("advancedAutomation.lastRun")} ${formatTime(p.lastRunAt)}`}
                                detail={p.enabled ? t("workflows.detailYes") : t("workflows.detailNo")}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>
                ) : null}

                {/* Auto-dream profiles */}
                {autoDreamProfiles.length > 0 ? (
                    <ItemGroup title={t("advancedAutomation.sectionAutoDream", autoDreamProfiles.length)}>
                        {autoDreamProfiles.map((p) => (
                            <Item
                                key={p.id}
                                title={p.name || p.rootDirectory}
                                subtitle={`${p.status} · ${p.stage} · ${t("advancedAutomation.lastRun")} ${formatTime(p.lastRunAt)}`}
                                detail={p.enabled ? t("workflows.detailYes") : t("workflows.detailNo")}
                                showChevron={false}
                            />
                        ))}
                    </ItemGroup>
                ) : null}
            </ItemList>
        </View>
    );
}
