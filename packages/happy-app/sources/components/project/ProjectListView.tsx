import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { resolveActiveTint } from "@/constants/activeTint";
import { useProjects } from "@/hooks/useProjects";
import { ProjectCard } from "./ProjectCard";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { t } from "@/text";
import {
    SharedGroupHeader,
    SharedGroupHeaderAction,
} from "@/components/SharedGroupHeader";
import { SharedStateView } from "@/components/SharedStateView";

export const ProjectListView = React.memo(() => {
    const projects = useProjects();
    const router = useRouter();
    const { theme } = useUnistyles();

    const handleProjectPress = React.useCallback(
        (projectId: string) => {
            router.push(`/world?projectId=${projectId}` as any);
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
            <SharedStateView
                kind="empty"
                icon={
                    <Ionicons
                        name="folder-open-outline"
                        size={64}
                        color={theme.colors.textSecondary}
                    />
                }
                title={t("projects.emptyTitle")}
                description={t("projects.emptySubtitle")}
            >
                <Pressable
                    style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={handleAddProject}
                    accessibilityLabel={t("projects.addProject")}
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="add-circle-outline"
                        size={20}
                        color={theme.colors.button.primary.tint}
                    />
                    <Text style={styles.addButtonText}>
                        {t("projects.addProject")}
                    </Text>
                </Pressable>
            </SharedStateView>
        );
    }

    const groupTitle = React.useMemo(
        () => (
            <SharedGroupHeader
                title={t("projects.allProjects")}
                trailing={
                    <SharedGroupHeaderAction
                        icon="add-circle-outline"
                        label={t("projects.addProject")}
                        onPress={handleAddProject}
                    />
                }
            />
        ),
        [handleAddProject],
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
    addButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 24,
        backgroundColor: resolveActiveTint(theme),
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
    },
    addButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.button.primary.tint,
    },
}));
