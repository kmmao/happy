import * as React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { ProjectSessionsTab } from "./ProjectSessionsTab";
import { ProjectHealthTab } from "./ProjectHealthTab";
import { ProjectResearchTab, type ResearchSyncStatus } from "./ProjectResearchTab";
import { ProjectKnowledgeTab } from "./ProjectKnowledgeTab";
import { WorldRolesTab } from "./WorldRolesTab";
import { WorldMembersTab } from "./WorldMembersTab";
import { WorldGoalsTab } from "./WorldGoalsTab";
import { WorldOverviewTab } from "./WorldOverviewTab";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { useSetting } from "@/sync/storage";

import { resolveProjectDetailInitialTab, type ProjectDetailTabKey } from "./projectDetailTabs";

type TabKey = ProjectDetailTabKey;

interface ProjectDetailViewProps {
    project: Project;
    initialTab?: TabKey;
}

export const ProjectDetailView = React.memo(
    ({ project, initialTab }: ProjectDetailViewProps) => {
        const { theme } = useUnistyles();
        const [activeTab, setActiveTab] = React.useState<TabKey>("world");
        const [researchSyncStatus, setResearchSyncStatus] =
            React.useState<ResearchSyncStatus>("idle");
        const knowledgeBaseEnabled = useSetting("knowledgeBase");

        React.useEffect(() => {
            const nextTab = resolveProjectDetailInitialTab({
                requestedTab: initialTab,
                knowledgeBaseEnabled,
            });
            setActiveTab(nextTab);
        }, [initialTab, knowledgeBaseEnabled]);

        const tabs: { key: TabKey; label: string }[] = React.useMemo(
            () => {
                const base: { key: TabKey; label: string }[] = [
                    { key: "world", label: t("projects.tabWorld") },
                    { key: "roles", label: t("projects.tabRoles") },
                    { key: "members", label: t("projects.tabMembers") },
                    { key: "goals", label: t("projects.tabGoals") },
                    { key: "sessions", label: t("projects.tabSessions") },
                    { key: "health", label: t("projects.tabHealth") },
                    { key: "research", label: t("projects.tabResearch") },
                ];
                if (knowledgeBaseEnabled) {
                    base.push({ key: "knowledge", label: t("projects.tabKnowledge") });
                }
                return base;
            },
            [knowledgeBaseEnabled],
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
                            activeTab === "health"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectHealthTab project={project} />
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
                    {knowledgeBaseEnabled && (
                        <View
                            style={
                                activeTab === "knowledge"
                                    ? styles.tabVisible
                                    : styles.tabHidden
                            }
                        >
                            <ProjectKnowledgeTab projectId={project.id} isActive={activeTab === "knowledge"} />
                        </View>
                    )}
                    <View
                        style={
                            activeTab === "world"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <WorldOverviewTab project={project} isActive={activeTab === "world"} />
                    </View>
                    <View
                        style={
                            activeTab === "roles"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <WorldRolesTab project={project} isActive={activeTab === "roles"} />
                    </View>
                    <View
                        style={
                            activeTab === "members"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <WorldMembersTab project={project} isActive={activeTab === "members"} />
                    </View>
                    <View
                        style={
                            activeTab === "goals"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <WorldGoalsTab project={project} isActive={activeTab === "goals"} />
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
