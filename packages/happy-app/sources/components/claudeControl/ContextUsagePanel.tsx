import * as React from "react";
import { View, Text, AppState, type AppStateStatus } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { fetchContextUsage } from "@/sync/apiClaudeControl";
import { log } from "@/log";
import type { GetContextUsageResponse } from "@kmmao/happy-wire";

// Refresh every 30s while active — context changes with each Claude turn
const REFRESH_INTERVAL_MS = 30_000;

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
}

interface ContextUsagePanelProps {
    sessionId: string;
}

/**
 * Panel showing the remote Claude session's context window usage.
 * Displays total usage, per-category colored segments, active model,
 * loaded memory files, and MCP tools consuming tokens.
 *
 * Refreshes every 30s while the app is foregrounded; pauses on background.
 */
export const ContextUsagePanel = React.memo(function ContextUsagePanel({
    sessionId,
}: ContextUsagePanelProps) {
    const [data, setData] = React.useState<GetContextUsageResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);
    const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);

    const refresh = React.useCallback(async () => {
        try {
            const res = await fetchContextUsage(sessionId);
            setData(res);
            setError(false);
        } catch (e) {
            log.log("[ContextUsagePanel] fetch failed", e);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    React.useEffect(() => {
        refresh();
        const interval = setInterval(() => {
            if (appStateRef.current === "active") refresh();
        }, REFRESH_INTERVAL_MS);
        const sub = AppState.addEventListener("change", (next) => {
            appStateRef.current = next;
            if (next === "active") refresh();
        });
        return () => {
            clearInterval(interval);
            sub.remove();
        };
    }, [refresh]);

    if (loading) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>{t("claudeControl.contextUsage.title")}</Text>
                <Text style={styles.muted}>{t("claudeControl.contextUsage.loading")}</Text>
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>{t("claudeControl.contextUsage.title")}</Text>
                <Text style={styles.errorText}>{t("claudeControl.contextUsage.error")}</Text>
            </View>
        );
    }

    const usedLabel = `${formatTokens(data.totalTokens)} / ${formatTokens(data.maxTokens)} tokens`;
    const pctLabel = `${Math.round(data.percentage)}% used`;
    const modelLabel = data.model && data.model !== "unknown" ? data.model : null;

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.headerRow}>
                <Text style={styles.title}>{t("claudeControl.contextUsage.title")}</Text>
                {modelLabel && (
                    <Text style={styles.modelBadge} numberOfLines={1}>
                        {modelLabel}
                    </Text>
                )}
            </View>

            {/* Usage summary */}
            <View style={styles.summaryRow}>
                <Text style={styles.tokensLabel}>{usedLabel}</Text>
                <Text style={styles.pctLabel}>{pctLabel}</Text>
            </View>

            {/* Segmented progress bar */}
            <SegmentedBar
                categories={data.categories}
                totalTokens={data.totalTokens}
                maxTokens={data.maxTokens}
            />

            {/* Category legend */}
            {data.categories.length > 0 && (
                <View style={styles.legendGrid}>
                    {data.categories.map((cat) => (
                        <View key={cat.name} style={styles.legendItem}>
                            <View
                                style={[
                                    styles.legendDot,
                                    { backgroundColor: cat.color },
                                ]}
                            />
                            <Text style={styles.legendName} numberOfLines={1}>
                                {cat.name}
                            </Text>
                            <Text style={styles.legendTokens}>
                                {formatTokens(cat.tokens)}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            {/* Memory files */}
            <ContextSection
                label={t("claudeControl.contextUsage.memoryFiles")}
                empty={data.memoryFiles.length === 0}
                emptyLabel={t("claudeControl.contextUsage.noMemoryFiles")}
            >
                {data.memoryFiles.map((f) => (
                    <View key={f.path} style={styles.listRow}>
                        <Text style={styles.listPath} numberOfLines={1}>
                            {f.path.split("/").pop() ?? f.path}
                        </Text>
                        <Text style={styles.listTokens}>
                            {formatTokens(f.tokens)}
                        </Text>
                    </View>
                ))}
            </ContextSection>

            {/* MCP tools */}
            <ContextSection
                label={t("claudeControl.contextUsage.mcpTools")}
                empty={data.mcpTools.length === 0}
                emptyLabel={t("claudeControl.contextUsage.noMcpTools")}
            >
                {data.mcpTools.map((tool) => (
                    <View key={`${tool.serverName}/${tool.name}`} style={styles.listRow}>
                        <Text style={styles.listPath} numberOfLines={1}>
                            {tool.serverName}/{tool.name}
                        </Text>
                        <Text style={styles.listTokens}>
                            {formatTokens(tool.tokens)}
                        </Text>
                    </View>
                ))}
            </ContextSection>
        </View>
    );
});

// ─── Sub-components ──────────────────────────────────────────────────────────

interface SegmentedBarProps {
    categories: GetContextUsageResponse["categories"];
    totalTokens: number;
    maxTokens: number;
}

const SegmentedBar = React.memo(function SegmentedBar({
    categories,
    totalTokens,
    maxTokens,
}: SegmentedBarProps) {
    const totalPct = maxTokens > 0 ? Math.min((totalTokens / maxTokens) * 100, 100) : 0;
    return (
        <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${totalPct}%` as any }]}>
                {categories.map((cat) => {
                    const segPct = totalTokens > 0 ? (cat.tokens / totalTokens) * 100 : 0;
                    return (
                        <View
                            key={cat.name}
                            style={[
                                styles.barSegment,
                                {
                                    width: `${segPct}%` as any,
                                    backgroundColor: cat.color,
                                    opacity: cat.isDeferred ? 0.4 : 1,
                                },
                            ]}
                        />
                    );
                })}
            </View>
        </View>
    );
});

interface ContextSectionProps {
    label: string;
    empty: boolean;
    emptyLabel: string;
    children?: React.ReactNode;
}

function ContextSection({ label, empty, emptyLabel, children }: ContextSectionProps) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionLabel}>{label}</Text>
            {empty ? (
                <Text style={styles.muted}>{emptyLabel}</Text>
            ) : (
                children
            )}
        </View>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 10,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    title: {
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
    },
    modelBadge: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.divider,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        overflow: "hidden",
        maxWidth: 160,
    },
    summaryRow: {
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
    },
    tokensLabel: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.text,
    },
    pctLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    barTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.divider,
        overflow: "hidden",
    },
    barFill: {
        flexDirection: "row",
        height: "100%" as any,
        borderRadius: 4,
        overflow: "hidden",
    },
    barSegment: {
        height: "100%" as any,
    },
    legendGrid: {
        gap: 5,
    },
    legendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    legendName: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        textTransform: "capitalize",
    },
    legendTokens: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    section: {
        gap: 5,
        marginTop: 2,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    listRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingVertical: 2,
    },
    listPath: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        fontFamily: "Menlo",
    },
    listTokens: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    muted: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    errorText: {
        fontSize: 12,
        color: theme.colors.textDestructive,
    },
}));
