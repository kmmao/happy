import * as React from "react";
import { View, Text, FlatList } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { storage } from "@/sync/storage";
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
        const allSessions = storage((s) => s.sessions);

        const sessions = React.useMemo(() => {
            return project.sessionIds
                .map((id) => allSessions[id])
                .filter(Boolean)
                .sort((a, b) => {
                    // Active first, then by activeAt descending
                    if (a.active !== b.active) return a.active ? -1 : 1;
                    return b.activeAt - a.activeAt;
                });
        }, [project.sessionIds, allSessions]);

        if (sessions.length === 0) {
            return (
                <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>
                        {t("projects.noSessions")}
                    </Text>
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
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
}));
