import * as React from "react";
import {
    Modal,
    Pressable,
    View,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { useProjectForSession, useSession, useSetting } from "@/sync/storage";
import { useProjectKnowledgeConfig } from "@/hooks/useProjectKnowledgeConfig";
import { SidePanelGitPanel } from "./SidePanelGitPanel";
import { SidePanelSessionTab } from "./SidePanelSessionTab";
import { SidePanelSummaryTab } from "./SidePanelSummaryTab";
import { SidePanelTerminalTab } from "./SidePanelTerminalTab";
import { SidePanelClaudeTab } from "./SidePanelClaudeTab";
import { SidePanelPreviewTab } from "./SidePanelPreviewTab";
import { SidePanelFilePreview } from "./SidePanelFilePreview";
import { SessionGlassTabBar, type SessionGlassTabBarItem } from "./SessionGlassTabBar";
import { buildFileReferenceText } from "./sessionSidePanelReference";
import { InputContext } from "@/hooks/useInputContext";
import {
    getMobilePanelLayoutConfig,
    getMobilePanelTabChipMinWidth,
} from "./mobileSessionPanelStyle";
import { getSessionName } from "@/utils/sessionUtils";
import {
    getSessionPanelTabDefinitions,
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
    type SessionPanelTab,
} from "./sessionPanelTabs";

interface MobileSessionPanelSheetProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
}

export const MobileSessionPanelSheet = React.memo<MobileSessionPanelSheetProps>(
    function MobileSessionPanelSheet({ visible, onClose, sessionId }) {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const enablePreviewTab = useSetting("enablePreviewTab");
        const [activeTab, setActiveTab] = React.useState<SessionPanelTab>("session");
        const [previewingFile, setPreviewingFile] = React.useState<string | null>(null);
        const [previewingRepoPath, setPreviewingRepoPath] = React.useState<string | null>(null);
        const inputContext = React.useContext(InputContext);
        const session = useSession(sessionId);
        const sessionTitle = session ? getSessionName(session) : "Panel";
        const project = useProjectForSession(sessionId);
        const { config: knowledgeConfig } = useProjectKnowledgeConfig(
            project?.serverId ?? undefined,
        );
        // Default to true while the config is still loading so the tab does not
        // flicker out; once the GET lands, the real project setting takes over.
        const knowledgeBaseEnabled = knowledgeConfig?.enabled ?? true;
        const tabDefinitions = React.useMemo(
            () => getSessionPanelTabDefinitions({ enablePreviewTab, knowledgeBaseEnabled }),
            [enablePreviewTab, knowledgeBaseEnabled],
        );
        const tabs = React.useMemo(
            () => getSessionPanelTabs({ enablePreviewTab, knowledgeBaseEnabled }),
            [enablePreviewTab, knowledgeBaseEnabled],
        );
        const layoutConfig = React.useMemo(() => getMobilePanelLayoutConfig(), []);
        const tabChipMinWidth = React.useMemo(() => getMobilePanelTabChipMinWidth(), []);
        const effectiveActiveTab = resolveSessionPanelActiveTab(activeTab, tabs);
        const mobileTabs = React.useMemo<SessionGlassTabBarItem[]>(
            () =>
                tabDefinitions.map((tab) => ({
                    key: tab.key,
                    label: t(tab.labelKey),
                })),
            [tabDefinitions],
        );

        React.useEffect(() => {
            if (effectiveActiveTab !== activeTab) {
                setActiveTab(effectiveActiveTab);
            }
        }, [activeTab, effectiveActiveTab]);

        const handleReference = React.useCallback(
            (path: string) => {
                inputContext?.appendToInput(buildFileReferenceText(path));
                onClose();
            },
            [inputContext, onClose],
        );

        const handleFilePress = React.useCallback((fullPath: string, repoPath?: string) => {
            setPreviewingFile(fullPath);
            setPreviewingRepoPath(repoPath ?? null);
        }, []);

        const handleClosePreview = React.useCallback(() => {
            setPreviewingFile(null);
            setPreviewingRepoPath(null);
        }, []);

        // Tab content is always rendered so GitBrowseTab retains its current
        // directory / filter state across opening + closing a file preview.
        // The preview is rendered as an absolute overlay above this content.
        const renderContent = () => {
            switch (effectiveActiveTab) {
                case "files":
                    return (
                        <GitBrowseTab
                            key={sessionId}
                            sessionId={sessionId}
                            embedded
                            onFilePress={handleFilePress}
                            onReference={handleReference}
                        />
                    );
                case "changes":
                    return <SidePanelGitPanel sessionId={sessionId} onFilePress={handleFilePress} />;
                case "knowledge":
                    return <SidePanelSummaryTab sessionId={sessionId} />;
                case "session":
                    return <SidePanelSessionTab sessionId={sessionId} />;
                case "preview":
                    return <SidePanelPreviewTab sessionId={sessionId} />;
                case "terminal":
                    return <SidePanelTerminalTab sessionId={sessionId} />;
                case "claude":
                    return <SidePanelClaudeTab sessionId={sessionId} />;
            }
        };

        return (
            <>
                <Modal
                    visible={visible}
                    animationType="slide"
                    transparent
                    onRequestClose={onClose}
                >
                    <View
                        style={{
                            flex: 1,
                            backgroundColor: theme.colors.surface,
                        }}
                    >
                        <View
                            style={{
                                backgroundColor: theme.colors.surface,
                                height: `${layoutConfig.sheetHeightPercent * 100}%`,
                                overflow: "hidden",
                                paddingTop: insets.top,
                                paddingBottom: Math.max(insets.bottom, 8),
                            }}
                        >
                            {!previewingFile && (
                                <View
                                    style={{
                                        height: layoutConfig.topBarHeight,
                                        justifyContent: "center",
                                        paddingHorizontal: 8,
                                        backgroundColor: theme.colors.surface,
                                        flexDirection: "row",
                                        alignItems: "center",
                                    }}
                                >
                                    <Pressable
                                        onPress={onClose}
                                        hitSlop={8}
                                        style={{
                                            width: layoutConfig.backButtonSize,
                                            height: layoutConfig.backButtonSize,
                                            borderRadius: layoutConfig.backButtonSize / 2,
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
                                    </Pressable>
                                    <Text
                                        numberOfLines={1}
                                        style={{
                                            flex: 1,
                                            marginLeft: layoutConfig.titleLeftGap,
                                            fontSize: 15,
                                            color: theme.colors.text,
                                            ...Typography.default("semiBold"),
                                        }}
                                    >
                                        {sessionTitle}
                                    </Text>
                                </View>
                            )}

                            {!previewingFile && (
                                <View
                                    style={{
                                        backgroundColor: theme.colors.surface,
                                        minHeight: layoutConfig.tabBarMinHeight,
                                        justifyContent: "center",
                                        paddingHorizontal: 10,
                                        paddingVertical: 6,
                                    }}
                                >
                                    <SessionGlassTabBar
                                        tabs={mobileTabs}
                                        activeTab={effectiveActiveTab}
                                        onChange={(tabKey) => setActiveTab(tabKey as SessionPanelTab)}
                                        scrollable
                                        tabMinWidth={tabChipMinWidth}
                                    />
                                </View>
                            )}

                            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                                {renderContent()}
                            </View>

                            {previewingFile && (
                                <View
                                    style={[
                                        StyleSheet.absoluteFillObject,
                                        { backgroundColor: theme.colors.surface },
                                    ]}
                                >
                                    <SidePanelFilePreview
                                        sessionId={sessionId}
                                        filePath={previewingFile}
                                        repoPath={previewingRepoPath ?? undefined}
                                        onClose={handleClosePreview}
                                    />
                                </View>
                            )}
                        </View>
                    </View>
                </Modal>
            </>
        );
    },
);
