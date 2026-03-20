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
import { sessionDelete, sessionKill, sessionRestore } from "@/sync/ops";
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

    const [restoring, performRestore] = useHappyAction(async () => {
        const result = await sessionRestore(session.id);
        if (!result.success) {
            throw new HappyError(
                result.message || t("sessionInfo.failedToRestoreSession"),
                false,
            );
        }
    });

    const handleRestore = React.useCallback(() => {
        swipeableRef.current?.close();
        performRestore();
    }, [performRestore]);

    const isBusy = archiving || deleting || restoring;

    const renderRightActions = React.useCallback(
        () => (
            <View style={{ flexDirection: "row" }}>
                {session.active ? (
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
                ) : (
                    <Pressable
                        style={styles.swipeActionRestore}
                        onPress={handleRestore}
                        disabled={isBusy}
                    >
                        <Ionicons
                            name="arrow-undo-outline"
                            size={20}
                            color="#FFFFFF"
                        />
                        <Text style={styles.swipeActionText} numberOfLines={1}>
                            {t("sessionInfo.restoreSession")}
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
        [session.active, handleArchive, handleRestore, handleDelete, isBusy],
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
                <ItemGroup>
                    <Item
                        title={t("newSession.title")}
                        icon={
                            <Ionicons
                                name="add-circle-outline"
                                size={20}
                                color={theme.colors.header.tint}
                            />
                        }
                        onPress={handleNewSession}
                        titleStyle={{ color: theme.colors.header.tint }}
                        showChevron
                    />
                </ItemGroup>
                {activeSessions.length > 0 && (
                    <ItemGroup title={t("projects.activeSessions")}>
                        {activeSessions.map((session) => (
                            <SessionRow key={session.id} session={session} />
                        ))}
                    </ItemGroup>
                )}
                {archivedSessions.length > 0 && (
                    <ItemGroup title={t("projects.archivedSessions")}>
                        <Item
                            title={t("projects.deleteArchivedSessions")}
                            icon={
                                <Ionicons
                                    name="trash-outline"
                                    size={20}
                                    color={theme.colors.deleteAction}
                                />
                            }
                            onPress={handleDeleteArchivedSessions}
                            titleStyle={{ color: theme.colors.deleteAction }}
                            disabled={deletingArchived}
                        />
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
    swipeActionRestore: {
        width: 80,
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.header.tint,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 11,
        color: "#FFFFFF",
        textAlign: "center",
        ...Typography.default("semiBold"),
    },
}));
