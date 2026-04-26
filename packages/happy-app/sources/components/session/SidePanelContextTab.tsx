import * as React from "react";
import { ScrollView, View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ContextUsagePanel } from "@/components/claudeControl/ContextUsagePanel";
import { McpServersPanel } from "@/components/claudeControl/McpServersPanel";
import { t } from "@/text";

interface SidePanelContextTabProps {
    sessionId: string;
}

/**
 * Side panel sub-tab surfacing context window usage and MCP server status
 * for the active session. Both panels auto-refresh every 30s while foregrounded.
 */
export const SidePanelContextTab = React.memo<SidePanelContextTabProps>(
    function SidePanelContextTab({ sessionId }) {
        const { theme } = useUnistyles();
        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <ContextUsagePanel sessionId={sessionId} />

                {/* ── Divider ── */}
                <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

                {/* ── MCP Servers ── */}
                <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                        {t("claudeControl.mcpServers.title")}
                    </Text>
                    <McpServersPanel sessionId={sessionId} />
                </View>
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
        gap: 0,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 16,
    },
    section: {
        gap: 8,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
}));
