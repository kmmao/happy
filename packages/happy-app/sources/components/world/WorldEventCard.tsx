import * as React from "react";
import { View, TouchableOpacity, LayoutAnimation } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFullDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatSourceLabel(projectPath?: string | null, projectId?: string | null): string {
    if (projectPath) {
        const segments = projectPath.split("/").filter(Boolean);
        return segments.pop() ?? projectPath;
    }
    if (projectId) return projectId.slice(0, 12);
    return "";
}

function useSeverityColor(severity: WorldEventSeverity): string {
    const { theme } = useUnistyles();
    if (severity === "critical") return theme.colors.warningCritical;
    if (severity === "warning") return theme.colors.warning;
    return theme.colors.textSecondary;
}

interface WorldEventCardProps {
    event: WorldEvent;
    onPress?: (event: WorldEvent) => void;
}

export const WorldEventCard = React.memo(function WorldEventCard({
    event,
    onPress,
}: WorldEventCardProps) {
    const { styles } = useStyles();
    const dotColor = useSeverityColor(event.severity);
    const [expanded, setExpanded] = React.useState(false);

    const handlePress = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
        onPress?.(event);
    }, [event, onPress]);

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                <View style={styles.content}>
                    <View style={styles.headerRow}>
                        <Text style={styles.eventType} numberOfLines={1}>
                            {event.eventType}
                        </Text>
                        <Text style={styles.time}>{formatTime(event.occurredAt)}</Text>
                    </View>
                    <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
                        {event.title}
                    </Text>
                    {(event.source.projectPath || event.source.projectId) && (
                        <Text style={styles.source} numberOfLines={1}>
                            {formatSourceLabel(event.source.projectPath, event.source.projectId)}
                        </Text>
                    )}

                    {expanded && (
                        <View style={styles.detail}>
                            {!!event.summary && (
                                <DetailRow label="Summary" value={event.summary} />
                            )}
                            <DetailRow label="Time" value={formatFullDate(event.occurredAt)} />
                            <DetailRow label="Source" value={event.source.type} />
                            {!!event.source.machineId && (
                                <DetailRow label="Machine" value={event.source.machineId} />
                            )}
                            {!!event.source.sessionId && (
                                <DetailRow label="Session" value={event.source.sessionId.slice(0, 16)} />
                            )}
                            <DetailRow label="ID" value={event.originalId.slice(0, 20)} />
                        </View>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
});

function DetailRow({ label, value }: { label: string; value: string }) {
    const { styles } = useStyles();
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
        </View>
    );
}

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        card: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 10,
            marginHorizontal: 16,
            marginVertical: 4,
            paddingHorizontal: 12,
            paddingVertical: 10,
        },
        row: {
            flexDirection: "row",
            alignItems: "flex-start",
        },
        dot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 5,
            marginRight: 10,
        },
        content: {
            flex: 1,
        },
        headerRow: {
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 2,
        },
        eventType: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            flex: 1,
        },
        time: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginLeft: 8,
        },
        title: {
            fontSize: 14,
            color: theme.colors.text,
            lineHeight: 20,
        },
        source: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginTop: 4,
        },
        detail: {
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            gap: 4,
        },
        detailRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        detailLabel: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 60,
        },
        detailValue: {
            flex: 1,
            fontSize: 12,
            color: theme.colors.text,
        },
    });
    return { styles };
};
