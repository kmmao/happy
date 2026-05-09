import * as React from "react";
import { View, FlatList, RefreshControl, TouchableOpacity, TextInput } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { useProjects, useAllMachines } from "@/sync/storage";
import { useWorldEvents } from "./useWorldEvents";
import { WorldEventCard } from "./WorldEventCard";
import { WorldFilterChips } from "./WorldFilterChips";
import { WorldDefinitionPanel } from "./WorldDefinitionPanel";
import { WorldChainMode } from "./WorldChainMode";
import { WorldAgentMode } from "./WorldAgentMode";
import type { WorldEvent, WorldFilter } from "./worldTypes";

type ViewMode = "stream" | "chain" | "agents";

interface WorldShellProps {
    onExit?: () => void;
}

export const WorldShell = React.memo(function WorldShell({ onExit }: WorldShellProps) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { styles } = useStyles();

    const projects = useProjects();
    const machines = useAllMachines();
    const [filter, setFilter] = React.useState<WorldFilter>({});
    const [panelOpen, setPanelOpen] = React.useState(false);
    const [viewMode, setViewMode] = React.useState<ViewMode>("stream");
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");

    const { events, loading, refresh } = useWorldEvents(filter);

    const displayEvents = React.useMemo(() => {
        if (!searchQuery.trim() || searchQuery.startsWith("/")) return events;
        const q = searchQuery.toLowerCase();
        return events.filter((e) =>
            e.title.toLowerCase().includes(q) ||
            e.eventType.toLowerCase().includes(q) ||
            (e.summary && e.summary.toLowerCase().includes(q)),
        );
    }, [events, searchQuery]);

    // Slash command definitions
    const slashCommands = React.useMemo(() => {
        const base = [
            { cmd: "/new", label: "New Session", icon: "chatbubble-outline" as const, action: () => { router.push("/(app)/new"); setSearchOpen(false); setSearchQuery(""); } },
            { cmd: "/sessions", label: "Go to Session List", icon: "list-outline" as const, action: () => { setSearchOpen(false); setSearchQuery(""); if (onExit) { onExit(); } else if (router.canGoBack()) { router.back(); } else { router.replace("/"); } } },
            { cmd: "/knowledge", label: "Search Knowledge Base", icon: "library-outline" as const, action: () => { router.push("/(app)/knowledge/search"); setSearchOpen(false); setSearchQuery(""); } },
        ];
        const taskCmds = machines.slice(0, 3).map((m) => {
            const mName = m.metadata?.displayName || m.metadata?.host || m.id.slice(0, 8);
            return {
                cmd: `/task ${mName}`,
                label: `New Task — ${mName}`,
                icon: "play-outline" as const,
                action: () => { router.push(`/(app)/machine/${m.id}/task/new`); setSearchOpen(false); setSearchQuery(""); },
            };
        });
        return [...base, ...taskCmds];
    }, [machines, router, onExit]);

    const matchedCommands = React.useMemo(() => {
        if (!searchQuery.startsWith("/")) return [];
        const q = searchQuery.toLowerCase();
        return slashCommands.filter((c) => c.cmd.startsWith(q));
    }, [searchQuery, slashCommands]);

    const projectChipInfos = React.useMemo(
        () => projects.filter((p) => !p.archived).map((p) => {
            const path = p.key?.path ?? "";
            const label = path.split("/").filter(Boolean).pop() ?? p.id.slice(0, 10);
            return { id: p.id, label };
        }),
        [projects],
    );


    const pendingDecisions = events.filter((e) =>
        e.eventType.startsWith("decision."),
    ).length;

    const activeAgents = events.filter(
        (e) => e.eventType === "task.running" || e.eventType === "session.started",
    ).length;

    const handleExit = React.useCallback(() => {
        if (onExit) {
            onExit();
        } else if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/");
        }
    }, [router, onExit]);

    const renderItem = React.useCallback(
        ({ item }: { item: WorldEvent }) => <WorldEventCard event={item} />,
        [],
    );

    const keyExtractor = React.useCallback((item: WorldEvent) => item.id, []);

    const ListEmpty = (
        <View style={styles.empty}>
            <Ionicons name="globe" size={48} color={theme.colors.primary} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyTitle}>{t("world.emptyTitle")}</Text>
            <Text style={styles.emptyDescription}>{t("world.emptyDescription")}</Text>
        </View>
    );

    const totalEvents = events.length;
    const statusColor = pendingDecisions > 0
        ? theme.colors.warningCritical
        : activeAgents > 0
            ? theme.colors.success
            : theme.colors.textSecondary;

    return (
        <View style={styles.container}>
            {/* Header with SafeArea */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    style={styles.worldButton}
                    onPress={() => setPanelOpen((v) => !v)}
                    activeOpacity={0.7}
                >
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={styles.worldTitle}>{t("world.title")}</Text>
                    <Ionicons
                        name={panelOpen ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={theme.colors.textSecondary}
                    />
                </TouchableOpacity>

                <View style={styles.stats}>
                    <View style={styles.badge}>
                        <Ionicons name="pulse-outline" size={12} color={theme.colors.textSecondary} />
                        <Text style={styles.badgeText}>{totalEvents}</Text>
                    </View>
                    {activeAgents > 0 && (
                        <View style={[styles.badge, styles.badgeActive]}>
                            <Ionicons name="flash" size={12} color={theme.colors.success} />
                            <Text style={styles.badgeText}>{activeAgents}</Text>
                        </View>
                    )}
                    {pendingDecisions > 0 && (
                        <View style={[styles.badge, styles.badgeDecision]}>
                            <Ionicons name="alert-circle" size={12} color={theme.colors.warningCritical} />
                            <Text style={styles.badgeText}>{pendingDecisions}</Text>
                        </View>
                    )}
                </View>

                <TouchableOpacity
                    onPress={() => {
                        setSearchOpen((v) => {
                            if (v) setSearchQuery("");
                            return !v;
                        });
                    }}
                    style={styles.newSessionButton}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name={searchOpen ? "search-circle" : "search"}
                        size={20}
                        color={searchOpen ? theme.colors.primary : theme.colors.textSecondary}
                    />
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={() => router.push("/(app)/new")}
                    style={styles.newSessionButton}
                    activeOpacity={0.7}
                >
                    <Ionicons name="add" size={22} color={theme.colors.primary} />
                </TouchableOpacity>

                <TouchableOpacity onPress={handleExit} style={styles.exitButton}>
                    <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                </TouchableOpacity>
            </View>

            {/* World Definition Panel */}
            <WorldDefinitionPanel visible={panelOpen} />

            {/* View Mode Toggle + Filter Chips */}
            <View style={styles.modeRow}>
                <TouchableOpacity
                    style={[styles.modeTab, viewMode === "stream" && styles.modeTabActive]}
                    onPress={() => setViewMode("stream")}
                >
                    <Text style={[styles.modeTabText, viewMode === "stream" && styles.modeTabTextActive]}>
                        {t("world.streamMode")}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.modeTab, viewMode === "chain" && styles.modeTabActive]}
                    onPress={() => setViewMode("chain")}
                >
                    <Text style={[styles.modeTabText, viewMode === "chain" && styles.modeTabTextActive]}>
                        {t("world.chainMode")}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.modeTab, viewMode === "agents" && styles.modeTabActive]}
                    onPress={() => setViewMode("agents")}
                >
                    <Text style={[styles.modeTabText, viewMode === "agents" && styles.modeTabTextActive]}>
                        {t("world.agentMode")}
                    </Text>
                </TouchableOpacity>
            </View>

            {viewMode === "stream" && (
                <WorldFilterChips
                    activeFilter={filter}
                    onFilterChange={setFilter}
                    projects={projectChipInfos}
                />
            )}

            {/* Search / command bar */}
            {viewMode === "stream" && searchOpen && (
                <>
                    <View style={styles.searchBar}>
                        <Ionicons
                            name={searchQuery.startsWith("/") ? "flash-outline" : "search"}
                            size={16}
                            color={searchQuery.startsWith("/") ? theme.colors.primary : theme.colors.textSecondary}
                            style={{ marginRight: 8 }}
                        />
                        <TextInput
                            style={styles.searchInput}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search or type / for commands…"
                            placeholderTextColor={theme.colors.textSecondary}
                            autoFocus
                            clearButtonMode="while-editing"
                        />
                    </View>
                    {matchedCommands.length > 0 && (
                        <View style={styles.commandList}>
                            {matchedCommands.map((cmd) => (
                                <TouchableOpacity
                                    key={cmd.cmd}
                                    style={styles.commandItem}
                                    onPress={cmd.action}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name={cmd.icon} size={16} color={theme.colors.primary} />
                                    <View style={{ marginLeft: 10 }}>
                                        <Text style={styles.commandCmd}>{cmd.cmd}</Text>
                                        <Text style={styles.commandLabel}>{cmd.label}</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </>
            )}

            {/* Content */}
            {viewMode === "stream" ? (
                <FlatList
                    data={displayEvents}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    ListEmptyComponent={loading ? null : ListEmpty}
                    refreshControl={
                        <RefreshControl refreshing={loading} onRefresh={refresh} />
                    }
                    contentContainerStyle={styles.list}
                />
            ) : viewMode === "chain" ? (
                <WorldChainMode events={events} loading={loading} onRefresh={refresh} />
            ) : (
                <WorldAgentMode />
            )}
        </View>
    );
});

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: theme.colors.surface,
        },
        header: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingBottom: 10,
            backgroundColor: theme.colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        statusDot: {
            width: 10,
            height: 10,
            borderRadius: 5,
        },
        worldButton: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flex: 1,
        },
        worldTitle: {
            fontSize: 17,
            fontWeight: "600",
            color: theme.colors.text,
        },
        stats: {
            flexDirection: "row",
            gap: 6,
            marginHorizontal: 8,
        },
        badge: {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: theme.colors.surfaceHigh,
        },
        badgeActive: {
            backgroundColor: theme.colors.surfaceHighest,
        },
        badgeDecision: {
            backgroundColor: theme.colors.surfaceHighest,
        },
        badgeText: {
            fontSize: 12,
            color: theme.colors.text,
        },
        newSessionButton: {
            padding: 6,
            borderRadius: 16,
        },
        exitButton: {
            padding: 8,
            borderRadius: 16,
        },
        searchBar: {
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 16,
            marginTop: 6,
            marginBottom: 2,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: theme.colors.surfaceHigh,
        },
        searchInput: {
            flex: 1,
            fontSize: 14,
            color: theme.colors.text,
        },
        commandList: {
            marginHorizontal: 16,
            marginTop: 4,
            borderRadius: 10,
            backgroundColor: theme.colors.surfaceHigh,
            overflow: "hidden",
        },
        commandItem: {
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        commandCmd: {
            fontSize: 13,
            fontWeight: "600",
            color: theme.colors.primary,
        },
        commandLabel: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginTop: 1,
        },
        modeRow: {
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingTop: 8,
            gap: 4,
        },
        modeTab: {
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 14,
        },
        modeTabActive: {
            backgroundColor: theme.colors.primary,
        },
        modeTabText: {
            fontSize: 13,
            color: theme.colors.textSecondary,
        },
        modeTabTextActive: {
            color: "#fff",
            fontWeight: "600",
        },
        list: {
            paddingTop: 8,
            paddingBottom: 24,
        },
        empty: {
            alignItems: "center",
            paddingTop: 80,
            paddingHorizontal: 32,
        },
        emptyTitle: {
            fontSize: 20,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 8,
        },
        emptyDescription: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            lineHeight: 20,
        },
    });
    return { styles };
};
