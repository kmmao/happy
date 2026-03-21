import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { storage } from "@/sync/storage";
import { useShallow } from "zustand/react/shallow";
import { Session } from "@/sync/storageTypes";
import { useSessionStatus, getSessionName } from "@/utils/sessionUtils";
import { useRouter } from "expo-router";
import { t } from "@/text";
import { Modal } from "@/modal";
import { sessionDelete, sessionKill } from "@/sync/ops";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";

interface ProjectSessionsTabProps {
    project: Project;
}

const SessionRow = React.memo(({ session, showDivider }: { session: Session; showDivider?: boolean }) => {
    const router = useRouter();
    const status = useSessionStatus(session);
    const { theme } = useUnistyles();
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
            <RectButton onPress={handlePress} enabled={!isBusy}>
                <Item
                    title={getSessionName(session)}
                    subtitle={status.statusText}
                    icon={
                        <View
                            style={[
                                styles.statusDot,
                                { backgroundColor: status.statusDotColor },
                            ]}
                        />
                    }
                    rightElement={
                        <View style={styles.tagsRow}>
                            <View
                                style={[
                                    styles.sessionTag,
                                    session.metadata?.worktree?.isWorktree
                                        ? styles.sessionTagBranch
                                        : styles.sessionTagMain,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.sessionTagText,
                                        session.metadata?.worktree?.isWorktree
                                            ? styles.sessionTagBranchText
                                            : styles.sessionTagMainText,
                                    ]}
                                >
                                    {session.metadata?.worktree?.isWorktree
                                        ? t("sessionInfo.tagBranch")
                                        : t("sessionInfo.tagMain")}
                                </Text>
                            </View>
                            {session.metadata?.host && (
                                <View style={styles.sessionTag}>
                                    <Text style={styles.sessionTagMetaText}>
                                        {session.metadata.host}
                                    </Text>
                                </View>
                            )}
                            {session.metadata?.version && (
                                <View style={styles.sessionTag}>
                                    <Text style={styles.sessionTagMetaText}>
                                        {session.metadata.version}
                                    </Text>
                                </View>
                            )}
                        </View>
                    }
                    showChevron={session.active}
                    showDivider={showDivider}
                    loading={isBusy}
                />
            </RectButton>
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
                <View style={styles.emptyContainer}>
                    <Ionicons
                        name="chatbubble-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={styles.emptyText}>
                        {t("projects.noSessions")}
                    </Text>
                    <Pressable
                        style={styles.newSessionButton}
                        onPress={handleNewSession}
                    >
                        <Ionicons name="add" size={18} color="#FFFFFF" />
                        <Text style={styles.newSessionButtonText}>
                            {t("newSession.title")}
                        </Text>
                    </Pressable>
                </View>
            );
        }

        return (
            <ItemList>
                <ItemGroup
                    title={
                        <View style={styles.archivedHeader}>
                            <Text style={styles.archivedHeaderTitle}>
                                {t("projects.activeSessions")}
                            </Text>
                            <Pressable
                                onPress={handleNewSession}
                                hitSlop={8}
                                style={({ pressed }) => [
                                    styles.archivedHeaderButton,
                                    pressed && { opacity: 0.5 },
                                ]}
                            >
                                <Ionicons name="add-circle-outline" size={14} color={theme.colors.header.tint} />
                                <Text style={[styles.archivedHeaderButtonText, { color: theme.colors.header.tint }]}>
                                    {t("newSession.title")}
                                </Text>
                            </Pressable>
                        </View>
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
                            <View style={styles.archivedHeader}>
                                <Text style={styles.archivedHeaderTitle}>
                                    {t("projects.archivedSessions")}
                                </Text>
                                <View style={styles.archivedHeaderActions}>
                                    {archivedBranchSessions.length > 0 && (
                                        <Pressable
                                            onPress={handleDeleteArchivedBranchSessions}
                                            disabled={deletingArchivedBranch || deletingArchived}
                                            hitSlop={8}
                                            style={({ pressed }) => [
                                                styles.archivedHeaderButton,
                                                pressed && { opacity: 0.5 },
                                            ]}
                                        >
                                            <Ionicons name="git-branch-outline" size={14} color={theme.colors.accentPurple} />
                                            <Text style={styles.archivedHeaderButtonBranchText}>
                                                {t("projects.clearBranch")}
                                            </Text>
                                        </Pressable>
                                    )}
                                    <Pressable
                                        onPress={handleDeleteArchivedSessions}
                                        disabled={deletingArchived || deletingArchivedBranch}
                                        hitSlop={8}
                                        style={({ pressed }) => [
                                            styles.archivedHeaderButton,
                                            pressed && { opacity: 0.5 },
                                        ]}
                                    >
                                        <Ionicons name="trash-outline" size={14} color={theme.colors.deleteAction} />
                                        <Text style={[styles.archivedHeaderButtonText, { color: theme.colors.deleteAction }]}>
                                            {t("projects.clearAll")}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
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
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    newSessionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.header.tint,
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
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    sessionTag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        marginRight: 4,
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
    },
    tagsRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
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
        alignItems: "center",
        justifyContent: "space-between",
    },
    archivedHeaderTitle: {
        fontSize: 13,
        color: theme.colors.groupped.sectionTitle,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        ...Typography.default(),
    },
    archivedHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    archivedHeaderButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
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
