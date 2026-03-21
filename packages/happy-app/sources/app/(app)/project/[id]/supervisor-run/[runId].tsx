import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    Pressable,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchRunComparison,
    exportRunReport,
    type RunComparisonAction,
    type RunComparison,
} from "@/sync/apiSupervisor";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import {
    SEVERITY_COLORS,
    SEVERITY_KEY_MAP,
    getConfidenceColor,
} from "@/components/project/supervisorConstants";
import { layout } from "@/components/layout";

// --- Helpers ---

function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(startMs: number, endMs: number | null): string {
    if (!endMs) return "--";
    const seconds = Math.round((endMs - startMs) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function formatCost(costUsd: number | null): string {
    if (costUsd == null) return "--";
    return `$${costUsd.toFixed(4)}`;
}

function formatTokens(tokenCount: number | null): string {
    if (tokenCount == null) return "--";
    if (tokenCount >= 1_000_000) {
        return `${(tokenCount / 1_000_000).toFixed(1)}M`;
    }
    if (tokenCount >= 1_000) {
        return `${(tokenCount / 1_000).toFixed(1)}K`;
    }
    return String(tokenCount);
}


// --- Main Screen ---

function SupervisorRunDetailScreen() {
    const { id, runId } = useLocalSearchParams<{
        id: string;
        runId: string;
    }>();
    const navigation = useNavigation();
    const { theme } = useUnistyles();

    const [comparison, setComparison] = React.useState<RunComparison | null>(
        null,
    );
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const [exporting, handleExport] = useHappyAction(
        React.useCallback(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const result = await exportRunReport(credentials, id, runId);
            await Clipboard.setStringAsync(result.content);
            Modal.toast(t("supervisor.exportCopied"));
        }, [id, runId]),
    );

    // Fetch comparison data
    React.useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                setLoading(true);
                setError(null);
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchRunComparison(
                    credentials,
                    id,
                    runId,
                );
                if (!cancelled) {
                    setComparison(data);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : t("supervisor.loadRunError"),
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [id, runId]);

    // Set header title to run date
    React.useLayoutEffect(() => {
        const title = comparison
            ? formatDate(comparison.currentRun.createdAt)
            : t("supervisor.runDetail");
        navigation.setOptions({ headerTitle: title });
    }, [navigation, comparison]);

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

    if (error || !comparison) {
        return (
            <View style={styles.centered}>
                <Text style={styles.errorText}>
                    {error ?? t("supervisor.loadRunError")}
                </Text>
            </View>
        );
    }

    const { currentRun, previousRun, newActions: rawNewActions, resolvedActions: rawResolvedActions, persistentActions: rawPersistentActions } =
        comparison;
    const hasPreviousRun = previousRun != null;

    // Reclassify: fixStatus=completed actions are resolved, not new/persistent
    const fixedFromNew = rawNewActions.filter((a) => a.fixStatus === "completed");
    const fixedFromPersistent = rawPersistentActions.filter((a) => a.fixStatus === "completed");
    const newActions = rawNewActions.filter((a) => a.fixStatus !== "completed");
    const resolvedActions = [...rawResolvedActions, ...fixedFromNew, ...fixedFromPersistent];
    const persistentActions = rawPersistentActions.filter((a) => a.fixStatus !== "completed");

    const allActions = [...newActions, ...resolvedActions, ...persistentActions];

    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
        >
            {/* Run Metadata Header */}
            <View style={styles.metadataCard}>
                <MetadataRow
                    label={t("supervisor.runTrigger")}
                    value={currentRun.trigger}
                />
                <MetadataRow
                    label={t("supervisor.runDuration")}
                    value={formatDuration(
                        currentRun.createdAt,
                        currentRun.completedAt,
                    )}
                />
                <MetadataRow
                    label={t("supervisor.runCost")}
                    value={formatCost(currentRun.costUsd)}
                />
                <MetadataRow
                    label="Tokens"
                    value={formatTokens(currentRun.tokenCount)}
                />
                {currentRun.healthScore != null && (
                    <MetadataRow
                        label={t("supervisor.healthScore")}
                        value={String(currentRun.healthScore)}
                    />
                )}
                <MetadataRow
                    label={t("supervisor.runActions")}
                    value={String(currentRun.actionsCount)}
                    isLast
                />
            </View>

            {/* Export button */}
            <Pressable
                style={styles.exportButton}
                onPress={handleExport}
                disabled={exporting}
            >
                {exporting ? (
                    <ActivityIndicator size="small" color={theme.colors.header.tint} />
                ) : (
                    <>
                        <Ionicons
                            name="share-outline"
                            size={16}
                            color={theme.colors.header.tint}
                        />
                        <Text style={styles.exportButtonText}>
                            {t("supervisor.exportReport")}
                        </Text>
                    </>
                )}
            </Pressable>

            {/* Comparison or flat list */}
            {hasPreviousRun ? (
                <>
                    <ActionSection
                        title={t("supervisor.newIssues")}
                        count={newActions.length}
                        badgeColor="#FF3B30"
                        actions={newActions}
                    />
                    <ActionSection
                        title={t("supervisor.resolvedIssues")}
                        count={resolvedActions.length}
                        badgeColor="#34C759"
                        actions={resolvedActions}
                    />
                    <ActionSection
                        title={t("supervisor.persistentIssues")}
                        count={persistentActions.length}
                        badgeColor="#8E8E93"
                        actions={persistentActions}
                    />
                </>
            ) : (
                <>
                    <View style={styles.noPreviousRunBanner}>
                        <Ionicons
                            name="information-circle-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.noPreviousRunText}>
                            {t("supervisor.noPreviousRun")}
                        </Text>
                    </View>
                    <ActionSection
                        title={t("supervisor.newIssues")}
                        count={allActions.length}
                        badgeColor="#FF3B30"
                        actions={allActions}
                    />
                </>
            )}
        </ScrollView>
    );
}

// --- MetadataRow ---

interface MetadataRowProps {
    label: string;
    value: string;
    isLast?: boolean;
}

const MetadataRow = React.memo(
    ({ label, value, isLast }: MetadataRowProps) => (
        <View
            style={[
                styles.metadataRow,
                !isLast && styles.metadataRowBorder,
            ]}
        >
            <Text style={styles.metadataLabel}>{label}</Text>
            <Text style={styles.metadataValue}>{value}</Text>
        </View>
    ),
);

// --- ActionSection ---

interface ActionSectionProps {
    title: string;
    count: number;
    badgeColor: string;
    actions: RunComparisonAction[];
}

const ActionSection = React.memo(
    ({ title, count, badgeColor, actions }: ActionSectionProps) => {
        const { theme } = useUnistyles();

        return (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{title}</Text>
                    <View
                        style={[
                            styles.badge,
                            { backgroundColor: badgeColor },
                        ]}
                    >
                        <Text style={styles.badgeText}>{count}</Text>
                    </View>
                </View>
                {actions.length === 0 ? (
                    <View style={styles.emptySection}>
                        <Text style={styles.emptySectionText}>--</Text>
                    </View>
                ) : (
                    <View style={styles.actionsContainer}>
                        {actions.map((action, index) => (
                            <ComparisonActionCard
                                key={action.id}
                                action={action}
                                isLast={index === actions.length - 1}
                            />
                        ))}
                    </View>
                )}
            </View>
        );
    },
);

// --- ComparisonActionCard ---

interface ComparisonActionCardProps {
    action: RunComparisonAction;
    isLast?: boolean;
}

const ComparisonActionCard = React.memo(
    ({ action, isLast }: ComparisonActionCardProps) => {
        const { theme } = useUnistyles();
        const borderColor =
            SEVERITY_COLORS[action.severity] ?? theme.colors.textSecondary;

        const severityLabel = SEVERITY_KEY_MAP[action.severity]
            ? t(SEVERITY_KEY_MAP[action.severity])
            : action.severity;

        const confidenceColor = getConfidenceColor(action.confidence);

        const showDetail = React.useCallback(() => {
            const message = action.suggestedFix
                ? `${action.description}\n\n${t("supervisor.suggestedFix")}:\n${action.suggestedFix}`
                : action.description;
            Modal.alert(action.title, message);
        }, [action.title, action.description, action.suggestedFix]);

        return (
            <Pressable
                onPress={showDetail}
                style={[
                    styles.actionCard,
                    !isLast && styles.actionCardBorder,
                    { borderLeftColor: borderColor },
                ]}
            >
                {/* Header row: severity pill + confidence */}
                <View style={styles.actionHeaderRow}>
                    <View
                        style={[
                            styles.severityBadge,
                            { backgroundColor: borderColor },
                        ]}
                    >
                        <Text style={styles.severityText}>
                            {severityLabel}
                        </Text>
                    </View>
                    {confidenceColor != null && action.confidence != null && (
                        <View
                            style={[
                                styles.confidenceBadge,
                                {
                                    backgroundColor:
                                        confidenceColor + "20",
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.confidenceText,
                                    { color: confidenceColor },
                                ]}
                            >
                                {action.confidence}%
                            </Text>
                        </View>
                    )}
                </View>

                {/* Title */}
                <Text style={styles.actionTitle}>{action.title}</Text>

                {/* Description */}
                <Text style={styles.actionDescription} numberOfLines={4}>
                    {action.description}
                </Text>

                {/* Suggested fix */}
                {action.suggestedFix && (
                    <View style={styles.fixBox}>
                        <Text style={styles.fixLabel}>
                            {t("supervisor.suggestedFix")}
                        </Text>
                        <Text style={styles.fixText} numberOfLines={3}>
                            {action.suggestedFix}
                        </Text>
                    </View>
                )}
            </Pressable>
        );
    },
);

// --- Styles ---

const styles = StyleSheet.create((theme) => ({
    centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.colors.groupped.background,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: "center",
        paddingHorizontal: 32,
    },
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },

    // Metadata card
    metadataCard: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginTop: 16,
        borderRadius: 10,
        overflow: "hidden",
    },

    // Export button
    exportButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        marginHorizontal: 16,
        marginTop: 10,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
    },
    exportButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.header.tint,
    },

    metadataRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    metadataRowBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    metadataLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    metadataValue: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
    },

    // No previous run banner
    noPreviousRunBanner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 16,
        marginTop: 16,
        padding: 12,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
    },
    noPreviousRunText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        flex: 1,
    },

    // Section
    section: {
        marginTop: 20,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 16,
        marginBottom: 8,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 17,
        color: theme.colors.text,
    },
    badge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 6,
    },
    badgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#FFFFFF",
    },

    // Empty section
    emptySection: {
        marginHorizontal: 16,
        padding: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        alignItems: "center",
    },
    emptySectionText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },

    // Actions container
    actionsContainer: {
        marginHorizontal: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        overflow: "hidden",
    },

    // Action card
    actionCard: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderLeftWidth: 3,
    },
    actionCardBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    actionHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
    },
    severityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    severityText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: "#FFFFFF",
        textTransform: "uppercase",
    },
    confidenceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        marginLeft: "auto",
    },
    confidenceText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    actionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
        marginBottom: 4,
    },
    actionDescription: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },

    // Suggested fix box
    fixBox: {
        marginTop: 8,
        padding: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 6,
    },
    fixLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        textTransform: "uppercase",
    },
    fixText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
    },
}));

export default React.memo(SupervisorRunDetailScreen);
