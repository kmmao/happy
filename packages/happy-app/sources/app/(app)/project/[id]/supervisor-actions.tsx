import * as React from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { ProjectActionsTab } from "@/components/project/ProjectActionsTab";
import { screenLayoutMaxWidth } from "@/components/layout";
import { useProject } from "@/hooks/useProjects";

function SupervisorActionsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const localProject = useProject(id);

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: t("supervisor.actionHistory"),
        });
    }, [navigation]);

    // Minimal project-like object — ProjectActionsTab uses project.serverId
    const project = React.useMemo(() => ({ serverId: localProject?.serverId ?? null }) as any, [localProject?.serverId]);

    if (id && !localProject?.serverId) {
        return (
            <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ProjectActionsTab project={project} />
        </View>
    );
}

export default React.memo(SupervisorActionsScreen);

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        width: "100%",
        alignSelf: "center",
    },
}));
