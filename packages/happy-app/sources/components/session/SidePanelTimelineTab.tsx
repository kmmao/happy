/**
 * Timeline tab for the session side panel (desktop).
 * Shows a compact vertical timeline of session events (file edits, commands, tool calls).
 */

import * as React from "react";
import { View, ScrollView, ActivityIndicator } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { useSessionTimeline } from "@/hooks/useSessionTimeline";
import { ServerSessionEvent } from "@/sync/apiSessionEvents";

const EVENT_TYPE_ICONS: Record<string, { name: string; color: string }> = {
    file_edit: { name: "document-text-outline", color: "#5856D6" },
    bash_command: { name: "terminal-outline", color: "#34C759" },
    tool_call: { name: "construct-outline", color: "#007AFF" },
    git_operation: { name: "git-branch-outline", color: "#FF9500" },
    error: { name: "alert-circle-outline", color: "#FF3B30" },
    session_start: { name: "play-circle-outline", color: "#30D158" },
    session_end: { name: "stop-circle-outline", color: "#8E8E93" },
};

function formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("timeline.justNow");
    if (minutes < 60) return t("timeline.minutesAgo", minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("timeline.hoursAgo", hours);
    const days = Math.floor(hours / 24);
    return t("timeline.daysAgo", days);
}

function formatEventType(eventType: string): string {
    const typeMap: Record<string, string> = {
        file_edit: t("timeline.typeFileEdit"),
        bash_command: t("timeline.typeBashCommand"),
        tool_call: t("timeline.typeToolCall"),
        git_operation: t("timeline.typeGitOperation"),
        error: t("timeline.typeError"),
        session_start: t("timeline.typeSessionStart"),
        session_end: t("timeline.typeSessionEnd"),
    };
    return typeMap[eventType] ?? eventType;
}

const CompactEventRow = React.memo(({ event, isLast }: {
    event: ServerSessionEvent;
    isLast: boolean;
}) => {
    const { theme } = useUnistyles();
    const iconInfo = EVENT_TYPE_ICONS[event.eventType] ?? { name: "ellipse-outline", color: "#8E8E93" };

    return (
        <View style={{ flexDirection: "row", minHeight: 36 }}>
            {/* Dot + line */}
            <View style={{ width: 24, alignItems: "center" }}>
                <View style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: iconInfo.color,
                    alignItems: "center",
                    justifyContent: "center",
                }}>
                    <Ionicons name={iconInfo.name as any} size={11} color="#FFFFFF" />
                </View>
                {!isLast && (
                    <View style={{ width: 1.5, flex: 1, backgroundColor: theme.colors.divider, marginVertical: 1 }} />
                )}
            </View>
            {/* Content */}
            <View style={{ flex: 1, paddingLeft: 8, paddingBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ ...Typography.default("semiBold"), fontSize: 11, color: iconInfo.color }}>
                        {formatEventType(event.eventType)}
                    </Text>
                    <Text style={{ ...Typography.default(), fontSize: 10, color: theme.colors.textSecondary }}>
                        {formatTimeAgo(event.createdAt)}
                    </Text>
                </View>
                <Text
                    style={{ ...Typography.default(), fontSize: 12, color: theme.colors.text, lineHeight: 16 }}
                    numberOfLines={2}
                >
                    {event.summary}
                </Text>
            </View>
        </View>
    );
});

interface SidePanelTimelineTabProps {
    sessionId: string;
}

export const SidePanelTimelineTab = React.memo<SidePanelTimelineTabProps>(
    function SidePanelTimelineTab({ sessionId }) {
        const { theme } = useUnistyles();
        const { events, loading } = useSessionTimeline(sessionId);

        if (loading) {
            return (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                    <ActivityIndicator size="small" color={theme.colors.textLink} />
                </View>
            );
        }

        if (events.length === 0) {
            return (
                <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
                    <Ionicons name="time-outline" size={32} color={theme.colors.textSecondary} />
                    <Text style={{ ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary, marginTop: 8, textAlign: "center" }}>
                        {t("timeline.noEvents")}
                    </Text>
                </View>
            );
        }

        return (
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
            >
                {events.map((event, index) => (
                    <CompactEventRow
                        key={event.id}
                        event={event}
                        isLast={index === events.length - 1}
                    />
                ))}
            </ScrollView>
        );
    },
);
