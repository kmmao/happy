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
import { MakeRecurringModal } from "./workflow/MakeRecurringModal";
import { WorkflowSessionRow } from "./workflow/WorkflowSessionRow";

const FILTER_VALUES: ReadonlyArray<{ key: "all" | WorkflowKind; label: () => string }> = [
    { key: "all", label: () => t("workflows.filterAll") },
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
    filterBar: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 6,
        flexDirection: "row",
        alignItems: "center",
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: 0.5,
        borderColor: theme.colors.divider,
        ...webInteractive,
    },
    filterChipActive: {
        backgroundColor: `${theme.colors.accentBlue}1A`,
        borderColor: theme.colors.accentBlue,
    },
    filterChipText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
    },
    filterChipTextActive: {
        color: theme.colors.accentBlue,
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
}));

interface WorkflowListProps {
    hideUpdateBanner?: boolean;
}

export const WorkflowList = React.memo<WorkflowListProps>(function WorkflowList({
    hideUpdateBanner,
}) {
    const layout = useLayout();
    const insets = useSafeAreaInsets();
    const { workflows, loading } = useWorkflows();
    const [activeFilter, setActiveFilter] = React.useState<"all" | WorkflowKind>("all");
    // Collapsed-ids: Multi-session workflows default to EXPANDED; only the
    // ones in this set are collapsed. Inverting the default keeps the
    // common case zero-click.
    const [collapsedIds, setCollapsedIds] = React.useState<Record<string, boolean>>({});

    const filtered = React.useMemo(() => {
        if (activeFilter === "all") return workflows;
        return workflows.filter((w) => w.kind === activeFilter);
    }, [workflows, activeFilter]);

    const toggleCollapse = React.useCallback((id: string) => {
        setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    const HeaderComponent = React.useCallback(
        () => (
            <>
                {!hideUpdateBanner && <UpdateBanner />}
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
            </>
        ),
        [activeFilter, hideUpdateBanner],
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
                        />
                    )}
                    ListHeaderComponent={HeaderComponent}
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 128,
                    }}
                />
            </View>
        </View>
    );
});

// --- Row -------------------------------------------------------------------

interface WorkflowRowProps {
    workflow: Workflow;
    expanded: boolean;
    onToggleCollapse: () => void;
}

const WorkflowRow = React.memo(function WorkflowRow({
    workflow,
    expanded,
    onToggleCollapse,
}: WorkflowRowProps) {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { isHovered, hoverProps } = useWebHoverProps();
    const [recurringModalVisible, setRecurringModalVisible] = React.useState(false);

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
                style={({ pressed }) => [
                    styles.rowHeader,
                    isHovered && styles.rowHeaderHovered,
                    pressed && styles.rowHeaderPressed,
                ]}
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
                    </View>
                </View>
                <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={theme.colors.textSecondary}
                    style={styles.expandToggle}
                />
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
