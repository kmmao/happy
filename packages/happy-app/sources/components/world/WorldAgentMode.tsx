import * as React from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity, LayoutAnimation } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { storage } from "@/sync/storage";
import { useShallow } from "zustand/react/shallow";
import type { Session, Machine } from "@/sync/storageTypes";

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentStatus = "running" | "thinking" | "requires_action" | "idle" | "stuck";

interface AgentSessionInfo {
    session: Session;
    displayName: string;
    status: AgentStatus;
}

interface AgentMachineGroup {
    machineId: string | null;
    machineLabel: string;
    isOnline: boolean;
    activeSessions: AgentSessionInfo[];
    recentSessions: AgentSessionInfo[];
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
const RECENT_WINDOW_MS = 30 * 60 * 1000;

const STATUS_PRIORITY: Record<AgentStatus, number> = {
    running: 0,
    thinking: 1,
    requires_action: 2,
    stuck: 3,
    idle: 4,
};

function getSessionStatus(session: Session, now: number): AgentStatus {
    if (session.thinking) return "thinking";
    if (session.sdkSessionState === "requires_action") return "requires_action";
    if (session.sdkSessionState === "running") return "running";
    if (session.active && (now - session.activeAt) > STUCK_THRESHOLD_MS) return "stuck";
    return "idle";
}

function getSessionDisplayName(session: Session): string {
    const path = session.metadata?.path;
    if (path) return path.split("/").filter(Boolean).pop() ?? path;
    if (session.metadata?.displayName) return session.metadata.displayName;
    return session.id.slice(0, 12);
}

function getMachineLabel(machineId: string | null, machine?: Machine): string {
    if (!machineId) return "Unknown";
    if (machine?.metadata?.displayName) return machine.metadata.displayName;
    if (machine?.metadata?.host) return machine.metadata.host;
    return machineId.slice(0, 12);
}

function relativeTime(ts: number, now: number): string {
    const diffMs = now - ts;
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
}

// ─── Data hook ───────────────────────────────────────────────────────────────

function useAgentMachineGroups(tick: number): AgentMachineGroup[] {
    const sessions = storage(useShallow((s) => s.sessions));
    const machines = storage(useShallow((s) => s.machines));

    return React.useMemo(() => {
        const now = Date.now();
        const byMachine = new Map<string | null, { active: AgentSessionInfo[]; recent: AgentSessionInfo[] }>();

        for (const session of Object.values(sessions)) {
            const isActive = session.active;
            const isRecent = !isActive && (now - session.updatedAt) < RECENT_WINDOW_MS;
            if (!isActive && !isRecent) continue;

            const machineId = session.metadata?.machineId ?? null;
            if (!byMachine.has(machineId)) {
                byMachine.set(machineId, { active: [], recent: [] });
            }

            const info: AgentSessionInfo = {
                session,
                displayName: getSessionDisplayName(session),
                status: getSessionStatus(session, now),
            };

            if (isActive) {
                byMachine.get(machineId)!.active.push(info);
            } else {
                byMachine.get(machineId)!.recent.push(info);
            }
        }

        const sortSessions = (list: AgentSessionInfo[]) =>
            list
                .slice()
                .sort(
                    (a, b) =>
                        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
                        b.session.activeAt - a.session.activeAt,
                );

        const groups: AgentMachineGroup[] = [];
        for (const [machineId, { active, recent }] of byMachine) {
            const machine = machineId ? machines[machineId] : undefined;
            groups.push({
                machineId,
                machineLabel: getMachineLabel(machineId, machine),
                isOnline: machine?.connected === true,
                activeSessions: sortSessions(active),
                recentSessions: sortSessions(recent).slice(0, 3),
            });
        }

        return groups.sort((a, b) => {
            const score = (g: AgentMachineGroup) =>
                g.activeSessions.length > 0 ? (g.isOnline ? 0 : 1) : 2;
            return score(a) - score(b) || b.activeSessions.length - a.activeSessions.length;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, machines, tick]);
}

// ─── Root component ───────────────────────────────────────────────────────────

export const WorldAgentMode = React.memo(function WorldAgentMode() {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const [tick, setTick] = React.useState(0);
    const [loading, setLoading] = React.useState(false);

    const groups = useAgentMachineGroups(tick);

    const onRefresh = React.useCallback(() => {
        setLoading(true);
        setTick((v) => v + 1);
        setTimeout(() => setLoading(false), 400);
    }, []);

    if (groups.length === 0) {
        return (
            <ScrollView
                contentContainerStyle={styles.empty}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
            >
                <Ionicons name="hardware-chip-outline" size={40} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>{t("world.noAgents")}</Text>
                <Text style={styles.emptyDescription}>{t("world.agentModeEmptyDescription")}</Text>
            </ScrollView>
        );
    }

    return (
        <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        >
            {groups.map((group) => (
                <MachineCard key={group.machineId ?? "_no_machine"} group={group} />
            ))}
        </ScrollView>
    );
});

// ─── MachineCard ──────────────────────────────────────────────────────────────

const MachineCard = React.memo(function MachineCard({ group }: { group: AgentMachineGroup }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();

    const hasRunning = group.activeSessions.some(
        (s) => s.status === "running" || s.status === "thinking",
    );
    const hasStuck = group.activeSessions.some((s) => s.status === "stuck");

    const dotColor = !group.isOnline
        ? theme.colors.textSecondary
        : hasRunning
            ? theme.colors.success
            : hasStuck
                ? theme.colors.warning
                : theme.colors.textSecondary;

    const [expanded, setExpanded] = React.useState(group.activeSessions.length > 0);

    const toggle = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
    }, []);

    const allSessions = [...group.activeSessions, ...group.recentSessions];

    return (
        <TouchableOpacity style={styles.card} onPress={toggle} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
                <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                <Text style={styles.machineName} numberOfLines={1}>{group.machineLabel}</Text>
                {group.activeSessions.length > 0 && (
                    <View style={[styles.badge, hasRunning && styles.badgeActive]}>
                        <Text style={styles.badgeText}>{group.activeSessions.length}</Text>
                    </View>
                )}
                {!group.isOnline && (
                    <Text style={styles.offlineLabel}>offline</Text>
                )}
                <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.colors.textSecondary}
                />
            </View>

            {expanded && allSessions.length > 0 && (
                <View style={styles.sessionList}>
                    {allSessions.map((info) => (
                        <SessionRow key={info.session.id} info={info} />
                    ))}
                </View>
            )}

            {expanded && allSessions.length === 0 && (
                <Text style={styles.noSessions}>No sessions</Text>
            )}
        </TouchableOpacity>
    );
});

// ─── SessionRow ───────────────────────────────────────────────────────────────

const STATUS_ICON: Record<AgentStatus, keyof typeof Ionicons.glyphMap> = {
    running: "flash",
    thinking: "ellipsis-horizontal",
    requires_action: "alert-circle",
    stuck: "pause-circle",
    idle: "radio-button-on",
};

const SessionRow = React.memo(function SessionRow({ info }: { info: AgentSessionInfo }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const now = Date.now();

    const statusColor =
        info.status === "running" || info.status === "thinking"
            ? theme.colors.success
            : info.status === "requires_action"
                ? theme.colors.warning
                : info.status === "stuck"
                    ? theme.colors.warningCritical
                    : theme.colors.textSecondary;

    const handlePress = React.useCallback(() => {
        router.push(`/(app)/session/${info.session.id}`);
    }, [info.session.id, router]);

    return (
        <TouchableOpacity style={styles.sessionRow} onPress={handlePress} activeOpacity={0.6}>
            <Ionicons name={STATUS_ICON[info.status]} size={14} color={statusColor} />
            <Text style={styles.sessionName} numberOfLines={1}>{info.displayName}</Text>
            {info.session.needsAttention && (
                <View style={[styles.attentionDot, { backgroundColor: theme.colors.warning }]} />
            )}
            <Text style={[styles.statusLabel, { color: statusColor }]}>{info.status}</Text>
            <Text style={styles.timeLabel}>{relativeTime(info.session.activeAt, now)}</Text>
            <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
        </TouchableOpacity>
    );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
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
        emptyDescription: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            lineHeight: 20,
        },
        card: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 12,
            padding: 14,
            gap: 10,
        },
        cardHeader: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        statusDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        machineName: {
            flex: 1,
            fontSize: 15,
            fontWeight: "600",
            color: theme.colors.text,
        },
        badge: {
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 10,
            backgroundColor: theme.colors.surfaceHighest,
        },
        badgeActive: {
            backgroundColor: theme.colors.success + "33",
        },
        badgeText: {
            fontSize: 12,
            color: theme.colors.text,
            fontWeight: "600",
        },
        offlineLabel: {
            fontSize: 11,
            color: theme.colors.textSecondary,
        },
        sessionList: {
            gap: 4,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            paddingTop: 8,
        },
        noSessions: {
            fontSize: 13,
            color: theme.colors.textSecondary,
            paddingTop: 4,
        },
        sessionRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 5,
        },
        sessionName: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
        },
        attentionDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
        },
        statusLabel: {
            fontSize: 11,
            fontWeight: "500",
        },
        timeLabel: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 48,
            textAlign: "right",
        },
    });
    return { styles };
};
