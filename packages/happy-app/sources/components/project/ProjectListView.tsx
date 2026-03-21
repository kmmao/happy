import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { useProjects } from "@/hooks/useProjects";
import { ProjectCard } from "./ProjectCard";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { t } from "@/text";

export const ProjectListView = React.memo(() => {
    const projects = useProjects();
    const router = useRouter();
    const { theme } = useUnistyles();

    const handleProjectPress = React.useCallback(
        (projectId: string) => {
            router.push(`/project/${projectId}`);
        },
        [router],
    );

    const handleProjectLongPress = React.useCallback(
        (projectId: string, sessionCount: number) => {
            if (sessionCount > 0) {
                Modal.alert(
                    t("projects.deleteProject"),
                    t("projects.hasActiveSessions"),
                );
                return;
            }

            void (async () => {
                const confirmed = await Modal.confirm(
                    t("projects.deleteConfirmTitle"),
                    t("projects.deleteConfirmMessage"),
                    { confirmText: t("common.delete"), destructive: true },
                );
                if (!confirmed) return;

                try {
                    await sync.deleteManualProject(projectId);
                } catch (error) {
                    Modal.alert(
                        t("common.error"),
                        error instanceof Error ? error.message : String(error),
                    );
                }
            })();
        },
        [],
    );

    const handleAddProject = React.useCallback(() => {
        router.push("/project/add");
    }, [router]);

    if (projects.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Ionicons
                    name="folder-open-outline"
                    size={64}
                    color={theme.colors.textSecondary}
                />
                <Text style={styles.emptyTitle}>
                    {t("projects.emptyTitle")}
                </Text>
                <Text style={styles.emptySubtitle}>
                    {t("projects.emptySubtitle")}
                </Text>
                <Pressable
                    style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={handleAddProject}
                >
                    <Ionicons
                        name="add-circle-outline"
                        size={20}
                        color="#FFFFFF"
                    />
                    <Text style={styles.addButtonText}>
                        {t("projects.addProject")}
                    </Text>
                </Pressable>
            </View>
        );
    }

    const groupTitle = React.useMemo(
        () => (
            <View style={styles.groupHeader}>
                <Text style={styles.groupHeaderTitle}>
                    {t("projects.allProjects")}
                </Text>
                <Pressable onPress={handleAddProject} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                    <Ionicons
                        name="add-circle-outline"
                        size={22}
                        color={theme.colors.header.tint}
                    />
                </Pressable>
            </View>
        ),
        [handleAddProject, theme],
    );

    return (
        <ItemList>
            <ItemGroup title={groupTitle}>
                {projects.map((project) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        onPress={() => handleProjectPress(project.id)}
                        onLongPress={() =>
                            handleProjectLongPress(
                                project.id,
                                project.sessionIds.length,
                            )
                        }
                    />
                ))}
            </ItemGroup>
        </ItemList>
    );
});

const styles = StyleSheet.create((theme) => ({
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 32,
        backgroundColor: theme.colors.groupped.background,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
        marginTop: 16,
        textAlign: "center",
    },
    emptySubtitle: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 8,
        textAlign: "center",
    },
    groupHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    groupHeaderTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
    },
    addButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 24,
        backgroundColor: theme.colors.header.tint,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
    },
    addButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: "#FFFFFF",
    },
}));
