import * as React from "react";
import { View, Text, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { ProjectSessionsTab } from "./ProjectSessionsTab";
import { ProjectHealthTab } from "./ProjectHealthTab";
import { ProjectResearchTab, type ResearchSyncStatus } from "./ProjectResearchTab";
import { ProjectKnowledgeTab } from "./ProjectKnowledgeTab";
import { ProjectConfigTab } from "./ProjectConfigTab";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { useSetting } from "@/sync/storage";
import { Ionicons } from "@expo/vector-icons";
import { useIsTablet } from "@/utils/responsive";
import { resolveUiTabToneColors } from "@/components/tabTone";

import { resolveProjectDetailInitialTab, resolveProjectDetailTabs, type ProjectDetailTabKey } from "./projectDetailTabs";
import { resolveProjectDetailTabPresentation } from "./projectDetailTabPresentation";

type TabKey = ProjectDetailTabKey;

const TAB_LABELS: Record<TabKey, () => string> = {
    sessions: () => t("projects.tabSessions"),
    health: () => t("projects.tabHealth"),
    research: () => t("projects.tabResearch"),
    knowledge: () => t("projects.tabKnowledge"),
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
        marginTop: 6,
        marginBottom: 8,
        maxWidth: layout.maxWidth,
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
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
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
    content: {
        flex: 1,
        width: "100%",
        maxWidth: layout.maxWidth,
        alignSelf: "center",
    },
    tabVisible: {
        flex: 1,
    },
    tabHidden: {
        display: "none",
    },
}));
