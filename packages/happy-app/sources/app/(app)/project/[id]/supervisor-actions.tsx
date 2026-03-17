import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { ProjectActionsTab } from "@/components/project/ProjectActionsTab";
import { layout } from "@/components/layout";

function SupervisorActionsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: t("supervisor.actionHistory"),
        });
    }, [navigation]);

    // Minimal project-like object — ProjectActionsTab uses project.serverId
    const project = React.useMemo(() => ({ serverId: id }) as any, [id]);

    return (
        <View style={styles.container}>
            <ProjectActionsTab project={project} />
        </View>
    );
}

export default React.memo(SupervisorActionsScreen);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
    },
}));
