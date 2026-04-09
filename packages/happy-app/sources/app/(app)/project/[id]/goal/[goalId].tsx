import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    Pressable,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { layout } from "@/components/layout";
import { TokenStorage } from "@/auth/tokenStorage";
import { fetchGoalDetail, type GoalDetail } from "@/sync/apiProjects";
import { useGoalProgressSubscription } from "@/hooks/useGoalProgressSubscription";
import { t } from "@/text";
import { buildGoalDetailSections, deriveGoalDetailScreenState } from "./goalDetailViewModel";
import { buildGoalDetailRouteState } from "./goalDetailRouteSafety";

function isSafeId(value: string | undefined): value is string {
    return Boolean(value && /^[A-Za-z0-9_-]+$/.test(value));
}

function GoalDetailScreen() {
    const { id, goalId } = useLocalSearchParams<{ id: string; goalId: string }>();
    const routeState = buildGoalDetailRouteState({ projectId: id, goalId });
    const navigation = useNavigation();
    const router = useRouter();
    const [goal, setGoal] = React.useState<GoalDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const readyProjectId = routeState.kind === "ready" ? routeState.projectId : undefined;
    const readyGoalId = routeState.kind === "ready" ? routeState.goalId : undefined;

    const loadGoal = React.useCallback(async () => {
        if (!readyProjectId || !readyGoalId) {
            setError(t("common.error"));
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                setError(t("common.error"));
                return;
            }
            const data = await fetchGoalDetail(credentials, readyProjectId, readyGoalId);
            setGoal(data);
        } catch {
            setError(t("common.error"));
        } finally {
            setLoading(false);
        }
    }, [readyGoalId, readyProjectId]);

    React.useEffect(() => {
        void loadGoal();
    }, [loadGoal]);

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: goal?.title ?? t("goals.title"),
        });
    }, [goal?.title, navigation]);

    const handlePatch = React.useCallback((event: {
        goalId: string;
        projectId: string;
        status: string;
        progress: number;
    }) => {
        setGoal((prev) => prev ? {
            ...prev,
            status: event.status,
            progress: event.progress,
        } : prev);
    }, []);

    const handleRefresh = React.useCallback(() => {
        void loadGoal();
    }, [loadGoal]);

    useGoalProgressSubscription({
        isActive: true,
        projectId: readyProjectId,
        goalId: readyGoalId,
        onPatch: handlePatch,
        onRefresh: handleRefresh,
    });

    const screenState = deriveGoalDetailScreenState({ loading, goal, error });

    if (screenState.kind === "loading") {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    if (screenState.kind === "error") {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>{screenState.message}</Text>
            </View>
        );
    }

    if (screenState.kind === "empty") {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>{t("projects.notFound")}</Text>
            </View>
        );
    }

    const readyGoal = goal;
    if (!readyGoal) {
        return null;
    }

    const viewModel = buildGoalDetailSections(readyGoal);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.heroCard}>
                <Text style={styles.title}>{readyGoal.title}</Text>
                {readyGoal.description ? (
                    <Text style={styles.description}>{readyGoal.description}</Text>
                ) : null}
                <View style={styles.badgeRow}>
                    {viewModel.hero.badges.map((badge) => (
                        <View key={badge} style={styles.badge}>
                            <Text style={styles.badgeText}>{badge}</Text>
                        </View>
                    ))}
                </View>
                <Text style={styles.progressValue}>{viewModel.hero.progressLabel}</Text>
                <View style={styles.statsRow}>
                    {viewModel.hero.stats.map((stat) => (
                        <View key={stat.label} style={styles.statItem}>
                            <Text style={styles.statValue}>{stat.value}</Text>
                            <Text style={styles.statLabel}>{stat.label}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {viewModel.sections.some((section) => section.key === "latest-session") && readyGoal.latestSession && isSafeId(readyGoal.latestSession.sessionId) ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("goals.viewSession")}</Text>
                    <Pressable
                        style={styles.linkRow}
                        onPress={() => router.push(`/session/${readyGoal.latestSession!.sessionId}` as any)}
                    >
                        <Ionicons name="open-outline" size={14} color="#3B82F6" />
                        <Text style={styles.linkText}>{readyGoal.latestSession.taskTitle ?? t("goals.viewSession")}</Text>
                    </Pressable>
                </View>
            ) : null}

            {viewModel.sections.some((section) => section.key === "tasks") ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("tasks.title")}</Text>
                    {readyGoal.tasks.map((task, index) => (
                        <Pressable
                            key={task.id}
                            style={styles.row}
                            disabled={!task.sessionId || !isSafeId(task.sessionId)}
                            onPress={() => task.sessionId && isSafeId(task.sessionId) && router.push(`/session/${task.sessionId}` as any)}
                        >
                            <View style={styles.rowMain}>
                                <Text style={styles.rowTitle}>{task.title ?? t("goals.taskIndex", { index: index + 1 })}</Text>
                                <Text style={styles.rowMeta}>{task.status}</Text>
                            </View>
                            {task.roleType ? (
                                <Text style={styles.rowMeta}>{task.roleType}</Text>
                            ) : null}
                        </Pressable>
                    ))}
                </View>
            ) : null}

            {viewModel.sections.some((section) => section.key === "subgoals") ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("goals.subGoals", { count: readyGoal.subGoals.length })}</Text>
                    {readyGoal.subGoals.map((subGoal) => (
                        <View key={subGoal.id} style={styles.row}>
                            <View style={styles.rowMain}>
                                <Text style={styles.rowTitle}>{subGoal.title}</Text>
                                <Text style={styles.rowMeta}>{subGoal.status}</Text>
                            </View>
                            <Text style={styles.rowMeta}>{t("goals.progress", { value: subGoal.progress })}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {viewModel.sections.some((section) => section.key === "blockers") ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("goals.statusBlocked")}</Text>
                    {readyGoal.blockers.map((blocker, index) => {
                        const canOpenDecision = Boolean(blocker.decisionId && isSafeId(blocker.decisionId));
                        const canOpenSession = Boolean(blocker.sessionId && isSafeId(blocker.sessionId));
                        const showMarkRead = Boolean(blocker.sourceMessageId && blocker.messageStatus === "unread");
                        return (
                            <View key={`${blocker.kind}-${index}`} style={styles.row}>
                                <View style={styles.rowMain}>
                                    <Text style={styles.rowTitle}>{blocker.summary}</Text>
                                    <Text style={styles.rowMeta}>{blocker.kind}</Text>
                                </View>
                                <View style={styles.metaRow}>
                                    {blocker.requiresHuman ? (
                                        <Text style={styles.metaText}>{t("status.needsAttention")}</Text>
                                    ) : null}
                                    {showMarkRead ? (
                                        <Text style={styles.metaText}>{t("inbox.markRead")}</Text>
                                    ) : null}
                                </View>
                                {(canOpenDecision || canOpenSession) ? (
                                    <View style={styles.actionRowInline}>
                                        {canOpenDecision ? (
                                            <Pressable
                                                style={styles.inlineActionButton}
                                                onPress={() => router.push(`/decision/${blocker.decisionId}` as any)}
                                            >
                                                <Ionicons name="git-branch-outline" size={14} color="#3B82F6" />
                                                <Text style={styles.inlineActionText}>{t("decision.title")}</Text>
                                            </Pressable>
                                        ) : null}
                                        {canOpenSession ? (
                                            <Pressable
                                                style={styles.inlineActionButton}
                                                onPress={() => router.push(`/session/${blocker.sessionId}` as any)}
                                            >
                                                <Ionicons name="open-outline" size={14} color="#3B82F6" />
                                                <Text style={styles.inlineActionText}>{t("goals.viewSession")}</Text>
                                            </Pressable>
                                        ) : null}
                                    </View>
                                ) : null}
                            </View>
                        );
                    })}
                </View>
            ) : null}

            {viewModel.sections.some((section) => section.key === "decisions") ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("decision.title")}</Text>
                    {readyGoal.decisions.map((decision) => (
                        <Pressable
                            key={decision.id}
                            style={styles.row}
                            disabled={!isSafeId(decision.id)}
                            onPress={() => isSafeId(decision.id) && router.push(`/decision/${decision.id}` as any)}
                        >
                            <View style={styles.rowMain}>
                                <Text style={styles.rowTitle}>{decision.question}</Text>
                                <Text style={styles.rowMeta}>{decision.status}</Text>
                            </View>
                        </Pressable>
                    ))}
                </View>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    heroCard: {
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
        gap: 12,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    description: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        lineHeight: 20,
    },
    card: {
        marginHorizontal: 16,
        marginTop: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
        gap: 10,
    },
    badgeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
    },
    badgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.text,
    },
    progressValue: {
        ...Typography.default("semiBold"),
        fontSize: 28,
        color: theme.colors.text,
    },
    statsRow: {
        flexDirection: "row",
        gap: 12,
    },
    statItem: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 10,
        padding: 12,
    },
    statValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    statLabel: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    metaRow: {
        flexDirection: "row",
        gap: 10,
        flexWrap: "wrap",
    },
    metaText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    linkRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    linkText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textLink,
    },
    row: {
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.groupped.background,
    },
    rowMain: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 8,
    },
    rowTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    rowMeta: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    actionRowInline: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 8,
    },
    inlineActionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: theme.colors.groupped.background,
    },
    inlineActionText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textLink,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));

export default React.memo(GoalDetailScreen);
