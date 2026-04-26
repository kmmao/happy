import * as React from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ContextUsagePanel } from "@/components/claudeControl/ContextUsagePanel";

interface SidePanelContextTabProps {
    sessionId: string;
}

/**
 * Side panel sub-tab that surfaces context window usage for the active session.
 * Wraps ContextUsagePanel (which auto-refreshes every 30s) in a scrollable
 * container sized for the 360px side panel.
 */
export const SidePanelContextTab = React.memo<SidePanelContextTabProps>(
    function SidePanelContextTab({ sessionId }) {
        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <ContextUsagePanel sessionId={sessionId} />
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        paddingBottom: 32,
    },
}));
