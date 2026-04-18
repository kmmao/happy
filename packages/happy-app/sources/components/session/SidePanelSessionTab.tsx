import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { SessionProgressPanel } from "./SessionProgressPanel";
import { SidePanelCodeTab } from "./SidePanelCodeTab";

type SessionSubTab = "progress" | "code";

interface SubTabDef {
    key: SessionSubTab;
    labelKey: "sidePanel.sessionProgress" | "sidePanel.sessionCode";
}

const SUB_TABS: readonly SubTabDef[] = [
    { key: "progress", labelKey: "sidePanel.sessionProgress" },
    { key: "code", labelKey: "sidePanel.sessionCode" },
];

interface SidePanelSessionTabProps {
    sessionId: string;
}

export const SidePanelSessionTab = React.memo<SidePanelSessionTabProps>(
    function SidePanelSessionTab({ sessionId }) {
        const { theme } = useUnistyles();
        const [activeSubTab, setActiveSubTab] = React.useState<SessionSubTab>("progress");

        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
                        borderBottomColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceHigh,
                    }}
                >
                    {SUB_TABS.map((tab) => {
                        const active = activeSubTab === tab.key;
                        return (
                            <Pressable
                                key={tab.key}
                                onPress={() => setActiveSubTab(tab.key)}
                                style={{
                                    flex: 1,
                                    paddingVertical: 8,
                                    alignItems: "center",
                                    borderBottomWidth: 2,
                                    borderBottomColor: active
                                        ? theme.colors.textLink
                                        : "transparent",
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: active ? "600" : "400",
                                        color: active
                                            ? theme.colors.textLink
                                            : theme.colors.textSecondary,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t(tab.labelKey)}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                <View style={{ flex: 1 }}>
                    {activeSubTab === "progress" && (
                        <SessionProgressPanel sessionId={sessionId} />
                    )}
                    {activeSubTab === "code" && (
                        <SidePanelCodeTab sessionId={sessionId} />
                    )}
                </View>
            </View>
        );
    },
);
