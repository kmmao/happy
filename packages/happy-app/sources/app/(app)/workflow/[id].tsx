/**
 * Workflow detail page — Phase 1 (read-only) of the unified IA.
 *
 * id format (from useWorkflows): `${kind}:${centerEntityId}`.
 *  - adhoc:<sessionId>      → backs onto a single Session
 *  - scheduled:<triggerId>  → fetched TriggerSchedule + its sessions
 *  - event:<triggerId>      → fetched WebhookTrigger + its sessions
 *  - loop:<loopId>          → AgentLoopSummary from daemonState
 *
 * Phase 2 will hang the "Make recurring" / "Attach to Loop" actions off
 * the ad-hoc kind here. Phase 3 deletes the legacy automation/loops/tasks/
 * trigger sub-pages once this page covers them.
 */

import * as React from "react";
import { View, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { useWorkflows, type Workflow } from "@/hooks/useWorkflows";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { SharedStateView } from "@/components/SharedStateView";
import { formatLastSeen, getSessionName } from "@/utils/sessionUtils";
import { useMachine } from "@/sync/storage";
import { MakeRecurringModal } from "@/components/workflow/MakeRecurringModal";
import { t } from "@/text";

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    headerBlock: {
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        backgroundColor: theme.colors.groupped.background,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
    },
    kindIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    headerText: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 20,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    subtitle: {
        marginTop: 4,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));

const KIND_META: Record<Workflow["kind"], {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    color: string;
    /** Translation key under `workflows.*` for the kind's long label */
    labelKey: "kindAdhocLabel" | "kindScheduledLabel" | "kindEventLabel" | "kindLoopLabel";
}> = {
    adhoc: { icon: "chatbubble-ellipses-outline", color: "#8E8E93", labelKey: "kindAdhocLabel" },
    scheduled: { icon: "timer-outline", color: "#34C759", labelKey: "kindScheduledLabel" },
    event: { icon: "flash-outline", color: "#0A84FF", labelKey: "kindEventLabel" },
    loop: { icon: "repeat-outline", color: "#BF5AF2", labelKey: "kindLoopLabel" },
};

export default function WorkflowDetailScreen() {
    const { id: rawId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { workflows, loading } = useWorkflows();

    const workflowId = decodeURIComponent(rawId ?? "");
    const workflow = React.useMemo(
        () => workflows.find((w) => w.id === workflowId) ?? null,
        [workflows, workflowId],
    );

    const machine = useMachine(workflow?.machineId ?? "");
    const [recurringModalVisible, setRecurringModalVisible] = React.useState(false);

    if (loading && !workflow) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t("tabs.sessions") }} />
                <SharedStateView kind="loading" title={t("common.loading")} />
            </View>
        );
    }

    if (!workflow) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{ headerTitle: t("tabs.sessions") }} />
                <SharedStateView
                    kind="empty"
                    title={t("workflows.emptyTitle")}
                    description={t("workflows.emptyDescription")}
                />
            </View>
        );
    }

    const meta = KIND_META[workflow.kind];
    // Use an explicit switch so TS validates each translation key literally.
    const metaLabel =
        workflow.kind === "adhoc" ? t("workflows.kindAdhocLabel")
        : workflow.kind === "scheduled" ? t("workflows.kindScheduledLabel")
        : workflow.kind === "event" ? t("workflows.kindEventLabel")
        : t("workflows.kindLoopLabel");
    const machineLabel = machine?.metadata?.displayName || machine?.metadata?.host || workflow.machineId;

    return (
        <View style={styles.container}>
            <Stack.Screen options={{ headerTitle: metaLabel, headerBackTitle: t("common.back") }} />
            <ScrollView contentContainerStyle={{ paddingBottom: 64 }}>
                <View style={styles.headerBlock}>
                    <View style={styles.headerRow}>
                        <View style={[styles.kindIcon, { backgroundColor: `${meta.color}18` }]}>
                            <Ionicons name={meta.icon} size={22} color={meta.color} />
                        </View>
                        <View style={styles.headerText}>
                            <Text style={styles.title} numberOfLines={3}>{workflow.displayName}</Text>
                            <Text style={styles.subtitle} numberOfLines={2}>
                                {metaLabel} · {machineLabel} · {t("workflows.detailLastActivity", formatLastSeen(workflow.lastActivityAt, false))}
                            </Text>
                        </View>
                    </View>
                </View>

                {workflow.kind === "scheduled" ? (
                    <ItemGroup title={t("workflows.sectionSchedule")}>
                        <Item title={t("workflows.detailCronExpression")} detail={workflow.trigger.cronExpression} copy showChevron={false} />
                        <Item
                            title={t("workflows.detailNextFire")}
                            detail={workflow.nextRunAt ? new Date(workflow.nextRunAt).toLocaleString() : t("workflows.detailNever")}
                            showChevron={false}
                        />
                        <Item title={t("workflows.detailRuns")} detail={String(workflow.runCount)} showChevron={false} />
                        <Item title={t("workflows.detailEnabled")} detail={workflow.trigger.enabled ? t("workflows.detailYes") : t("workflows.detailNo")} showChevron={false} />
                    </ItemGroup>
                ) : null}

                {workflow.kind === "event" ? (
                    <ItemGroup title={t("workflows.sectionWebhook")}>
                        <Item title={t("workflows.detailSlug")} detail={workflow.trigger.slug} copy showChevron={false} />
                        <Item title={t("workflows.detailFires")} detail={String(workflow.triggerCount)} showChevron={false} />
                        <Item title={t("workflows.detailEnabled")} detail={workflow.trigger.enabled ? t("workflows.detailYes") : t("workflows.detailNo")} showChevron={false} />
                    </ItemGroup>
                ) : null}

                {workflow.kind === "loop" ? (
                    <ItemGroup title={t("workflows.sectionLoop")}>
                        <Item title={t("workflows.detailDirectory")} detail={workflow.loop.directory} copy showChevron={false} />
                        <Item title={t("workflows.detailAgent")} detail={workflow.loop.agent} showChevron={false} />
                        <Item title={t("workflows.detailIteration")} detail={String(workflow.loop.iteration)} showChevron={false} />
                        <Item title={t("workflows.detailPhase")} detail={workflow.loop.phase} showChevron={false} />
                        <Item title={t("workflows.detailEnabled")} detail={workflow.loop.enabled ? t("workflows.detailYes") : t("workflows.detailNo")} showChevron={false} />
                        {workflow.loop.cronExpression ? (
                            <Item title={t("workflows.detailCron")} detail={workflow.loop.cronExpression} copy showChevron={false} />
                        ) : null}
                        {workflow.loop.lastError ? (
                            <Item
                                title={t("workflows.detailLastError")}
                                subtitle={workflow.loop.lastError}
                                subtitleLines={3}
                                detailStyle={{ color: theme.colors.status.error }}
                                showChevron={false}
                            />
                        ) : null}
                    </ItemGroup>
                ) : null}

                <ItemGroup title={t("workflows.sessionsHeader", workflow.sessions.length)}>
                    {workflow.sessions.length === 0 ? (
                        <Item title={t("workflows.detailNoSessions")} subtitle={t("workflows.detailNoSessionsSubtitle")} showChevron={false} />
                    ) : (
                        workflow.sessions.map((session) => (
                            <Item
                                key={session.id}
                                title={getSessionName(session)}
                                subtitle={formatLastSeen(session.updatedAt ?? 0, false)}
                                onPress={() => navigateToSession(session.id)}
                                icon={
                                    <Ionicons
                                        name={session.active ? "chatbubble-ellipses" : "chatbubble-ellipses-outline"}
                                        size={18}
                                        color={session.active ? "#34C759" : theme.colors.textSecondary}
                                    />
                                }
                            />
                        ))
                    )}
                </ItemGroup>

                {workflow.kind === "adhoc" ? (
                    <ItemGroup title={t("workflows.sectionActions")}>
                        <Item
                            title={t("workflows.actionMakeRecurringTitle")}
                            subtitle={t("workflows.actionMakeRecurringSubtitle")}
                            icon={<Ionicons name="timer-outline" size={20} color={theme.colors.textLink} />}
                            onPress={() => setRecurringModalVisible(true)}
                        />
                        <Item
                            title={t("workflows.actionAttachLoopTitle")}
                            subtitle={t("workflows.actionLoopGatedSubtitle")}
                            icon={<Ionicons name="repeat-outline" size={20} color={theme.colors.textLink} />}
                            disabled
                            showChevron={false}
                        />
                        <Item
                            title={t("workflows.actionPromoteLoopTitle")}
                            subtitle={t("workflows.actionLoopGatedSubtitle")}
                            icon={<Ionicons name="rocket-outline" size={20} color={theme.colors.textLink} />}
                            disabled
                            showChevron={false}
                        />
                    </ItemGroup>
                ) : null}

                {workflow.kind === "loop" || workflow.kind === "scheduled" || workflow.kind === "event" ? (
                    <ItemGroup title={t("workflows.sectionMachine")}>
                        <Item
                            title={machineLabel}
                            subtitle={t("workflows.detailOpenMachine")}
                            icon={<Ionicons name="desktop-outline" size={20} color={theme.colors.textLink} />}
                            onPress={() => router.push(`/machine/${workflow.machineId}` as any)}
                        />
                    </ItemGroup>
                ) : null}
            </ScrollView>

            {workflow.kind === "adhoc" ? (
                <MakeRecurringModal
                    session={workflow.session}
                    visible={recurringModalVisible}
                    onClose={() => setRecurringModalVisible(false)}
                />
            ) : null}
        </View>
    );
}
