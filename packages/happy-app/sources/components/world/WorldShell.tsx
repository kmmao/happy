import * as React from "react";
import { View, FlatList, RefreshControl, TouchableOpacity } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { useProjects } from "@/sync/storage";
import { useWorldEvents } from "./useWorldEvents";
import { WorldEventCard } from "./WorldEventCard";
import { WorldFilterChips } from "./WorldFilterChips";
import { WorldDefinitionPanel } from "./WorldDefinitionPanel";
import type { WorldEvent, WorldFilter, WorldDefinition } from "./worldTypes";

function extractDefinition(
    supervisorConfig: string | null | undefined,
    supervisorMode: string | null | undefined,
): WorldDefinition {
    if (!supervisorConfig) {
        return { narrative: null, laws: null, policy: supervisorMode ?? null };
    }
    try {
        const parsed = JSON.parse(supervisorConfig) as {
            narrative?: string | null;
            laws?: string | null;
        };
        return {
            narrative: parsed.narrative ?? null,
            laws: parsed.laws ?? null,
            policy: supervisorMode ?? null,
        };
    } catch {
        return { narrative: null, laws: null, policy: supervisorMode ?? null };
    }
}

export const WorldShell = React.memo(function WorldShell() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { styles } = useStyles();

    const projects = useProjects();
    const [filter, setFilter] = React.useState<WorldFilter>({});
    const [panelOpen, setPanelOpen] = React.useState(false);

    const { events, loading, refresh } = useWorldEvents(filter);

    const projectIds = React.useMemo(
        () => projects.filter((p) => !p.archived).map((p) => p.id),
        [projects],
    );

    const definition = React.useMemo<WorldDefinition>(() => {
        const first = projects.find((p) => p.supervisorConfig || p.supervisorMode);
        if (!first) return { narrative: null, laws: null, policy: null };
        return extractDefinition(first.supervisorConfig, first.supervisorMode ?? null);
    }, [projects]);

    const pendingDecisions = events.filter((e) =>
        e.eventType.startsWith("decision."),
    ).length;

    const activeAgents = events.filter(
        (e) => e.eventType === "task.running" || e.eventType === "session.started",
    ).length;

    const handleExit = React.useCallback(() => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/");
        }
    }, [router]);

    const renderItem = React.useCallback(
        ({ item }: { item: WorldEvent }) => <WorldEventCard event={item} />,
        [],
    );

    const keyExtractor = React.useCallback((item: WorldEvent) => item.id, []);

    const ListEmpty = (
        <View style={styles.empty}>
            <Text style={styles.emptyText}>{t("world.noEvents")}</Text>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.worldButton}
                    onPress={() => setPanelOpen((v) => !v)}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name="globe-outline"
                        size={20}
                        color={theme.colors.primary}
                    />
                    <Text style={styles.worldTitle}>{t("world.title")}</Text>
                    <Ionicons
                        name={panelOpen ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={theme.colors.textSecondary}
                    />
                </TouchableOpacity>

                <View style={styles.stats}>
                    {activeAgents > 0 && (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>⚡ {activeAgents}</Text>
                        </View>
                    )}
                    {pendingDecisions > 0 && (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>⚠️ {pendingDecisions}</Text>
                        </View>
                    )}
                </View>

                <TouchableOpacity onPress={handleExit} style={styles.exitButton}>
                    <Text style={styles.exitText}>{t("world.exitWorld")}</Text>
                </TouchableOpacity>
            </View>

            {/* World Definition Panel */}
            <WorldDefinitionPanel definition={definition} visible={panelOpen} />

            {/* Filter Chips */}
            <WorldFilterChips
                activeFilter={filter}
                onFilterChange={setFilter}
                projectIds={projectIds}
            />

            {/* Event Stream */}
            <FlatList
                data={events}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                ListEmptyComponent={loading ? null : ListEmpty}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={refresh} />
                }
                contentContainerStyle={styles.list}
            />
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
            paddingTop: 12,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
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
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 10,
            backgroundColor: theme.colors.surfaceHigh,
        },
        badgeText: {
            fontSize: 12,
            color: theme.colors.text,
        },
        exitButton: {
            paddingHorizontal: 10,
            paddingVertical: 6,
        },
        exitText: {
            fontSize: 14,
            color: theme.colors.textLink,
        },
        list: {
            paddingTop: 8,
            paddingBottom: 24,
        },
        empty: {
            alignItems: "center",
            paddingTop: 60,
        },
        emptyText: {
            color: theme.colors.textSecondary,
            fontSize: 15,
        },
    });
    return { styles };
};
