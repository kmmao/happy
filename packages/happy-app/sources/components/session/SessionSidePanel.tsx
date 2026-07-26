import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { Typography } from "@/constants/Typography";
import { InputContext } from "@/hooks/useInputContext";
import {
    useSessionChangesInfo,
    useSetting,
} from "@/sync/storage";
import { t } from "@/text";
import { OpenFilesTabBar } from "./OpenFilesTabBar";
import { SidePanelFilePreview } from "./SidePanelFilePreview";
import { SidePanelGitPanel } from "./SidePanelGitPanel";
import { useOpenFilesStack } from "./useOpenFilesStack";
import { SidePanelPreviewTab } from "./SidePanelPreviewTab";
import { SidePanelSessionTab } from "./SidePanelSessionTab";
import { SidePanelTerminalTab } from "./SidePanelTerminalTab";
import { SidePanelClaudeTab } from "./SidePanelClaudeTab";
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
        const openFilesStack = useOpenFilesStack();
        const inputContext = React.useContext(InputContext);

        const handleFilePress = React.useCallback(
            (fullPath: string, repoPath?: string) => {
                openFilesStack.openFile(fullPath, repoPath);
            },
            [openFilesStack],
        );

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
            () => getSessionPanelTabDefinitions({ enablePreviewTab }),
            [enablePreviewTab],
        );
        const tabs = React.useMemo(
            () => getSessionPanelTabs({ enablePreviewTab }),
            [enablePreviewTab],
        );
        const effectiveActiveTab = resolveSessionPanelActiveTab(activeTab, tabs);

        React.useEffect(() => {
            if (effectiveActiveTab !== activeTab) {
                setActiveTab(effectiveActiveTab);
            }
        }, [activeTab, effectiveActiveTab]);

        // "+" in the overlay → minimize. Force-switch to the Files tab only
        // when the user is on a tab that doesn't surface a file browser
        // (Session/Preview/Terminal/Claude). When they're already
        // on Files or Changes, leave the tab alone — both expose a usable
        // file source and overriding their choice is more disruptive than
        // helpful (e.g. they were inspecting changed files and the next
        // file they want is in the same diff list).
        const handleAddFile = React.useCallback(() => {
            openFilesStack.minimize();
            if (effectiveActiveTab !== "files" && effectiveActiveTab !== "changes") {
                setActiveTab("files");
            }
        }, [openFilesStack, effectiveActiveTab]);

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
                {/* Tabs are always mounted so GitBrowseTab keeps its current
                 * directory / filter state when the user opens then closes a
                 * file preview. The preview sits on top as an overlay below. */}
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
                    {effectiveActiveTab === "terminal" && (
                        <SidePanelTerminalTab sessionId={sessionId} />
                    )}
                    {effectiveActiveTab === "claude" && (
                        <SidePanelClaudeTab sessionId={sessionId} />
                    )}
                </View>

                {openFilesStack.previewVisible &&
                    openFilesStack.openFiles.length > 0 && (
                        <View
                            style={[
                                StyleSheet.absoluteFillObject,
                                { backgroundColor: theme.colors.surface },
                            ]}
                        >
                            <OpenFilesTabBar
                                files={openFilesStack.openFiles}
                                activeIndex={openFilesStack.activeIndex}
                                onTabPress={openFilesStack.pressTab}
                                onTabClose={openFilesStack.closeTab}
                                onAddFile={handleAddFile}
                            />
                            {/* All previews stay mounted (display-toggled) so
                              * switching tabs is instant and each preview's
                              * mode toggle / scroll position survives. */}
                            {openFilesStack.openFiles.map((file, index) => (
                                <View
                                    key={file.filePath}
                                    style={{
                                        flex: 1,
                                        display:
                                            index === openFilesStack.activeIndex
                                                ? "flex"
                                                : "none",
                                    }}
                                >
                                    <SidePanelFilePreview
                                        sessionId={sessionId}
                                        filePath={file.filePath}
                                        repoPath={file.repoPath}
                                        onClose={openFilesStack.minimize}
                                    />
                                </View>
                            ))}
                        </View>
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
