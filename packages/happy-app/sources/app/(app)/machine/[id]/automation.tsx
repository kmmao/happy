import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import {
    machineSetKillswitch,
    type MachineAutomationAuditEvent,
    type MachineAutomationGuardian,
    type MachineAutomationGuardianUsage,
    type MachineAutomationJob,
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { projectManager } from "@/sync/projectManager";
import { t } from "@/text";
import {
    type AuditFilter,
    type GuardianFilter,
    type JobFilter,
    formatJobSubtitle,
    formatRate,
    formatTimestamp,
    getAuditEventDetailMessage,
    getAuditEventSubtitle,
    getAuditEventTitle,
    getAuditKindAccent,
    getGuardianDetailMessage,
    getGuardianStateLabel,
    getJobDetailMessage,
    getJobKindLabel,
    getJobTitle,
    getStatusColor,
    getStatusLabel,
} from "./automationLabels";
import { styles } from "./automationStyles";
import { useAutomationData } from "./useAutomationData";

type ActiveSection = "loops" | "jobs" | "guardians" | "audit" | null;

// ── 可点击 Pipeline 节点 ──────────────────────────────────────────────────
function PipelineNode(props: {
    label: string;
    count: number;
    accent?: string;
    isLast?: boolean;
    isActive?: boolean;
    onPress?: () => void;
}) {
    const { theme } = useUnistyles();
    const activeAccent = props.accent ?? theme.colors.textSecondary;
    return (
        <Pressable style={styles.pipelineNodeWrap} onPress={props.onPress} disabled={!props.onPress}>
            <View style={[
                styles.pipelineNode,
                props.isActive ? { borderColor: activeAccent, backgroundColor: activeAccent + "18" } : null,
            ]}>
                <Text style={[styles.pipelineNodeCount, props.isActive ? { color: activeAccent } : null]}>
                    {props.count}
                </Text>
                <Text style={[styles.pipelineNodeLabel, props.isActive ? { color: activeAccent, fontWeight: "700" } : null]} numberOfLines={1}>
                    {props.label}
                </Text>
            </View>
            {!props.isLast ? <Text style={styles.pipelineArrow}>{"→"}</Text> : null}
        </Pressable>
    );
}

// ── 状态指示圆点 ─────────────────────────────────────────────────────────
function StatusDot({ color }: { color: string }) {
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

// ── 健康指标 Chip ─────────────────────────────────────────────────────────
function MetricChip({ icon, value, label, color }: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    value: number;
    label: string;
    color?: string;
}) {
    const { theme } = useUnistyles();
    const accent = color ?? theme.colors.textSecondary;
    return (
        <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            backgroundColor: value > 0 && color ? color + "14" : theme.colors.surfaceHigh,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: value > 0 && color ? color + "40" : theme.colors.divider,
        }}>
            <Ionicons name={icon} size={13} color={value > 0 && color ? accent : theme.colors.textSecondary} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: value > 0 && color ? accent : theme.colors.text }}>
                {value}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{label}</Text>
        </View>
    );
}

// ── 区块标题 ──────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: string }) {
    const { theme } = useUnistyles();
    return (
        <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>
            {children}
        </Text>
    );
}

function renderSummaryCard(options: {
    title: string;
    value: string;
    hint: string;
    accent?: string;
}) {
    const { title, value, hint, accent } = options;
    return (
        <View style={[styles.summaryCard, accent ? { borderColor: accent } : null]}>
            <Text style={styles.summaryCardTitle}>{title}</Text>
            <Text style={[styles.summaryCardValue, accent ? { color: accent } : null]}>{value}</Text>
            <Text style={styles.summaryCardHint} numberOfLines={1}>{hint}</Text>
        </View>
    );
}

export default React.memo(function MachineAutomationPage() {
    const {
        id: machineId,
        q: initialQueryParam,
        jobFilter: initialJobFilterParam,
        auditFilter: initialAuditFilterParam,
        guardianFilter: initialGuardianFilterParam,
    } = useLocalSearchParams<{
        id: string;
        q?: string;
        jobFilter?: JobFilter;
        auditFilter?: AuditFilter;
        guardianFilter?: GuardianFilter;
    }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const machine = useMachine(typeof machineId === "string" ? machineId : "");
    const isKilled = Boolean(machine?.daemonState?.killed);

    const [activeSection, setActiveSection] = React.useState<ActiveSection>(null);

    const toggleSection = React.useCallback((section: Exclude<ActiveSection, null>) => {
        setActiveSection((current) => current === section ? null : section);
    }, []);

    const doToggleKillswitch = React.useCallback(async () => {
        if (typeof machineId !== "string") return;
        try {
            await machineSetKillswitch(machineId, !isKilled);
        } catch { /* best-effort */ }
    }, [machineId, isKilled]);

    const toggleKillswitch = React.useCallback(() => {
        const title = isKilled ? t("machine.automationResume") : t("machine.automationEmergencyStop");
        const message = isKilled ? t("machine.automationResumeConfirm") : t("machine.automationEmergencyStopConfirm");
        Modal.alert(title, message, [
            { text: t("common.cancel"), style: "cancel" },
            { text: title, style: isKilled ? "default" : "destructive", onPress: () => void doToggleKillswitch() },
        ]);
    }, [doToggleKillswitch, isKilled]);

    const data = useAutomationData({
        machineId,
        initialQueryParam: typeof initialQueryParam === "string" ? initialQueryParam : undefined,
        initialJobFilterParam: typeof initialJobFilterParam === "string" ? initialJobFilterParam : undefined,
        initialAuditFilterParam: typeof initialAuditFilterParam === "string" ? initialAuditFilterParam : undefined,
        initialGuardianFilterParam: typeof initialGuardianFilterParam === "string" ? initialGuardianFilterParam : undefined,
    });

    const getLocalProjectId = React.useCallback((serverProjectId?: string) => {
        if (!serverProjectId) return null;
        return projectManager.getProjectByServerId(serverProjectId)?.id ?? null;
    }, []);

    // ── Event handlers ────────────────────────────────────────────────────

    const handleJobPress = React.useCallback((job: MachineAutomationJob) => {
        const relatedEvents = data.recentAuditEvents.filter((e) =>
            e.jobId === job.id || e.dedupeKey === job.dedupeKey
            || (job.sessionId ? e.sessionId === job.sessionId : false)
            || (job.runId ? e.runId === job.runId : false)
        );
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (job.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (job.kind === "agent_loop") { router.push(`/machine/${machineId}/loops?loopId=${job.loopId}` as any); return; }
                    const pid = getLocalProjectId(job.projectId);
                    if (pid) router.push(`/project/${pid}/supervisor-loop/${job.loopId}` as any);
                },
            });
        }
        if (job.projectId) {
            buttons.push({ text: t("machine.automationOpenProject"), onPress: () => { const pid = getLocalProjectId(job.projectId); if (pid) router.push(`/project/${pid}` as any); } });
        }
        if (job.sessionId) {
            buttons.push({ text: t("machine.automationOpenSession"), onPress: () => router.push(`/session/${job.sessionId}` as any) });
        }
        if (job.status === "queued") {
            buttons.push({ text: t("machine.automationCancel"), style: "destructive", onPress: () => void data.mutateAndReload(job.id, "cancel") });
        }
        if ((job.status === "running" || job.status === "dispatching") && job.sessionId) {
            buttons.push({ text: t("machine.automationStop"), style: "destructive", onPress: () => void data.stopJobSession(job.id, job.sessionId!) });
        }
        if (job.status === "failed" || job.status === "cancelled" || job.status === "completed") {
            buttons.push({ text: t("machine.automationRetry"), onPress: () => void data.mutateAndReload(job.id, "retry") });
        }
        Modal.alert(getJobTitle(job), getJobDetailMessage(job, relatedEvents), buttons);
    }, [data.mutateAndReload, data.recentAuditEvents, data.stopJobSession, getLocalProjectId, machineId, router]);

    const handleGuardianPress = React.useCallback((guardian: MachineAutomationGuardian) => {
        const usage = data.guardianUsage.find((e) => e.key === guardian.key);
        const relatedEvents = data.recentAuditEvents.filter((e) => e.guardianKey === guardian.key || e.sessionId === guardian.sessionId);
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (guardian.projectId) {
            buttons.push({ text: t("machine.automationOpenProject"), onPress: () => { const pid = getLocalProjectId(guardian.projectId); if (pid) router.push(`/project/${pid}` as any); } });
        }
        if (guardian.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (guardian.key.startsWith("agent-loop:")) { router.push(`/machine/${machineId}/loops?loopId=${guardian.loopId}` as any); return; }
                    const pid = getLocalProjectId(guardian.projectId);
                    if (pid) router.push(`/project/${pid}/supervisor-loop/${guardian.loopId}` as any);
                },
            });
        }
        buttons.push({ text: t("machine.automationOpenSession"), onPress: () => router.push(`/session/${guardian.sessionId}` as any) });
        buttons.push({
            text: t("machine.automationResetGuardian"), style: "destructive",
            onPress: () => Modal.alert(t("machine.automationResetGuardian"), t("machine.automationResetGuardianMessage"), [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("machine.automationResetGuardian"), style: "destructive", onPress: () => void data.clearGuardians({ key: guardian.key, sessionId: guardian.sessionId }) },
            ]),
        });
        Modal.alert(guardian.key, `${getGuardianDetailMessage(guardian, usage, relatedEvents)}\n${t("machine.automationStatusLabel")}: ${getGuardianStateLabel(guardian.attached, guardian.recovered)}`, buttons);
    }, [data.clearGuardians, data.guardianUsage, data.recentAuditEvents, getLocalProjectId, machineId, router]);

    const handleAuditEventPress = React.useCallback((event: MachineAutomationAuditEvent) => {
        const relatedJob = data.jobs.find((j) => j.id === event.jobId || j.dedupeKey === event.dedupeKey || (event.sessionId ? j.sessionId === event.sessionId : false));
        const buttons: Array<{ text: string; style?: "cancel" | "default"; onPress?: () => void }> = [{ text: t("common.cancel"), style: "cancel" }];
        if (event.sessionId) buttons.push({ text: t("machine.automationOpenSession"), onPress: () => router.push(`/session/${event.sessionId}` as any) });
        if (event.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"), onPress: () => {
                    if (event.trigger?.startsWith("agent_loop")) { router.push(`/machine/${machineId}/loops?loopId=${event.loopId}` as any); return; }
                    const pid = getLocalProjectId(event.projectId);
                    if (pid) router.push(`/project/${pid}/supervisor-loop/${event.loopId}` as any);
                },
            });
        }
        if (event.projectId) buttons.push({ text: t("machine.automationOpenProject"), onPress: () => { const pid = getLocalProjectId(event.projectId); if (pid) router.push(`/project/${pid}` as any); } });
        if (relatedJob) buttons.push({ text: t("machine.automationOpenJob"), onPress: () => handleJobPress(relatedJob) });
        Modal.alert(getAuditEventTitle(event), getAuditEventDetailMessage(event), buttons);
    }, [data.jobs, getLocalProjectId, handleJobPress, machineId, router]);

    // ── 计算健康状态 ──────────────────────────────────────────────────────

    const activeCount = (data.counts.running ?? 0) + (data.counts.dispatching ?? 0);
    const failedCount = data.counts.failed ?? 0;
    const queuedCount = data.counts.queued ?? 0;
    const hasAlerts = data.alertCards.length > 0;
    const healthColor = isKilled ? "#FF3B30" : failedCount > 0 || hasAlerts ? "#FF9500" : "#34C759";
    const healthLabel = isKilled
        ? t("machine.automationEmergencyStop")
        : failedCount > 0
            ? `${failedCount} ${t("machine.automationFailed")}`
            : hasAlerts
                ? t("machine.automationAlerts")
                : activeCount > 0
                    ? `${activeCount} ${t("machine.automationRunning")}`
                    : t("machine.automationCompleted");

    // ── Render ────────────────────────────────────────────────────────────

    if (data.loading && !data.status) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.text} />
            </View>
        );
    }

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.groupped.background }]}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void data.load("refresh")} />}
        >
            {/* ① RPC 连接中提示 */}
            {!data.rpcReady ? (
                <View style={styles.rpcNotice}>
                    <Text style={styles.rpcNoticeTitle}>{t("status.connecting")}</Text>
                    <Text style={styles.rpcNoticeText}>{t("machine.automationViewAllHint")}</Text>
                </View>
            ) : null}

            {/* ② 顶部状态行：健康指示 + Killswitch */}
            <View style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginHorizontal: 16,
                marginTop: 12,
                marginBottom: 4,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: healthColor + "40",
                backgroundColor: healthColor + "10",
            }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <StatusDot color={healthColor} />
                    <Text style={{ fontSize: 14, fontWeight: "600", color: healthColor }}>
                        {healthLabel}
                    </Text>
                </View>
                <Pressable
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                        backgroundColor: isKilled ? theme.colors.success : theme.colors.deleteAction,
                    }}
                    onPress={toggleKillswitch}
                >
                    <Ionicons name={isKilled ? "play-circle" : "stop-circle"} size={15} color="#fff" />
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>
                        {isKilled ? t("machine.automationResume") : t("machine.automationEmergencyStop")}
                    </Text>
                </Pressable>
            </View>

            {/* ③ 关键指标行 */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 8 }}>
                {activeCount > 0 && (
                    <MetricChip icon="play-circle-outline" value={activeCount} label={t("machine.automationRunning")} color="#0A84FF" />
                )}
                <MetricChip icon="time-outline" value={queuedCount} label={t("machine.automationQueued")} color={queuedCount > 0 ? "#FF9500" : undefined} />
                {failedCount > 0 && (
                    <MetricChip icon="alert-circle-outline" value={failedCount} label={t("machine.automationFailed")} color="#FF3B30" />
                )}
                <MetricChip icon="shield-checkmark-outline" value={data.guardians.length} label={t("machine.automationGuardians")} color={data.guardians.length > 0 ? "#34C759" : undefined} />
                {(data.counts.completed ?? 0) > 0 && (
                    <MetricChip icon="checkmark-circle-outline" value={data.counts.completed ?? 0} label={t("machine.automationCompleted")} />
                )}
            </View>

            {/* ④ Alert cards（有异常时才出现） */}
            {hasAlerts ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
                    {data.alertCards.map((alert) => {
                        const accent = alert.kind === "anomalies" ? "#FF3B30" : alert.kind === "recovered" ? "#34C759" : "#FF9500";
                        const title = alert.kind === "anomalies"
                            ? t("machine.automationAnomaliesDetected")
                            : alert.kind === "recovered"
                                ? t("machine.automationRecoveredSessions")
                                : t("machine.automationGuardianRecoveryNeeded");
                        const subtitle = alert.kind === "anomalies"
                            ? `${t("machine.automationFailed")}: ${failedCount} · ${t("machine.automationWatchdogStops")}: ${data.auditStats?.watchdogStopCount ?? 0}`
                            : alert.kind === "recovered"
                                ? `${t("machine.automationRecoveredGuardians")}: ${data.guardians.filter((g) => g.recovered).length} · ${t("machine.automationRecoveredJobs")}: ${data.jobs.filter((j) => j.recovered).length}`
                                : t("machine.automationGuardianRecoveryNeededMessage");
                        return (
                            <View key={alert.kind} style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: accent, marginHorizontal: 0, marginVertical: 0 }]}>
                                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                    <Text style={[styles.dataCardTitle, { color: accent, flex: 1 }]} numberOfLines={1}>{title}</Text>
                                    <View style={{ backgroundColor: accent + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 8 }}>
                                        <Text style={{ fontSize: 15, fontWeight: "800", color: accent }}>{alert.count}</Text>
                                    </View>
                                </View>
                                <Text style={styles.dataCardSubtitle}>{subtitle}</Text>
                            </View>
                        );
                    })}
                </View>
            ) : null}

            {/* ⑤ 数据流向（Pipeline — 主导航） */}
            <View style={[styles.pipelineContainer, { marginTop: 4 }]}>
                <Text style={styles.pipelineTitle}>{t("machine.automationPipelineTitle")}</Text>
                <View style={styles.pipelineRow}>
                    <PipelineNode label={t("machine.automationLoopsTotal")} count={data.loopRollup.total} accent="#0A84FF" isActive={activeSection === "loops"} onPress={() => toggleSection("loops")} />
                    <PipelineNode label={t("machine.automationJobs")} count={data.jobs.length} accent={activeCount > 0 ? "#0A84FF" : undefined} isActive={activeSection === "jobs"} onPress={() => toggleSection("jobs")} />
                    <PipelineNode label={t("machine.automationGuardians")} count={data.guardians.length} accent={data.guardians.length > 0 ? "#34C759" : undefined} isActive={activeSection === "guardians"} onPress={() => toggleSection("guardians")} />
                    <PipelineNode label={t("machine.automationAudit")} count={data.recentAuditEvents.length} isLast isActive={activeSection === "audit"} onPress={() => toggleSection("audit")} />
                </View>
            </View>

            {/* ⑥ 按需展开的区块内容 */}
            <View>
                {/* ── Loops ── */}
                {activeSection === "loops" ? (
                    <ItemGroup title={<SectionTitle>{t("machine.automationLoopRollup")}</SectionTitle>}>
                        <View style={styles.summaryGrid}>
                            {renderSummaryCard({ title: t("machine.automationLoopsTotal"), value: String(data.loopRollup.total), hint: t("machine.automationLoopsTotalHint") })}
                            {renderSummaryCard({ title: t("machine.automationLoopsActive"), value: String(data.loopRollup.active), hint: t("machine.automationLoopsActiveHint"), accent: "#0A84FF" })}
                            {renderSummaryCard({ title: t("machine.automationLoopsBlocked"), value: String(data.loopRollup.blocked), hint: t("machine.automationLoopsBlockedHint"), accent: data.loopRollup.blocked > 0 ? "#FF3B30" : undefined })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPaused"), value: String(data.loopRollup.paused), hint: t("machine.automationLoopsPausedHint"), accent: theme.colors.textSecondary })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPendingEvents"), value: String(data.loopRollup.pendingEvents), hint: t("machine.automationLoopsPendingEventsHint") })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPolicyStopped"), value: String(data.loopRollup.policyStopped), hint: t("machine.automationLoopsPolicyStoppedHint"), accent: data.loopRollup.policyStopped > 0 ? "#FF9500" : undefined })}
                        </View>
                        <Item title={t("machine.automationOpenLoops")} subtitle={t("machine.automationOpenLoopsHint")} titleStyle={{ color: theme.colors.textLink }} onPress={() => router.push(`/machine/${machineId}/loops` as any)} />
                    </ItemGroup>
                ) : null}

                {/* ── Jobs + Timeline ── */}
                {activeSection === "jobs" ? (
                    <ItemGroup title={<SectionTitle>{t("machine.automationJobs")}</SectionTitle>}>
                        {/* 失败任务优先显示（不需要点击展开） */}
                        {data.filteredJobs.filter((j) => j.status === "failed").length > 0 ? (
                            <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, gap: 6 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 2 }}>
                                    <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#FF3B30" }}>
                                        {t("machine.automationFailed").toUpperCase()}
                                    </Text>
                                </View>
                                {data.filteredJobs.filter((j) => j.status === "failed").map((job) => (
                                    <Pressable key={job.id} style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: "#FF3B30", marginHorizontal: 0, marginVertical: 0 }]} onPress={() => handleJobPress(job)}>
                                        <View style={styles.dataCardHeader}>
                                            <View style={styles.dataCardTitleWrap}>
                                                <Text style={styles.dataCardTitle} numberOfLines={1}>{getJobTitle(job)}</Text>
                                                {job.errorMessage ? <Text style={[styles.dataCardSubtitle, { color: "#FF3B30" }]} numberOfLines={2}>{job.errorMessage}</Text> : null}
                                            </View>
                                            <View style={{ alignItems: "flex-end", gap: 4 }}>
                                                <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{formatTimestamp(job.updatedAt)}</Text>
                                                {data.activeJobId === job.id && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                                            </View>
                                        </View>
                                        <View style={styles.pillRow}>
                                            <View style={[styles.pill, { borderColor: "#FF3B30" + "40" }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                        </View>
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}

                        {/* 所有任务（展开） */}
                        <Item
                            title={`${t("machine.automationJobs")} (${data.filteredJobs.length})`}
                            subtitle={data.filteredJobs.length === 0
                                ? t("machine.automationDetailsEmpty")
                                : `${t("machine.automationRunning")}: ${activeCount} · ${t("machine.automationQueued")}: ${queuedCount} · ${t("machine.automationFailed")}: ${failedCount}`}
                            detail={data.showAllJobs ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllJobs((c) => !c)}
                            showChevron={!data.showAllJobs && data.filteredJobs.length > 0}
                        />
                        {data.showAllJobs ? data.filteredJobs.filter((j) => j.status !== "failed").map((job) => {
                            const statusColor = getStatusColor(job.status) ?? theme.colors.divider;
                            return (
                                <Pressable key={job.id} style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: statusColor }]} onPress={() => handleJobPress(job)}>
                                    <View style={styles.dataCardHeader}>
                                        <View style={styles.dataCardTitleWrap}>
                                            <Text style={styles.dataCardTitle} numberOfLines={2}>{getJobTitle(job)}</Text>
                                            <Text style={styles.dataCardSubtitle}>{formatJobSubtitle(job, data.resolveGuardianKeyLabel)}</Text>
                                        </View>
                                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                                            <View style={[styles.statusBadge, { borderColor: statusColor, backgroundColor: statusColor + "18" }]}>
                                                <Text style={[styles.statusBadgeText, { color: statusColor }]}>{getStatusLabel(job.status)}</Text>
                                            </View>
                                            {data.activeJobId === job.id && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                                        </View>
                                    </View>
                                    <View style={styles.pillRow}>
                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{formatTimestamp(job.createdAt)}</Text></View>
                                        {job.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{data.resolveLoopName(job.loopId) ?? job.loopId.slice(0, 8)}</Text></View> : null}
                                    </View>
                                </Pressable>
                            );
                        }) : null}

                        {/* Timeline */}
                        <Item
                            title={`${t("machine.automationTimeline")} (${data.fullTimelineEntries.length})`}
                            subtitle={data.fullTimelineEntries.length === 0 ? t("machine.automationTimelineEmpty") : t("machine.automationTimelineHint")}
                            detail={data.showAllTimeline ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllTimeline((c) => !c)}
                            showChevron={!data.showAllTimeline && data.fullTimelineEntries.length > 0}
                        />
                        {data.showAllTimeline ? data.visibleTimelineEntries.map((entry) => {
                            const job = data.jobs.find((c) => c.id === entry.jobId);
                            const accent = entry.kind === "terminal" ? theme.colors.textSecondary : entry.kind === "running" ? "#0A84FF" : "#FF9500";
                            return (
                                <Pressable key={entry.key} style={styles.timelineCard} onPress={job ? () => handleJobPress(job) : undefined}>
                                    <View style={styles.timelineRail}>
                                        <View style={[styles.timelineDot, { backgroundColor: accent }]} />
                                        <View style={[styles.timelineLine, { backgroundColor: theme.colors.divider }]} />
                                    </View>
                                    <View style={styles.timelineContent}>
                                        <View style={styles.dataCardHeader}>
                                            <View style={styles.dataCardTitleWrap}>
                                                <Text style={styles.dataCardTitle}>{entry.title}</Text>
                                                <Text style={styles.dataCardSubtitle}>{entry.subtitle}</Text>
                                            </View>
                                            <Text style={[styles.dataCardTimestamp, { color: accent }]}>{formatTimestamp(entry.timestamp)}</Text>
                                        </View>
                                    </View>
                                </Pressable>
                            );
                        }) : null}

                        {/* 清除终态任务 */}
                        <Item
                            title={t("machine.automationClearTerminal")}
                            subtitle={t("machine.automationClearTerminalHint")}
                            titleStyle={{ color: theme.colors.textLink }}
                            onPress={() => Modal.alert(t("machine.automationClearTerminal"), t("machine.automationClearTerminalMessage"), [
                                { text: t("common.cancel"), style: "cancel" },
                                { text: t("machine.automationClearTerminal"), style: "destructive", onPress: () => void data.clearTerminal() },
                            ])}
                            rightElement={data.clearing ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                        />
                    </ItemGroup>
                ) : null}

                {/* ── Guardians（状态连续性） ── */}
                {activeSection === "guardians" ? (
                    <ItemGroup title={<SectionTitle>{t("machine.automationGuardians")}</SectionTitle>}>
                        {/* Guardian 效率指标 */}
                        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                            <View style={[styles.summaryCard, { borderColor: data.guardians.filter((g) => g.attached).length > 0 ? "#34C759" : theme.colors.divider }]}>
                                <Text style={styles.summaryCardTitle}>{t("machine.automationGuardianAttached")}</Text>
                                <Text style={[styles.summaryCardValue, { color: "#34C759" }]}>{data.guardians.filter((g) => g.attached).length}</Text>
                                <Text style={styles.summaryCardHint}>{t("machine.automationGuardiansHint")}</Text>
                            </View>
                            <View style={[styles.summaryCard, { borderColor: theme.colors.divider }]}>
                                <Text style={styles.summaryCardTitle}>{t("machine.automationGuardianPersisted")}</Text>
                                <Text style={styles.summaryCardValue}>{data.guardians.filter((g) => !g.attached).length}</Text>
                                <Text style={styles.summaryCardHint}>{t("machine.automationGuardianUsageHint")}</Text>
                            </View>
                            {data.auditStats ? (
                                <View style={styles.summaryCard}>
                                    <Text style={styles.summaryCardTitle}>{t("machine.automationGuardianReuseRate")}</Text>
                                    <Text style={[styles.summaryCardValue, { color: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C759" : "#FF9500" }]}>
                                        {formatRate(data.auditStats.guardianReuseRate)}
                                    </Text>
                                    <Text style={styles.summaryCardHint}>{t("machine.automationGuardianReuseRateHint")}</Text>
                                </View>
                            ) : null}
                        </View>

                        {/* Guardian 列表 */}
                        <Item
                            title={`${t("machine.automationGuardians")} (${data.filteredGuardians.length})`}
                            subtitle={data.filteredGuardians.length === 0 ? t("machine.automationGuardiansEmpty") : `${t("machine.automationGuardianAttached")}: ${data.filteredGuardians.filter((g) => g.attached).length} · ${t("machine.automationGuardianPersisted")}: ${data.filteredGuardians.filter((g) => !g.attached).length}`}
                            detail={data.showAllGuardians ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllGuardians((c) => !c)}
                            showChevron={!data.showAllGuardians && data.filteredGuardians.length > 0}
                        />
                        {data.showAllGuardians ? (
                            <>
                                {data.visibleGuardians.map((guardian: MachineAutomationGuardian) => {
                                    const gColor = guardian.recovered ? "#FF9500" : guardian.attached ? "#34C759" : theme.colors.textSecondary;
                                    return (
                                        <Pressable key={guardian.key} style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: gColor }]} onPress={() => handleGuardianPress(guardian)}>
                                            <View style={styles.dataCardHeader}>
                                                <View style={styles.dataCardTitleWrap}>
                                                    <Text style={styles.dataCardTitle} numberOfLines={1}>{data.resolveGuardianKeyLabel(guardian.key)}</Text>
                                                    <Text style={[styles.dataCardSubtitle, { color: gColor }]}>{getGuardianStateLabel(guardian.attached, guardian.recovered)}</Text>
                                                </View>
                                                <Text style={styles.dataCardTimestamp}>{formatTimestamp(guardian.updatedAt)}</Text>
                                            </View>
                                            {guardian.loopId ? (
                                                <View style={styles.pillRow}>
                                                    <View style={[styles.pill, { borderColor: theme.colors.divider }]}>
                                                        <Text style={styles.pillText}>{data.resolveLoopName(guardian.loopId) ?? guardian.loopId.slice(0, 8)}</Text>
                                                    </View>
                                                </View>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                                <Item
                                    title={`${t("machine.automationGuardianUsage")} (${data.filteredGuardianUsage.length})`}
                                    subtitle={t("machine.automationGuardianUsageHint")}
                                    detail={data.showAllGuardianUsage ? t("machine.automationSectionShowLess") : undefined}
                                    onPress={() => data.setShowAllGuardianUsage((c) => !c)}
                                    showChevron={!data.showAllGuardianUsage && data.filteredGuardianUsage.length > 0}
                                />
                                {data.showAllGuardianUsage ? data.visibleGuardianUsage.map((entry: MachineAutomationGuardianUsage) => {
                                    const matchingGuardian = data.guardians.find((g) => g.key === entry.key);
                                    const onPress = matchingGuardian ? () => handleGuardianPress(matchingGuardian) : entry.currentSessionId ? () => router.push(`/session/${entry.currentSessionId}` as any) : undefined;
                                    return (
                                        <Pressable key={entry.key} style={styles.dataCard} onPress={onPress}>
                                            <View style={styles.dataCardHeader}>
                                                <View style={styles.dataCardTitleWrap}>
                                                    <Text style={styles.dataCardTitle}>{data.resolveGuardianKeyLabel(entry.key)}</Text>
                                                    <Text style={styles.dataCardSubtitle}>{t("machine.automationGuardianUsage")}</Text>
                                                </View>
                                                <Text style={styles.dataCardTimestamp}>{formatTimestamp(entry.lastUsedAt)}</Text>
                                            </View>
                                            <View style={styles.pillRow}>
                                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianReuseCount")}: ${entry.reuseCount}`}</Text></View>
                                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianResetCount")}: ${entry.resetCount}`}</Text></View>
                                            </View>
                                        </Pressable>
                                    );
                                }) : null}
                            </>
                        ) : null}
                    </ItemGroup>
                ) : null}

                {/* ── Audit（技术日志） ── */}
                {activeSection === "audit" ? (
                    <ItemGroup title={<SectionTitle>{t("machine.automationAuditStats")}</SectionTitle>}>
                        <View style={styles.summaryGrid}>
                            {renderSummaryCard({ title: t("machine.automationTotalAuditEvents"), value: String(data.auditStats?.totalEvents ?? 0), hint: t("machine.automationTotalAuditEventsHint") })}
                            {renderSummaryCard({ title: t("machine.automationGuardianReuseCount"), value: String(data.auditStats?.guardianReuseCount ?? 0), hint: t("machine.automationGuardianReuseCountHint"), accent: "#0A84FF" })}
                            {renderSummaryCard({ title: t("machine.automationGuardianReuseRate"), value: formatRate(data.auditStats?.guardianReuseRate), hint: t("machine.automationGuardianReuseRateHint") })}
                            {renderSummaryCard({ title: t("machine.automationSessionReattachedCount"), value: String(data.auditStats?.sessionReattachedCount ?? 0), hint: t("machine.automationSessionReattachedCountHint"), accent: "#34C759" })}
                            {renderSummaryCard({ title: t("machine.automationWatchdogStops"), value: String(data.auditStats?.watchdogStopCount ?? 0), hint: t("machine.automationWatchdogStopsHint"), accent: (data.auditStats?.watchdogStopCount ?? 0) > 0 ? "#FF3B30" : undefined })}
                            {renderSummaryCard({ title: t("machine.automationGuardianResetCount"), value: String(data.auditStats?.guardianResetCount ?? 0), hint: t("machine.automationGuardianResetCountHint"), accent: "#FF9500" })}
                        </View>
                        <Item title={t("machine.automationLastAuditEvent")} subtitle={t("machine.automationLastAuditEventHint")} detail={data.auditStats?.lastEventAt ? formatTimestamp(data.auditStats.lastEventAt) : "-"} showChevron={false} />
                        <Item
                            title={`${t("machine.automationAudit")} (${data.filteredAuditEvents.length})`}
                            subtitle={data.filteredAuditEvents.length === 0 ? t("machine.automationAuditEmpty") : t("machine.automationAuditHint")}
                            detail={data.showAllAuditEvents ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllAuditEvents((c) => !c)}
                            showChevron={!data.showAllAuditEvents && data.filteredAuditEvents.length > 0}
                        />
                        {data.showAllAuditEvents ? (
                            <>
                                <Item
                                    title={t("machine.automationClearAudit")} subtitle={t("machine.automationClearAuditHint")}
                                    titleStyle={{ color: theme.colors.textLink }}
                                    onPress={() => Modal.alert(t("machine.automationClearAudit"), t("machine.automationClearAuditMessage"), [
                                        { text: t("common.cancel"), style: "cancel" },
                                        { text: t("machine.automationClearAudit"), style: "destructive", onPress: () => void data.clearAudit() },
                                    ])}
                                    rightElement={data.clearingAudit ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                                {data.visibleAuditEvents.map((event: MachineAutomationAuditEvent) => {
                                    const aAccent = getAuditKindAccent(event) ?? theme.colors.divider;
                                    return (
                                        <Pressable key={event.id} style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: aAccent }]} onPress={() => handleAuditEventPress(event)}>
                                            <View style={styles.dataCardHeader}>
                                                <View style={styles.dataCardTitleWrap}>
                                                    <Text style={styles.dataCardTitle} numberOfLines={1}>{getAuditEventTitle(event)}</Text>
                                                    <Text style={styles.dataCardSubtitle} numberOfLines={2}>{event.message || getAuditEventSubtitle(event) || t("machine.automationAudit")}</Text>
                                                </View>
                                                <Text style={[styles.dataCardTimestamp, { color: aAccent }]}>{formatTimestamp(event.occurredAt)}</Text>
                                            </View>
                                            {(event.guardianKey || event.loopId) ? (
                                                <View style={styles.pillRow}>
                                                    {event.guardianKey ? <View style={[styles.pill, { borderColor: aAccent + "80" }]}><Text style={styles.pillText}>{data.resolveGuardianKeyLabel(event.guardianKey)}</Text></View> : null}
                                                    {event.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{data.resolveLoopName(event.loopId) ?? event.loopId.slice(0, 8)}</Text></View> : null}
                                                </View>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </>
                        ) : null}
                    </ItemGroup>
                ) : null}
            </View>
        </ScrollView>
    );
});
