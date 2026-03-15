import * as React from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
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

interface ProjectSessionsTabProps {
    project: Project;
}

const SessionRow = React.memo(({ session }: { session: Session }) => {
    const router = useRouter();
    const status = useSessionStatus(session);
    const { theme } = useUnistyles();

    return (
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
            onPress={() => router.push(`/session/${session.id}`)}
            showChevron
        />
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

        const handleNewSession = React.useCallback(() => {
            router.push({
                pathname: "/new",
                params: {
                    machineId: project.key.machineId,
                    path: project.key.path,
                },
            });
        }, [router, project.key.machineId, project.key.path]);

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
                <ItemGroup title={t("projects.sessions")}>
                    {sessions.map((session) => (
                        <SessionRow key={session.id} session={session} />
                    ))}
                </ItemGroup>
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
}));
