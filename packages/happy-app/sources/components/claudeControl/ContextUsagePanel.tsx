import * as React from "react";
import { View, Text, Pressable, ScrollView, AppState, type AppStateStatus } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Modal } from "@/modal";
import { fetchContextUsage } from "@/sync/apiClaudeControl";
import { log } from "@/log";
import type { GetContextUsageResponse } from "@kmmao/happy-wire";

// Refresh every 30s while active — context changes with each Claude turn
const REFRESH_INTERVAL_MS = 30_000;

const RING_SIZE = 160;
const STROKE_WIDTH = 20;
const RING_RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Fallback palette — used when the API returns empty / invalid color strings
const CATEGORY_PALETTE = [
    "#007AFF",
    "#FF9500",
    "#34C759",
    "#FF3B30",
    "#5856D6",
    "#FF2D55",
    "#5AC8FA",
    "#FFCC00",
];

function resolveColor(color: string | undefined, index: number): string {
    if (color && /^#[0-9A-Fa-f]{3,8}$/.test(color)) return color;
    return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

// ─── Category detail helpers ──────────────────────────────────────────────────

type DetailRow = { label: string; sub?: string; value: string };

/**
 * Returns a list of detail rows for categories that have sub-data,
 * or null if the category has no drillable detail.
 */
function resolveDetail(catName: string, data: GetContextUsageResponse): DetailRow[] | null {
    const lower = catName.toLowerCase();
    if ((lower.includes("memory") || lower.includes("file")) && data.memoryFiles.length > 0) {
        return data.memoryFiles.map((f) => ({
            label: f.path.split("/").pop() ?? f.path,
            sub: f.path,
            value: formatTokens(f.tokens),
        }));
    }
    if (lower.includes("mcp") && data.mcpTools.length > 0) {
        return data.mcpTools.map((tool) => ({
            label: tool.name,
            sub: tool.serverName,
            value: formatTokens(tool.tokens),
        }));
    }
    return null;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
}

function formatPct(n: number): string {
    return `${n < 1 ? "<1" : Math.round(n)}%`;
}

interface ContextUsagePanelProps {
    sessionId: string;
}

/**
 * Panel showing the remote Claude session's context window usage.
 * Displays a Ring Donut chart with per-category arcs, center usage percentage,
 * plus memory files and MCP tools consuming tokens.
 *
 * Refreshes every 30s while the app is foregrounded; pauses on background.
 */
export const ContextUsagePanel = React.memo(function ContextUsagePanel({
    sessionId,
}: ContextUsagePanelProps) {
    const { theme } = useUnistyles();
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
                <Text style={styles.sectionTitle}>{t("claudeControl.contextUsage.title")}</Text>
                <Text style={styles.muted}>{t("claudeControl.contextUsage.loading")}</Text>
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={styles.container}>
                <Text style={styles.sectionTitle}>{t("claudeControl.contextUsage.title")}</Text>
                <Text style={styles.errorText}>{t("claudeControl.contextUsage.error")}</Text>
            </View>
        );
    }

    const modelLabel = data.model && data.model !== "unknown" ? data.model : null;

    return (
        <View style={styles.container}>
            {/* ── Header ── */}
            <View style={styles.headerRow}>
                <Text style={styles.sectionTitle}>{t("claudeControl.contextUsage.title")}</Text>
                {modelLabel && (
                    <Text style={styles.modelBadge} numberOfLines={1}>{modelLabel}</Text>
                )}
            </View>

            {/* ── Ring Donut + Legend side by side ── */}
            <View style={styles.contentRow}>
                <View style={styles.donutWrap}>
                    <RingDonut
                        categories={data.categories}
                        totalTokens={data.totalTokens}
                        maxTokens={data.maxTokens}
                        percentage={data.percentage}
                        trackColor={theme.colors.divider}
                    />
                </View>

            {data.categories.length > 0 && (
                <View style={[styles.card, styles.legendCard, { backgroundColor: theme.colors.surfaceHighest ?? theme.colors.surface }]}>
                    {data.categories.map((cat, i) => {
                        const color = resolveColor(cat.color, i);
                        const pct = data.maxTokens > 0
                            ? (cat.tokens / data.maxTokens) * 100
                            : 0;
                        const detail = resolveDetail(cat.name, data);
                        const isLast = i === data.categories.length - 1;
                        const inner = (
                            <View
                                style={[
                                    styles.legendItem,
                                    !isLast && {
                                        borderBottomWidth: StyleSheet.hairlineWidth,
                                        borderBottomColor: theme.colors.divider,
                                    },
                                ]}
                            >
                                <View style={[styles.legendDot, { backgroundColor: color, opacity: cat.isDeferred ? 0.4 : 1 }]} />
                                <Text style={styles.legendName} numberOfLines={1}>{cat.name}</Text>
                                <Text style={styles.legendPct}>{formatPct(pct)}</Text>
                                <Text style={styles.legendTokens}>{formatTokens(cat.tokens)}</Text>
                                {detail ? (
                                    <Ionicons
                                        name="chevron-forward"
                                        size={12}
                                        color={theme.colors.textSecondary}
                                        style={{ marginLeft: 0 }}
                                    />
                                ) : (
                                    <View style={{ width: 12 }} />
                                )}
                            </View>
                        );
                        if (!detail) return <View key={cat.name}>{inner}</View>;
                        return (
                            <Pressable
                                key={cat.name}
                                onPress={() => Modal.show({
                                    component: CategoryDetailModal,
                                    props: { title: cat.name, detail },
                                })}
                                style={({ pressed }) => pressed ? { opacity: 0.6 } : undefined}
                            >
                                {inner}
                            </Pressable>
                        );
                    })}
                </View>
            )}
            </View>{/* contentRow */}

        </View>
    );
});

// ─── CategoryDetailModal ──────────────────────────────────────────────────────

interface CategoryDetailModalProps {
    title: string;
    detail: DetailRow[];
    onClose: () => void;
}

const CategoryDetailModal = React.memo<CategoryDetailModalProps>(function CategoryDetailModal({
    title,
    detail,
    onClose,
}) {
    const { theme } = useUnistyles();
    const c = theme.colors;
    return (
        <View style={[detailModalStyles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[detailModalStyles.header, { borderBottomColor: c.divider }]}>
                <Text style={[detailModalStyles.title, { color: c.text }]} numberOfLines={1}>
                    {title}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} style={detailModalStyles.closeBtn}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>
            {/* Rows */}
            <ScrollView
                style={detailModalStyles.scroll}
                contentContainerStyle={detailModalStyles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {detail.map((row, i) => (
                    <View
                        key={`${row.label}-${i}`}
                        style={[
                            detailModalStyles.row,
                            { borderBottomColor: c.divider },
                        ]}
                    >
                        <View style={detailModalStyles.rowLeft}>
                            <Text style={[detailModalStyles.rowLabel, { color: c.text }]}>
                                {row.label}
                            </Text>
                            {row.sub ? (
                                <Text
                                    style={[detailModalStyles.rowSub, { color: c.textSecondary }]}
                                    numberOfLines={1}
                                >
                                    {row.sub}
                                </Text>
                            ) : null}
                        </View>
                        <Text style={[detailModalStyles.rowValue, { color: c.textSecondary }]}>
                            {row.value}
                        </Text>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
});

const detailModalStyles = StyleSheet.create((_, rt) => ({
    container: {
        borderRadius: 16,
        overflow: "hidden",
        maxHeight: 460,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    title: {
        flex: 1,
        fontSize: 15,
        fontWeight: "600",
    },
    closeBtn: {
        padding: 4,
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingVertical: 4,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    rowLeft: {
        flex: 1,
        gap: 2,
    },
    rowLabel: {
        fontSize: 13,
        fontWeight: "500",
        fontFamily: "Menlo",
    },
    rowSub: {
        fontSize: 11,
        fontFamily: "Menlo",
    },
    rowValue: {
        fontSize: 12,
        fontVariant: ["tabular-nums"],
        flexShrink: 0,
    },
}));

// ─── Ring Donut ───────────────────────────────────────────────────────────────

interface RingDonutProps {
    categories: GetContextUsageResponse["categories"];
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    trackColor: string;
}

/**
 * SVG ring donut.
 * Each category arc is individually rotated so it starts at its correct position.
 * Uses per-arc `transform="rotate(angle, cx, cy)"` to avoid G wrapper issues on iOS.
 * Falls back to a built-in palette if the API returns no color.
 */
const RingDonut = React.memo(function RingDonut({
    categories,
    totalTokens,
    maxTokens,
    percentage,
    trackColor,
}: RingDonutProps) {
    const { theme } = useUnistyles();
    const cx = RING_SIZE / 2;
    const cy = RING_SIZE / 2;

    // Pre-compute arc geometry with resolved colors
    let cumOffset = 0;
    const arcs = categories.map((cat, i) => {
        const arcLen = maxTokens > 0 ? (cat.tokens / maxTokens) * CIRCUMFERENCE : 0;
        // Start at 12 o'clock (-90°), advance clockwise by cumulative arc length
        const startAngle = (cumOffset / CIRCUMFERENCE) * 360 - 90;
        const color = resolveColor(cat.color, i);
        cumOffset += arcLen;
        return { ...cat, arcLen, startAngle, color };
    });

    const pctText = `${Math.round(percentage)}%`;
    const tokenText = formatTokens(totalTokens);
    const maxText = formatTokens(maxTokens);

    return (
        <View style={donutStyles.root}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
                {/* Background track */}
                <Circle
                    cx={cx}
                    cy={cy}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={trackColor}
                    strokeWidth={STROKE_WIDTH}
                />
                {/* Per-category arcs, each individually rotated to its start angle */}
                {arcs.map((arc) => (
                    <Circle
                        key={arc.name}
                        cx={cx}
                        cy={cy}
                        r={RING_RADIUS}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth={STROKE_WIDTH}
                        strokeDasharray={[arc.arcLen, CIRCUMFERENCE]}
                        transform={`rotate(${arc.startAngle}, ${cx}, ${cy})`}
                        strokeLinecap="butt"
                        opacity={arc.isDeferred ? 0.4 : 1}
                    />
                ))}
            </Svg>

            {/* Center overlay */}
            <View style={donutStyles.center} pointerEvents="none">
                <Text style={[donutStyles.pct, { color: theme.colors.text }]}>{pctText}</Text>
                <Text style={[donutStyles.tokens, { color: theme.colors.textSecondary }]}>
                    {tokenText} / {maxText}
                </Text>
            </View>
        </View>
    );
});

const donutStyles = {
    root: { width: RING_SIZE, height: RING_SIZE, position: "relative" as const },
    center: {
        position: "absolute" as const,
        top: 0, left: 0, right: 0, bottom: 0,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
    pct: { fontSize: 26, fontWeight: "700" as const, lineHeight: 30 },
    tokens: { fontSize: 11, lineHeight: 14, marginTop: 2 },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 12,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
    },
    modelBadge: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.divider,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        overflow: "hidden",
        maxWidth: 160,
    },
    // Row that puts the donut chart and legend side by side
    contentRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    donutWrap: {
        alignItems: "center",
        justifyContent: "center",
    },
    // Shared card container for legend and file sections
    card: {
        borderRadius: 10,
        overflow: "hidden",
    },
    // Legend card in the side-by-side layout takes remaining width
    legendCard: {
        flex: 1,
        alignSelf: "stretch",
    },
    // Legend items inside the card
    legendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    legendDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        flexShrink: 0,
    },
    legendName: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
    },
    legendPct: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        minWidth: 36,
        textAlign: "right",
    },
    legendTokens: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontVariant: ["tabular-nums"],
        minWidth: 40,
        textAlign: "right",
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
