import * as React from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { screenLayoutMaxWidth } from "@/components/layout";
import { Project } from "@/sync/projectManager";
import { SupervisorConfigSection } from "./config/SupervisorConfigSection";
import { ResearchDefaultsSection } from "./config/ResearchDefaultsSection";
import { KnowledgeConfigSection } from "./config/KnowledgeConfigSection";
import { NotificationProfileSection } from "./config/NotificationProfileSection";
import { IntegrationsSection } from "./config/IntegrationsSection";

interface ProjectConfigTabProps {
    project: Project;
}

export const ProjectConfigTab = React.memo<ProjectConfigTabProps>(
    ({ project }) => {
        return (
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <SupervisorConfigSection project={project} />
                <ResearchDefaultsSection project={project} />
                <KnowledgeConfigSection project={project} />
                <NotificationProfileSection project={project} />
                <IntegrationsSection project={project} />
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((_, rt) => ({
    container: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 40,
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        alignSelf: "center",
        width: "100%",
        gap: 16,
    },
}));
