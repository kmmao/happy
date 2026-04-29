import * as React from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { t } from "@/text";
import { SessionProgressPanel } from "./SessionProgressPanel";
import { SessionGlassTabBar, type SessionGlassTabBarItem } from "./SessionGlassTabBar";
import { SidePanelCodeTab } from "./SidePanelCodeTab";
import { SidePanelContextTab } from "./SidePanelContextTab";

type SessionSubTab = "progress" | "code" | "context";

interface SubTabDef {
    key: SessionSubTab;
    labelKey: "sidePanel.sessionProgress" | "sidePanel.sessionCode" | "sidePanel.sessionContext";
}

const SUB_TABS: readonly SubTabDef[] = [
    { key: "progress", labelKey: "sidePanel.sessionProgress" },
    { key: "code", labelKey: "sidePanel.sessionCode" },
    { key: "context", labelKey: "sidePanel.sessionContext" },
];

interface SidePanelSessionTabProps {
    sessionId: string;
}

export const SidePanelSessionTab = React.memo<SidePanelSessionTabProps>(
    function SidePanelSessionTab({ sessionId }) {
        const { theme } = useUnistyles();
        const [activeSubTab, setActiveSubTab] = React.useState<SessionSubTab>("progress");
        const subTabs: SessionGlassTabBarItem[] = SUB_TABS.map((tab) => ({
            key: tab.key,
            label: t(tab.labelKey),
        }));

        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                <View
                    style={[
                        styles.headerWrap,
                        { backgroundColor: theme.colors.surface },
                    ]}
                >
                    <SessionGlassTabBar
                        tabs={subTabs}
                        activeTab={activeSubTab}
                        onChange={(tabKey) => setActiveSubTab(tabKey as SessionSubTab)}
                        compact
                        scrollable
                        tabMinWidth={64}
                    />
                </View>

                <View style={{ flex: 1 }}>
                    {activeSubTab === "progress" && (
                        <SessionProgressPanel sessionId={sessionId} />
                    )}
                    {activeSubTab === "code" && (
                        <SidePanelCodeTab sessionId={sessionId} />
                    )}
                    {activeSubTab === "context" && (
                        <SidePanelContextTab sessionId={sessionId} />
                    )}
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create((_, rt) => ({
    headerWrap: {
        paddingHorizontal: 6,
        paddingTop: 0,
        paddingBottom: 4,
    },
}));
