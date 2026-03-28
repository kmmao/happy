import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { KnowledgeEvolutionView } from "@/components/project/KnowledgeEvolutionView";

function EvolutionScreen() {
    const { id, entryId } = useLocalSearchParams<{ id: string; entryId: string }>();

    return (
        <View style={styles.container}>
            <KnowledgeEvolutionView
                projectServerId={id ?? ""}
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
