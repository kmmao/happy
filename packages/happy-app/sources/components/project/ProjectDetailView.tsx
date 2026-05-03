import * as React from "react";
import { View, Text, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { ProjectSessionsTab } from "./ProjectSessionsTab";
import { ProjectGitTab } from "./ProjectGitTab";
import { ProjectSupervisorTab } from "./ProjectSupervisorTab";
import { ProjectHealthTab } from "./ProjectHealthTab";
import { ProjectResearchTab, type ResearchSyncStatus } from "./ProjectResearchTab";
import { ProjectKnowledgeTab } from "./ProjectKnowledgeTab";
import { ProjectActionsTab } from "./ProjectActionsTab";
import { ProjectConfigTab } from "./ProjectConfigTab";
import { ProjectActionTraceTab } from "./ProjectActionTraceTab";
import { screenLayoutMaxWidth } from "@/components/layout";
import { t } from "@/text";
import { storage, useSetting } from "@/sync/storage";
import { gitStatusSync } from "@/sync/gitStatusSync";
import { Ionicons } from "@expo/vector-icons";
import { useIsTablet } from "@/utils/responsive";
import { resolveUiTabToneColors } from "@/components/tabTone";
import { resolveActiveTint } from "@/constants/activeTint";
import { fetchSupervisorActions } from "@/sync/apiSupervisor";
import { TokenStorage } from "@/auth/tokenStorage";
import { onProjectEvent } from "@/utils/projectEvents";

import { resolveProjectDetailInitialTab, resolveProjectDetailTabs, type ProjectDetailTabKey } from "./projectDetailTabs";
import { resolveProjectDetailTabPresentation } from "./projectDetailTabPresentation";

type TabKey = ProjectDetailTabKey;

const TAB_LABELS: Record<TabKey, () => string> = {
    sessions: () => t("projects.tabSessions"),
    git: () => t("projects.tabGit"),
    supervisor: () => t("projects.tabSupervisor"),
    health: () => t("projects.tabHealth"),
    events: () => t("projects.tabEvents"),
    research: () => t("projects.tabResearch"),
    knowledge: () => t("projects.tabKnowledge"),
    traces: () => t("projects.tabTraces"),
    config: () => t("projects.tabConfig"),
};

interface ProjectDetailViewProps {
    project: Project;
    initialTab?: TabKey;
}

export const ProjectDetailView = React.memo(
    ({ project, initialTab }: ProjectDetailViewProps) => {
        const { theme } = useUnistyles();
        const { width: viewportWidth } = useWindowDimensions();
        const isTablet = useIsTablet();
        const [activeTab, setActiveTab] = React.useState<TabKey>("sessions");
        const [researchSyncStatus, setResearchSyncStatus] =
            React.useState<ResearchSyncStatus>("idle");
        const [pendingEventsCount, setPendingEventsCount] = React.useState(0);
        const knowledgeBaseEnabled = useSetting("knowledgeBase");

        React.useEffect(() => {
            if (!project.serverId) return;
            const serverId = project.serverId;
            async function loadPendingCount() {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                try {
                    const data = await fetchSupervisorActions(credentials, serverId, {
                        approval: "pending",
                        limit: 1,
                    });
                    setPendingEventsCount(data.total);
                } catch {}
            }
            loadPendingCount();
            return onProjectEvent("actions-changed", loadPendingCount);
        }, [project.serverId]);

        React.useEffect(() => {
            const sessions = storage.getState().sessions;
            const activeSessionId = project.sessionIds.find(
                (id) => sessions[id]?.active,
            );
            if (activeSessionId) {
                gitStatusSync.getSync(activeSessionId).invalidate();
            }
        }, [project.sessionIds]);

        React.useEffect(() => {
            const nextTab = resolveProjectDetailInitialTab({
                requestedTab: initialTab,
                knowledgeBaseEnabled,
            });
            setActiveTab(nextTab);
        }, [initialTab, knowledgeBaseEnabled]);

        const tabs: { key: TabKey; label: string }[] = React.useMemo(
            () => {
                const tabKeys = resolveProjectDetailTabs({ knowledgeBaseEnabled });
                return tabKeys.map((key) => ({ key, label: TAB_LABELS[key]() }));
            },
            [knowledgeBaseEnabled],
        );
        const useCompactTabs = !isTablet && (tabs.length >= 5 || viewportWidth < 420);

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
                            const presentation = resolveProjectDetailTabPresentation(tab.key);
                            const toneColors = resolveUiTabToneColors(
                                presentation.tone,
                                theme,
                            );
                            const showEventsBadge =
                                tab.key === "events" && pendingEventsCount > 0;
                            return (
                                <Pressable
                                    key={tab.key}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: isActive }}
                                    hitSlop={6}
                                    style={({ pressed }) => [
                                        styles.segmentButton,
                                        useCompactTabs && styles.segmentButtonCompact,
                                        isActive && styles.segmentButtonActive,
                                        pressed && styles.segmentButtonPressed,
                                    ]}
                                    onPress={() => setActiveTab(tab.key)}
                                >
                                    <View style={styles.segmentLabelRow}>
                                        <View
                                            style={[
                                                styles.segmentIconBadge,
                                                useCompactTabs &&
                                                    styles.segmentIconBadgeCompact,
                                                isActive
                                                    ? styles.segmentIconBadgeActive
                                                    : {
                                                          backgroundColor:
                                                              toneColors.backgroundColor,
                                                      },
                                            ]}
                                        >
                                            <Ionicons
                                                name={presentation.icon}
                                                size={useCompactTabs ? 13 : 14}
                                                color={
                                                    isActive
                                                        ? "#FFFFFF"
                                                        : toneColors.textColor
                                                }
                                            />
                                            {showSyncDot && (
                                                <View
                                                    style={[
                                                        styles.syncDot,
                                                        styles.syncDotOverlay,
                                                        {
                                                            backgroundColor:
                                                                dotColor,
                                                        },
                                                    ]}
                                                />
                                            )}
                                        </View>
                                        <Text
                                            style={[
                                                styles.segmentText,
                                                useCompactTabs &&
                                                    styles.segmentTextCompact,
                                                isActive && styles.segmentTextActive,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {tab.label}
                                        </Text>
                                        {showEventsBadge && (
                                            <View
                                                style={[
                                                    styles.eventsBadge,
                                                    isActive && styles.eventsBadgeActive,
                                                ]}
                                            >
                                                <Text style={[
                                                    styles.eventsBadgeText,
                                                    isActive && styles.eventsBadgeTextActive,
                                                ]}>
                                                    {pendingEventsCount > 99 ? "99+" : pendingEventsCount}
                                                </Text>
                                            </View>
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
                            activeTab === "supervisor"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectSupervisorTab project={project} />
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
                            activeTab === "events"
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
                            activeTab === "traces"
                                ? styles.tabVisible
                                : styles.tabHidden
                        }
                    >
                        <ProjectActionTraceTab project={project} isActive={activeTab === "traces"} />
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

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    segmentScroll: {
        flexGrow: 0,
        marginTop: 6,
        marginBottom: 8,
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        alignSelf: "center",
        width: "100%",
    },
    segmentScrollContent: {
        paddingHorizontal: 12,
        paddingRight: 18,
    },
    segmentContainer: {
        flexDirection: "row",
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 4,
        gap: 4,
        alignSelf: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: theme.colors.shadow.opacity * 0.4,
        shadowRadius: 10,
        elevation: 2,
    },
    segmentButton: {
        minHeight: 36,
        paddingVertical: 8,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
    },
    segmentButtonCompact: {
        paddingVertical: 7,
        paddingHorizontal: 10,
    },
    segmentButtonActive: {
        backgroundColor: resolveActiveTint(theme),
    },
    segmentButtonPressed: {
        opacity: 0.88,
    },
    segmentLabelRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    segmentIconBadge: {
        width: 24,
        height: 24,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    segmentIconBadgeCompact: {
        width: 22,
        height: 22,
    },
    segmentIconBadgeActive: {
        backgroundColor: "rgba(255,255,255,0.18)",
    },
    segmentText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    segmentTextCompact: {
        fontSize: 12,
    },
    segmentTextActive: {
        color: "#FFFFFF",
    },
    syncDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: theme.colors.surface,
    },
    syncDotOverlay: {
        position: "absolute",
        right: -1,
        top: -1,
    },
    eventsBadge: {
        backgroundColor: "#FF3B30",
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
    },
    eventsBadgeActive: {
        backgroundColor: "rgba(255,255,255,0.3)",
    },
    eventsBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        color: "#FFFFFF",
    },
    eventsBadgeTextActive: {
        color: "#FFFFFF",
    },
    content: {
        flex: 1,
        width: "100%",
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        alignSelf: "center",
    },
    tabVisible: {
        flex: 1,
    },
    tabHidden: {
        display: "none",
    },
}));
