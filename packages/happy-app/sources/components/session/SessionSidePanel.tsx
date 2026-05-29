import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { Typography } from "@/constants/Typography";
import { InputContext } from "@/hooks/useInputContext";
import {
    useProjectForSession,
    useSessionChangesInfo,
    useSetting,
} from "@/sync/storage";
import { useProjectKnowledgeConfig } from "@/hooks/useProjectKnowledgeConfig";
import { t } from "@/text";
import { SidePanelFilePreview } from "./SidePanelFilePreview";
import { SidePanelGitPanel } from "./SidePanelGitPanel";
import { SidePanelPreviewTab } from "./SidePanelPreviewTab";
import { SidePanelSessionTab } from "./SidePanelSessionTab";
import { SidePanelSummaryTab } from "./SidePanelSummaryTab";
import { SidePanelTerminalTab } from "./SidePanelTerminalTab";
import { SessionGlassTabBar, type SessionGlassTabBarItem } from "./SessionGlassTabBar";
import {
    getSessionPanelTabDefinitions,
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
    type SessionPanelTab,
} from "./sessionPanelTabs";
import { formatCompactTabNumber } from "./sessionTabNumberFormat";
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

export const SessionSidePanel = React.memo<SessionSidePanelProps>(
    function SessionSidePanel({ sessionId, collapsed, onToggleCollapse }) {
        const { theme } = useUnistyles();
        const enablePreviewTab = useSetting("enablePreviewTab");
        const [activeTab, setActiveTab] = React.useState<SessionPanelTab>("session");
        const [previewingFile, setPreviewingFile] = React.useState<string | null>(null);
        const [previewingRepoPath, setPreviewingRepoPath] = React.useState<string | null>(null);
        const inputContext = React.useContext(InputContext);
        const project = useProjectForSession(sessionId);
        const { config: knowledgeConfig } = useProjectKnowledgeConfig(
            project?.serverId ?? undefined,
        );
        // Default to true while config is loading so the tab does not flicker
        // out; once the GET returns, the flag reflects the real project setting.
        const knowledgeBaseEnabled = knowledgeConfig?.enabled ?? true;

        const handleFilePress = React.useCallback((fullPath: string, repoPath?: string) => {
            setPreviewingFile(fullPath);
            setPreviewingRepoPath(repoPath ?? null);
        }, []);

        const handleClosePreview = React.useCallback(() => {
            setPreviewingFile(null);
            setPreviewingRepoPath(null);
        }, []);

        const handleReference = React.useCallback(
            (path: string) => {
                inputContext?.appendToInput(buildFileReferenceText(path));
            },
            [inputContext],
        );

        // Tiny `{ totalAdded, totalRemoved } | null` selector under useShallow.
        // Decouples the tab bar from the full GitStatus / submodules
        // references, which the git fetcher replaces on every mutable-tool
        // tick even when the numbers haven't moved.
        const changesInfo = useSessionChangesInfo(sessionId);

        const tabDefinitions = React.useMemo(
            () => getSessionPanelTabDefinitions({ enablePreviewTab, knowledgeBaseEnabled }),
            [enablePreviewTab, knowledgeBaseEnabled],
        );
        const tabs = React.useMemo(
            () => getSessionPanelTabs({ enablePreviewTab, knowledgeBaseEnabled }),
            [enablePreviewTab, knowledgeBaseEnabled],
        );
        const effectiveActiveTab = resolveSessionPanelActiveTab(activeTab, tabs);

        React.useEffect(() => {
            if (effectiveActiveTab !== activeTab) {
                setActiveTab(effectiveActiveTab);
            }
        }, [activeTab, effectiveActiveTab]);

        const topTabs = React.useMemo<SessionGlassTabBarItem[]>(
            () =>
                tabDefinitions.map((tab) => ({
                    key: tab.key,
                    label: t(tab.labelKey),
                    secondary:
                        tab.key === "changes" && changesInfo ? (
                            <View
                                style={styles.metricSecondaryRow}
                            >
                                <Text
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.72}
                                    numberOfLines={1}
                                    style={[
                                        styles.metricDelta,
                                        { color: theme.colors.gitAddedText },
                                    ]}
                                >
                                    +{formatCompactTabNumber(changesInfo.totalAdded)}
                                </Text>
                                <Text
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.72}
                                    numberOfLines={1}
                                    style={[
                                        styles.metricDelta,
                                        { color: theme.colors.gitRemovedText },
                                    ]}
                                >
                                    -{formatCompactTabNumber(changesInfo.totalRemoved)}
                                </Text>
                            </View>
                        ) : undefined,
                })),
            [changesInfo, tabDefinitions, theme],
        );

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
                        repoPath={previewingRepoPath ?? undefined}
                        onClose={handleClosePreview}
                    />
                ) : (
                    <>
                        <View
                            style={[
                                styles.headerWrap,
                                { backgroundColor: theme.colors.surface },
                            ]}
                        >
                            <SessionGlassTabBar
                                tabs={topTabs}
                                activeTab={effectiveActiveTab}
                                onChange={(tabKey) => setActiveTab(tabKey as SessionPanelTab)}
                                scrollable
                                tabMinWidth={68}
                                trailingAccessory={(
                                    <Pressable
                                        onPress={onToggleCollapse}
                                        hitSlop={6}
                                        style={styles.collapseButton}
                                    >
                                        <Ionicons
                                            name="chevron-forward"
                                            size={16}
                                            color={theme.colors.textSecondary}
                                        />
                                    </Pressable>
                                )}
                            />
                        </View>

                        <View style={{ flex: 1 }}>
                            {effectiveActiveTab === "files" && (
                                <GitBrowseTab
                                    key={sessionId}
                                    sessionId={sessionId}
                                    embedded
                                    onFilePress={handleFilePress}
                                    onReference={handleReference}
                                />
                            )}
                            {effectiveActiveTab === "changes" && (
                                <SidePanelGitPanel
                                    sessionId={sessionId}
                                    onFilePress={handleFilePress}
                                />
                            )}
                            {effectiveActiveTab === "session" && (
                                <SidePanelSessionTab sessionId={sessionId} />
                            )}
                            {effectiveActiveTab === "preview" && (
                                <SidePanelPreviewTab sessionId={sessionId} />
                            )}
                            {effectiveActiveTab === "knowledge" && (
                                <SidePanelSummaryTab sessionId={sessionId} />
                            )}
                            {effectiveActiveTab === "terminal" && (
                                <SidePanelTerminalTab sessionId={sessionId} />
                            )}
                        </View>
                    </>
                )}
            </View>
        );
    },
);

const styles = StyleSheet.create((_, rt) => ({
    headerWrap: {
        paddingHorizontal: 6,
        paddingTop: 6,
        paddingBottom: 4,
    },
    collapseButton: {
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    metricSecondaryRow: {
        width: "100%",
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        maxWidth: "100%",
        opacity: 0.94,
    },
    metricDelta: {
        fontSize: 8,
        lineHeight: 9,
        includeFontPadding: false,
        textAlign: "center",
        flexShrink: 1,
        letterSpacing: -0.1,
        ...Typography.mono("semiBold"),
    },

}));
