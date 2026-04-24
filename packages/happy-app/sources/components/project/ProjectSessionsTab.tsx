import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Swipeable } from "react-native-gesture-handler";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { Project } from "@/sync/projectManager";
import { storage, useMachine } from "@/sync/storage";
import { useShallow } from "zustand/react/shallow";
import { Session } from "@/sync/storageTypes";
import {
    useSessionStatus,
    getSessionName,
} from "@/utils/sessionUtils";
import { useRouter } from "expo-router";
import { t } from "@/text";
import { Modal } from "@/modal";
import { sessionDelete, sessionKill } from "@/sync/ops";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { SessionProviderTag } from "@/components/session/SessionProviderTag";
import {
    resolveProjectSessionScopeTone,
    resolveProjectSessionTextBadges,
} from "./projectSessionBadges";
import {
    SharedGroupHeader,
    SharedGroupHeaderAction,
} from "@/components/SharedGroupHeader";
import { SharedStateView } from "@/components/SharedStateView";

interface ProjectSessionsTabProps {
    project: Project;
}

const SessionRow = React.memo(({ session, showDivider }: { session: Session; showDivider?: boolean }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const status = useSessionStatus(session);
    const machine = useMachine(session.metadata?.machineId ?? "");
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const isSwipeOpen = React.useRef(false);
    const [archiving, performArchive] = useHappyAction(async () => {
        const result = await sessionKill(session.id);
        if (!result.success) {
            throw new HappyError(
                result.message || t("sessionInfo.failedToArchiveSession"),
                false,
            );
        }
    });

    const handleArchive = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t("sessionInfo.archiveSession"),
            t("sessionInfo.archiveSessionConfirm"),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("sessionInfo.archiveSession"),
                    style: "destructive",
                    onPress: performArchive,
                },
            ],
        );
    }, [performArchive]);

    const [deleting, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(
                result.message || t("sessionInfo.failedToDeleteSession"),
                false,
            );
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t("sessionInfo.deleteSession"),
            t("sessionInfo.deleteSessionWarning"),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("sessionInfo.deleteSession"),
                    style: "destructive",
                    onPress: performDelete,
                },
            ],
        );
    }, [performDelete]);

    const isBusy = archiving || deleting;

    const renderRightActions = React.useCallback(
        () => (
            <View style={{ flexDirection: "row" }}>
                {session.active && (
                    <Pressable
                        style={styles.swipeActionArchive}
                        onPress={handleArchive}
                        disabled={isBusy}
                    >
                        <Ionicons
                            name="archive-outline"
                            size={20}
                            color="#FFFFFF"
                        />
                        <Text style={styles.swipeActionText} numberOfLines={1}>
                            {t("sessionInfo.archiveSession")}
                        </Text>
                    </Pressable>
                )}
                <Pressable
                    style={styles.swipeActionDelete}
                    onPress={handleDelete}
                    disabled={isBusy}
                >
                    <Ionicons
                        name="trash-outline"
                        size={20}
                        color="#FFFFFF"
                    />
                    <Text style={styles.swipeActionText} numberOfLines={1}>
                        {t("sessionInfo.deleteSession")}
                    </Text>
                </Pressable>
            </View>
        ),
        [session.active, handleArchive, handleDelete, isBusy],
    );

    const handlePress = React.useCallback(() => {
        if (isSwipeOpen.current) {
            swipeableRef.current?.close();
            return;
        }
        router.push(`/session/${session.id}`);
    }, [router, session.id]);

    const scopeTone = React.useMemo(
        () => resolveProjectSessionScopeTone(session),
        [session],
    );
    const textBadges = React.useMemo(
        () =>
            resolveProjectSessionTextBadges({
                session,
                machineLabel: machine?.metadata?.displayName ?? null,
            }),
        [machine?.metadata?.displayName, session],
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderRightActions={renderRightActions}
            overshootRight={false}
            rightThreshold={40}
            enabled={!isBusy}
            onSwipeableWillOpen={() => { isSwipeOpen.current = true; }}
            onSwipeableClose={() => { isSwipeOpen.current = false; }}
        >
            <Pressable
                onPress={handlePress}
                disabled={isBusy}
                style={({ pressed }) => [
                    styles.sessionRow,
                    showDivider && styles.sessionRowDivider,
                    pressed && styles.sessionRowPressed,
                    isBusy && styles.sessionRowBusy,
                ]}
            >
                <View style={styles.sessionRowMain}>
                    <View style={styles.sessionDotColumn}>
                        <View
                            style={[
                                styles.statusDot,
                                { backgroundColor: status.statusDotColor },
                            ]}
                        />
                    </View>
                    <View style={styles.sessionContent}>
                        <View style={styles.sessionHeader}>
                            <View style={styles.sessionTitleBlock}>
                                <Text
                                    style={[
                                        styles.sessionTitle,
                                        !status.isConnected && styles.sessionTitleMuted,
                                    ]}
                                    numberOfLines={2}
                                >
                                    {getSessionName(session)}
                                </Text>
                                <Text
                                    style={styles.sessionSubtitle}
                                    numberOfLines={1}
                                >
                                    {status.statusText}
                                </Text>
                            </View>
                            {session.active ? (
                                <Ionicons
                                    name="chevron-forward"
                                    size={18}
                                    color={theme.colors.groupped.chevron}
                                    style={styles.chevron}
                                />
                            ) : null}
                        </View>
                        <View style={styles.tagsRow}>
                            <View
                                style={[
                                    styles.sessionTag,
                                    scopeTone === "branch"
                                        ? styles.sessionTagBranch
                                        : styles.sessionTagMain,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.sessionTagText,
                                        scopeTone === "branch"
                                            ? styles.sessionTagBranchText
                                            : styles.sessionTagMainText,
                                    ]}
                                >
                                    {scopeTone === "branch"
                                        ? t("sessionInfo.tagBranch")
                                        : t("sessionInfo.tagMain")}
                                </Text>
                            </View>
                            <SessionProviderTag session={session} includeModel />
                            {textBadges.map((badge) => (
                                <View
                                    key={`${session.id}-${badge.kind}-${badge.value}`}
                                    style={[
                                        styles.sessionTag,
                                        badge.kind === "branchName" && styles.branchNameTag,
                                    ]}
                                >
                                    {badge.kind === "branchName" ? (
                                        <Ionicons
                                            name="git-branch-outline"
                                            size={11}
                                            color={theme.colors.text}
                                        />
                                    ) : null}
                                    <Text
                                        style={[
                                            styles.sessionTagMetaText,
                                            badge.kind === "branchName" &&
                                                styles.branchNameTagText,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {badge.value}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
            </Pressable>
        </Swipeable>
    );
});

export const ProjectSessionsTab = React.memo(
    ({ project }: ProjectSessionsTabProps) => {
        const router = useRouter();
        const { theme } = useUnistyles();
        const sessions = storage(
            useShallow((s) => {
                return project.sessionIds
                    .map((id) => s.sessions[id])
                    .filter(Boolean)
                    .sort((a, b) => {
                        // Active first
                        if (a.active !== b.active) return a.active ? -1 : 1;
                        // Active sessions: stable sort by createdAt (activeAt changes too frequently)
                        // Inactive sessions: sort by activeAt (most recently active first)
                        const sortKey = a.active ? "createdAt" : "activeAt";
                        const timeDiff = b[sortKey] - a[sortKey];
                        if (timeDiff !== 0) return timeDiff;
                        return a.id < b.id ? -1 : 1;
                    });
            }),
        );

        const activeSessions = React.useMemo(
            () => sessions.filter((s) => s.active),
            [sessions],
        );

        const archivedSessions = React.useMemo(
            () => sessions.filter((s) => !s.active),
            [sessions],
        );

        const handleNewSession = React.useCallback(() => {
            router.push({
                pathname: "/new",
                params: {
                    machineId: project.key.machineId,
                    path: project.key.path,
                },
            });
        }, [router, project.key.machineId, project.key.path]);

        const [deletingArchived, performDeleteArchived] = useHappyAction(
            async () => {
                const ids = archivedSessions.map((s) => s.id);
                const results = await Promise.all(
                    ids.map((id) => sessionDelete(id)),
                );
                const failed = results.filter((r) => !r.success);
                if (failed.length > 0 && failed.length === ids.length) {
                    throw new HappyError(
                        t("projects.failedToDeleteArchivedSessions"),
                        false,
                    );
                }
                const deletedCount = ids.length - failed.length;
                Modal.toast(
                    t("projects.deleteArchivedSessionsSuccess", {
                        count: deletedCount,
                    }),
                );
            },
        );

        const handleDeleteArchivedSessions = React.useCallback(() => {
            const count = archivedSessions.length;
            Modal.alert(
                t("projects.deleteArchivedSessions"),
                t("projects.deleteArchivedSessionsConfirm", { count }),
                [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                        text: t("projects.deleteArchivedSessions"),
                        style: "destructive",
                        onPress: performDeleteArchived,
                    },
                ],
            );
        }, [archivedSessions.length, performDeleteArchived]);

        const archivedBranchSessions = React.useMemo(
            () => archivedSessions.filter((s) => s.metadata?.worktree?.isWorktree),
            [archivedSessions],
        );

        const [deletingArchivedBranch, performDeleteArchivedBranch] = useHappyAction(
            async () => {
                const ids = archivedBranchSessions.map((s) => s.id);
                const results = await Promise.all(
                    ids.map((id) => sessionDelete(id)),
                );
                const failed = results.filter((r) => !r.success);
                if (failed.length > 0 && failed.length === ids.length) {
                    throw new HappyError(
                        t("projects.failedToDeleteArchivedSessions"),
                        false,
                    );
                }
                const deletedCount = ids.length - failed.length;
                Modal.toast(
                    t("projects.deleteArchivedSessionsSuccess", {
                        count: deletedCount,
                    }),
                );
            },
        );

        const handleDeleteArchivedBranchSessions = React.useCallback(() => {
            const count = archivedBranchSessions.length;
            Modal.alert(
                t("projects.deleteArchivedBranchSessions"),
                t("projects.deleteArchivedBranchSessionsConfirm", { count }),
                [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                        text: t("projects.deleteArchivedBranchSessions"),
                        style: "destructive",
                        onPress: performDeleteArchivedBranch,
                    },
                ],
            );
        }, [archivedBranchSessions.length, performDeleteArchivedBranch]);

        if (sessions.length === 0) {
            return (
                <SharedStateView
                    kind="empty"
                    icon={
                        <Ionicons
                            name="chatbubble-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                    }
                    title={t("projects.noSessions")}
                >
                    <Pressable
                        style={styles.newSessionButton}
                        onPress={handleNewSession}
                    >
                        <Ionicons name="add" size={18} color="#FFFFFF" />
                        <Text style={styles.newSessionButtonText}>
                            {t("newSession.title")}
                        </Text>
                    </Pressable>
                </SharedStateView>
            );
        }

        return (
            <ItemList>
                <ItemGroup
                    title={
                        <SharedGroupHeader
                            title={t("projects.activeSessions")}
                            trailing={
                                <SharedGroupHeaderAction
                                    icon="add-circle-outline"
                                    label={t("newSession.title")}
                                    onPress={handleNewSession}
                                />
                            }
                        />
                    }
                >
                    {activeSessions.length > 0 ? (
                        activeSessions.map((session) => (
                            <SessionRow key={session.id} session={session} />
                        ))
                    ) : (
                        <Item
                            title={t("projects.noSessions")}
                            showChevron={false}
                        />
                    )}
                </ItemGroup>
                {archivedSessions.length > 0 && (
                    <ItemGroup
                        title={
                            <SharedGroupHeader
                                title={t("projects.archivedSessions")}
                                trailing={
                                    <View style={styles.archivedHeaderActions}>
                                    {archivedBranchSessions.length > 0 && (
                                        <SharedGroupHeaderAction
                                            icon="git-branch-outline"
                                            label={t("projects.clearBranch")}
                                            onPress={handleDeleteArchivedBranchSessions}
                                            disabled={deletingArchivedBranch || deletingArchived}
                                            tone="purple"
                                        />
                                    )}
                                    <SharedGroupHeaderAction
                                        icon="trash-outline"
                                        label={t("projects.clearAll")}
                                        onPress={handleDeleteArchivedSessions}
                                        disabled={deletingArchived || deletingArchivedBranch}
                                        tone="danger"
                                    />
                                    </View>
                                }
                            />
                        }
                    >
                        {archivedSessions.map((session) => (
                            <SessionRow key={session.id} session={session} />
                        ))}
                    </ItemGroup>
                )}
            </ItemList>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    newSessionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: resolveActiveTint(theme),
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        marginTop: 4,
    },
    newSessionButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#FFFFFF",
    },
    sessionRow: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
    },
    sessionRowDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    sessionRowPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    sessionRowBusy: {
        opacity: 0.6,
    },
    sessionRowMain: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    sessionDotColumn: {
        width: 12,
        alignItems: "center",
        paddingTop: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    sessionContent: {
        flex: 1,
        minWidth: 0,
        gap: 10,
    },
    sessionHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    sessionTitleBlock: {
        flex: 1,
        minWidth: 0,
    },
    sessionTitle: {
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    sessionTitleMuted: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitle: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    chevron: {
        marginTop: 2,
        color: theme.colors.groupped.chevron,
    },
    sessionTag: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: "100%",
    },
    sessionTagBranch: {
        backgroundColor: "rgba(88, 86, 214, 0.12)",
    },
    sessionTagMain: {
        backgroundColor: "rgba(52, 199, 89, 0.12)",
    },
    sessionTagText: {
        fontSize: 10,
        ...Typography.default("semiBold"),
    },
    sessionTagBranchText: {
        color: theme.colors.accentPurple,
    },
    sessionTagMainText: {
        color: theme.colors.success,
    },
    sessionTagMetaText: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        flexShrink: 1,
    },
    branchNameTag: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    branchNameTagText: {
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    tagsRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    swipeActionDelete: {
        width: 80,
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.status.error,
    },
    swipeActionArchive: {
        width: 80,
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.warning,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 11,
        color: "#FFFFFF",
        textAlign: "center",
        ...Typography.default("semiBold"),
    },
    archivedHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    archivedHeaderTitle: {
        fontSize: 13,
        color: theme.colors.groupped.sectionTitle,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        ...Typography.default("semiBold"),
    },
    archivedHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: 12,
        flexShrink: 1,
    },
    archivedHeaderButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
    },
    archivedHeaderButtonText: {
        fontSize: 12,
        ...Typography.default("semiBold"),
    },
    archivedHeaderButtonBranchText: {
        fontSize: 12,
        color: theme.colors.accentPurple,
        ...Typography.default("semiBold"),
    },
}));
