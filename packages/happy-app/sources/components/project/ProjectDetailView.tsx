import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { ProjectSessionsTab } from "./ProjectSessionsTab";
import { ProjectGitTab } from "./ProjectGitTab";
import { ProjectHealthTab } from "./ProjectHealthTab";
import { t } from "@/text";

type TabKey = "sessions" | "git" | "health";

interface ProjectDetailViewProps {
    project: Project;
    initialTab?: TabKey;
}

export const ProjectDetailView = React.memo(
    ({ project, initialTab }: ProjectDetailViewProps) => {
        const { theme } = useUnistyles();
        const [activeTab, setActiveTab] = React.useState<TabKey>(
            initialTab ?? "sessions",
        );

        const tabs: { key: TabKey; label: string }[] = React.useMemo(
            () => [
                { key: "sessions", label: t("projects.tabSessions") },
                { key: "git", label: t("projects.tabGit") },
                { key: "health", label: t("projects.tabHealth") },
            ],
            [],
        );

        const renderContent = React.useCallback(() => {
            switch (activeTab) {
                case "sessions":
                    return <ProjectSessionsTab project={project} />;
                case "git":
                    return <ProjectGitTab project={project} />;
                case "health":
                    return <ProjectHealthTab project={project} />;
            }
        }, [activeTab, project]);

        return (
            <View style={styles.container}>
                <View style={styles.segmentContainer}>
                    {tabs.map((tab) => {
                        const isActive = activeTab === tab.key;
                        return (
                            <Pressable
                                key={tab.key}
                                style={[
                                    styles.segmentButton,
                                    isActive && styles.segmentButtonActive,
                                ]}
                                onPress={() => setActiveTab(tab.key)}
                            >
                                <Text
                                    style={[
                                        styles.segmentText,
                                        isActive && styles.segmentTextActive,
                                    ]}
                                >
                                    {tab.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
                <View style={styles.content}>{renderContent()}</View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    segmentContainer: {
        flexDirection: "row",
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 2,
    },
    segmentButton: {
        flex: 1,
        paddingVertical: 8,
        alignItems: "center",
        borderRadius: 6,
    },
    segmentButtonActive: {
        backgroundColor: theme.colors.header.tint,
    },
    segmentText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    segmentTextActive: {
        ...Typography.default("semiBold"),
        color: "#FFFFFF",
    },
    content: {
        flex: 1,
    },
}));
