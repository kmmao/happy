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

function PipelineNode(props: {
    label: string;
    count: number;
    accent?: string;
    isLast?: boolean;
    isActive?: boolean;
    onPress?: () => void;
}) {
    const activeAccent = props.accent ?? "#8E8E93";
    return (
        <Pressable
            style={styles.pipelineNodeWrap}
            onPress={props.onPress}
            disabled={!props.onPress}
        >
            <View
                style={[
                    styles.pipelineNode,
                    { borderColor: props.isActive ? activeAccent : undefined },
                    props.isActive ? { backgroundColor: activeAccent + "18" } : null,
                ]}
            >
                <Text style={[styles.pipelineNodeCount, { color: props.isActive ? activeAccent : undefined }]}>
                    {props.count}
                </Text>
                <Text
                    style={[styles.pipelineNodeLabel, props.isActive ? { color: activeAccent, fontWeight: "700" } : null]}
                    numberOfLines={1}
                >
                    {props.label}
                </Text>
            </View>
            {!props.isLast ? <Text style={styles.pipelineArrow}>{"→"}</Text> : null}
        </Pressable>
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
        } catch {
            // best-effort
        }
    }, [machineId, isKilled]);

    const toggleKillswitch = React.useCallback(() => {
        const title = isKilled ? t("machine.automationResume") : t("machine.automationEmergencyStop");
        const message = isKilled
            ? t("machine.automationResumeConfirm")
            : t("machine.automationEmergencyStopConfirm");
        Modal.alert(title, message, [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: title,
                style: isKilled ? "default" : "destructive",
                onPress: () => void doToggleKillswitch(),
            },
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

    // ── Event handlers ──────────────────────────────────────────────────

    const handleJobPress = React.useCallback((job: MachineAutomationJob) => {
        const relatedEvents = data.recentAuditEvents.filter((event) => event.jobId === job.id
            || event.dedupeKey === job.dedupeKey
            || (job.sessionId ? event.sessionId === job.sessionId : false)
            || (job.runId ? event.runId === job.runId : false)
        );
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (job.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (job.kind === "agent_loop") {
                        router.push(`/machine/${machineId}/loops?loopId=${job.loopId}` as any);
                        return;
                    }
                    const localProjectId = getLocalProjectId(job.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}/supervisor-loop/${job.loopId}` as any);
                    }
                },
            });
        }
        if (job.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(job.projectId);
                    if (localProjectId) router.push(`/project/${localProjectId}` as any);
                },
            });
        }
        if (job.sessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${job.sessionId}` as any),
            });
        }
        if (job.status === "queued") {
            buttons.push({
                text: t("machine.automationCancel"),
                style: "destructive",
                onPress: () => void data.mutateAndReload(job.id, "cancel"),
            });
        }
        if ((job.status === "running" || job.status === "dispatching") && job.sessionId) {
            buttons.push({
                text: t("machine.automationStop"),
                style: "destructive",
                onPress: () => void data.stopJobSession(job.id, job.sessionId!),
            });
        }
        if (job.status === "failed" || job.status === "cancelled" || job.status === "completed") {
            buttons.push({
                text: t("machine.automationRetry"),
                onPress: () => void data.mutateAndReload(job.id, "retry"),
            });
        }
        Modal.alert(getJobTitle(job), getJobDetailMessage(job, relatedEvents), buttons);
    }, [data.mutateAndReload, data.recentAuditEvents, data.stopJobSession, getLocalProjectId, machineId, router]);

    const handleGuardianPress = React.useCallback((guardian: MachineAutomationGuardian) => {
        const usage = data.guardianUsage.find((entry) => entry.key === guardian.key);
        const relatedEvents = data.recentAuditEvents.filter((event) => event.guardianKey === guardian.key || event.sessionId === guardian.sessionId);
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (guardian.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(guardian.projectId);
                    if (localProjectId) router.push(`/project/${localProjectId}` as any);
                },
            });
        }
        if (guardian.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (guardian.key.startsWith("agent-loop:")) {
                        router.push(`/machine/${machineId}/loops?loopId=${guardian.loopId}` as any);
                        return;
                    }
                    const localProjectId = getLocalProjectId(guardian.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}/supervisor-loop/${guardian.loopId}` as any);
                    }
                },
            });
        }
        buttons.push({
            text: t("machine.automationOpenSession"),
            onPress: () => router.push(`/session/${guardian.sessionId}` as any),
        });
        buttons.push({
            text: t("machine.automationResetGuardian"),
            style: "destructive",
            onPress: () => {
                Modal.alert(
                    t("machine.automationResetGuardian"),
                    t("machine.automationResetGuardianMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                            text: t("machine.automationResetGuardian"),
                            style: "destructive",
                            onPress: () => void data.clearGuardians({ key: guardian.key, sessionId: guardian.sessionId }),
                        },
                    ],
                );
            },
        });
        Modal.alert(
            guardian.key,
            `${getGuardianDetailMessage(guardian, usage, relatedEvents)}\n${t("machine.automationStatusLabel")}: ${getGuardianStateLabel(guardian.attached, guardian.recovered)}`,
            buttons,
        );
    }, [data.clearGuardians, data.guardianUsage, data.recentAuditEvents, getLocalProjectId, machineId, router]);

    const handleAuditEventPress = React.useCallback((event: MachineAutomationAuditEvent) => {
        const relatedJob = data.jobs.find((job) => job.id === event.jobId || job.dedupeKey === event.dedupeKey || (event.sessionId ? job.sessionId === event.sessionId : false));
        const buttons: Array<{ text: string; style?: "cancel" | "default"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (event.sessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${event.sessionId}` as any),
            });
        }
        if (event.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (event.trigger?.startsWith("agent_loop")) {
                        router.push(`/machine/${machineId}/loops?loopId=${event.loopId}` as any);
                        return;
                    }
                    const localProjectId = getLocalProjectId(event.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}/supervisor-loop/${event.loopId}` as any);
                    }
                },
            });
        }
        if (event.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(event.projectId);
                    if (localProjectId) router.push(`/project/${localProjectId}` as any);
                },
            });
        }
        if (relatedJob) {
            buttons.push({
                text: t("machine.automationOpenJob"),
                onPress: () => handleJobPress(relatedJob),
            });
        }
        Modal.alert(getAuditEventTitle(event), getAuditEventDetailMessage(event), buttons);
    }, [data.jobs, getLocalProjectId, handleJobPress, machineId, router]);

    // ── Render ──────────────────────────────────────────────────────────

    if (data.loading && !data.status) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.text} />
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void data.load("refresh")} />}
        >
            {/* RPC connecting notice */}
            {!data.rpcReady ? (
                <View style={styles.rpcNotice}>
                    <Text style={styles.rpcNoticeTitle}>{t("status.connecting")}</Text>
                    <Text style={styles.rpcNoticeText}>{t("machine.automationViewAllHint")}</Text>
                </View>
            ) : null}

            {/* Killswitch */}
            {data.rpcReady ? (
                <Pressable
                    style={[styles.killswitchButton, { backgroundColor: isKilled ? theme.colors.success : theme.colors.deleteAction }]}
                    onPress={toggleKillswitch}
                >
                    <Ionicons name={isKilled ? "play-circle" : "stop-circle"} size={20} color="#fff" />
                    <Text style={styles.killswitchText}>
                        {isKilled ? t("machine.automationResume") : t("machine.automationEmergencyStop")}
                    </Text>
                </Pressable>
            ) : null}

            {/* ── Pipeline: interactive section selector ── */}
            <View style={styles.pipelineContainer}>
                <Text style={styles.pipelineTitle}>{t("machine.automationPipelineTitle")}</Text>
                <View style={styles.pipelineRow}>
                    <PipelineNode
                        label={t("machine.automationLoopsTotal")}
                        count={data.loopRollup.total}
                        accent="#0A84FF"
                        isActive={activeSection === "loops"}
                        onPress={() => toggleSection("loops")}
                    />
                    <PipelineNode
                        label={t("machine.automationJobs")}
                        count={data.jobs.length}
                        accent={(data.counts.running ?? 0) + (data.counts.dispatching ?? 0) > 0 ? "#0A84FF" : undefined}
                        isActive={activeSection === "jobs"}
                        onPress={() => toggleSection("jobs")}
                    />
                    <PipelineNode
                        label={t("machine.automationGuardians")}
                        count={data.guardians.length}
                        accent={data.guardians.length > 0 ? "#34C759" : undefined}
                        isActive={activeSection === "guardians"}
                        onPress={() => toggleSection("guardians")}
                    />
                    <PipelineNode
                        label={t("machine.automationAudit")}
                        count={data.recentAuditEvents.length}
                        isLast
                        isActive={activeSection === "audit"}
                        onPress={() => toggleSection("audit")}
                    />
                </View>
            </View>

            {/* Alert cards — always visible */}
            {data.alertCards.length > 0 ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
                    {data.alertCards.map((alert) => {
                        const accent = alert.kind === "anomalies" ? "#FF3B30" : alert.kind === "recovered" ? "#34C759" : "#FF9500";
                        const title = alert.kind === "anomalies"
                            ? t("machine.automationAnomaliesDetected")
                            : alert.kind === "recovered"
                                ? t("machine.automationRecoveredSessions")
                                : t("machine.automationGuardianRecoveryNeeded");
                        const subtitle = alert.kind === "anomalies"
                            ? `${t("machine.automationFailed")}: ${data.counts.failed ?? 0} · ${t("machine.automationWatchdogStops")}: ${data.auditStats?.watchdogStopCount ?? 0}`
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

            {/* Overview summary — always visible */}
            <ItemGroup title={t("machine.automation")}>
                <View style={styles.summaryGrid}>
                    {data.overviewCards.map((card) => {
                        const titleMap: Record<string, string> = {
                            running: t("machine.automationRunning"),
                            queued: t("machine.automationQueued"),
                            completed: t("machine.automationCompleted"),
                            alerts: t("machine.automationAlerts"),
                            guardians: t("machine.automationGuardians"),
                        };
                        const hintMap: Record<string, string> = {
                            running: t("machine.automationRunningHint"),
                            queued: t("machine.automationQueuedHint"),
                            completed: t("machine.automationCompletedHint"),
                            alerts: t("machine.automationAnomaliesDetected"),
                            guardians: t("machine.automationGuardiansHint"),
                        };
                        return renderSummaryCard({
                            title: titleMap[card.kind] ?? card.kind,
                            value: card.value,
                            hint: hintMap[card.kind] ?? "",
                            accent: card.accent,
                        });
                    })}
                </View>
                <Item
                    title={t("machine.automationClearTerminal")}
                    subtitle={t("machine.automationClearTerminalHint")}
                    titleStyle={{ color: theme.colors.textLink }}
                    onPress={() => {
                        Modal.alert(
                            t("machine.automationClearTerminal"),
                            t("machine.automationClearTerminalMessage"),
                            [
                                { text: t("common.cancel"), style: "cancel" },
                                { text: t("machine.automationClearTerminal"), style: "destructive", onPress: () => void data.clearTerminal() },
                            ],
                        );
                    }}
                    rightElement={data.clearing ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                />
            </ItemGroup>

            {/* ── Section content (conditional on activeSection) ── */}
            <View>
                {/* Loops */}
                {activeSection === "loops" ? (
                    <ItemGroup title={<Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>{t("machine.automationLoopRollup")}</Text>}>
                        <View style={styles.summaryGrid}>
                            {renderSummaryCard({ title: t("machine.automationLoopsTotal"), value: String(data.loopRollup.total), hint: t("machine.automationLoopsTotalHint") })}
                            {renderSummaryCard({ title: t("machine.automationLoopsActive"), value: String(data.loopRollup.active), hint: t("machine.automationLoopsActiveHint"), accent: "#0A84FF" })}
                            {renderSummaryCard({ title: t("machine.automationLoopsBlocked"), value: String(data.loopRollup.blocked), hint: t("machine.automationLoopsBlockedHint"), accent: "#FF3B30" })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPaused"), value: String(data.loopRollup.paused), hint: t("machine.automationLoopsPausedHint"), accent: theme.colors.textSecondary })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPendingEvents"), value: String(data.loopRollup.pendingEvents), hint: t("machine.automationLoopsPendingEventsHint") })}
                            {renderSummaryCard({ title: t("machine.automationLoopsPolicyStopped"), value: String(data.loopRollup.policyStopped), hint: t("machine.automationLoopsPolicyStoppedHint"), accent: "#FF9500" })}
                        </View>
                        <Item
                            title={t("machine.automationOpenLoops")}
                            subtitle={t("machine.automationOpenLoopsHint")}
                            titleStyle={{ color: theme.colors.textLink }}
                            onPress={() => router.push(`/machine/${machineId}/loops` as any)}
                        />
                    </ItemGroup>
                ) : null}

                {/* Jobs + Timeline */}
                {activeSection === "jobs" ? (
                    <ItemGroup title={<Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>{t("machine.automationJobs")}</Text>}>
                        {/* Jobs toggle → job cards immediately below */}
                        <Item
                            title={`${t("machine.automationJobs")} (${data.filteredJobs.length})`}
                            subtitle={data.filteredJobs.length === 0
                                ? t("machine.automationDetailsEmpty")
                                : `${t("machine.automationRunning")}: ${(data.counts.running ?? 0) + (data.counts.dispatching ?? 0)} · ${t("machine.automationQueued")}: ${data.counts.queued ?? 0} · ${t("machine.automationFailed")}: ${data.counts.failed ?? 0}`}
                            detail={data.showAllJobs ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllJobs((c) => !c)}
                            showChevron={!data.showAllJobs && data.filteredJobs.length > 0}
                        />
                        {data.showAllJobs ? data.filteredJobs.map((job) => {
                            const statusColor = getStatusColor(job.status) ?? theme.colors.divider;
                            return (
                                <Pressable
                                    key={job.id}
                                    style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: statusColor }]}
                                    onPress={() => handleJobPress(job)}
                                >
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
                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}>
                                            <Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text>
                                        </View>
                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}>
                                            <Text style={styles.pillText}>{formatTimestamp(job.createdAt)}</Text>
                                        </View>
                                        {job.loopId ? (
                                            <View style={[styles.pill, { borderColor: theme.colors.divider }]}>
                                                <Text style={styles.pillText}>{data.resolveLoopName(job.loopId) ?? job.loopId.slice(0, 8)}</Text>
                                            </View>
                                        ) : null}
                                    </View>
                                </Pressable>
                            );
                        }) : null}

                        {/* Timeline toggle → timeline cards immediately below */}
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
                    </ItemGroup>
                ) : null}

                {/* Guardians */}
                {activeSection === "guardians" ? (
                    <ItemGroup title={<Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>{t("machine.automationGuardians")}</Text>}>
                        {/* Guardians toggle → guardian cards immediately below */}
                        <Item
                            title={`${t("machine.automationGuardians")} (${data.filteredGuardians.length})`}
                            subtitle={data.filteredGuardians.length === 0
                                ? t("machine.automationGuardiansEmpty")
                                : `${t("machine.automationGuardianAttached")}: ${data.filteredGuardians.filter((g) => g.attached).length} · ${t("machine.automationGuardianPersisted")}: ${data.filteredGuardians.filter((g) => !g.attached).length}`}
                            detail={data.showAllGuardians ? t("machine.automationSectionShowLess") : undefined}
                            onPress={() => data.setShowAllGuardians((c) => !c)}
                            showChevron={!data.showAllGuardians && data.filteredGuardians.length > 0}
                        />
                        {data.showAllGuardians ? (
                            <>
                                {data.visibleGuardians.map((guardian: MachineAutomationGuardian) => {
                                    const gColor = guardian.recovered ? "#FF9500" : guardian.attached ? "#34C759" : theme.colors.textSecondary;
                                    return (
                                        <Pressable
                                            key={guardian.key}
                                            style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: gColor }]}
                                            onPress={() => handleGuardianPress(guardian)}
                                        >
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

                                {/* Guardian usage toggle → usage cards immediately below */}
                                <Item
                                    title={`${t("machine.automationGuardianUsage")} (${data.filteredGuardianUsage.length})`}
                                    subtitle={t("machine.automationGuardianUsageHint")}
                                    detail={data.showAllGuardianUsage ? t("machine.automationSectionShowLess") : undefined}
                                    onPress={() => data.setShowAllGuardianUsage((c) => !c)}
                                    showChevron={!data.showAllGuardianUsage && data.filteredGuardianUsage.length > 0}
                                />
                                {data.showAllGuardianUsage ? data.visibleGuardianUsage.map((entry: MachineAutomationGuardianUsage) => {
                                    const matchingGuardian = data.guardians.find((g) => g.key === entry.key);
                                    const onPress = matchingGuardian
                                        ? () => handleGuardianPress(matchingGuardian)
                                        : entry.currentSessionId
                                            ? () => router.push(`/session/${entry.currentSessionId}` as any)
                                            : undefined;
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
                                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianRememberCount")}: ${entry.rememberCount}`}</Text></View>
                                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianResetCount")}: ${entry.resetCount}`}</Text></View>
                                            </View>
                                        </Pressable>
                                    );
                                }) : null}
                            </>
                        ) : null}
                    </ItemGroup>
                ) : null}

                {/* Audit Stats + Events */}
                {activeSection === "audit" ? (
                    <ItemGroup title={<Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>{t("machine.automationAuditStats")}</Text>}>
                        <View style={styles.summaryGrid}>
                            {renderSummaryCard({ title: t("machine.automationTotalAuditEvents"), value: String(data.auditStats?.totalEvents ?? 0), hint: t("machine.automationTotalAuditEventsHint") })}
                            {renderSummaryCard({ title: t("machine.automationGuardianReuseCount"), value: String(data.auditStats?.guardianReuseCount ?? 0), hint: t("machine.automationGuardianReuseCountHint"), accent: "#0A84FF" })}
                            {renderSummaryCard({ title: t("machine.automationGuardianReuseRate"), value: formatRate(data.auditStats?.guardianReuseRate), hint: t("machine.automationGuardianReuseRateHint") })}
                            {renderSummaryCard({ title: t("machine.automationGuardianResetCount"), value: String(data.auditStats?.guardianResetCount ?? 0), hint: t("machine.automationGuardianResetCountHint"), accent: "#FF9500" })}
                            {renderSummaryCard({ title: t("machine.automationSessionReattachedCount"), value: String(data.auditStats?.sessionReattachedCount ?? 0), hint: t("machine.automationSessionReattachedCountHint"), accent: "#34C759" })}
                            {renderSummaryCard({ title: t("machine.automationWatchdogStops"), value: String(data.auditStats?.watchdogStopCount ?? 0), hint: t("machine.automationWatchdogStopsHint"), accent: "#FF3B30" })}
                        </View>
                        <Item
                            title={t("machine.automationLastAuditEvent")}
                            subtitle={t("machine.automationLastAuditEventHint")}
                            detail={data.auditStats?.lastEventAt ? formatTimestamp(data.auditStats.lastEventAt) : "-"}
                            showChevron={false}
                        />

                        {/* Audit events toggle → event cards immediately below */}
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
                                    title={t("machine.automationClearAudit")}
                                    subtitle={t("machine.automationClearAuditHint")}
                                    titleStyle={{ color: theme.colors.textLink }}
                                    onPress={() => {
                                        Modal.alert(
                                            t("machine.automationClearAudit"),
                                            t("machine.automationClearAuditMessage"),
                                            [
                                                { text: t("common.cancel"), style: "cancel" },
                                                { text: t("machine.automationClearAudit"), style: "destructive", onPress: () => void data.clearAudit() },
                                            ],
                                        );
                                    }}
                                    rightElement={data.clearingAudit ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                                {data.visibleAuditEvents.map((event: MachineAutomationAuditEvent) => {
                                    const aAccent = getAuditKindAccent(event) ?? theme.colors.divider;
                                    return (
                                        <Pressable
                                            key={event.id}
                                            style={[styles.dataCard, { borderLeftWidth: 4, borderLeftColor: aAccent }]}
                                            onPress={() => handleAuditEventPress(event)}
                                        >
                                            <View style={styles.dataCardHeader}>
                                                <View style={styles.dataCardTitleWrap}>
                                                    <Text style={styles.dataCardTitle} numberOfLines={1}>{getAuditEventTitle(event)}</Text>
                                                    <Text style={styles.dataCardSubtitle} numberOfLines={2}>{event.message || getAuditEventSubtitle(event) || t("machine.automationAudit")}</Text>
                                                </View>
                                                <Text style={[styles.dataCardTimestamp, { color: aAccent }]}>{formatTimestamp(event.occurredAt)}</Text>
                                            </View>
                                            {(event.guardianKey || event.loopId) ? (
                                                <View style={styles.pillRow}>
                                                    {event.guardianKey ? (
                                                        <View style={[styles.pill, { borderColor: aAccent + "80" }]}>
                                                            <Text style={styles.pillText}>{data.resolveGuardianKeyLabel(event.guardianKey)}</Text>
                                                        </View>
                                                    ) : null}
                                                    {event.loopId ? (
                                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}>
                                                            <Text style={styles.pillText}>{data.resolveLoopName(event.loopId) ?? event.loopId.slice(0, 8)}</Text>
                                                        </View>
                                                    ) : null}
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
