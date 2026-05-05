import * as React from "react";
import { View, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={() => onPress?.(event)}
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
                    <Text style={styles.title} numberOfLines={2}>
                        {event.title}
                    </Text>
                    {event.source.projectId && (
                        <Text style={styles.source} numberOfLines={1}>
                            {event.source.projectId.slice(0, 20)}
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
    });
    return { styles };
};
