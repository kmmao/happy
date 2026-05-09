import * as React from "react";
import { View, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    compact?: boolean;
    onPress?: (event: WorldEvent) => void;
}

export const WorldEventCard = React.memo(function WorldEventCard({
    event,
    compact = false,
    onPress,
}: WorldEventCardProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const dotColor = useSeverityColor(event.severity);

    const handlePress = React.useCallback(() => {
        onPress?.(event);
    }, [event, onPress]);

    if (compact) {
        return (
            <TouchableOpacity
                style={styles.compactCard}
                onPress={handlePress}
                activeOpacity={0.7}
            >
                <View style={[styles.compactDot, { backgroundColor: dotColor }]} />
                <Text style={styles.compactType} numberOfLines={1}>{event.eventType}</Text>
                <Text style={styles.compactTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.compactTime}>{formatTime(event.occurredAt)}</Text>
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
            </TouchableOpacity>
        );
    }

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
                        <Ionicons
                            name="chevron-forward"
                            size={14}
                            color={theme.colors.textSecondary}
                            style={{ marginLeft: 4 }}
                        />
                    </View>
                    <Text style={styles.title} numberOfLines={2}>
                        {event.title}
                    </Text>
                    {(event.source.projectPath || event.source.projectId) && (
                        <Text style={styles.source} numberOfLines={1}>
                            {formatSourceLabel(event.source.projectPath, event.source.projectId)}
                        </Text>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
});

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
        compactCard: {
            flexDirection: "row" as const,
            alignItems: "center" as const,
            gap: 6,
            marginHorizontal: 16,
            marginVertical: 1,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 8,
            backgroundColor: theme.colors.surfaceHigh,
        },
        compactDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
            flexShrink: 0,
        },
        compactType: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 88,
            flexShrink: 0,
        },
        compactTitle: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
        },
        compactTime: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 36,
            textAlign: "right" as const,
        },
    });
    return { styles };
};
