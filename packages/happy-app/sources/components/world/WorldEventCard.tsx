import * as React from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateActionApproval } from "@/sync/apiSupervisor";
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

    const isSupervisorAction = event.eventType === "supervisor.action_found";
    const [actionLoading, setActionLoading] = React.useState(false);
    const [actionDone, setActionDone] = React.useState<string | null>(null);

    const handlePress = React.useCallback(() => {
        onPress?.(event);
    }, [event, onPress]);

    const handleAction = React.useCallback(async (approval: "approved" | "skipped") => {
        if (!event.source.projectId) return;
        setActionLoading(true);
        try {
            const creds = await TokenStorage.getCredentials();
            if (!creds) return;
            await updateActionApproval(creds, event.source.projectId, event.originalId, approval);
            setActionDone(approval);
        } finally {
            setActionLoading(false);
        }
    }, [event.source.projectId, event.originalId]);

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
            style={[styles.card, isSupervisorAction && !actionDone && styles.cardAction]}
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

            {/* Inline actions for supervisor.action_found */}
            {isSupervisorAction && !!event.source.projectId && (
                <View style={styles.inlineActions}>
                    {actionDone ? (
                        <View style={styles.actionDoneRow}>
                            <Ionicons
                                name={actionDone === "approved" ? "checkmark-circle" : "close-circle"}
                                size={14}
                                color={actionDone === "approved" ? theme.colors.success : theme.colors.textSecondary}
                            />
                            <Text style={[styles.actionDoneText, { color: actionDone === "approved" ? theme.colors.success : theme.colors.textSecondary }]}>
                                {actionDone}
                            </Text>
                        </View>
                    ) : (
                        <>
                            <TouchableOpacity
                                style={[styles.inlineBtn, styles.inlineBtnApprove]}
                                onPress={(e) => { e.stopPropagation?.(); void handleAction("approved"); }}
                                disabled={actionLoading}
                                activeOpacity={0.7}
                            >
                                {actionLoading
                                    ? <ActivityIndicator size="small" color={theme.colors.success} />
                                    : <Ionicons name="checkmark" size={13} color={theme.colors.success} />
                                }
                                <Text style={[styles.inlineBtnText, { color: theme.colors.success }]}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.inlineBtn, styles.inlineBtnSkip]}
                                onPress={(e) => { e.stopPropagation?.(); void handleAction("skipped"); }}
                                disabled={actionLoading}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="close" size={13} color={theme.colors.textSecondary} />
                                <Text style={[styles.inlineBtnText, { color: theme.colors.textSecondary }]}>Skip</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            )}
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
        cardAction: {
            borderLeftWidth: 2,
            borderLeftColor: theme.colors.warning,
        },
        inlineActions: {
            flexDirection: "row",
            gap: 8,
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
        },
        inlineBtn: {
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
        },
        inlineBtnApprove: {
            backgroundColor: theme.colors.success + "18",
        },
        inlineBtnSkip: {
            backgroundColor: theme.colors.surfaceHighest,
        },
        inlineBtnText: {
            fontSize: 13,
            fontWeight: "500",
        },
        actionDoneRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
        },
        actionDoneText: {
            fontSize: 13,
            fontStyle: "italic",
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
