import * as React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { ProjectSessionsTab } from "./ProjectSessionsTab";
import { ProjectGitTab } from "./ProjectGitTab";
import { ProjectHealthTab } from "./ProjectHealthTab";
import { ProjectResearchTab, type ResearchSyncStatus } from "./ProjectResearchTab";
import { ProjectActionsTab } from "./ProjectActionsTab";
import { ProjectConfigTab } from "./ProjectConfigTab";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { storage } from "@/sync/storage";
import { gitStatusSync } from "@/sync/gitStatusSync";

type TabKey = "sessions" | "git" | "health" | "actions" | "research" | "config";

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
        const [researchSyncStatus, setResearchSyncStatus] =
            React.useState<ResearchSyncStatus>("idle");

        // Proactively trigger git status refresh on mount if project has active sessions
        React.useEffect(() => {
            const sessions = storage.getState().sessions;
            const activeSessionId = project.sessionIds.find(
                (id) => sessions[id]?.active,
            );
            if (activeSessionId) {
                gitStatusSync.getSync(activeSessionId).invalidate();
            }
        }, [project.sessionIds]);

        const tabs: { key: TabKey; label: string }[] = React.useMemo(
            () => [
                { key: "sessions", label: t("projects.tabSessions") },
                { key: "git", label: t("projects.tabGit") },
                { key: "health", label: t("projects.tabHealth") },
                { key: "actions", label: t("projects.tabActions") },
                { key: "research", label: t("projects.tabResearch") },
                { key: "config", label: t("projects.tabConfig") },
            ],
            [],
        );

        return (
            <View style={styles.container}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.segmentScrollContent}
                    style={styles.segmentScroll}
                >
                    <View style={styles.segmentContainer}>
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.key;
                            const showSyncDot =
                                tab.key === "research" &&
                                researchSyncStatus !== "idle";
                            const dotColor =
                                researchSyncStatus === "failed"
                                    ? theme.colors.deleteAction
                                    : researchSyncStatus === "saved"
                                        ? theme.colors.header.tint
                                        : theme.colors.textSecondary;
                            return (
                                <Pressable
                                    key={tab.key}
                                    style={[
                                        styles.segmentButton,
                                        isActive && styles.segmentButtonActive,
                                    ]}
                                    onPress={() => setActiveTab(tab.key)}
                                >
                                    <View style={styles.segmentLabelRow}>
                                        <Text
                                            style={[
                                                styles.segmentText,
                                                isActive && styles.segmentTextActive,
                                            ]}
                                        >
                                            {tab.label}
                                        </Text>
                                        {showSyncDot && (
                                            <View
                                                style={[
                                                    styles.syncDot,
                                                    { backgroundColor: dotColor },
                                                ]}
                                            />
                                        )}
                                    </View>
                                </Pressable>
                            );
                        })}
                    </View>
                </ScrollView>
                <View style={styles.content}>
                    <View
                        style={
                            activeTab === "sessions"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectSessionsTab project={project} />
                    </View>
                    <View
                        style={
                            activeTab === "git"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectGitTab project={project} />
                    </View>
                    <View
                        style={
                            activeTab === "health"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectHealthTab project={project} />
                    </View>
                    <View
                        style={
                            activeTab === "actions"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectActionsTab project={project} />
                    </View>
                    <View
                        style={
                            activeTab === "research"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectResearchTab
                            project={project}
                            onSyncStatusChange={setResearchSyncStatus}
                        />
                    </View>
                    <View
                        style={
                            activeTab === "config"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectConfigTab project={project} />
                    </View>
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    segmentScroll: {
        flexGrow: 0,
        marginTop: 8,
        marginBottom: 4,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    segmentScrollContent: {
        paddingHorizontal: 16,
    },
    segmentContainer: {
        flexDirection: "row",
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 2,
        maxWidth: layout.maxWidth - 32,
        alignSelf: "center",
    },
    segmentButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        alignItems: "center",
        borderRadius: 6,
    },
    segmentButtonActive: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    segmentLabelRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    segmentText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    segmentTextActive: {
        ...Typography.default("semiBold"),
        color: "#FFFFFF",
    },
    syncDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    content: {
        flex: 1,
    },
    tabVisible: {
        flex: 1,
    },
    tabHidden: {
        flex: 1,
        display: "none",
    },
}));
