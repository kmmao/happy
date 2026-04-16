import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { SessionKnowledgeSheet } from "@/components/knowledge/SessionKnowledgeSheet";
import type { SessionKnowledgeTab } from "@/components/knowledge/sessionKnowledgeLoadState";
import { Typography } from "@/constants/Typography";
import { InputContext } from "@/hooks/useInputContext";
import {
    useProjectForSession,
    useSessionGitStatus,
    useSessionProjectGitStatus,
    useSessionProjectSubmodules,
    useSetting,
} from "@/sync/storage";
import { t } from "@/text";
import { aggregateLineChanges } from "@/utils/gitStatusUtils";
import { SidePanelCodeTab } from "./SidePanelCodeTab";
import { SidePanelFilePreview } from "./SidePanelFilePreview";
import { SidePanelGitPanel } from "./SidePanelGitPanel";
import { SidePanelPreviewTab } from "./SidePanelPreviewTab";
import { SidePanelSummaryTab } from "./SidePanelSummaryTab";
import { SidePanelTerminalTab } from "./SidePanelTerminalTab";
import {
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
    type SessionPanelTab,
} from "./sessionPanelTabs";
import { buildFileReferenceText } from "./sessionSidePanelReference";

export const SIDE_PANEL_WIDTH = 360;
export const SIDE_PANEL_MIN_WINDOW_WIDTH = 1200;
const COLLAPSED_WIDTH = 36;

interface SessionSidePanelProps {
    sessionId: string;
    collapsed: boolean;
    onToggleCollapse: () => void;
    width?: number;
}

const SESSION_PANEL_TAB_LABELS: Record<SessionPanelTab, string> = {
    changes: t("sidePanel.changes"),
    files: t("sidePanel.files"),
    code: t("sidePanel.code"),
    preview: t("sidePanel.preview"),
    summary: t("sidePanel.summary"),
    terminal: t("sidePanel.terminal"),
};

export const SessionSidePanel = React.memo<SessionSidePanelProps>(
    function SessionSidePanel({ sessionId, collapsed, onToggleCollapse }) {
        const { theme } = useUnistyles();
        const enablePreviewTab = useSetting("enablePreviewTab");
        const [activeTab, setActiveTab] = React.useState<SessionPanelTab>("changes");
        const [previewingFile, setPreviewingFile] = React.useState<string | null>(null);
        const [showKnowledgeSheet, setShowKnowledgeSheet] = React.useState(false);
        const [knowledgeSheetInitialTab, setKnowledgeSheetInitialTab] = React.useState<SessionKnowledgeTab>("changes");
        const inputContext = React.useContext(InputContext);
        const project = useProjectForSession(sessionId);

        const handleFilePress = React.useCallback((fullPath: string) => {
            setPreviewingFile(fullPath);
        }, []);

        const handleClosePreview = React.useCallback(() => {
            setPreviewingFile(null);
        }, []);

        const handleReference = React.useCallback(
            (path: string) => {
                inputContext?.appendToInput(buildFileReferenceText(path));
            },
            [inputContext],
        );

        const handleOpenKnowledge = React.useCallback((tab: SessionKnowledgeTab) => {
            setKnowledgeSheetInitialTab(tab);
            setShowKnowledgeSheet(true);
        }, []);

        const projectGitStatus = useSessionProjectGitStatus(sessionId);
        const sessionGitStatus = useSessionGitStatus(sessionId);
        const gitStatus = projectGitStatus || sessionGitStatus;
        const submodules = useSessionProjectSubmodules(sessionId);

        const changesInfo = React.useMemo(() => {
            if (!gitStatus || gitStatus.lastUpdatedAt === 0) return null;
            const { totalAdded, totalRemoved } = aggregateLineChanges(gitStatus, submodules);
            if (totalAdded === 0 && totalRemoved === 0) return null;
            return { totalAdded, totalRemoved };
        }, [gitStatus, submodules]);

        const tabs = React.useMemo(
            () => getSessionPanelTabs(enablePreviewTab),
            [enablePreviewTab],
        );

        React.useEffect(() => {
            setActiveTab((currentTab) => resolveSessionPanelActiveTab(currentTab, tabs));
        }, [tabs]);

        if (collapsed) {
            return (
                <Pressable
                    onPress={onToggleCollapse}
                    style={{
                        width: COLLAPSED_WIDTH,
                        backgroundColor: theme.colors.surfaceHigh,
                        borderLeftWidth: Platform.select({ ios: 0.33, default: 1 }),
                        borderLeftColor: theme.colors.divider,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Ionicons
                        name="chevron-back"
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            );
        }

        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: theme.colors.surface,
                }}
            >
                {previewingFile ? (
                    <SidePanelFilePreview
                        sessionId={sessionId}
                        filePath={previewingFile}
                        onClose={handleClosePreview}
                    />
                ) : (
                    <>
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                                borderBottomColor: theme.colors.divider,
                                backgroundColor: theme.colors.surfaceHigh,
                            }}
                        >
                            {tabs.map((tab) => (
                                <Pressable
                                    key={tab}
                                    onPress={() => setActiveTab(tab)}
                                    style={{
                                        flex: 1,
                                        paddingVertical: 10,
                                        alignItems: "center",
                                        borderBottomWidth: 2,
                                        borderBottomColor:
                                            activeTab === tab
                                                ? theme.colors.textLink
                                                : "transparent",
                                        flexDirection: "row",
                                        justifyContent: "center",
                                        gap: 4,
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            fontWeight: activeTab === tab ? "600" : "400",
                                            color:
                                                activeTab === tab
                                                    ? theme.colors.textLink
                                                    : theme.colors.textSecondary,
                                            ...Typography.default(),
                                        }}
                                    >
                                        {SESSION_PANEL_TAB_LABELS[tab]}
                                    </Text>
                                    {tab === "changes" && changesInfo && (
                                        <View style={{ flexDirection: "row", gap: 2 }}>
                                            <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.gitAddedText }}>
                                                +{changesInfo.totalAdded}
                                            </Text>
                                            <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.gitRemovedText }}>
                                                -{changesInfo.totalRemoved}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            ))}
                            <Pressable
                                onPress={onToggleCollapse}
                                hitSlop={6}
                                style={{
                                    paddingHorizontal: 10,
                                    paddingVertical: 10,
                                }}
                            >
                                <Ionicons
                                    name="chevron-forward"
                                    size={16}
                                    color={theme.colors.textSecondary}
                                />
                            </Pressable>
                        </View>

                        <View style={{ flex: 1 }}>
                            {activeTab === "files" && (
                                <GitBrowseTab
                                    key={sessionId}
                                    sessionId={sessionId}
                                    embedded
                                    onFilePress={handleFilePress}
                                    onReference={handleReference}
                                />
                            )}
                            {activeTab === "changes" && (
                                <SidePanelGitPanel
                                    sessionId={sessionId}
                                    onFilePress={handleFilePress}
                                />
                            )}
                            {activeTab === "code" && (
                                <SidePanelCodeTab sessionId={sessionId} />
                            )}
                            {activeTab === "preview" && (
                                <SidePanelPreviewTab sessionId={sessionId} />
                            )}
                            {activeTab === "summary" && (
                                <SidePanelSummaryTab
                                    sessionId={sessionId}
                                    onOpenKnowledge={handleOpenKnowledge}
                                />
                            )}
                            {activeTab === "terminal" && (
                                <SidePanelTerminalTab sessionId={sessionId} />
                            )}
                        </View>
                        <SessionKnowledgeSheet
                            visible={showKnowledgeSheet}
                            onClose={() => setShowKnowledgeSheet(false)}
                            projectServerId={project?.serverId ?? undefined}
                            sessionId={sessionId}
                            initialTab={knowledgeSheetInitialTab}
                            maxHeight="84%"
                        />
                    </>
                )}
            </View>
        );
    },
);
