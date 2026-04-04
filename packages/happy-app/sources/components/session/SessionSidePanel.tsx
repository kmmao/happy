import * as React from "react";
import { View, Platform, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { SidePanelSummaryTab } from "./SidePanelSummaryTab";
import { SidePanelGitPanel } from "./SidePanelGitPanel";
import { SidePanelFilePreview } from "./SidePanelFilePreview";
import { SidePanelTimelineTab } from "./SidePanelTimelineTab";
import { InputContext } from "@/hooks/useInputContext";

export const SIDE_PANEL_WIDTH = 360;
export const SIDE_PANEL_MIN_WINDOW_WIDTH = 1200;
const COLLAPSED_WIDTH = 36;

type TabKey = "files" | "changes" | "summary" | "timeline";

interface SessionSidePanelProps {
    sessionId: string;
    collapsed: boolean;
    onToggleCollapse: () => void;
    width?: number;
}

export const SessionSidePanel = React.memo<SessionSidePanelProps>(
    function SessionSidePanel({ sessionId, collapsed, onToggleCollapse, width }) {
        const { theme } = useUnistyles();
        const [activeTab, setActiveTab] = React.useState<TabKey>("files");
        const [previewingFile, setPreviewingFile] = React.useState<string | null>(null);
        const inputContext = React.useContext(InputContext);

        const handleFilePress = React.useCallback((fullPath: string) => {
            setPreviewingFile(fullPath);
        }, []);

        const handleClosePreview = React.useCallback(() => {
            setPreviewingFile(null);
        }, []);

        const handleReference = React.useCallback(
            (path: string) => {
                inputContext?.appendToInput(`@${path}`);
            },
            [inputContext],
        );

        // Collapsed state: show a thin vertical bar with expand button
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

        const tabs: Array<{ key: TabKey; label: string }> = [
            { key: "files", label: t("sidePanel.files") },
            { key: "changes", label: t("sidePanel.changes") },
            { key: "summary", label: t("sidePanel.summary") },
            { key: "timeline", label: t("sidePanel.timeline") },
        ];

        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: theme.colors.surface,
                }}
            >
                {/* File preview overlay */}
                {previewingFile ? (
                    <SidePanelFilePreview
                        sessionId={sessionId}
                        filePath={previewingFile}
                        onClose={handleClosePreview}
                    />
                ) : (
                    <>
                        {/* Tab bar */}
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
                                    key={tab.key}
                                    onPress={() => setActiveTab(tab.key)}
                                    style={{
                                        flex: 1,
                                        paddingVertical: 10,
                                        alignItems: "center",
                                        borderBottomWidth: 2,
                                        borderBottomColor:
                                            activeTab === tab.key
                                                ? theme.colors.textLink
                                                : "transparent",
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontSize: 13,
                                            fontWeight: activeTab === tab.key ? "600" : "400",
                                            color:
                                                activeTab === tab.key
                                                    ? theme.colors.textLink
                                                    : theme.colors.textSecondary,
                                            ...Typography.default(),
                                        }}
                                    >
                                        {tab.label}
                                    </Text>
                                </Pressable>
                            ))}
                            {/* Collapse button */}
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

                        {/* Tab content — conditionally render active tab */}
                        <View style={{ flex: 1 }}>
                            {activeTab === "files" && (
                                <GitBrowseTab
                                    sessionId={sessionId}
                                    embedded
                                    onFilePress={handleFilePress}
                                    onReference={handleReference}
                                />
                            )}
                            {activeTab === "changes" && (
                                <SidePanelGitPanel sessionId={sessionId} />
                            )}
                            {activeTab === "summary" && (
                                <SidePanelSummaryTab sessionId={sessionId} />
                            )}
                            {activeTab === "timeline" && (
                                <SidePanelTimelineTab sessionId={sessionId} />
                            )}
                        </View>
                    </>
                )}
            </View>
        );
    },
);
