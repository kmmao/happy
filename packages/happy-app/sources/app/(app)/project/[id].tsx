import * as React from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { ProjectDetailView } from "@/components/project/ProjectDetailView";
import { getProjectDisplayName } from "@/sync/projectManager";
import { t } from "@/text";

function ProjectDetailScreen() {
    const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
    const navigation = useNavigation();
    const project = useProject(id);

    React.useLayoutEffect(() => {
        if (project) {
            navigation.setOptions({
                headerTitle: getProjectDisplayName(project),
            });
        }
    }, [navigation, project]);

    if (!project) {
        return (
            <View style={styles.notFound}>
                <Text style={styles.notFoundText}>
                    {t("projects.notFound")}
                </Text>
            </View>
        );
    }

    const initialTab =
        tab === "health" || tab === "git" || tab === "sessions" || tab === "research" || tab === "config"
            ? tab
            : undefined;

    return <ProjectDetailView project={project} initialTab={initialTab} />;
}

const styles = StyleSheet.create((theme) => ({
    notFound: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    notFoundText: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
    },
}));

export default React.memo(ProjectDetailScreen);
