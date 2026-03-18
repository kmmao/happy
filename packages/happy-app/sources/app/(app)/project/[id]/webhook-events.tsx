import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    RefreshControl,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchWebhookEvents, type WebhookEvent } from "@/sync/apiWebhook";
import { layout } from "@/components/layout";

const PAGE_SIZE = 20;

// --- Helpers ---

function formatRelativeTime(timestamp: number): string {
    // Server returns milliseconds (Date.getTime()), convert to seconds
    const timestampSec = timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestampSec;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    const date = new Date(timestampSec * 1000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type StatusIcon = {
    name: React.ComponentProps<typeof Ionicons>["name"];
    color: string;
};

function getStatusIcon(status: string): StatusIcon {
    switch (status) {
        case "completed":
            return { name: "checkmark-circle", color: "#34C759" };
        case "failed":
            return { name: "close-circle", color: "#FF3B30" };
        case "pending":
            return { name: "time", color: "#8E8E93" };
        case "dispatched":
            return { name: "sync-circle", color: "#007AFF" };
        case "skipped":
            return { name: "remove-circle", color: "#FF9500" };
        default:
            return { name: "help-circle", color: "#8E8E93" };
    }
}

// --- Event Row ---

interface EventRowProps {
    readonly event: WebhookEvent;
    readonly isLast: boolean;
}

const EventRow = React.memo<EventRowProps>(function EventRow({ event, isLast }) {
    const { theme } = useUnistyles();
    const icon = getStatusIcon(event.status);

    return (
        <View style={[styles.eventRow, !isLast && styles.eventRowBorder]}>
            <Ionicons name={icon.name} size={22} color={icon.color} />
            <View style={styles.eventContent}>
                <View style={styles.eventTitleRow}>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                        {event.issueTitle}
                    </Text>
                    <View style={styles.issueBadge}>
                        <Text style={styles.issueBadgeText}>
                            #{event.issueNumber}
                        </Text>
                    </View>
                </View>
                <Text style={styles.eventSubtitle} numberOfLines={1}>
                    {event.provider} &middot; {event.repoUrl}
                </Text>
                {event.status === "failed" && event.errorMessage && (
                    <Text style={styles.errorText} numberOfLines={2}>
                        {event.errorMessage}
                    </Text>
                )}
            </View>
            <Text style={styles.eventTime}>
                {formatRelativeTime(event.createdAt)}
            </Text>
        </View>
    );
});

// --- Main Screen ---

function WebhookEventsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const { theme } = useUnistyles();

    const [events, setEvents] = React.useState<WebhookEvent[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: t("webhook.eventHistory"),
        });
    }, [navigation]);

    const loadEvents = React.useCallback(async () => {
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const data = await fetchWebhookEvents(credentials, {
                projectId: id,
                limit: PAGE_SIZE,
                offset: 0,
            });
            setEvents(data.events);
            setTotal(data.total);
        } catch {
            // Silently fail — user can pull to refresh
        }
    }, []);

    React.useEffect(() => {
        let cancelled = false;

        async function init() {
            try {
                setLoading(true);
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchWebhookEvents(credentials, {
                    projectId: id,
                    limit: PAGE_SIZE,
                    offset: 0,
                });
                if (!cancelled) {
                    setEvents(data.events);
                    setTotal(data.total);
                }
            } catch {
                // Silently fail
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        init();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleRefresh = React.useCallback(async () => {
        setRefreshing(true);
        await loadEvents();
        setRefreshing(false);
    }, [loadEvents]);

    const handleLoadMore = React.useCallback(async () => {
        if (loadingMore || events.length >= total) return;
        try {
            setLoadingMore(true);
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const data = await fetchWebhookEvents(credentials, {
                projectId: id,
                limit: PAGE_SIZE,
                offset: events.length,
            });
            setEvents((prev) => [...prev, ...data.events]);
            setTotal(data.total);
        } catch {
            // Silently fail
        } finally {
            setLoadingMore(false);
        }
    }, [events.length, total, loadingMore]);

    const hasMore = events.length < total;

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator
                    size="large"
                    color={theme.colors.header.tint}
                />
            </View>
        );
    }

    if (events.length === 0) {
        return (
            <View style={styles.centered}>
                <Ionicons
                    name="notifications-off-outline"
                    size={48}
                    color={theme.colors.textSecondary}
                />
                <Text style={styles.emptyText}>
                    {t("webhook.noEvents")}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor={theme.colors.header.tint}
                />
            }
        >
            <View style={styles.eventsContainer}>
                {events.map((event, index) => (
                    <EventRow
                        key={event.id}
                        event={event}
                        isLast={index === events.length - 1}
                    />
                ))}
            </View>

            {hasMore && (
                <Pressable
                    style={styles.loadMoreButton}
                    onPress={handleLoadMore}
                    disabled={loadingMore}
                >
                    {loadingMore ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.header.tint}
                        />
                    ) : (
                        <Text style={styles.loadMoreText}>
                            {t("webhook.loadMore")}
                        </Text>
                    )}
                </Pressable>
            )}
        </ScrollView>
    );
}

export default React.memo(WebhookEventsScreen);

// --- Styles ---

const styles = StyleSheet.create((theme) => ({
    centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingTop: 16,
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    eventsContainer: {
        marginHorizontal: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        overflow: "hidden",
    },
    eventRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    eventRowBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    eventContent: {
        flex: 1,
    },
    eventTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    eventTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    issueBadge: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    issueBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    eventSubtitle: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 12,
        color: "#FF3B30",
        marginTop: 4,
    },
    eventTime: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    loadMoreButton: {
        marginHorizontal: 16,
        marginTop: 12,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    loadMoreText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.header.tint,
    },
}));
