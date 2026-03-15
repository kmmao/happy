import * as React from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { useProjects } from "@/hooks/useProjects";
import { ProjectCard } from "./ProjectCard";
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
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup title={t("projects.allProjects")}>
                {projects.map((project) => (
                    <ProjectCard
                        key={project.id}
                        project={project}
                        onPress={() => handleProjectPress(project.id)}
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
}));
