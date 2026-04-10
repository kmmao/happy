import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { ActivityIndicator } from "react-native";
import { KnowledgeEvolutionView } from "@/components/project/KnowledgeEvolutionView";
import { useProject } from "@/hooks/useProjects";

function EvolutionScreen() {
    const { id, entryId } = useLocalSearchParams<{ id: string; entryId: string }>();
    const project = useProject(id);

    if (id && !project?.serverId) {
        return (
            <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <KnowledgeEvolutionView
                projectServerId={project?.serverId ?? ""}
                entryId={entryId ?? ""}
            />
        </View>
    );
}

export default React.memo(EvolutionScreen);

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
