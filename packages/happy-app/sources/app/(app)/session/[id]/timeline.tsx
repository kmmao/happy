import * as React from "react";
import { View, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useSessionTimeline } from "@/hooks/useSessionTimeline";
import { ServerSessionEvent } from "@/sync/apiSessionEvents";
import { SharedStateView } from "@/components/SharedStateView";

// Event type → icon mapping
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

const TimelineEventCard = React.memo(({ event, isLast }: {
    event: ServerSessionEvent;
    isLast: boolean;
}) => {
    const { theme } = useUnistyles();
    const iconInfo = EVENT_TYPE_ICONS[event.eventType] ?? { name: "ellipse-outline", color: "#8E8E93" };

    return (
        <View style={styles.eventRow}>
            {/* Timeline line + dot */}
            <View style={styles.timelineColumn}>
                <View style={[styles.dot, { backgroundColor: iconInfo.color }]}>
                    <Ionicons
                        name={iconInfo.name as any}
                        size={14}
                        color="#FFFFFF"
                    />
                </View>
                {!isLast && (
                    <View style={[styles.line, { backgroundColor: theme.colors.divider }]} />
                )}
            </View>

            {/* Content */}
            <View style={styles.contentColumn}>
                <View style={styles.eventHeader}>
                    <Text style={[styles.eventType, { color: iconInfo.color }]}>
                        {formatEventType(event.eventType)}
                    </Text>
                    <Text style={[styles.eventTime, { color: theme.colors.textSecondary }]}>
                        {formatTimeAgo(event.createdAt)}
                    </Text>
                </View>
                <Text
                    style={[styles.eventSummary, { color: theme.colors.text }]}
                    numberOfLines={3}
                >
                    {event.summary}
                </Text>
                {event.detail && Object.keys(event.detail).length > 0 && (
                    <DetailChips detail={event.detail} />
                )}
            </View>
        </View>
    );
});

const DetailChips = React.memo(({ detail }: { detail: Record<string, unknown> }) => {
    const { theme } = useUnistyles();

    const chips: string[] = [];
    if (typeof detail.filePath === "string") {
        const parts = detail.filePath.split("/");
        chips.push(parts[parts.length - 1]);
    }
    if (typeof detail.tool === "string") {
        chips.push(detail.tool);
    }
    if (typeof detail.command === "string") {
        const cmd = detail.command as string;
        chips.push(cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd);
    }

    if (chips.length === 0) return null;

    return (
        <View style={styles.chipsRow}>
            {chips.map((chip, i) => (
                <View
                    key={i}
                    style={[styles.chip, { backgroundColor: (theme.colors.groupped as any).background ?? theme.colors.surfaceHigh }]}
                >
                    <Text
                        style={[styles.chipText, { color: theme.colors.textSecondary }]}
                        numberOfLines={1}
                    >
                        {chip}
                    </Text>
                </View>
            ))}
        </View>
    );
});

export default React.memo(function TimelinePage() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const { events, total, loading, error, refresh } = useSessionTimeline(sessionId);
    const { theme } = useUnistyles();

    if (loading) {
        return (
            <SharedStateView kind="loading" title={t("common.loading")} />
        );
    }

    if (error) {
        return (
            <SharedStateView
                kind="error"
                title={t("common.error")}
                description={error}
                onAction={refresh}
            />
        );
    }

    if (events.length === 0) {
        return (
            <SharedStateView
                kind="empty"
                title={t("timeline.noEvents")}
                description={t("timeline.noEventsDescription")}
                icon={
                    <Ionicons
                        name="time-outline"
                        size={36}
                        color={theme.colors.textSecondary}
                    />
                }
            />
        );
    }

    return (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
        >
            <Text style={[styles.countLabel, { color: theme.colors.textSecondary }]}>
                {t("timeline.eventCount", total)}
            </Text>
            {events.map((event, index) => (
                <TimelineEventCard
                    key={event.id}
                    event={event}
                    isLast={index === events.length - 1}
                />
            ))}
        </ScrollView>
    );
});

const styles = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        gap: 12,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingVertical: 16,
        paddingBottom: 40,
    },
    countLabel: {
        ...Typography.default(),
        fontSize: 12,
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    eventRow: {
        flexDirection: "row",
        minHeight: 60,
    },
    timelineColumn: {
        width: 32,
        alignItems: "center",
    },
    dot: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    line: {
        width: 2,
        flex: 1,
        marginVertical: 2,
    },
    contentColumn: {
        flex: 1,
        paddingLeft: 10,
        paddingBottom: 16,
    },
    eventHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 2,
    },
    eventType: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    eventTime: {
        ...Typography.default(),
        fontSize: 11,
    },
    eventSummary: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
    },
    chipsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 6,
    },
    chip: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    chipText: {
        ...Typography.mono(),
        fontSize: 11,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 17,
        marginTop: 8,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        textAlign: "center",
    },
    retryButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        marginTop: 8,
    },
});
