/**
 * WorkflowList — the Workflow-IA replacement for SessionsList.
 *
 * Phase A (this revision):
 *  - Ad-hoc workflows are LEAF rows: a single Session, header tap goes
 *    straight to the conversation (no detail page, no expand state).
 *  - Scheduled / Event / Loop workflows default to EXPANDED (key config
 *    + child Sessions visible without an extra tap) and can be collapsed.
 *    The kind-specific config + actions that used to live on
 *    /workflow/[id] are now inlined here — the detail page is removed.
 *  - Promote actions (Make recurring) hang off Ad-hoc workflows via a
 *    long-press menu — leaf tap is reserved for the most common path.
 */

import React from "react";
import {
    View,
    Pressable,
    FlatList,
    ScrollView,
    Linking,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Typography } from "@/constants/Typography";
import { useWorkflows, type Workflow, type WorkflowKind } from "@/hooks/useWorkflows";
import { useSetting } from "@/sync/storage";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { SharedStateView } from "./SharedStateView";
import { UpdateBanner } from "./UpdateBanner";
import { StatusDot } from "./StatusDot";
import { formatLastSeen } from "@/utils/sessionUtils";
import { useLayout } from "./layout";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";
import { Modal } from "@/modal";
import { useRouter } from "expo-router";
import { MakeRecurringModal } from "./workflow/MakeRecurringModal";
import { AdoptSessionModal } from "./workflow/AdoptSessionModal";
import { CreateLoopModal } from "./workflow/CreateLoopModal";
import { CreateWebhookModal } from "./workflow/CreateWebhookModal";
import { WorkflowSessionRow } from "./workflow/WorkflowSessionRow";
import { WorkflowDetailSheet } from "./workflow/WorkflowDetailSheet";
import { WorkflowEnabledGlow } from "./workflow/WorkflowEnabledGlow";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    setAgentLoopEnabled,
    deleteAgentLoop,
} from "@/sync/apiAgentLoops";
import {
    updateWebhookTrigger,
    deleteWebhookTrigger,
} from "@/sync/apiWebhookTriggers";
import {
    toggleTriggerSchedule,
    deleteTriggerSchedule,
} from "@/sync/apiTriggerSchedules";
import { notifyWorkflowSourcesChanged } from "@/sync/workflowBus";

const FILTER_VALUES: ReadonlyArray<{ key: WorkflowKind; label: () => string }> = [
    { key: "adhoc", label: () => t("workflows.kindAdhoc") },
    { key: "scheduled", label: () => t("workflows.kindScheduled") },
    { key: "event", label: () => t("workflows.kindEvent") },
    { key: "loop", label: () => t("workflows.kindLoop") },
];

const KIND_ICON: Record<WorkflowKind, React.ComponentProps<typeof Ionicons>["name"]> = {
    adhoc: "chatbubble-ellipses-outline",
    scheduled: "timer-outline",
    event: "flash-outline",
    loop: "repeat-outline",
};

const KIND_COLOR: Record<WorkflowKind, string> = {
    adhoc: "#8E8E93",
    scheduled: "#34C759",
    event: "#0A84FF",
    loop: "#BF5AF2",
};

const STATUS_COLOR: Record<Workflow["status"], string> = {
    active: "#34C759",
    idle: "#8E8E93",
    error: "#FF3B30",
    archived: "#C7C7CC",
};

// Show up to this many sessions per expanded workflow before collapsing the
// tail behind "+ N more". Keeps a busy loop with 100+ iterations from
// blowing out the list.
const MAX_INLINE_SESSIONS = 5;

function isWorkflowEnabled(workflow: Workflow): boolean {
    if (workflow.kind === "adhoc") return workflow.status === "active";
    if (workflow.kind === "loop") return workflow.loop.enabled;
    return workflow.trigger.enabled;
}

function formatRunTimestamp(timestamp: number | null | undefined): string | null {
    if (!timestamp || timestamp <= 0) return null;
    // Show seconds too — schedules / loops fire on cron ticks that the
    // user expects to land at a specific second (e.g. "*/30 * * * * *").
    // Minute-only granularity loses that signal and makes it look like
    // the row hasn't ticked when it actually has.
    return new Date(timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function workflowNextRunText(workflow: Workflow): string | null {
    if (workflow.kind === "adhoc") return null;
    if (!isWorkflowEnabled(workflow)) return t("workflows.nextRunDisabled");
    if (workflow.kind === "event") return t("workflows.nextRunWaitingEvent");

    const nextRunAt = workflow.kind === "scheduled"
        ? workflow.nextRunAt
        : workflow.loop.nextRunAt;
    const formatted = formatRunTimestamp(nextRunAt);
    if (formatted) return t("workflows.nextRunAt", formatted);
    if (workflow.kind === "loop" && workflow.status === "active") {
        return t("workflows.nextRunAfterCurrent");
    }
    return t("workflows.nextRunPending");
}

function workflowSummaryText(workflow: Workflow): string | null {
    switch (workflow.kind) {
        case "scheduled":
            return t("workflows.summaryScheduled");
        case "event":
            return t("workflows.summaryEvent");
        case "loop":
            return t("workflows.summaryLoop");
        case "adhoc":
            return null;
    }
}

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        flexDirection: "row",
        justifyContent: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
    },
    // Sticky wrapper around the kind filter chips. Sits on top of the
    // FlatList so that scrolling the workflow rows underneath never hides
    // the segmented control — the same pattern iOS uses for tab strips.
    filterBarSticky: {
        backgroundColor: theme.colors.groupped.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    filterBar: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
        flexDirection: "row",
        alignItems: "center",
    },
    filterChip: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        ...webInteractive,
    },
    filterChipActive: {
        backgroundColor: `${theme.colors.accentBlue}10`,
        borderColor: theme.colors.accentBlue,
    },
    filterChipText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
    },
    filterChipTextActive: {
        color: theme.colors.accentBlue,
        ...Typography.default("semiBold"),
    },
    rowContainer: {
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        overflow: "hidden",
    },
    rowHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
        ...webInteractive,
    },
    rowHeaderHovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    rowHeaderPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    kindIconBadge: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    headerCenter: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    headerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    headerTitle: {
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    headerTimestamp: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    headerMetaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
    },
    headerMetaText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    headerSummaryText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 17,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    detailIconButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surfaceHigh,
        ...webInteractive,
    },
    cliLocalTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: `${theme.colors.warning}1F`,
    },
    cliLocalTagText: {
        fontSize: 10,
        color: theme.colors.warning,
        ...Typography.default("semiBold"),
    },
    supervisorRoleTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: `${theme.colors.accentBlue}1F`,
    },
    supervisorRoleTagText: {
        fontSize: 10,
        color: theme.colors.accentBlue,
        ...Typography.default("semiBold"),
    },
    expandToggle: {
        paddingTop: 2,
    },
    // Inline detail body sits below the header row, divided by a hairline.
    detailBody: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
        backgroundColor: theme.colors.surface,
    },
    // Tree layout: each row carries its own rail segment + T-connector so
    // we don't need a "full-height rail + cover the bottom" trick.
    treeRow: {
        flexDirection: "row",
        alignItems: "stretch",
    },
    treeRail: {
        width: 14,
        position: "relative",
    },
    // Vertical line for non-terminal rows: top → bottom of the row.
    treeRailVerticalFull: {
        position: "absolute",
        left: 6,
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: theme.colors.divider,
    },
    // Vertical line for the LAST row: only the upper half (stops at the
    // T-connector midline, drawing the └─ corner instead of ├─).
    treeRailVerticalHalf: {
        position: "absolute",
        left: 6,
        top: 0,
        height: "50%",
        width: 1,
        backgroundColor: theme.colors.divider,
    },
    // Horizontal stub from rail to the row content.
    treeRailConnector: {
        position: "absolute",
        left: 7,
        top: "50%",
        width: 7,
        height: 1,
        marginTop: -0.5,
        backgroundColor: theme.colors.divider,
    },
    treeRowChildren: {
        flex: 1,
        minWidth: 0,
    },
    sectionTitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
        marginBottom: 2,
    },
    configRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    configChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surfaceHigh,
    },
    configChipText: {
        fontSize: 11,
        color: theme.colors.text,
        ...Typography.default(),
        fontFamily: "Menlo",
    },
    configChipLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    moreSessionsButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 8,
        gap: 4,
        ...webInteractive,
    },
    moreSessionsText: {
        fontSize: 12,
        color: theme.colors.textLink,
        ...Typography.default("semiBold"),
    },
    actionsRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        ...webInteractive,
    },
    actionButtonText: {
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    emptySessions: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        paddingVertical: 6,
    },
    // Kind-specific empty state shown when the active filter chip has
    // zero matching workflows. The CTA opens the standalone create-X
    // modal (or pushes /new for ad-hoc) so the user can fill the
    // category in one tap.
    kindEmpty: {
        alignItems: "center",
        paddingHorizontal: 32,
        paddingTop: 56,
        paddingBottom: 24,
        gap: 12,
    },
    kindEmptyIconBadge: {
        width: 56,
        height: 56,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    kindEmptyTitle: {
        fontSize: 16,
        color: theme.colors.text,
        textAlign: "center",
        ...Typography.default("semiBold"),
    },
    kindEmptyDescription: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        textAlign: "center",
        lineHeight: 19,
        ...Typography.default(),
    },
    kindEmptyButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: theme.colors.accentBlue,
        ...webInteractive,
    },
    kindEmptyButtonText: {
        fontSize: 13,
        color: "#FFFFFF",
        ...Typography.default("semiBold"),
    },
}));

interface WorkflowListProps {
    hideUpdateBanner?: boolean;
}

export const WorkflowList = React.memo<WorkflowListProps>(function WorkflowList({
    hideUpdateBanner,
}) {
    const layout = useLayout();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { workflows, loading } = useWorkflows();
    // Default to Ad-hoc — it's where active conversations live, and
    // removing the "All" tab keeps the kind chips uniformly content-typed.
    const [activeFilter, setActiveFilter] = React.useState<WorkflowKind>("adhoc");
    // Collapsed-ids: Multi-session workflows default to EXPANDED; only the
    // ones in this set are collapsed. Inverting the default keeps the
    // common case zero-click.
    const [collapsedIds, setCollapsedIds] = React.useState<Record<string, boolean>>({});
    const [detailWorkflow, setDetailWorkflow] = React.useState<Workflow | null>(null);
    // Standalone-mode visibility for the create-X modals. Reachable from
    // the kind-specific empty state CTA below, and mirrored to the
    // existing header "+" CreateWorkflowMenu (both routes converge on
    // the same modals running without a `session` prop).
    const [standaloneScheduleVisible, setStandaloneScheduleVisible] = React.useState(false);
    const [standaloneWebhookVisible, setStandaloneWebhookVisible] = React.useState(false);
    const [standaloneLoopVisible, setStandaloneLoopVisible] = React.useState(false);

    // "Hide inactive sessions" (settings.hideInactiveSessions) mirrors the
    // legacy useVisibleSessionListViewData semantics, but scoped to Ad-hoc
    // workflows only — those ARE chats. Scheduled / Event / Loop workflows
    // are persistent automation containers, not chats, so hiding them when
    // idle would make them vanish from their own kind tab. Keep an Ad-hoc
    // workflow when its session is active OR starred (bookmarked).
    const hideInactiveSessions = useSetting('hideInactiveSessions');
    const filtered = React.useMemo(() => {
        const byKind = workflows.filter((w) => w.kind === activeFilter);
        if (!hideInactiveSessions) {
            return byKind;
        }
        return byKind.filter(
            (w) => w.kind !== "adhoc" || w.session.active || w.session.starred,
        );
    }, [workflows, activeFilter, hideInactiveSessions]);

    const handleEmptyCreate = React.useCallback(() => {
        switch (activeFilter) {
            case "adhoc":
                router.push("/new");
                break;
            case "scheduled":
                setStandaloneScheduleVisible(true);
                break;
            case "event":
                setStandaloneWebhookVisible(true);
                break;
            case "loop":
                setStandaloneLoopVisible(true);
                break;
        }
    }, [activeFilter, router]);

    const toggleCollapse = React.useCallback((id: string) => {
        setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    // UpdateBanner stays inside the list so it scrolls away with the
    // content — it's a one-off nag, not a persistent control. The filter
    // chips render OUTSIDE the FlatList (see JSX below) so they remain
    // pinned at the top during scroll.
    const ListHeader = React.useCallback(
        () => (hideUpdateBanner ? null : <UpdateBanner />),
        [hideUpdateBanner],
    );

    const FilterBar = React.useCallback(
        () => (
            <View style={styles.filterBarSticky}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterBar}
                >
                    {FILTER_VALUES.map((option) => {
                        const active = activeFilter === option.key;
                        return (
                            <Pressable
                                key={option.key}
                                style={[
                                    styles.filterChip,
                                    active && styles.filterChipActive,
                                ]}
                                onPress={() => setActiveFilter(option.key)}
                            >
                                <Text style={[
                                    styles.filterChipText,
                                    active && styles.filterChipTextActive,
                                ]}>
                                    {option.label()}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
        ),
        [activeFilter],
    );

    if (loading && workflows.length === 0) {
        return (
            <View style={styles.container}>
                <SharedStateView kind="loading" title={t("common.loading")} />
            </View>
        );
    }

    if (workflows.length === 0) {
        return (
            <View style={styles.container}>
                <SharedStateView
                    kind="empty"
                    title={t("workflows.emptyTitle")}
                    description={t("workflows.emptyDescription")}
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={[styles.contentContainer, { maxWidth: layout.maxWidth }]}>
                {/* FilterBar lives outside the FlatList so the kind chips
                    stay pinned at the top while the workflow rows scroll
                    underneath. UpdateBanner remains in ListHeaderComponent
                    so it scrolls away with the content. */}
                <FilterBar />
                <FlatList
                    data={filtered}
                    keyExtractor={(w) => w.id}
                    renderItem={({ item }) => (
                        <WorkflowRow
                            workflow={item}
                            // Ad-hoc rows ignore this; multi-session rows
                            // default expanded unless user collapsed them.
                            expanded={!collapsedIds[item.id]}
                            onToggleCollapse={() => toggleCollapse(item.id)}
                            onOpenDetails={() => setDetailWorkflow(item)}
                        />
                    )}
                    ListHeaderComponent={ListHeader}
                    ListEmptyComponent={
                        <WorkflowKindEmptyState
                            kind={activeFilter}
                            onCreate={handleEmptyCreate}
                        />
                    }
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 128,
                    }}
                />
            </View>
            <WorkflowDetailSheet
                visible={detailWorkflow !== null}
                workflow={detailWorkflow}
                onClose={() => setDetailWorkflow(null)}
            />
            {/* Standalone-mode creation modals. Mounted at this level
                (not inside individual rows) so the empty-state CTAs above
                can open them without re-walking the row tree. */}
            <MakeRecurringModal
                visible={standaloneScheduleVisible}
                onClose={() => setStandaloneScheduleVisible(false)}
            />
            <CreateWebhookModal
                visible={standaloneWebhookVisible}
                onClose={() => setStandaloneWebhookVisible(false)}
            />
            <CreateLoopModal
                visible={standaloneLoopVisible}
                onClose={() => setStandaloneLoopVisible(false)}
            />
        </View>
    );
});

// --- Row -------------------------------------------------------------------

interface WorkflowRowProps {
    workflow: Workflow;
    expanded: boolean;
    onToggleCollapse: () => void;
    onOpenDetails: () => void;
}

const WorkflowRow = React.memo(function WorkflowRow({
    workflow,
    expanded,
    onToggleCollapse,
    onOpenDetails,
}: WorkflowRowProps) {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { isHovered, hoverProps } = useWebHoverProps();
    const [recurringModalVisible, setRecurringModalVisible] = React.useState(false);
    const [adoptModalVisible, setAdoptModalVisible] = React.useState(false);
    const [promoteLoopModalVisible, setPromoteLoopModalVisible] = React.useState(false);

    // Ad-hoc workflows are leaves: the row IS the session, tap goes
    // straight to the conversation. No collapse/expand toggle, no detail
    // body — the "1 session" meta would just duplicate the row.
    const isAdhoc = workflow.kind === "adhoc";

    const onHeaderPress = React.useCallback(() => {
        if (isAdhoc) {
            navigateToSession((workflow as Extract<Workflow, { kind: "adhoc" }>).session.id);
        } else {
            onToggleCollapse();
        }
    }, [isAdhoc, workflow, navigateToSession, onToggleCollapse]);

    // Long-press on an Ad-hoc row reveals the promote menu. This is the
    // discovery path for "Make this recurring" now that the dedicated
    // detail page is gone; the new top-level + menu (Phase B) is the
    // other entry for users who'd rather start fresh.
    const onHeaderLongPress = React.useCallback(() => {
        if (!isAdhoc) return;
        const session = (workflow as Extract<Workflow, { kind: "adhoc" }>).session;
        Modal.alert(
            workflow.displayName,
            "",
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("workflows.actionMakeRecurringTitle"),
                    onPress: () => setRecurringModalVisible(true),
                },
                {
                    text: t("workflows.detailOpenMachine"),
                    onPress: () => navigateToSession(session.id),
                },
            ],
        );
    }, [isAdhoc, workflow, navigateToSession]);

    const kindLabel = React.useMemo(() => {
        switch (workflow.kind) {
            case "adhoc": return t("workflows.kindAdhoc");
            case "scheduled": return t("workflows.kindScheduled");
            case "event": return t("workflows.kindEvent");
            case "loop": return t("workflows.kindLoop");
        }
    }, [workflow.kind]);

    const metaSuffix = React.useMemo(() => {
        switch (workflow.kind) {
            case "scheduled":
                return t("workflows.metaCronRuns", workflow.runCount);
            case "event":
                return t("workflows.metaWebhookFires", workflow.triggerCount);
            case "loop":
                return t("workflows.metaLoopIter", workflow.loop.iteration);
            case "adhoc":
                return null;
        }
    }, [workflow]);

    const summaryText = React.useMemo(() => workflowSummaryText(workflow), [workflow]);
    const nextRunText = React.useMemo(() => workflowNextRunText(workflow), [workflow]);
    const enabled = isWorkflowEnabled(workflow);

    // Long-press menu for Scheduled / Event / Loop rows. Mirrors the
    // Ad-hoc Modal.alert pattern above, but with two destructive-ish
    // actions wired straight to the existing toggle/delete APIs:
    //
    //   - 启用/停用 — flips the trigger/loop's `enabled` flag in place.
    //     CLI-local loops (no projectId yet) hide this entry: the
    //     server-side endpoint would 404.
    //   - 删除 — destructive; second Modal.alert confirms before firing.
    //
    // On success we call notifyWorkflowSourcesChanged() so useWorkflows
    // refetches and the row disappears (or its enabled state flips)
    // without waiting for the next throttle tick.
    const openMultiSessionMenu = React.useCallback(() => {
        if (workflow.kind === "adhoc") return;

        const currentlyEnabled =
            workflow.kind === "loop"
                ? workflow.loop.enabled
                : workflow.trigger.enabled;
        // Loop without a projectId means it's CLI-local (pre-ADR-0022
        // migration). The server can't act on it; only show the delete
        // entry once that flag flips. Hide the menu entirely to keep the
        // user from tapping a no-op.
        const isCliLocalLoop =
            workflow.kind === "loop" && workflow.projectId === null;
        if (isCliLocalLoop) return;

        const toggle = async () => {
            try {
                const creds = await TokenStorage.getCredentials();
                if (!creds) throw new Error("Not authenticated");
                if (workflow.kind === "loop") {
                    if (!workflow.projectId) return;
                    await setAgentLoopEnabled(
                        creds,
                        workflow.projectId,
                        workflow.loop.id,
                        !currentlyEnabled,
                    );
                } else if (workflow.kind === "event") {
                    await updateWebhookTrigger(creds, workflow.trigger.id, {
                        enabled: !currentlyEnabled,
                    });
                } else if (workflow.kind === "scheduled") {
                    // The schedule API exposes a single /toggle endpoint
                    // (no "set to value") — server flips the flag for us.
                    await toggleTriggerSchedule(creds, workflow.trigger.id);
                }
                notifyWorkflowSourcesChanged();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Modal.alert(t("workflows.actionToggleErrorTitle"), message);
            }
        };

        const confirmDelete = () => {
            Modal.alert(
                t("workflows.actionDeleteTitle"),
                t("workflows.actionDeleteMessage", workflow.displayName),
                [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                        text: t("common.delete"),
                        style: "destructive",
                        onPress: async () => {
                            try {
                                const creds = await TokenStorage.getCredentials();
                                if (!creds) throw new Error("Not authenticated");
                                if (workflow.kind === "loop") {
                                    if (!workflow.projectId) return;
                                    await deleteAgentLoop(
                                        creds,
                                        workflow.projectId,
                                        workflow.loop.id,
                                    );
                                } else if (workflow.kind === "event") {
                                    await deleteWebhookTrigger(
                                        creds,
                                        workflow.trigger.id,
                                    );
                                } else if (workflow.kind === "scheduled") {
                                    await deleteTriggerSchedule(
                                        creds,
                                        workflow.trigger.id,
                                    );
                                }
                                notifyWorkflowSourcesChanged();
                            } catch (err) {
                                const message =
                                    err instanceof Error ? err.message : String(err);
                                Modal.alert(
                                    t("workflows.actionDeleteErrorTitle"),
                                    message,
                                );
                            }
                        },
                    },
                ],
            );
        };

        Modal.alert(workflow.displayName, undefined, [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: currentlyEnabled
                    ? t("workflows.actionDisable")
                    : t("workflows.actionEnable"),
                onPress: toggle,
            },
            {
                text: t("common.delete"),
                style: "destructive",
                onPress: confirmDelete,
            },
        ]);
    }, [workflow]);

    // Ad-hoc workflows are rendered as a full SessionItem-style row —
    // the whole point of an ad-hoc workflow IS the session, so it gets
    // the full status/preview/tags/avatar-glow treatment that the
    // pre-Workflow-IA sessions list used to show. The "Make this
    // recurring" affordance lives in the row's long-press menu (passed
    // through as an extraMenuActions entry on the row).
    if (isAdhoc) {
        const session = (workflow as Extract<Workflow, { kind: "adhoc" }>).session;
        return (
            <View style={styles.rowContainer}>
                <WorkflowSessionRow
                    session={session}
                    mode="standalone"
                    extraMenuActions={[
                        {
                            label: t("workflows.actionAttachToWorkflowTitle"),
                            onPress: () => setAdoptModalVisible(true),
                        },
                        {
                            label: t("workflows.actionPromoteLoopTitle"),
                            onPress: () => setPromoteLoopModalVisible(true),
                        },
                        {
                            label: t("workflows.actionMakeRecurringTitle"),
                            onPress: () => setRecurringModalVisible(true),
                        },
                    ]}
                />
                <MakeRecurringModal
                    session={session}
                    visible={recurringModalVisible}
                    onClose={() => setRecurringModalVisible(false)}
                />
                <AdoptSessionModal
                    session={session}
                    visible={adoptModalVisible}
                    onClose={() => setAdoptModalVisible(false)}
                />
                <CreateLoopModal
                    session={session}
                    visible={promoteLoopModalVisible}
                    onClose={() => setPromoteLoopModalVisible(false)}
                />
            </View>
        );
    }

    // Multi-session workflows (Scheduled / Event / Loop) keep the
    // kind-icon header (since the workflow ≠ a single session here) and
    // expand below to show tree children.
    return (
        <View style={styles.rowContainer}>
            <Pressable
                {...hoverProps}
                onPress={onHeaderPress}
                onLongPress={openMultiSessionMenu}
                delayLongPress={400}
                style={({ pressed }) => [
                    styles.rowHeader,
                    isHovered && styles.rowHeaderHovered,
                    pressed && styles.rowHeaderPressed,
                ]}
            >
                <WorkflowEnabledGlow
                    enabled={enabled}
                    active={workflow.status === "active"}
                    color={KIND_COLOR[workflow.kind]}
                >
                    <View
                        style={[
                            styles.kindIconBadge,
                            { backgroundColor: `${KIND_COLOR[workflow.kind]}18` },
                        ]}
                    >
                        <Ionicons
                            name={KIND_ICON[workflow.kind]}
                            size={20}
                            color={KIND_COLOR[workflow.kind]}
                        />
                    </View>
                </WorkflowEnabledGlow>
                <View style={styles.headerCenter}>
                    <View style={styles.headerTitleRow}>
                        <Text style={styles.headerTitle} numberOfLines={2}>
                            {workflow.displayName}
                        </Text>
                        <Text style={styles.headerTimestamp}>
                            {formatLastSeen(workflow.lastActivityAt, false)}
                        </Text>
                    </View>
                    <View style={styles.headerMetaRow}>
                        <StatusDot color={STATUS_COLOR[workflow.status]} />
                        <Text style={styles.headerMetaText}>{kindLabel}</Text>
                        {metaSuffix ? (
                            <Text style={styles.headerMetaText}>· {metaSuffix}</Text>
                        ) : null}
                        {workflow.sessions.length > 0 ? (
                            <Text style={styles.headerMetaText}>
                                · {t("workflows.sessionCount", workflow.sessions.length)}
                            </Text>
                        ) : null}
                        {nextRunText ? (
                            <Text style={styles.headerMetaText}>· {nextRunText}</Text>
                        ) : null}
                        {workflow.kind === "loop" && workflow.isCliLocal ? (
                            <View style={styles.cliLocalTag}>
                                <Ionicons
                                    name="laptop-outline"
                                    size={10}
                                    color={theme.colors.warning}
                                />
                                <Text style={styles.cliLocalTagText}>{t("workflows.cliLocal")}</Text>
                            </View>
                        ) : null}
                        {/* ADR-0022 Phase 4 — small inline role badge so
                            supervisor-role loops (autopilot mode) are
                            distinguishable at a glance from the generic
                            user-defined ones. Skipped for generic since
                            it would clutter every row. */}
                        {workflow.kind === "loop" && workflow.role === "supervisor" ? (
                            <View style={styles.supervisorRoleTag}>
                                <Ionicons
                                    name="shield-checkmark-outline"
                                    size={10}
                                    color={theme.colors.accentBlue}
                                />
                                <Text style={styles.supervisorRoleTagText}>
                                    {t("workflows.roleSupervisor")}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                    {summaryText ? (
                        <Text style={styles.headerSummaryText} numberOfLines={2}>
                            {summaryText}
                        </Text>
                    ) : null}
                </View>
                <View style={styles.headerActions}>
                    <Pressable
                        style={styles.detailIconButton}
                        onPress={(event) => {
                            event.stopPropagation?.();
                            onOpenDetails();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t("workflows.detailViewDetails")}
                    >
                        <Ionicons
                            name="information-circle-outline"
                            size={17}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                        style={styles.expandToggle}
                    />
                </View>
            </Pressable>

            {expanded ? <WorkflowDetailBody workflow={workflow} /> : null}
        </View>
    );
});

// --- Detail body (inlined, used to be the /workflow/[id] page) ------------

const WorkflowDetailBody = React.memo(function WorkflowDetailBody({
    workflow,
}: { workflow: Workflow }) {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();

    if (workflow.kind === "adhoc") return null;

    const sessionsToShow = workflow.sessions.slice(0, MAX_INLINE_SESSIONS);
    const moreCount = workflow.sessions.length - sessionsToShow.length;

    return (
        <View style={styles.detailBody}>
            {/* Kind-specific configuration chips. Compact, key fields only —
                full editing still happens through dedicated flows. */}
            {workflow.kind === "scheduled" ? (
                <View>
                    <Text style={styles.sectionTitle}>{t("workflows.sectionSchedule")}</Text>
                    <View style={styles.configRow}>
                        <ConfigChip label={t("workflows.detailCronExpression")} value={workflow.trigger.cronExpression} />
                        {workflow.nextRunAt ? (
                            <ConfigChip
                                label={t("workflows.detailNextFire")}
                                value={new Date(workflow.nextRunAt).toLocaleString()}
                            />
                        ) : null}
                        <ConfigChip
                            label={t("workflows.detailEnabled")}
                            value={workflow.trigger.enabled ? t("workflows.detailYes") : t("workflows.detailNo")}
                        />
                    </View>
                </View>
            ) : null}

            {workflow.kind === "event" ? (
                <View>
                    <Text style={styles.sectionTitle}>{t("workflows.sectionWebhook")}</Text>
                    <View style={styles.configRow}>
                        <ConfigChip label={t("workflows.detailSlug")} value={workflow.trigger.slug} />
                        <ConfigChip
                            label={t("workflows.detailEnabled")}
                            value={workflow.trigger.enabled ? t("workflows.detailYes") : t("workflows.detailNo")}
                        />
                    </View>
                </View>
            ) : null}

            {workflow.kind === "loop" ? (
                <View>
                    <Text style={styles.sectionTitle}>{t("workflows.sectionLoop")}</Text>
                    <View style={styles.configRow}>
                        <ConfigChip label={t("workflows.detailDirectory")} value={workflow.loop.directory} />
                        <ConfigChip label={t("workflows.detailAgent")} value={workflow.loop.agent} />
                        <ConfigChip label={t("workflows.detailPhase")} value={workflow.loop.phase} />
                        {workflow.loop.cronExpression ? (
                            <ConfigChip label={t("workflows.detailCron")} value={workflow.loop.cronExpression} />
                        ) : null}
                    </View>
                </View>
            ) : null}

            {/* Sessions list — rendered as a tree under the section header
                so the parent-child relationship reads visually. Each child
                row is offset behind a vertical rail with a T-connector;
                the rail ends at the last visible row. */}
            <View>
                <Text style={styles.sectionTitle}>
                    {t("workflows.sessionsHeader", workflow.sessions.length)}
                </Text>
                {workflow.sessions.length === 0 ? (
                    <Text style={styles.emptySessions}>{t("workflows.detailNoSessions")}</Text>
                ) : (
                    <View>
                        {sessionsToShow.map((session, idx) => {
                            const isLast =
                                idx === sessionsToShow.length - 1 && moreCount === 0;
                            return (
                                <TreeRow key={session.id} isLast={isLast}>
                                    {/* Same row component as ad-hoc — keeps
                                        avatar / live status / preview /
                                        tags consistent across the IA. */}
                                    <WorkflowSessionRow
                                        session={session}
                                        mode="treeChild"
                                    />
                                </TreeRow>
                            );
                        })}
                        {moreCount > 0 ? (
                            <TreeRow isLast>
                                <Pressable
                                    style={styles.moreSessionsButton}
                                    onPress={() => navigateToSession(workflow.sessions[0].id)}
                                >
                                    <Text style={styles.moreSessionsText}>
                                        + {moreCount} more
                                    </Text>
                                </Pressable>
                            </TreeRow>
                        ) : null}
                    </View>
                )}
            </View>
        </View>
    );
});

function ConfigChip({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.configChip}>
            <Text style={styles.configChipLabel}>{label}:</Text>
            <Text style={styles.configChipText} numberOfLines={1}>{value}</Text>
        </View>
    );
}

// TreeRow wraps an inline content child in a left rail column, drawing
// either a ├─ (non-terminal) or └─ (terminal) connector. The rail and
// connector are inert View slabs — no measurement, no nested gestures —
// so they cost virtually nothing per row.
const TreeRow = React.memo(function TreeRow({
    isLast,
    children,
}: {
    isLast?: boolean;
    children: React.ReactNode;
}) {
    return (
        <View style={styles.treeRow}>
            <View style={styles.treeRail}>
                <View style={isLast ? styles.treeRailVerticalHalf : styles.treeRailVerticalFull} />
                <View style={styles.treeRailConnector} />
            </View>
            <View style={styles.treeRowChildren}>{children}</View>
        </View>
    );
});

// SessionLeaf removed — WorkflowSessionRow (mode="treeChild") is the
// single source of truth for rendering a session inside a workflow.

// --- Kind-specific empty state --------------------------------------------
//
// Shown via FlatList's ListEmptyComponent when the active filter chip has
// no matching workflows. Each kind gets its own title/description and a
// single CTA that drops the user straight into the right standalone-create
// modal — no detour through the header "+" menu required. Strings are
// duplicated under workflows.kindEmpty{Adhoc|Schedules|Events|Loops}* so
// every category can speak to its own concept rather than reuse a generic
// "no items" line.

interface WorkflowKindEmptyStateProps {
    kind: WorkflowKind;
    onCreate: () => void;
}

const WorkflowKindEmptyState = React.memo(function WorkflowKindEmptyState({
    kind,
    onCreate,
}: WorkflowKindEmptyStateProps) {
    const { theme } = useUnistyles();

    const { title, description, cta } = React.useMemo(() => {
        switch (kind) {
            case "adhoc":
                return {
                    title: t("workflows.kindEmptyAdhocTitle"),
                    description: t("workflows.kindEmptyAdhocDescription"),
                    cta: t("workflows.createMenuNewSession"),
                };
            case "scheduled":
                return {
                    title: t("workflows.kindEmptySchedulesTitle"),
                    description: t("workflows.kindEmptySchedulesDescription"),
                    cta: t("workflows.createMenuScheduled"),
                };
            case "event":
                return {
                    title: t("workflows.kindEmptyEventsTitle"),
                    description: t("workflows.kindEmptyEventsDescription"),
                    cta: t("workflows.createMenuWebhook"),
                };
            case "loop":
                return {
                    title: t("workflows.kindEmptyLoopsTitle"),
                    description: t("workflows.kindEmptyLoopsDescription"),
                    cta: t("workflows.createMenuLoop"),
                };
        }
    }, [kind]);

    return (
        <View style={styles.kindEmpty}>
            <View
                style={[
                    styles.kindEmptyIconBadge,
                    { backgroundColor: `${KIND_COLOR[kind]}1A` },
                ]}
            >
                <Ionicons
                    name={KIND_ICON[kind]}
                    size={28}
                    color={KIND_COLOR[kind]}
                />
            </View>
            <Text style={styles.kindEmptyTitle}>{title}</Text>
            <Text style={styles.kindEmptyDescription}>{description}</Text>
            <Pressable style={styles.kindEmptyButton} onPress={onCreate}>
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text style={styles.kindEmptyButtonText}>{cta}</Text>
            </Pressable>
        </View>
    );
});
