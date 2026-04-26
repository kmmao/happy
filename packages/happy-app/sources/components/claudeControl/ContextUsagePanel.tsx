import * as React from "react";
import { View, Text, AppState, type AppStateStatus } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import Svg, { Circle } from "react-native-svg";
import { t } from "@/text";
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

            {/* ── Ring Donut ── */}
            <View style={styles.donutWrap}>
                <RingDonut
                    categories={data.categories}
                    totalTokens={data.totalTokens}
                    maxTokens={data.maxTokens}
                    percentage={data.percentage}
                    trackColor={theme.colors.divider}
                />
            </View>

            {/* ── Category legend ── */}
            {data.categories.length > 0 && (
                <View style={[styles.card, { backgroundColor: theme.colors.surfaceHighest ?? theme.colors.surface }]}>
                    {data.categories.map((cat, i) => {
                        const color = resolveColor(cat.color, i);
                        const pct = data.maxTokens > 0
                            ? (cat.tokens / data.maxTokens) * 100
                            : 0;
                        return (
                            <View
                                key={cat.name}
                                style={[
                                    styles.legendItem,
                                    i < data.categories.length - 1 && {
                                        borderBottomWidth: StyleSheet.hairlineWidth,
                                        borderBottomColor: theme.colors.divider,
                                    },
                                ]}
                            >
                                <View style={[styles.legendDot, { backgroundColor: color, opacity: cat.isDeferred ? 0.4 : 1 }]} />
                                <Text style={styles.legendName} numberOfLines={1}>{cat.name}</Text>
                                <Text style={styles.legendPct}>{formatPct(pct)}</Text>
                                <Text style={styles.legendTokens}>{formatTokens(cat.tokens)}</Text>
                            </View>
                        );
                    })}
                </View>
            )}

            {/* ── Memory files ── */}
            {data.memoryFiles.length > 0 && (
                <SectionBlock
                    label={t("claudeControl.contextUsage.memoryFiles")}
                    borderColor={theme.colors.divider}
                    cardBg={theme.colors.surfaceHighest ?? theme.colors.surface}
                >
                    {data.memoryFiles.map((f, i) => (
                        <FileRow
                            key={f.path}
                            name={f.path.split("/").pop() ?? f.path}
                            value={formatTokens(f.tokens)}
                            isLast={i === data.memoryFiles.length - 1}
                            borderColor={theme.colors.divider}
                        />
                    ))}
                </SectionBlock>
            )}

            {/* ── MCP tools ── */}
            {data.mcpTools.length > 0 && (
                <SectionBlock
                    label={t("claudeControl.contextUsage.mcpTools")}
                    borderColor={theme.colors.divider}
                    cardBg={theme.colors.surfaceHighest ?? theme.colors.surface}
                >
                    {data.mcpTools.map((tool, i) => (
                        <FileRow
                            key={`${tool.serverName}/${tool.name}`}
                            name={`${tool.serverName}/${tool.name}`}
                            value={formatTokens(tool.tokens)}
                            isLast={i === data.mcpTools.length - 1}
                            borderColor={theme.colors.divider}
                        />
                    ))}
                </SectionBlock>
            )}

            {/* Empty states */}
            {data.memoryFiles.length === 0 && (
                <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                    {t("claudeControl.contextUsage.noMemoryFiles")}
                </Text>
            )}
        </View>
    );
});

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

// ─── SectionBlock ─────────────────────────────────────────────────────────────

interface SectionBlockProps {
    label: string;
    borderColor: string;
    cardBg: string;
    children: React.ReactNode;
}

function SectionBlock({ label, borderColor, cardBg, children }: SectionBlockProps) {
    return (
        <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
                {children}
            </View>
        </View>
    );
}

// ─── FileRow ──────────────────────────────────────────────────────────────────

interface FileRowProps {
    name: string;
    value: string;
    isLast: boolean;
    borderColor: string;
}

function FileRow({ name, value, isLast, borderColor }: FileRowProps) {
    return (
        <View
            style={[
                styles.fileRow,
                !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
            ]}
        >
            <Text style={styles.fileName}>{name}</Text>
            <Text style={styles.fileValue}>{value}</Text>
        </View>
    );
}

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
    donutWrap: {
        alignItems: "center",
        paddingVertical: 4,
    },
    // Shared card container for legend and file sections
    card: {
        borderRadius: 10,
        overflow: "hidden",
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
    // Section blocks (Memory Files, MCP Tools)
    sectionBlock: {
        gap: 6,
    },
    sectionLabel: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    fileRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    fileName: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        fontFamily: "Menlo",
        lineHeight: 16,
    },
    fileValue: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        fontVariant: ["tabular-nums"],
        flexShrink: 0,
    },
    emptyHint: {
        fontSize: 12,
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
