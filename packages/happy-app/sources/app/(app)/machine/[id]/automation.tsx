import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
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
    getPriorityLabel,
    getStatusColor,
    getStatusLabel,
} from "./automationLabels";
import { styles } from "./automationStyles";
import { useAutomationData } from "./useAutomationData";

function PipelineNode(props: {
    label: string;
    count: number;
    accent?: string;
    isLast?: boolean;
}) {
    return (
        <View style={styles.pipelineNodeWrap}>
            <View style={[styles.pipelineNode, props.accent ? { borderColor: props.accent } : null]}>
                <Text style={[styles.pipelineNodeCount, props.accent ? { color: props.accent } : null]}>
                    {props.count}
                </Text>
                <Text style={styles.pipelineNodeLabel} numberOfLines={1}>
                    {props.label}
                </Text>
            </View>
            {!props.isLast ? (
                <Text style={styles.pipelineArrow}>{"→"}</Text>
            ) : null}
        </View>
    );
}

function renderSectionTitle(title: string, hint: string) {
    return (
        <View style={{ gap: 2 }}>
            <Text style={styles.sectionTitleText}>{title.toUpperCase()}</Text>
            <Text style={styles.sectionHint}>{hint}</Text>
        </View>
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
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}` as any);
                    }
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
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}` as any);
                    }
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
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}` as any);
                    }
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
            {!data.rpcReady ? (
                <View style={styles.rpcNotice}>
                    <Text style={styles.rpcNoticeTitle}>{t("status.connecting")}</Text>
                    <Text style={styles.rpcNoticeText}>{t("machine.automationViewAllHint")}</Text>
                </View>
            ) : null}
            {data.rpcReady ? (
                <Pressable
                    style={[
                        styles.killswitchButton,
                        { backgroundColor: isKilled ? theme.colors.success : theme.colors.deleteAction },
                    ]}
                    onPress={toggleKillswitch}
                >
                    <Ionicons
                        name={isKilled ? "play-circle" : "stop-circle"}
                        size={20}
                        color="#fff"
                    />
                    <Text style={styles.killswitchText}>
                        {isKilled ? t("machine.automationResume") : t("machine.automationEmergencyStop")}
                    </Text>
                </Pressable>
            ) : null}
            <View style={styles.filterPanel}>
                <Pressable
                    style={styles.panelHeaderRow}
                    onPress={() => data.setOverviewFiltersExpanded((current) => !current)}
                    accessibilityRole="button"
                    accessibilityLabel={data.overviewFiltersExpanded ? t("machine.automationFiltersCollapse") : t("machine.automationFiltersExpand")}
                >
                    <View style={styles.panelHeaderTextCol}>
                        <Text style={styles.panelTitle}>{t("machine.automationOverviewTitle")}</Text>
                        {data.overviewFiltersExpanded ? (
                            <Text style={styles.panelSubtitle}>{t("machine.automationOverviewHint")}</Text>
                        ) : null}
                    </View>
                    <Ionicons
                        name={data.overviewFiltersExpanded ? "chevron-up-outline" : "chevron-down-outline"}
                        size={22}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
                <TextInput
                    style={styles.searchInput}
                    value={data.searchQuery}
                    onChangeText={data.setSearchQuery}
                    placeholder={t("machine.automationSearchPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
                {data.overviewFiltersExpanded ? (
                    <>
                        <Text style={styles.panelHint}>{t("machine.automationSearchHint")}</Text>
                        <Text style={styles.filterLabel}>{t("machine.automationJobFilters")}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                            {([
                                ["all", t("machine.automationFilterAll")],
                                ["running", t("machine.automationFilterRunning")],
                                ["failed", t("machine.automationFilterFailed")],
                                ["terminal", t("machine.automationFilterTerminal")],
                                ["recovered", t("machine.automationFilterRecovered")],
                            ] as Array<[JobFilter, string]>).map(([value, label]) => (
                                <Pressable
                                    key={value}
                                    style={[styles.filterChip, data.jobFilter === value && styles.filterChipSelected]}
                                    onPress={() => data.setJobFilter(value)}
                                >
                                    <Text style={[styles.filterChipText, data.jobFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                        <Text style={styles.filterLabel}>{t("machine.automationAuditFilters")}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                            {([
                                ["all", t("machine.automationFilterAll")],
                                ["anomalies", t("machine.automationFilterAnomalies")],
                                ["guardian", t("machine.automationFilterGuardian")],
                                ["jobs", t("machine.automationFilterJobs")],
                                ["recovered", t("machine.automationFilterRecovered")],
                            ] as Array<[AuditFilter, string]>).map(([value, label]) => (
                                <Pressable
                                    key={value}
                                    style={[styles.filterChip, data.auditFilter === value && styles.filterChipSelected]}
                                    onPress={() => data.setAuditFilter(value)}
                                >
                                    <Text style={[styles.filterChipText, data.auditFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                        <Text style={styles.filterLabel}>{t("machine.automationGuardians")}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                            {([
                                ["all", t("machine.automationFilterAll")],
                                ["attached", t("machine.automationGuardianAttached")],
                                ["persisted", t("machine.automationGuardianPersisted")],
                                ["recovered", t("machine.automationFilterRecovered")],
                            ] as Array<[GuardianFilter, string]>).map(([value, label]) => (
                                <Pressable
                                    key={value}
                                    style={[styles.filterChip, data.guardianFilter === value && styles.filterChipSelected]}
                                    onPress={() => data.setGuardianFilter(value)}
                                >
                                    <Text style={[styles.filterChipText, data.guardianFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </>
                ) : null}
                <Text style={styles.filterSummary}>{`${data.filteredJobs.length}/${data.jobs.length} jobs • ${data.filteredGuardians.length}/${data.guardians.length} guardians • ${data.filteredAuditEvents.length}/${data.recentAuditEvents.length} audit`}</Text>
            </View>

            <View style={styles.pipelineContainer}>
                <Text style={styles.pipelineTitle}>{t("machine.automationPipelineTitle")}</Text>
                <View style={styles.pipelineRow}>
                    <PipelineNode label={t("machine.automationLoopsTotal")} count={data.loopRollup.total} accent="#0A84FF" />
                    <PipelineNode label={t("machine.automationJobs")} count={data.jobs.length} accent={(data.counts.running ?? 0) + (data.counts.dispatching ?? 0) > 0 ? "#0A84FF" : undefined} />
                    <PipelineNode label={t("machine.automationGuardians")} count={data.guardians.length} accent={data.guardians.length > 0 ? "#34C759" : undefined} />
                    <PipelineNode label={t("machine.automationAudit")} count={data.recentAuditEvents.length} isLast />
                </View>
            </View>

            <ItemList>
                {data.alertCards.length > 0 ? (
                    <ItemGroup title={renderSectionTitle(t("machine.automationAlerts"), t("machine.automationSectionAlerts"))}>
                        {data.alertCards.map((alert) => {
                            if (alert.kind === "anomalies") {
                                return (
                                    <Item
                                        key={alert.kind}
                                        title={t("machine.automationAnomaliesDetected")}
                                        subtitle={`${t("machine.automationFailed")}: ${data.counts.failed ?? 0} • ${t("machine.automationWatchdogStops")}: ${data.auditStats?.watchdogStopCount ?? 0}`}
                                        detail={String(alert.count)}
                                        detailStyle={{ color: "#FF3B30" }}
                                        showChevron={false}
                                    />
                                );
                            }
                            if (alert.kind === "recovered") {
                                return (
                                    <Item
                                        key={alert.kind}
                                        title={t("machine.automationRecoveredSessions")}
                                        subtitle={`${t("machine.automationRecoveredGuardians")}: ${data.guardians.filter((guardian) => guardian.recovered).length} • ${t("machine.automationRecoveredJobs")}: ${data.jobs.filter((job) => job.recovered).length}`}
                                        detail={String(alert.count)}
                                        detailStyle={{ color: "#34C759" }}
                                        showChevron={false}
                                    />
                                );
                            }
                            return (
                                <Item
                                    key={alert.kind}
                                    title={t("machine.automationGuardianRecoveryNeeded")}
                                    subtitle={t("machine.automationGuardianRecoveryNeededMessage")}
                                    detail={String(alert.count)}
                                    detailStyle={{ color: "#FF9500" }}
                                    showChevron={false}
                                />
                            );
                        })}
                    </ItemGroup>
                ) : null}
                <ItemGroup title={renderSectionTitle(t("machine.automation"), t("machine.automationSectionOverview"))}>
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
                            const title = titleMap[card.kind] ?? card.kind;
                            const hint = hintMap[card.kind] ?? "";
                            return renderSummaryCard({
                                title,
                                value: card.value,
                                hint,
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
                                    {
                                        text: t("machine.automationClearTerminal"),
                                        style: "destructive",
                                        onPress: () => void data.clearTerminal(),
                                    },
                                ],
                            );
                        }}
                        rightElement={data.clearing ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                    />
                </ItemGroup>

                {/* ── 任务 + 时间线（合并） ── */}
                <ItemGroup title={renderSectionTitle(t("machine.automationJobs"), t("machine.automationSectionJobs"))}>
                    <Item
                        title={`${t("machine.automationJobs")} (${data.filteredJobs.length})`}
                        subtitle={data.filteredJobs.length === 0 ? t("machine.automationDetailsEmpty") : `${t("machine.automationRunning")}: ${(data.counts.running ?? 0) + (data.counts.dispatching ?? 0)} • ${t("machine.automationQueued")}: ${data.counts.queued ?? 0} • ${t("machine.automationFailed")}: ${data.counts.failed ?? 0}`}
                        detail={data.showAllJobs ? t("machine.automationSectionShowLess") : undefined}
                        onPress={() => data.setShowAllJobs((current) => !current)}
                        showChevron={!data.showAllJobs && data.filteredJobs.length > 0}
                    />
                    <Item
                        title={`${t("machine.automationTimeline")} (${data.fullTimelineEntries.length})`}
                        subtitle={data.fullTimelineEntries.length === 0 ? t("machine.automationTimelineEmpty") : t("machine.automationTimelineHint")}
                        detail={data.showAllTimeline ? t("machine.automationSectionShowLess") : undefined}
                        onPress={() => data.setShowAllTimeline((current) => !current)}
                        showChevron={!data.showAllTimeline && data.fullTimelineEntries.length > 0}
                    />
                    {data.showAllTimeline ? data.visibleTimelineEntries.map((entry) => {
                        const job = data.jobs.find((candidate) => candidate.id === entry.jobId);
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
                    {data.showAllJobs ? data.filteredJobs.map((job) => (
                        <Pressable key={job.id} style={styles.dataCard} onPress={() => handleJobPress(job)}>
                            <View style={styles.dataCardHeader}>
                                <View style={styles.dataCardTitleWrap}>
                                    <Text style={styles.dataCardTitle}>{getJobTitle(job)}</Text>
                                    <Text style={styles.dataCardSubtitle}>{formatJobSubtitle(job, data.resolveGuardianKeyLabel)}</Text>
                                </View>
                                <View style={styles.statusWrap}>
                                    <View style={[styles.statusBadge, { borderColor: getStatusColor(job.status) ?? theme.colors.divider, backgroundColor: theme.colors.surface }] }>
                                        <Text style={[styles.statusBadgeText, { color: getStatusColor(job.status) ?? theme.colors.text }]}>{getStatusLabel(job.status)}</Text>
                                    </View>
                                    {data.activeJobId === job.id ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : null}
                                </View>
                            </View>
                            <View style={styles.pillRow}>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationPriority")}: ${getPriorityLabel(job.priority)}`}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationCreatedAt")}: ${formatTimestamp(job.createdAt)}`}</Text></View>
                                {job.projectId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditProject")}: ${job.projectId}`}</Text></View> : null}
                                {job.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${data.resolveLoopName(job.loopId) ?? job.loopId.slice(0, 8)}`}</Text></View> : null}
                            </View>
                        </Pressable>
                    )) : null}
                </ItemGroup>

                <ItemGroup title={renderSectionTitle(t("machine.automationLoopRollup"), t("machine.automationSectionLoopRollup"))}>
                    <View style={styles.summaryGrid}>
                        {renderSummaryCard({ title: t("machine.automationLoopsTotal"), value: String(data.loopRollup.total), hint: t("machine.automationLoopsTotalHint") })}
                        {renderSummaryCard({ title: t("machine.automationLoopsActive"), value: String(data.loopRollup.active), hint: t("machine.automationLoopsActiveHint"), accent: "#0A84FF" })}
                        {renderSummaryCard({ title: t("machine.automationLoopsBlocked"), value: String(data.loopRollup.blocked), hint: t("machine.automationLoopsBlockedHint"), accent: "#FF3B30" })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPaused"), value: String(data.loopRollup.paused), hint: t("machine.automationLoopsPausedHint"), accent: theme.colors.textSecondary })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPendingEvents"), value: String(data.loopRollup.pendingEvents), hint: t("machine.automationLoopsPendingEventsHint") })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPolicyStopped"), value: String(data.loopRollup.policyStopped), hint: t("machine.automationLoopsPolicyStoppedHint"), accent: "#FF9500" })}
                    </View>
                    <Item title={t("machine.automationOpenLoops")} subtitle={t("machine.automationOpenLoopsHint")} titleStyle={{ color: theme.colors.textLink }} onPress={() => router.push(`/machine/${machineId}/loops` as any)} />
                </ItemGroup>

                {/* ── Guardian 会话 + 使用情况（合并） ── */}
                <ItemGroup title={renderSectionTitle(t("machine.automationGuardians"), t("machine.automationSectionGuardians"))}>
                    <Item
                        title={`${t("machine.automationGuardians")} (${data.filteredGuardians.length})`}
                        subtitle={data.filteredGuardians.length === 0 ? t("machine.automationGuardiansEmpty") : `${t("machine.automationGuardianAttached")}: ${data.filteredGuardians.filter((g) => g.attached).length} • ${t("machine.automationGuardianPersisted")}: ${data.filteredGuardians.filter((g) => !g.attached).length}`}
                        detail={data.showAllGuardians ? t("machine.automationSectionShowLess") : undefined}
                        onPress={() => data.setShowAllGuardians((current) => !current)}
                        showChevron={!data.showAllGuardians && data.filteredGuardians.length > 0}
                    />
                    {data.showAllGuardians ? (
                        <>
                            {data.visibleGuardians.map((guardian: MachineAutomationGuardian) => (
                                <Pressable key={guardian.key} style={styles.dataCard} onPress={() => handleGuardianPress(guardian)}>
                                    <View style={styles.dataCardHeader}>
                                        <View style={styles.dataCardTitleWrap}>
                                            <Text style={styles.dataCardTitle}>{data.resolveGuardianKeyLabel(guardian.key)}</Text>
                                            <Text style={styles.dataCardSubtitle}>{getGuardianStateLabel(guardian.attached, guardian.recovered)}</Text>
                                        </View>
                                        <Text style={styles.dataCardTimestamp}>{formatTimestamp(guardian.updatedAt)}</Text>
                                    </View>
                                    <View style={styles.pillRow}>
                                        <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText} numberOfLines={1}>{`${t("machine.automationGuardianSession")}: ${guardian.sessionId.slice(0, 12)}…`}</Text></View>
                                        {guardian.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${data.resolveLoopName(guardian.loopId) ?? guardian.loopId.slice(0, 8)}`}</Text></View> : null}
                                    </View>
                                </Pressable>
                            ))}
                            <Item
                                title={`${t("machine.automationGuardianUsage")} (${data.filteredGuardianUsage.length})`}
                                subtitle={t("machine.automationGuardianUsageHint")}
                                detail={data.showAllGuardianUsage ? t("machine.automationSectionShowLess") : undefined}
                                onPress={() => data.setShowAllGuardianUsage((current) => !current)}
                                showChevron={!data.showAllGuardianUsage && data.filteredGuardianUsage.length > 0}
                            />
                            {data.showAllGuardianUsage ? data.visibleGuardianUsage.map((entry: MachineAutomationGuardianUsage) => {
                                const matchingGuardian = data.guardians.find((guardian) => guardian.key === entry.key);
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

                {/* ── 审计统计 + 审计日志（合并） ── */}
                <ItemGroup title={renderSectionTitle(t("machine.automationAuditStats"), t("machine.automationSectionAuditStats"))}>
                    <View style={styles.summaryGrid}>
                        {renderSummaryCard({ title: t("machine.automationTotalAuditEvents"), value: String(data.auditStats?.totalEvents ?? 0), hint: t("machine.automationTotalAuditEventsHint") })}
                        {renderSummaryCard({ title: t("machine.automationGuardianReuseCount"), value: String(data.auditStats?.guardianReuseCount ?? 0), hint: t("machine.automationGuardianReuseCountHint"), accent: "#0A84FF" })}
                        {renderSummaryCard({ title: t("machine.automationGuardianReuseRate"), value: formatRate(data.auditStats?.guardianReuseRate), hint: t("machine.automationGuardianReuseRateHint") })}
                        {renderSummaryCard({ title: t("machine.automationGuardianResetCount"), value: String(data.auditStats?.guardianResetCount ?? 0), hint: t("machine.automationGuardianResetCountHint"), accent: "#FF9500" })}
                        {renderSummaryCard({ title: t("machine.automationSessionReattachedCount"), value: String(data.auditStats?.sessionReattachedCount ?? 0), hint: t("machine.automationSessionReattachedCountHint"), accent: "#34C759" })}
                        {renderSummaryCard({ title: t("machine.automationWatchdogStops"), value: String(data.auditStats?.watchdogStopCount ?? 0), hint: t("machine.automationWatchdogStopsHint"), accent: "#FF3B30" })}
                    </View>
                    <Item title={t("machine.automationLastAuditEvent")} subtitle={t("machine.automationLastAuditEventHint")} detail={data.auditStats?.lastEventAt ? formatTimestamp(data.auditStats.lastEventAt) : "-"} showChevron={false} />
                    <Item
                        title={`${t("machine.automationAudit")} (${data.filteredAuditEvents.length})`}
                        subtitle={data.filteredAuditEvents.length === 0 ? t("machine.automationAuditEmpty") : t("machine.automationAuditHint")}
                        detail={data.showAllAuditEvents ? t("machine.automationSectionShowLess") : undefined}
                        onPress={() => data.setShowAllAuditEvents((current) => !current)}
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
                                            {
                                                text: t("machine.automationClearAudit"),
                                                style: "destructive",
                                                onPress: () => void data.clearAudit(),
                                            },
                                        ],
                                    );
                                }}
                                rightElement={data.clearingAudit ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                            />
                            {data.visibleAuditEvents.map((event: MachineAutomationAuditEvent) => (
                                <Pressable key={event.id} style={styles.dataCard} onPress={() => handleAuditEventPress(event)}>
                                    <View style={styles.dataCardHeader}>
                                        <View style={styles.dataCardTitleWrap}>
                                            <Text style={styles.dataCardTitle}>{getAuditEventTitle(event)}</Text>
                                            <Text style={styles.dataCardSubtitle}>{event.message || getAuditEventSubtitle(event) || t("machine.automationAudit")}</Text>
                                        </View>
                                        <Text style={[styles.dataCardTimestamp, getAuditKindAccent(event) ? { color: getAuditKindAccent(event) } : null]}>{formatTimestamp(event.occurredAt)}</Text>
                                    </View>
                                    <View style={styles.pillRow}>
                                        {event.status ? <View style={[styles.pill, { borderColor: getAuditKindAccent(event) ?? theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationStatusLabel")}: ${event.status}`}</Text></View> : null}
                                        {event.guardianKey ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditGuardian")}: ${data.resolveGuardianKeyLabel(event.guardianKey)}`}</Text></View> : null}
                                        {event.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${data.resolveLoopName(event.loopId) ?? event.loopId.slice(0, 8)}`}</Text></View> : null}
                                    </View>
                                </Pressable>
                            ))}
                        </>
                    ) : null}
                </ItemGroup>

            </ItemList>
        </ScrollView>
    );
});
