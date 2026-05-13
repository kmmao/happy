import * as React from "react";
import { View, Text, Pressable, ScrollView, AppState, type AppStateStatus } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Modal } from "@/modal";
import { fetchContextUsage, fetchContextDetail } from "@/sync/apiClaudeControl";
import { log } from "@/log";
import type { GetContextUsageResponse, GetContextDetailResponse } from "@kmmao/happy-wire";

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
                        const legacyDetail = resolveDetail(cat.name, data);
                        const isLast = i === data.categories.length - 1;
                        // "Free space" has no backing content — not drillable
                        const isFreeSpace = cat.name.toLowerCase().includes("free");
                        const isClickable = !isFreeSpace;
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
                                {isClickable ? (
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
                        if (!isClickable) return <View key={cat.name}>{inner}</View>;
                        // Legacy detail (memory files / MCP tools) shown via existing modal
                        if (legacyDetail) {
                            return (
                                <Pressable
                                    key={cat.name}
                                    onPress={() => Modal.show({
                                        component: CategoryDetailModal,
                                        props: { title: cat.name, detail: legacyDetail },
                                    })}
                                    style={({ pressed }) => pressed ? { opacity: 0.6 } : undefined}
                                >
                                    {inner}
                                </Pressable>
                            );
                        }
                        // Messages category — two-level drill-down via SubcategoryListModal
                        const isMessages = cat.name.toLowerCase().includes("message");
                        if (isMessages) {
                            return (
                                <Pressable
                                    key={cat.name}
                                    onPress={() => Modal.show({
                                        component: SubcategoryListModal,
                                        props: { sessionId, category: cat.name },
                                    })}
                                    style={({ pressed }) => pressed ? { opacity: 0.6 } : undefined}
                                >
                                    {inner}
                                </Pressable>
                            );
                        }
                        // All other categories — open full content modal via RPC
                        return (
                            <Pressable
                                key={cat.name}
                                onPress={() => Modal.show({
                                    component: ContextContentModal,
                                    props: { sessionId, category: cat.name },
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

// ─── SubcategoryListModal ─────────────────────────────────────────────────────
// Two-level drill-down for "Messages": first load subcategory counts (no content),
// then let the user pick a subcategory to open the full ContextContentModal.

interface SubcategoryListModalProps {
    sessionId: string;
    category: string;
    onClose: () => void;
}

const SUBCAT_ICONS: Record<string, string> = {
    "user": "person-outline",
    "system-reminder": "code-slash-outline",
    "assistant": "chatbubble-ellipses-outline",
};

function subcatLabel(name: string): string {
    if (name === "user") return t("claudeControl.contextUsage.subcatUser");
    if (name === "system-reminder") return t("claudeControl.contextUsage.subcatSystemReminder");
    if (name === "assistant") return t("claudeControl.contextUsage.subcatAssistant");
    return name;
}

const SubcategoryListModal = React.memo<SubcategoryListModalProps>(function SubcategoryListModal({
    sessionId,
    category,
    onClose,
}) {
    const { theme } = useUnistyles();
    const c = theme.colors;
    const [state, setState] = React.useState<
        | { status: "loading" }
        | { status: "error" }
        | { status: "done"; subcategories: GetContextDetailResponse["subcategories"] }
    >({ status: "loading" });

    React.useEffect(() => {
        let cancelled = false;
        fetchContextDetail(sessionId, category, { summaryOnly: true })
            .then((res) => {
                if (!cancelled) setState({ status: "done", subcategories: res.subcategories ?? [] });
            })
            .catch(() => {
                if (!cancelled) setState({ status: "error" });
            });
        return () => { cancelled = true; };
    }, [sessionId, category]);

    return (
        <View style={[subcatModalStyles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[subcatModalStyles.header, { borderBottomColor: c.divider }]}>
                <Text style={[subcatModalStyles.title, { color: c.text }]} numberOfLines={1}>
                    {category}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} style={subcatModalStyles.closeBtn}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>

            {state.status === "loading" && (
                <View style={subcatModalStyles.center}>
                    <Text style={[subcatModalStyles.muted, { color: c.textSecondary }]}>
                        {t("claudeControl.contextUsage.subcatLoading")}
                    </Text>
                </View>
            )}

            {state.status === "error" && (
                <View style={subcatModalStyles.center}>
                    <Text style={[subcatModalStyles.muted, { color: c.textSecondary }]}>
                        {t("claudeControl.contextUsage.detailError")}
                    </Text>
                </View>
            )}

            {state.status === "done" && (
                <View>
                    {(state.subcategories ?? []).map((subcat, i) => {
                        const isLast = i === (state.subcategories?.length ?? 0) - 1;
                        const iconName = SUBCAT_ICONS[subcat.name] ?? "document-text-outline";
                        return (
                            <Pressable
                                key={subcat.name}
                                onPress={() => {
                                    onClose();
                                    // Small delay so the first modal closes before the second opens
                                    setTimeout(() => {
                                        Modal.show({
                                            component: ContextContentModal,
                                            props: {
                                                sessionId,
                                                category,
                                                subcategory: subcat.name,
                                                subcategoryLabel: subcatLabel(subcat.name),
                                            },
                                        });
                                    }, 150);
                                }}
                                style={({ pressed }) => pressed ? { opacity: 0.6 } : undefined}
                            >
                                <View
                                    style={[
                                        subcatModalStyles.row,
                                        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider },
                                    ]}
                                >
                                    <Ionicons name={iconName as never} size={16} color={c.textSecondary} />
                                    <Text style={[subcatModalStyles.rowLabel, { color: c.text }]} numberOfLines={1}>
                                        {subcatLabel(subcat.name)}
                                    </Text>
                                    <Text style={[subcatModalStyles.rowCount, { color: c.textSecondary }]}>
                                        {formatTokens(subcat.count)}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={12} color={c.textSecondary} />
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            )}
        </View>
    );
});

const subcatModalStyles = StyleSheet.create(() => ({
    container: {
        borderRadius: 16,
        overflow: "hidden",
        width: "100%",
        maxWidth: 720,
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
    center: {
        paddingVertical: 32,
        alignItems: "center",
    },
    muted: {
        fontSize: 13,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
    },
    rowLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: "500",
    },
    rowCount: {
        fontSize: 12,
        fontVariant: ["tabular-nums"],
    },
}));

// ─── ContentItem (collapsible) ───────────────────────────────────────────────

const COLLAPSED_LINES = 6;

interface ContentItemProps {
    item: GetContextDetailResponse["items"][number];
}

const ContentItem = React.memo<ContentItemProps>(function ContentItem({ item }) {
    const { theme } = useUnistyles();
    const c = theme.colors;
    const [expanded, setExpanded] = React.useState(false);
    const lineCount = React.useMemo(() => (item.content.match(/\n/g) ?? []).length + 1, [item.content]);
    const isLong = lineCount > COLLAPSED_LINES;

    return (
        <View
            style={[
                contentModalStyles.itemCard,
                { backgroundColor: c.surfaceHighest ?? c.surface, borderColor: c.divider },
            ]}
        >
            <Pressable
                style={contentModalStyles.itemHeader}
                onPress={() => isLong && setExpanded((v) => !v)}
            >
                <Text style={[contentModalStyles.itemBadge, { backgroundColor: c.divider, color: c.textSecondary }]}>
                    {item.role ? `${item.type} · ${item.role}` : item.type}
                </Text>
                {item.timestamp ? (
                    <Text style={[contentModalStyles.itemTime, { color: c.textSecondary }]} numberOfLines={1}>
                        {item.timestamp.slice(11, 19)}
                    </Text>
                ) : null}
                {isLong && (
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={12}
                        color={c.textSecondary}
                        style={{ marginLeft: "auto" }}
                    />
                )}
            </Pressable>
            <Text
                style={[contentModalStyles.itemContent, { color: c.text }]}
                selectable={expanded}
                numberOfLines={expanded ? undefined : COLLAPSED_LINES}
            >
                {item.content}
            </Text>
            {isLong && !expanded && (
                <Pressable onPress={() => setExpanded(true)}>
                    <Text style={[contentModalStyles.expandHint, { color: c.primary }]}>
                        {`${lineCount} ${t("claudeControl.contextUsage.detailLines")}`}
                    </Text>
                </Pressable>
            )}
        </View>
    );
});

// ─── ContextContentModal ─────────────────────────────────────────────────────
// Full content viewer for a context category — fetches records via RPC and
// shows them in a scrollable list with monospace text.

interface ContextContentModalProps {
    sessionId: string;
    category: string;
    /** Optional subcategory filter (e.g. "user", "system-reminder", "assistant") */
    subcategory?: string;
    /** Display label for the subcategory, shown in the header */
    subcategoryLabel?: string;
    onClose: () => void;
}

const ContextContentModal = React.memo<ContextContentModalProps>(function ContextContentModal({
    sessionId,
    category,
    subcategory,
    subcategoryLabel,
    onClose,
}) {
    const { theme } = useUnistyles();
    const c = theme.colors;
    const [state, setState] = React.useState<
        | { status: "loading" }
        | { status: "error" }
        | { status: "done"; data: GetContextDetailResponse }
    >({ status: "loading" });

    React.useEffect(() => {
        let cancelled = false;
        fetchContextDetail(sessionId, category, subcategory ? { subcategory } : undefined)
            .then((res) => {
                if (!cancelled) setState({ status: "done", data: res });
            })
            .catch(() => {
                if (!cancelled) setState({ status: "error" });
            });
        return () => { cancelled = true; };
    }, [sessionId, category, subcategory]);

    return (
        <View style={[contentModalStyles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[contentModalStyles.header, { borderBottomColor: c.divider }]}>
                <Text style={[contentModalStyles.title, { color: c.text }]} numberOfLines={1}>
                    {subcategoryLabel ?? category}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} style={contentModalStyles.closeBtn}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>

            {state.status === "loading" && (
                <View style={contentModalStyles.center}>
                    <Text style={[contentModalStyles.muted, { color: c.textSecondary }]}>
                        {t("claudeControl.contextUsage.detailLoading")}
                    </Text>
                </View>
            )}

            {state.status === "error" && (
                <View style={contentModalStyles.center}>
                    <Text style={[contentModalStyles.muted, { color: c.textSecondary }]}>
                        {t("claudeControl.contextUsage.detailError")}
                    </Text>
                </View>
            )}

            {state.status === "done" && (
                <>
                    <View style={[contentModalStyles.countRow, { borderBottomColor: c.divider }]}>
                        <Text style={[contentModalStyles.countText, { color: c.textSecondary }]}>
                            {t("claudeControl.contextUsage.detailItems").replace("{n}", String(state.data.totalItems))}
                        </Text>
                    </View>
                    <ScrollView
                        style={contentModalStyles.scroll}
                        contentContainerStyle={contentModalStyles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {state.data.items.map((item, idx) => (
                            <ContentItem
                                key={item.uuid ?? String(idx)}
                                item={item}
                            />
                        ))}
                    </ScrollView>
                </>
            )}
        </View>
    );
});

const contentModalStyles = StyleSheet.create((_, rt) => ({
    container: {
        borderRadius: 16,
        overflow: "hidden",
        maxHeight: "85%",
        minHeight: 180,
        width: "100%",
        maxWidth: 720,
        flexShrink: 1,
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
    countRow: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    countText: {
        fontSize: 11,
    },
    center: {
        paddingVertical: 32,
        alignItems: "center",
    },
    muted: {
        fontSize: 13,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 12,
        gap: 10,
    },
    itemCard: {
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 10,
        gap: 6,
        overflow: "hidden",
    },
    itemHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    itemBadge: {
        fontSize: 10,
        fontWeight: "600",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: "hidden",
    },
    itemTime: {
        fontSize: 10,
    },
    itemContent: {
        fontSize: 12,
        fontFamily: "Menlo",
        lineHeight: 17,
        flexShrink: 1,
    },
    expandHint: {
        fontSize: 11,
        fontWeight: "500",
        paddingTop: 4,
    },
}));

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
