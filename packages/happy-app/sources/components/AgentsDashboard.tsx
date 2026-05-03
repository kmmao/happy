import React from "react";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSessionMessages } from "@/sync/storage";
import { Session } from "@/sync/storageTypes";
import { Ionicons } from "@expo/vector-icons";
import {
    getSessionName,
    getSessionSubtitle,
    getSessionStatusState,
    getSessionAvatarId,
    getSessionProviderKey,
    getLatestUserRequestPreview,
} from "@/utils/sessionUtils";
import { Avatar } from "@/components/Avatar";
import { StatusDot } from "@/components/StatusDot";
import { Typography } from "@/constants/Typography";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { t } from "@/text";
import { sync } from "@/sync/sync";

const CARD_WIDTH = 168;

interface AgentCardProps {
    session: Session;
}

const AgentCard = React.memo(({ session }: AgentCardProps) => {
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const { messages } = useSessionMessages(session.id);
    const [latestInterAgentMessage, setLatestInterAgentMessage] = React.useState<string | null>(null);

    React.useEffect(() => {
        return sync.onInterAgentMessage((event) => {
            if (event.fromSessionId === session.id || event.toSessionId === session.id) {
                setLatestInterAgentMessage(event.message);
            }
        });
    }, [session.id]);

    const statusState = getSessionStatusState(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const avatarId = getSessionAvatarId(session);
    const provider = getSessionProviderKey(session);
    const isWorktree = session.metadata?.worktree?.isWorktree ?? false;
    const latestRequest = React.useMemo(() => getLatestUserRequestPreview(messages), [messages]);

    const statusColor = React.useMemo(() => {
        switch (statusState) {
            case "thinking": return (theme.colors as any).accentBlue ?? "#007AFF";
            case "permission_required": return "#FF9500";
            case "needs_attention": return "#FF9500";
            case "disconnected": return theme.colors.textSecondary;
            default: return (theme.colors.status as any)?.connected ?? "#34C759";
        }
    }, [statusState, theme]);

    const statusLabel = React.useMemo(() => {
        switch (statusState) {
            case "thinking": return "running";
            case "permission_required": return "blocked";
            case "needs_attention": return "attention";
            case "disconnected": return "offline";
            default: return "idle";
        }
    }, [statusState]);

    const isPulsing = statusState === "thinking" || statusState === "permission_required" || statusState === "needs_attention";

    return (
        <Pressable
            style={styles.card}
            onPress={() => navigateToSession(session.id)}
        >
            <View style={styles.cardHeader}>
                <Avatar
                    id={avatarId}
                    size={28}
                    monochrome={statusState === "disconnected"}
                    flavor={session.metadata?.flavor}
                    provider={provider}
                />
                <View style={styles.statusBadge}>
                    <StatusDot color={statusColor} isPulsing={isPulsing} size={5} />
                    <Text style={[styles.statusLabel, { color: statusColor }]} numberOfLines={1}>
                        {statusLabel}
                    </Text>
                </View>
            </View>

            <Text style={styles.sessionName} numberOfLines={2}>
                {sessionName}
            </Text>

            <Text style={styles.sessionSubtitle} numberOfLines={1}>
                {sessionSubtitle}
            </Text>

            {latestRequest ? (
                <Text style={styles.requestPreview} numberOfLines={1}>
                    {latestRequest.text}
                </Text>
            ) : null}

            {latestInterAgentMessage ? (
                <View style={styles.interAgentBubble}>
                    <Text style={styles.interAgentText} numberOfLines={2}>
                        {latestInterAgentMessage}
                    </Text>
                </View>
            ) : null}

            {isWorktree && (
                <View style={styles.worktreeBadge}>
                    <Ionicons name="git-branch-outline" size={9} color={(theme.colors as any).accentPurple} />
                    <Text style={styles.worktreeText} numberOfLines={1}>
                        {session.metadata?.worktree?.branchName ?? "branch"}
                    </Text>
                </View>
            )}
        </Pressable>
    );
});

interface AgentsDashboardProps {
    sessions: Session[];
}

export const AgentsDashboard = React.memo(({ sessions }: AgentsDashboardProps) => {
    if (sessions.length < 2) {
        return null;
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>{t("agentsDashboard.sectionTitle")}</Text>
                <Text style={styles.headerCount}>
                    {t("agentsDashboard.agentCount", { count: sessions.length })}
                </Text>
            </View>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {sessions.map((session) => (
                    <AgentCard key={session.id} session={session} />
                ))}
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 8,
        paddingBottom: 4,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: Platform.select({ ios: 20, default: 16 }),
        paddingBottom: 8,
    },
    headerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
    },
    headerCount: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    scrollContent: {
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
        gap: 10,
        paddingBottom: 8,
    },
    card: {
        width: CARD_WIDTH,
        backgroundColor: theme.colors.surface,
        borderRadius: Platform.select({ ios: 10, default: 14 }),
        padding: 10,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 0.5 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 1,
        elevation: 1,
        gap: 4,
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 2,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 8,
    },
    statusLabel: {
        ...Typography.default("semiBold"),
        fontSize: 9,
    },
    sessionName: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.text,
        lineHeight: 16,
    },
    sessionSubtitle: {
        ...Typography.default(),
        fontSize: 10,
        color: theme.colors.textSecondary,
        lineHeight: 13,
    },
    requestPreview: {
        ...Typography.default(),
        fontSize: 10,
        color: theme.colors.textSecondary,
        lineHeight: 13,
        fontStyle: "italic",
    },
    worktreeBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        marginTop: 2,
    },
    worktreeText: {
        ...Typography.default("semiBold"),
        fontSize: 9,
        color: (theme.colors as any).accentPurple,
        maxWidth: 120,
    },
    interAgentBubble: {
        backgroundColor: (theme.colors as any).accentBlue
            ? `${(theme.colors as any).accentBlue}22`
            : "rgba(0,122,255,0.13)",
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 3,
        marginTop: 2,
    },
    interAgentText: {
        ...Typography.default(),
        fontSize: 9,
        color: (theme.colors as any).accentBlue ?? "#007AFF",
        lineHeight: 12,
    },
}));
