import * as React from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldEvent, WorldFilter } from "./worldTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceDensity {
    key: string;
    type: "project" | "machine" | "system";
    label: string;
    totalCount: number;
    recentCount: number;
    lastActivity: number;
    typeCounts: Record<string, number>;
    hasActiveSession: boolean;
    projectId?: string;
    machineId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_WINDOW_MS = 30 * 60 * 1000;

const TYPE_PREFIX_ORDER = ["task", "session", "supervisor", "memory", "trigger", "decision"];

const TYPE_COLORS: Record<string, string> = {
    task: "#3B82F6",
    session: "#22C55E",
    supervisor: "#F59E0B",
    memory: "#8B5CF6",
    trigger: "#EC4899",
    decision: "#EF4444",
};

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    task: "flash",
    session: "terminal",
    supervisor: "shield",
    memory: "library",
    trigger: "alarm",
    decision: "alert-circle",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTypePrefix(eventType: string): string {
    return eventType.split(".")[0] ?? "other";
}

function relativeTime(ts: number, now: number): string {
    const diff = now - ts;
    if (diff < 60_000) return t("inbox.justNow");
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return t("inbox.minutesAgo", mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("inbox.hoursAgo", hrs);
    return t("inbox.daysAgo", Math.floor(hrs / 24));
}

function buildSourceLabel(event: WorldEvent): string {
    if (event.source.projectPath) {
        return event.source.projectPath.split("/").filter(Boolean).pop() ?? event.source.projectPath;
    }
    if (event.source.projectId) return event.source.projectId.slice(0, 12);
    if (event.source.machineId) return event.source.machineId.slice(0, 12);
    return "system";
}

function buildSourceKey(event: WorldEvent): string {
    if (event.source.projectId) return `project:${event.source.projectId}`;
    if (event.source.machineId) return `machine:${event.source.machineId}`;
    return "system";
}

function computeDensities(events: WorldEvent[]): SourceDensity[] {
    const now = Date.now();
    const bySource = new Map<string, SourceDensity>();

    for (const ev of events) {
        const key = buildSourceKey(ev);
        if (!bySource.has(key)) {
            const label = buildSourceLabel(ev);
            const type: SourceDensity["type"] =
                ev.source.projectId ? "project"
                    : ev.source.machineId ? "machine"
                        : "system";
            bySource.set(key, {
                key,
                type,
                label,
                totalCount: 0,
                recentCount: 0,
                lastActivity: 0,
                typeCounts: {},
                hasActiveSession: false,
                projectId: ev.source.projectId ?? undefined,
                machineId: ev.source.machineId ?? undefined,
            });
        }

        const d = bySource.get(key)!;
        d.totalCount++;
        if (now - ev.occurredAt < RECENT_WINDOW_MS) {
            d.recentCount++;
        }
        if (ev.occurredAt > d.lastActivity) {
            d.lastActivity = ev.occurredAt;
        }
        const prefix = getTypePrefix(ev.eventType);
        d.typeCounts[prefix] = (d.typeCounts[prefix] ?? 0) + 1;

        if (
            ev.source.sessionId &&
            (ev.eventType === "session.started" || ev.eventType === "task.running")
        ) {
            d.hasActiveSession = true;
        }
    }

    return Array.from(bySource.values()).sort(
        (a, b) => b.recentCount - a.recentCount || b.lastActivity - a.lastActivity,
    );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorldDensityModeProps {
    events: WorldEvent[];
    loading: boolean;
    onRefresh: () => void;
    onNavigateToStream: (filter: WorldFilter) => void;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export const WorldDensityMode = React.memo(function WorldDensityMode({
    events,
    loading,
    onRefresh,
    onNavigateToStream,
}: WorldDensityModeProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();

    const densities = React.useMemo(() => computeDensities(events), [events]);

    const maxRecent = React.useMemo(
        () => Math.max(...densities.map((d) => d.recentCount), 1),
        [densities],
    );

    if (densities.length === 0 && !loading) {
        return (
            <ScrollView
                style={styles.flex1}
                contentContainerStyle={styles.empty}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
            >
                <Ionicons name="radio-outline" size={40} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>{t("world.densityEmpty")}</Text>
                <Text style={styles.emptyDesc}>{t("world.densityEmptyDesc")}</Text>
            </ScrollView>
        );
    }

    return (
        <ScrollView
            style={styles.flex1}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        >
            {densities.map((d) => (
                <DensityCard
                    key={d.key}
                    density={d}
                    heat={maxRecent > 0 ? d.recentCount / maxRecent : 0}
                    onPress={onNavigateToStream}
                />
            ))}
        </ScrollView>
    );
});

// ─── DensityCard ──────────────────────────────────────────────────────────────

interface DensityCardProps {
    density: SourceDensity;
    heat: number;
    onPress: (filter: WorldFilter) => void;
}

const DensityCard = React.memo(function DensityCard({ density, heat, onPress }: DensityCardProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const now = Date.now();

    const heatColor =
        heat > 0.7
            ? theme.colors.success
            : heat > 0.3
                ? theme.colors.warning
                : theme.colors.textSecondary;

    const filter: WorldFilter = density.projectId
        ? { projectId: density.projectId }
        : density.machineId
            ? { machineId: density.machineId }
            : {};

    const typeEntries = TYPE_PREFIX_ORDER.map((p) => ({
        prefix: p,
        count: density.typeCounts[p] ?? 0,
    })).filter((e) => e.count > 0);

    const totalForBar = typeEntries.reduce((s, e) => s + e.count, 0) || 1;

    const sourceIcon: keyof typeof Ionicons.glyphMap =
        density.type === "project"
            ? "folder-outline"
            : density.type === "machine"
                ? "hardware-chip-outline"
                : "globe-outline";

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={() => onPress(filter)}
            activeOpacity={0.7}
        >
            {/* Heat bar at top */}
            <View style={styles.heatBarTrack}>
                <View
                    style={[
                        styles.heatBarFill,
                        {
                            width: `${Math.max(heat * 100, 4)}%` as `${number}%`,
                            backgroundColor: heatColor,
                        },
                    ]}
                />
            </View>

            <View style={styles.cardBody}>
                {/* Header: icon + label + active dot + chevron */}
                <View style={styles.headerRow}>
                    <Ionicons name={sourceIcon} size={14} color={theme.colors.textSecondary} />
                    <Text style={styles.sourceLabel} numberOfLines={1}>{density.label}</Text>
                    {density.hasActiveSession && (
                        <View style={[styles.activeDot, { backgroundColor: theme.colors.success }]} />
                    )}
                    <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
                </View>

                {/* Stats: total / recent / last activity */}
                <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                        <Text style={[styles.statCount, { color: theme.colors.text }]}>
                            {density.totalCount}
                        </Text>
                        <Text style={styles.statLabel}>{t("world.densityTotal")}</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Text style={[styles.statCount, { color: heatColor }]}>
                            {density.recentCount}
                        </Text>
                        <Text style={styles.statLabel}>{t("world.densityRecent")}</Text>
                    </View>
                    <View style={[styles.statBox, styles.statBoxRight]}>
                        <Text style={[styles.statCount, styles.statCountSmall, { color: theme.colors.textSecondary }]}>
                            {density.lastActivity > 0 ? relativeTime(density.lastActivity, now) : "—"}
                        </Text>
                        <Text style={styles.statLabel}>{t("world.densityLastActivity")}</Text>
                    </View>
                </View>

                {/* Type distribution bar */}
                {typeEntries.length > 0 && (
                    <View style={styles.distBar}>
                        {typeEntries.map(({ prefix, count }) => (
                            <View
                                key={prefix}
                                style={[
                                    styles.distSegment,
                                    {
                                        flex: count / totalForBar,
                                        backgroundColor: TYPE_COLORS[prefix] ?? theme.colors.surfaceHighest,
                                    },
                                ]}
                            />
                        ))}
                    </View>
                )}

                {/* Type legend */}
                {typeEntries.length > 0 && (
                    <View style={styles.typeRow}>
                        {typeEntries.map(({ prefix, count }) => (
                            <TypeChip key={prefix} prefix={prefix} count={count} />
                        ))}
                    </View>
                )}
            </View>
        </TouchableOpacity>
    );
});

// ─── TypeChip ─────────────────────────────────────────────────────────────────

function TypeChip({ prefix, count }: { prefix: string; count: number }) {
    const { theme } = useUnistyles();
    const color = TYPE_COLORS[prefix] ?? theme.colors.textSecondary;
    const icon = TYPE_ICONS[prefix] ?? "ellipse";
    return (
        <View style={typeChipStyle}>
            <Ionicons name={icon} size={12} color={color} />
            <Text style={{ fontSize: 12, color: theme.colors.text, fontWeight: "500" }}>
                {count}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                {prefix}
            </Text>
        </View>
    );
}

const typeChipStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginRight: 12,
    marginBottom: 2,
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        flex1: {
            flex: 1,
        },
        list: {
            padding: 16,
            gap: 12,
        },
        empty: {
            alignItems: "center",
            paddingTop: 80,
            paddingHorizontal: 32,
            gap: 12,
        },
        emptyTitle: {
            fontSize: 18,
            fontWeight: "600",
            color: theme.colors.text,
        },
        emptyDesc: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            lineHeight: 20,
        },
        card: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 14,
            overflow: "hidden",
        },
        heatBarTrack: {
            height: 4,
            backgroundColor: theme.colors.divider,
        },
        heatBarFill: {
            height: 4,
            borderRadius: 2,
        },
        cardBody: {
            padding: 14,
            gap: 10,
        },
        headerRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
        },
        sourceLabel: {
            flex: 1,
            fontSize: 15,
            fontWeight: "600",
            color: theme.colors.text,
        },
        activeDot: {
            width: 7,
            height: 7,
            borderRadius: 3.5,
        },
        statsRow: {
            flexDirection: "row",
            gap: 8,
        },
        statBox: {
            flex: 1,
            gap: 2,
        },
        statBoxRight: {
            flex: 2,
            alignItems: "flex-end",
        },
        statCount: {
            fontSize: 22,
            fontWeight: "700",
            lineHeight: 26,
        },
        statCountSmall: {
            fontSize: 13,
            fontWeight: "500",
        },
        statLabel: {
            fontSize: 10,
            color: theme.colors.textSecondary,
            textTransform: "uppercase" as const,
            letterSpacing: 0.4,
        },
        distBar: {
            height: 4,
            borderRadius: 2,
            flexDirection: "row",
            overflow: "hidden",
        },
        distSegment: {
            height: 4,
        },
        typeRow: {
            flexDirection: "row",
            flexWrap: "wrap",
        },
    });
    return { styles };
};
