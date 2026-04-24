import * as React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { Project } from "@/sync/projectManager";
import { fetchWebhookEvents, type WebhookEvent } from "@/sync/apiWebhook";
import { TokenStorage } from "@/auth/tokenStorage";

interface Props {
    project: Project;
}

function statusColor(status: string, theme: any): string {
    switch (status) {
        case "completed":
            return theme.colors.success;
        case "failed":
            return theme.colors.deleteAction;
        case "pending":
        case "dispatched":
            return theme.colors.accentOrange;
        default:
            return theme.colors.textSecondary;
    }
}

export const IntegrationsSection = React.memo<Props>(({ project }) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [events, setEvents] = React.useState<WebhookEvent[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);

    const serverId = project.serverId;
    const machineId = project.key.machineId;

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!serverId) {
                setLoading(false);
                return;
            }
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const result = await fetchWebhookEvents(credentials, {
                    projectId: serverId,
                    limit: 5,
                });
                if (!cancelled) {
                    setEvents(result.events);
                    setTotal(result.total);
                }
            } catch {
                // ignore
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [serverId]);

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.header}>
                <View style={[styles.iconBadge, { backgroundColor: `${theme.colors.accentTeal}1A` }]}>
                    <Ionicons name="git-pull-request-outline" size={16} color={theme.colors.accentTeal} />
                </View>
                <Text style={[styles.title, { color: theme.colors.text }]}>
                    {t("projectConfig.sectionIntegrations")}
                </Text>
            </View>

            <Text style={[styles.subHeader, { color: theme.colors.textSecondary }]}>
                {t("projectConfig.webhookEvents")}
            </Text>
            {loading ? (
                <ActivityIndicator size="small" style={styles.loader} />
            ) : events.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    {t("projectConfig.webhookNoEvents")}
                </Text>
            ) : (
                <View style={styles.eventList}>
                    {events.map((ev) => (
                        <View key={ev.id} style={[styles.eventRow, { borderBottomColor: theme.colors.divider }]}>
                            <View style={[styles.statusDot, { backgroundColor: statusColor(ev.status, theme) }]} />
                            <Text style={[styles.eventTitle, { color: theme.colors.text }]} numberOfLines={1}>
                                {ev.issueTitle || `#${ev.issueNumber}`}
                            </Text>
                            <Text style={[styles.eventStatus, { color: theme.colors.textSecondary }]}>
                                {ev.status}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
            {total > 5 && (
                <Pressable
                    style={styles.viewAllButton}
                    onPress={() => router.push(`/project/${project.id}/webhook-events` as any)}
                >
                    <Text style={[styles.viewAllText, { color: theme.colors.header.tint }]}>
                        {t("projectConfig.viewAll")} ({total})
                    </Text>
                </Pressable>
            )}

            <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
            <Pressable
                style={styles.triggerLink}
                onPress={() => router.push(`/machine/${machineId}/triggers` as any)}
            >
                <Ionicons name="flash-outline" size={16} color={theme.colors.textSecondary} />
                <Text style={[styles.triggerLinkText, { color: theme.colors.text }]}>
                    {t("projectConfig.machineTriggers")}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
    },
    iconBadge: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    subHeader: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    loader: {
        marginVertical: 12,
    },
    emptyText: {
        ...Typography.default("regular"),
        fontSize: 13,
        marginBottom: 8,
    },
    eventList: {
        gap: 0,
    },
    eventRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    eventTitle: {
        ...Typography.default("regular"),
        fontSize: 13,
        flex: 1,
    },
    eventStatus: {
        ...Typography.default("regular"),
        fontSize: 12,
    },
    viewAllButton: {
        paddingVertical: 8,
        alignItems: "center",
    },
    viewAllText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 12,
    },
    triggerLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    triggerLinkText: {
        ...Typography.default("regular"),
        fontSize: 14,
        flex: 1,
    },
}));
