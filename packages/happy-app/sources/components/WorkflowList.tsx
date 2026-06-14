/**
 * WorkflowList — the Workflow-IA replacement for SessionsList.
 *
 * Per docs/plans/sessions-and-automation-ia.md (Phase 1):
 *  - One row per Workflow (Ad-hoc / Scheduled / Event / Loop)
 *  - Each Workflow row expands to show its child Sessions
 *  - Filter chip row at the top (All / Ad-hoc / Scheduled / Event / Loop)
 *  - Tapping a Workflow opens the Workflow detail page; tapping a Session
 *    inside still goes to the conversation
 *
 * Phase 1 is read-only; Phase 2 adds promote actions on rows.
 */

import React from "react";
import {
    View,
    Pressable,
    FlatList,
    ScrollView,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Typography } from "@/constants/Typography";
import { useWorkflows, type Workflow, type WorkflowKind } from "@/hooks/useWorkflows";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { SharedStateView } from "./SharedStateView";
import { UpdateBanner } from "./UpdateBanner";
import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";
import {
    getSessionAvatarId,
    getSessionName,
    formatLastSeen,
    useSessionStatus,
} from "@/utils/sessionUtils";
import { useLayout } from "./layout";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";

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
    sessionsContainer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    sessionRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 10,
        ...webInteractive,
    },
    sessionRowHovered: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    sessionRowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    sessionRowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionRowName: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    sessionRowMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    sessionCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
        paddingLeft: 4,
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
    const [expandedIds, setExpandedIds] = React.useState<Record<string, boolean>>({});

    const filtered = React.useMemo(() => {
        if (activeFilter === "all") return workflows;
        return workflows.filter((w) => w.kind === activeFilter);
    }, [workflows, activeFilter]);

    const toggleExpanded = React.useCallback((id: string) => {
        setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
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
                            expanded={!!expandedIds[item.id]}
                            onToggleExpand={() => toggleExpanded(item.id)}
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
    onToggleExpand: () => void;
}

const WorkflowRow = React.memo(function WorkflowRow({
    workflow,
    expanded,
    onToggleExpand,
}: WorkflowRowProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const pathname = usePathname();
    const { isHovered, hoverProps } = useWebHoverProps();

    const navigateToWorkflow = React.useCallback(() => {
        router.push(`/workflow/${encodeURIComponent(workflow.id)}` as any);
    }, [router, workflow.id]);

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
                return `cron · ${workflow.runCount} runs`;
            case "event":
                return `webhook · ${workflow.triggerCount} fires`;
            case "loop":
                return `iter ${workflow.loop.iteration}`;
            case "adhoc":
                return null;
        }
    }, [workflow]);

    const canExpand = workflow.kind !== "adhoc" && workflow.sessions.length > 0;

    return (
        <View style={styles.rowContainer}>
            <Pressable
                {...hoverProps}
                onPress={navigateToWorkflow}
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
                            <Text style={styles.sessionCount}>
                                · {workflow.sessions.length} session{workflow.sessions.length === 1 ? "" : "s"}
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
                {canExpand ? (
                    <Pressable
                        style={styles.expandToggle}
                        hitSlop={8}
                        onPress={(e) => {
                            e.stopPropagation();
                            onToggleExpand();
                        }}
                    >
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                ) : null}
            </Pressable>

            {canExpand && expanded ? (
                <View style={styles.sessionsContainer}>
                    {workflow.sessions.map((session, idx) => (
                        <WorkflowSessionRow
                            key={session.id}
                            session={session}
                            showDivider={idx > 0}
                            selectedPath={pathname}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
});

const WorkflowSessionRow = React.memo(function WorkflowSessionRow({
    session,
    showDivider,
    selectedPath,
}: {
    session: Session;
    showDivider?: boolean;
    selectedPath: string;
}) {
    const styles2 = styles;
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);
    const { isHovered, hoverProps } = useWebHoverProps();

    const selected = selectedPath.startsWith(`/session/${session.id}`);
    const avatarId = React.useMemo(() => getSessionAvatarId(session), [session]);
    const name = getSessionName(session);

    return (
        <Pressable
            {...hoverProps}
            onPress={(e) => {
                e.stopPropagation();
                navigateToSession(session.id);
            }}
            style={[
                styles2.sessionRow,
                showDivider && styles2.sessionRowDivider,
                isHovered && !selected && styles2.sessionRowHovered,
                selected && styles2.sessionRowSelected,
            ]}
        >
            <Avatar
                id={avatarId}
                size={26}
                monochrome={!sessionStatus.isConnected}
                flavor={session.metadata?.flavor}
            />
            <Text style={styles2.sessionRowName} numberOfLines={1}>
                {name}
            </Text>
            <StatusDot color={sessionStatus.statusDotColor} />
            <Text style={styles2.sessionRowMeta}>
                {formatLastSeen(session.updatedAt ?? 0, false)}
            </Text>
            <Ionicons
                name="chevron-forward"
                size={14}
                color={theme.colors.groupped.chevron}
            />
        </Pressable>
    );
});
