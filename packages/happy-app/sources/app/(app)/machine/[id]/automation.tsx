import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useUnistyles } from "react-native-unistyles";
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

// ── 区块内子折叠标题 ─────────────────────────────────────────────────────
function SubToggle({
    label, count, expanded, onPress, accent,
}: {
    label: string; count: number; expanded: boolean; onPress: () => void; accent?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderTopWidth: 1,
                borderTopColor: theme.colors.divider,
                opacity: pressed ? 0.7 : 1,
            })}
            onPress={onPress}
        >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>{label}</Text>
                <View style={{
                    backgroundColor: accent ? accent + "18" : theme.colors.surfaceHigh,
                    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
                }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: accent ?? theme.colors.textSecondary }}>
                        {count}
                    </Text>
                </View>
            </View>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

// ── 横排统计行 ────────────────────────────────────────────────────────────
function StatRow({ items }: {
    items: Array<{ label: string; value: string | number; color?: string; dimmed?: boolean }>;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 20, flexWrap: "wrap" }}>
            {items.map((item) => (
                <View key={item.label} style={{ alignItems: "flex-start", gap: 2 }}>
                    <Text style={{
                        fontSize: 22, fontWeight: "800",
                        color: item.dimmed ? theme.colors.textSecondary : (item.color ?? theme.colors.text),
                    }}>
                        {item.value}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{item.label}</Text>
                </View>
            ))}
        </View>
    );
}

// ── 区块容器 ─────────────────────────────────────────────────────────────
function SectionContainer({ title, rightAction, children }: {
    title: string;
    rightAction?: React.ReactNode;
    children: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            marginHorizontal: 16, marginTop: 12,
            borderRadius: 16, borderWidth: 1,
            borderColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
            overflow: "hidden",
        }}>
            {/* 标题行 */}
            <View style={{
                flexDirection: "row", alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
            }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.text }}>{title}</Text>
                {rightAction}
            </View>
            {children}
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
            <View style={{ paddingBottom: 24 }}>

                {/* ── Loops ── */}
                {activeSection === "loops" ? (
                    <SectionContainer
                        title={t("machine.automationLoopRollup")}
                        rightAction={
                            <Pressable onPress={() => router.push(`/machine/${machineId}/loops` as any)}
                                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.textLink }}>{t("machine.automationOpenLoops")}</Text>
                                <Ionicons name="arrow-forward" size={14} color={theme.colors.textLink} />
                            </Pressable>
                        }
                    >
                        {data.loopRollup.total === 0 ? (
                            /* 全 0 时：简洁空状态 */
                            <View style={{ paddingHorizontal: 16, paddingBottom: 16, alignItems: "center", gap: 6 }}>
                                <Ionicons name="repeat-outline" size={32} color={theme.colors.textSecondary} style={{ opacity: 0.35 }} />
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{t("machine.agentLoopsEmpty")}</Text>
                            </View>
                        ) : (
                            /* 有数据时：total 大字 + 非 0 状态 chip */
                            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
                                {/* Total 大数字 */}
                                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                                    <Text style={{ fontSize: 36, fontWeight: "800", color: theme.colors.text }}>{data.loopRollup.total}</Text>
                                    <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>{t("machine.automationLoopsTotal")}</Text>
                                </View>
                                {/* 状态 chips（只显示有值的） */}
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                    {[
                                        { key: "active",  value: data.loopRollup.active,        label: t("machine.automationLoopsActive"),        color: "#0A84FF", icon: "play-circle-outline" as const },
                                        { key: "blocked", value: data.loopRollup.blocked,        label: t("machine.automationLoopsBlocked"),       color: "#FF3B30", icon: "ban-outline" as const },
                                        { key: "paused",  value: data.loopRollup.paused,         label: t("machine.automationLoopsPaused"),        color: "#8E8E93", icon: "pause-circle-outline" as const },
                                        { key: "events",  value: data.loopRollup.pendingEvents,  label: t("machine.automationLoopsPendingEvents"), color: "#FF9500", icon: "flash-outline" as const },
                                        { key: "policy",  value: data.loopRollup.policyStopped,  label: t("machine.automationLoopsPolicyStopped"), color: "#FF9500", icon: "shield-outline" as const },
                                    ].filter((s) => s.value > 0).map((s) => (
                                        <View key={s.key} style={{
                                            flexDirection: "row", alignItems: "center", gap: 5,
                                            backgroundColor: s.color + "14",
                                            borderRadius: 8, borderWidth: 1, borderColor: s.color + "40",
                                            paddingHorizontal: 10, paddingVertical: 5,
                                        }}>
                                            <Ionicons name={s.icon} size={13} color={s.color} />
                                            <Text style={{ fontSize: 13, fontWeight: "700", color: s.color }}>{s.value}</Text>
                                            <Text style={{ fontSize: 12, color: s.color }}>{s.label}</Text>
                                        </View>
                                    ))}
                                    {/* 若所有子状态均为 0 只显示 active 占位 */}
                                    {data.loopRollup.active === 0 && data.loopRollup.blocked === 0 && data.loopRollup.paused === 0 && (
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: theme.colors.surfaceHigh, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.divider, paddingHorizontal: 10, paddingVertical: 5 }}>
                                            <Ionicons name="checkmark-circle-outline" size={13} color={theme.colors.textSecondary} />
                                            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{t("machine.automationCompleted")}</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}
                    </SectionContainer>
                ) : null}

                {/* ── Jobs + Timeline ── */}
                {activeSection === "jobs" ? (
                    <SectionContainer title={t("machine.automationJobs")}>
                        {/* 核心指标 */}
                        <StatRow items={[
                            { label: t("machine.automationRunning"), value: activeCount, color: activeCount > 0 ? "#0A84FF" : undefined, dimmed: activeCount === 0 },
                            { label: t("machine.automationQueued"), value: queuedCount, color: queuedCount > 0 ? "#FF9500" : undefined, dimmed: queuedCount === 0 },
                            { label: t("machine.automationFailed"), value: failedCount, color: failedCount > 0 ? "#FF3B30" : undefined, dimmed: failedCount === 0 },
                            { label: t("machine.automationCompleted"), value: data.counts.completed ?? 0, dimmed: true },
                        ]} />

                        {/* 失败任务自动展示 */}
                        {data.filteredJobs.filter((j) => j.status === "failed").map((job) => (
                            <Pressable
                                key={job.id}
                                style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: "#FF3B30" }]}
                                onPress={() => handleJobPress(job)}
                            >
                                <View style={styles.dataCardHeader}>
                                    <View style={styles.dataCardTitleWrap}>
                                        <Text style={styles.dataCardTitle} numberOfLines={1}>{getJobTitle(job)}</Text>
                                        {job.errorMessage
                                            ? <Text style={[styles.dataCardSubtitle, { color: "#FF3B30" }]} numberOfLines={2}>{job.errorMessage}</Text>
                                            : null}
                                    </View>
                                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                                        <View style={[styles.statusBadge, { borderColor: "#FF3B30", backgroundColor: "#FF3B3018" }]}>
                                            <Text style={[styles.statusBadgeText, { color: "#FF3B30" }]}>{getStatusLabel(job.status)}</Text>
                                        </View>
                                        {data.activeJobId === job.id && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                                    </View>
                                </View>
                                <View style={styles.pillRow}>
                                    <View style={[styles.pill, { borderColor: "#FF3B3040" }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                    <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{formatTimestamp(job.updatedAt)}</Text></View>
                                </View>
                            </Pressable>
                        ))}

                        {/* 其余任务（折叠） */}
                        <SubToggle
                            label={t("machine.automationJobs")}
                            count={data.filteredJobs.filter((j) => j.status !== "failed").length}
                            expanded={data.showAllJobs}
                            onPress={() => data.setShowAllJobs((c) => !c)}
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

                        {/* 时间线（折叠） */}
                        <SubToggle
                            label={t("machine.automationTimeline")}
                            count={data.fullTimelineEntries.length}
                            expanded={data.showAllTimeline}
                            onPress={() => data.setShowAllTimeline((c) => !c)}
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

                        {/* 清除终态任务（危险操作底部文字链接） */}
                        <Pressable
                            style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                            onPress={() => Modal.alert(t("machine.automationClearTerminal"), t("machine.automationClearTerminalMessage"), [
                                { text: t("common.cancel"), style: "cancel" },
                                { text: t("machine.automationClearTerminal"), style: "destructive", onPress: () => void data.clearTerminal() },
                            ])}
                        >
                            <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t("machine.automationClearTerminal")}</Text>
                            {data.clearing ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : <Ionicons name="trash-outline" size={16} color={theme.colors.textLink} />}
                        </Pressable>
                    </SectionContainer>
                ) : null}

                {/* ── Guardians（状态连续性） ── */}
                {activeSection === "guardians" ? (
                    <SectionContainer title={t("machine.automationGuardians")}>
                        {data.guardians.length === 0 ? (
                            /* 无 Guardian 时 */
                            <View style={{ paddingHorizontal: 16, paddingBottom: 16, alignItems: "center", gap: 6 }}>
                                <Ionicons name="shield-outline" size={32} color={theme.colors.textSecondary} style={{ opacity: 0.35 }} />
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{t("machine.automationGuardiansEmpty")}</Text>
                            </View>
                        ) : (
                            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
                                {/* Total 大数字 + reuse rate */}
                                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                                    <Text style={{ fontSize: 36, fontWeight: "800", color: theme.colors.text }}>{data.guardians.length}</Text>
                                    <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>{t("machine.automationGuardians")}</Text>
                                    {data.auditStats && (
                                        <View style={{ marginLeft: "auto", backgroundColor: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C75918" : "#FF950018", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C75940" : "#FF950040" }}>
                                            <Text style={{ fontSize: 13, fontWeight: "700", color: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C759" : "#FF9500" }}>
                                                {`${t("machine.automationGuardianReuseRate")} ${formatRate(data.auditStats.guardianReuseRate)}`}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                                {/* 状态 chips（只显示非 0） */}
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                    {[
                                        { key: "attached",  value: data.guardians.filter((g) => g.attached && !g.recovered).length,  label: t("machine.automationGuardianAttached"),  color: "#34C759", icon: "link-outline" as const },
                                        { key: "persisted", value: data.guardians.filter((g) => !g.attached).length,                 label: t("machine.automationGuardianPersisted"), color: "#8E8E93", icon: "save-outline" as const },
                                        { key: "recovered", value: data.guardians.filter((g) => g.recovered).length,                  label: t("machine.automationGuardianRecovered"),  color: "#FF9500", icon: "refresh-circle-outline" as const },
                                    ].filter((s) => s.value > 0).map((s) => (
                                        <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: s.color + "14", borderRadius: 8, borderWidth: 1, borderColor: s.color + "40", paddingHorizontal: 10, paddingVertical: 5 }}>
                                            <Ionicons name={s.icon} size={13} color={s.color} />
                                            <Text style={{ fontSize: 13, fontWeight: "700", color: s.color }}>{s.value}</Text>
                                            <Text style={{ fontSize: 12, color: s.color }}>{s.label}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        {/* Guardian 列表（折叠） */}
                        <SubToggle
                            label={t("machine.automationGuardians")}
                            count={data.filteredGuardians.length}
                            expanded={data.showAllGuardians}
                            onPress={() => data.setShowAllGuardians((c) => !c)}
                            accent={data.filteredGuardians.length > 0 ? "#34C759" : undefined}
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
                                {/* 使用统计（折叠） */}
                                <SubToggle
                                    label={t("machine.automationGuardianUsage")}
                                    count={data.filteredGuardianUsage.length}
                                    expanded={data.showAllGuardianUsage}
                                    onPress={() => data.setShowAllGuardianUsage((c) => !c)}
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
                    </SectionContainer>
                ) : null}

                {/* ── Audit（技术日志） ── */}
                {activeSection === "audit" ? (
                    <SectionContainer
                        title={t("machine.automationAuditStats")}
                        rightAction={data.auditStats?.lastEventAt
                            ? <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{formatTimestamp(data.auditStats.lastEventAt)}</Text>
                            : undefined}
                    >
                        {(data.auditStats?.totalEvents ?? 0) === 0 ? (
                            /* 无审计事件时 */
                            <View style={{ paddingHorizontal: 16, paddingBottom: 16, alignItems: "center", gap: 6 }}>
                                <Ionicons name="document-text-outline" size={32} color={theme.colors.textSecondary} style={{ opacity: 0.35 }} />
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{t("machine.automationAuditEmpty")}</Text>
                            </View>
                        ) : (
                            <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
                                {/* Total 大数字 + reuse rate */}
                                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                                    <Text style={{ fontSize: 36, fontWeight: "800", color: theme.colors.text }}>{data.auditStats?.totalEvents ?? 0}</Text>
                                    <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>{t("machine.automationTotalAuditEvents")}</Text>
                                    {data.auditStats && (data.auditStats.guardianReuseRate ?? 0) > 0 && (
                                        <View style={{ marginLeft: "auto", backgroundColor: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C75918" : "#FF950018", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C75940" : "#FF950040" }}>
                                            <Text style={{ fontSize: 13, fontWeight: "700", color: (data.auditStats.guardianReuseRate ?? 0) > 0.5 ? "#34C759" : "#FF9500" }}>
                                                {`${t("machine.automationGuardianReuseRate")} ${formatRate(data.auditStats.guardianReuseRate)}`}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                                {/* 异常指标 chips（只显示非 0） */}
                                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                    {[
                                        { key: "reuse",    value: data.auditStats?.guardianReuseCount ?? 0,      label: t("machine.automationGuardianReuseCount"),      color: "#0A84FF", icon: "repeat-outline" as const },
                                        { key: "reattach", value: data.auditStats?.sessionReattachedCount ?? 0,  label: t("machine.automationSessionReattachedCount"),   color: "#34C759", icon: "refresh-outline" as const },
                                        { key: "watchdog", value: data.auditStats?.watchdogStopCount ?? 0,       label: t("machine.automationWatchdogStops"),            color: "#FF3B30", icon: "warning-outline" as const },
                                        { key: "reset",    value: data.auditStats?.guardianResetCount ?? 0,      label: t("machine.automationGuardianResetCount"),       color: "#FF9500", icon: "trash-outline" as const },
                                    ].filter((s) => s.value > 0).map((s) => (
                                        <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: s.color + "14", borderRadius: 8, borderWidth: 1, borderColor: s.color + "40", paddingHorizontal: 10, paddingVertical: 5 }}>
                                            <Ionicons name={s.icon} size={13} color={s.color} />
                                            <Text style={{ fontSize: 13, fontWeight: "700", color: s.color }}>{s.value}</Text>
                                            <Text style={{ fontSize: 12, color: s.color }}>{s.label}</Text>
                                        </View>
                                    ))}
                                    {/* 全为 0 时显示健康状态 */}
                                    {(data.auditStats?.watchdogStopCount ?? 0) === 0 && (data.auditStats?.guardianResetCount ?? 0) === 0 && (
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#34C75914", borderRadius: 8, borderWidth: 1, borderColor: "#34C75940", paddingHorizontal: 10, paddingVertical: 5 }}>
                                            <Ionicons name="checkmark-circle-outline" size={13} color="#34C759" />
                                            <Text style={{ fontSize: 12, color: "#34C759" }}>{t("common.ok") ?? "无异常"}</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                        {/* 审计事件列表（折叠） */}
                        <SubToggle
                            label={t("machine.automationAudit")}
                            count={data.filteredAuditEvents.length}
                            expanded={data.showAllAuditEvents}
                            onPress={() => data.setShowAllAuditEvents((c) => !c)}
                        />
                        {data.showAllAuditEvents ? (
                            <>
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
                                {/* 清除审计日志（危险操作底部） */}
                                <Pressable
                                    style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                                    onPress={() => Modal.alert(t("machine.automationClearAudit"), t("machine.automationClearAuditMessage"), [
                                        { text: t("common.cancel"), style: "cancel" },
                                        { text: t("machine.automationClearAudit"), style: "destructive", onPress: () => void data.clearAudit() },
                                    ])}
                                >
                                    <Text style={{ fontSize: 14, color: theme.colors.textLink }}>{t("machine.automationClearAudit")}</Text>
                                    {data.clearingAudit ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : <Ionicons name="trash-outline" size={16} color={theme.colors.textLink} />}
                                </Pressable>
                            </>
                        ) : null}
                    </SectionContainer>
                ) : null}

            </View>
        </ScrollView>
    );
});
