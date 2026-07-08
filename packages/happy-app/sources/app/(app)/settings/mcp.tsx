import * as React from "react";
import { View, Text, TextInput, ActivityIndicator, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import {
    machineListMcpServers,
    machineListAvailableMcpServers,
    machineMcpAdd,
    machineMcpRemove,
} from "@/sync/ops";
import type { McpServerInfo, AvailableMcpServer } from "@/sync/ops";
import { Modal } from "@/modal";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { extractMachineError } from "@/utils/machineUtils";
import { findOnlineMachineId } from "@/utils/onlineMachine";

/** Category labels */
function getCategoryLabel(category: string): string {
    switch (category) {
        case "dev": return t("settingsMcp.categoryDevelopment");
        case "knowledge": return t("settingsMcp.categoryKnowledge");
        case "search": return t("settingsMcp.categorySearch");
        case "database": return t("settingsMcp.categoryDatabase");
        case "utility": return t("settingsMcp.categoryUtility");
        case "platform": return t("settingsMcp.categoryPlatform");
        default: return category;
    }
}

function McpSettingsScreen() {
    const { theme } = useUnistyles();
    const { machineId: paramMachineId } = useLocalSearchParams<{
        machineId?: string;
    }>();

    /** Resolve machineId: prefer route param, fallback to first online. */
    const resolveMachineId = React.useCallback(
        (): string | null => paramMachineId || findOnlineMachineId(),
        [paramMachineId],
    );

    const [servers, setServers] = React.useState<readonly McpServerInfo[]>([]);
    const [availableServers, setAvailableServers] = React.useState<
        readonly AvailableMcpServer[]
    >([]);
    const [loading, setLoading] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    const [actionInProgress, setActionInProgress] = React.useState<
        Set<string>
    >(new Set());
    const [searchQuery, setSearchQuery] = React.useState("");

    const machineIdRef = React.useRef<string | null>(null);

    // Load on mount and on focus
    const loadAll = React.useCallback(async () => {
        const machineId = resolveMachineId();
        if (!machineId) return;
        machineIdRef.current = machineId;

        setLoading(true);
        try {
            const [installed, available] = await Promise.all([
                machineListMcpServers(machineId),
                machineListAvailableMcpServers(machineId),
            ]);
            setServers(installed.servers);
            setAvailableServers(available.servers);
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        React.useCallback(() => {
            loadAll();
        }, [loadAll]),
    );

    // Refresh
    const [, doRefresh] = useHappyAction(async () => {
        const machineId = resolveMachineId();
        if (!machineId) {
            Modal.toast(t("settingsMcp.noMachineOnline"));
            return;
        }
        machineIdRef.current = machineId;
        setLoading(true);
        try {
            const [installed, available] = await Promise.all([
                machineListMcpServers(machineId),
                machineListAvailableMcpServers(machineId),
            ]);
            setServers(installed.servers);
            setAvailableServers(available.servers);
            setLoaded(true);
            Modal.toast(t("settingsMcp.refreshSuccess"));
        } finally {
            setLoading(false);
        }
    });

    // Install from catalog
    const doInstall = React.useCallback(
        async (server: AvailableMcpServer) => {
            const machineId = machineIdRef.current ?? resolveMachineId();
            if (!machineId) {
                Modal.toast(t("settingsMcp.noMachineOnline"));
                return;
            }

            const command = `npx -y ${server.pkg}`;

            setActionInProgress((prev) => new Set([...prev, server.name]));
            try {
                const result = await machineMcpAdd(
                    machineId,
                    server.name,
                    command,
                );
                if (result.success) {
                    Modal.toast(t("settingsMcp.addSuccess", { name: server.name }));
                    // Optimistic: add to installed list immediately
                    setServers((prev) => [
                        ...prev,
                        { name: server.name, command, status: "connected" as const },
                    ]);
                    setAvailableServers((prev) =>
                        prev.map((s) =>
                            s.name === server.name ? { ...s, installed: true } : s,
                        ),
                    );
                    // Background refresh for accurate status
                    loadAll();
                } else {
                    Modal.toast(
                        t("settingsMcp.actionFailed", {
                            error:
                                extractMachineError(result, { maxLength: 100 }),
                        }),
                    );
                }
            } finally {
                setActionInProgress((prev) => {
                    const next = new Set(prev);
                    next.delete(server.name);
                    return next;
                });
            }
        },
        [loadAll],
    );

    // Add custom server
    const doAddCustom = React.useCallback(async () => {
        const machineId = machineIdRef.current ?? resolveMachineId();
        if (!machineId) {
            Modal.toast(t("settingsMcp.noMachineOnline"));
            return;
        }

        const name = await Modal.prompt(
            t("settingsMcp.addServer"),
            t("settingsMcp.addServerName"),
            { placeholder: t("settingsMcp.addServerNamePlaceholder") },
        );
        if (!name) return;

        const command = await Modal.prompt(
            t("settingsMcp.addServer"),
            t("settingsMcp.addServerCommand"),
            { placeholder: t("settingsMcp.addServerCommandPlaceholder") },
        );
        if (!command) return;

        setActionInProgress((prev) => new Set([...prev, name]));
        try {
            const result = await machineMcpAdd(machineId, name, command);
            if (result.success) {
                Modal.toast(t("settingsMcp.addSuccess", { name }));
                // Optimistic: add to installed list immediately
                setServers((prev) => [
                    ...prev,
                    { name, command, status: "connected" as const },
                ]);
                // Background refresh
                loadAll();
            } else {
                Modal.toast(
                    t("settingsMcp.actionFailed", {
                        error:
                            extractMachineError(result, { maxLength: 100 }),
                    }),
                );
            }
        } finally {
            setActionInProgress((prev) => {
                const next = new Set(prev);
                next.delete(name);
                return next;
            });
        }
    }, [loadAll]);

    // Remove server
    const doRemove = React.useCallback(
        async (name: string) => {
            const machineId = machineIdRef.current ?? resolveMachineId();
            if (!machineId) {
                Modal.toast(t("settingsMcp.noMachineOnline"));
                return;
            }

            const confirmed = await Modal.confirm(
                t("settingsMcp.removeServer"),
                t("settingsMcp.confirmRemove", { name }),
                { destructive: true },
            );
            if (!confirmed) return;

            setActionInProgress((prev) => new Set([...prev, name]));
            try {
                const result = await machineMcpRemove(machineId, name);
                if (result.success) {
                    Modal.toast(t("settingsMcp.removeSuccess", { name }));
                    // Optimistic: remove from installed list immediately
                    setServers((prev) => prev.filter((s) => s.name !== name));
                    setAvailableServers((prev) =>
                        prev.map((s) =>
                            s.name === name ? { ...s, installed: false } : s,
                        ),
                    );
                    // Background refresh
                    loadAll();
                } else {
                    Modal.toast(
                        t("settingsMcp.actionFailed", {
                            error:
                                extractMachineError(result, { maxLength: 100 }),
                        }),
                    );
                }
            } finally {
                setActionInProgress((prev) => {
                    const next = new Set(prev);
                    next.delete(name);
                    return next;
                });
            }
        },
        [loadAll],
    );

    // Server tap → detail popup with remove option
    const showServerDetail = React.useCallback(
        async (server: McpServerInfo) => {
            const statusLabel =
                server.status === "connected"
                    ? t("settingsMcp.connected")
                    : server.status === "error"
                      ? t("settingsMcp.error")
                      : t("settingsMcp.disconnected");

            const info = t("settingsMcp.serverDetail", {
                name: server.name,
                command: server.command,
                status: statusLabel,
            });

            const shouldRemove = await Modal.confirm(
                server.name,
                info,
                {
                    confirmText: t("settingsMcp.removeServer"),
                    destructive: true,
                },
            );
            if (shouldRemove) {
                doRemove(server.name);
            }
        },
        [doRemove],
    );

    // Filter catalog by search (exclude installed)
    const filteredCatalog = React.useMemo(() => {
        const notInstalled = availableServers.filter((s) => !s.installed);
        if (!searchQuery) return notInstalled;
        const q = searchQuery.toLowerCase();
        return notInstalled.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.category.toLowerCase().includes(q),
        );
    }, [availableServers, searchQuery]);

    const styles = StyleSheet.create({
        loadingContainer: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 12,
            gap: 8,
        },
        emptyText: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            paddingVertical: 16,
            paddingHorizontal: 16,
        },
        statusBadge: {
            fontSize: 12,
            fontWeight: "500",
        },
        searchContainer: {
            paddingHorizontal: 16,
            paddingVertical: 8,
        },
        searchInput: {
            backgroundColor: theme.colors.groupped.background,
            color: theme.colors.text,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontSize: 15,
        },
        installButton: {
            paddingHorizontal: 14,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: theme.colors.groupped.background,
        },
        installButtonText: {
            color: theme.colors.primary,
            fontSize: 13,
            fontWeight: "600",
        },
        envHint: {
            fontSize: 11,
            color: theme.colors.warning,
            marginTop: 2,
        },
    });

    return (
        <ItemList>
            {/* ── Installed MCP Servers ── */}
            <ItemGroup title={t("settingsMcp.servers")}>
                {loading && !loaded && (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.primary}
                        />
                    </View>
                )}
                {loaded && servers.length === 0 && (
                    <View>
                        <Text style={styles.emptyText}>
                            {t("settingsMcp.noServers")}
                        </Text>
                    </View>
                )}
                {servers.map((server) => (
                    <Item
                        key={server.name}
                        title={server.name}
                        subtitle={server.command}
                        icon={
                            actionInProgress.has(server.name) ? (
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.primary}
                                />
                            ) : (
                                <Ionicons
                                    name={
                                        server.status === "connected"
                                            ? "checkmark-circle"
                                            : server.status === "error"
                                              ? "alert-circle"
                                              : "close-circle"
                                    }
                                    size={22}
                                    color={
                                        server.status === "connected"
                                            ? theme.colors.success
                                            : server.status === "error"
                                              ? theme.colors.warning
                                              : theme.colors.textSecondary
                                    }
                                />
                            )
                        }
                        rightElement={
                            <Text
                                style={[
                                    styles.statusBadge,
                                    {
                                        color:
                                            server.status === "connected"
                                                ? theme.colors.success
                                                : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {server.status === "connected"
                                    ? t("settingsMcp.connected")
                                    : server.status === "error"
                                      ? t("settingsMcp.error")
                                      : t("settingsMcp.disconnected")}
                            </Text>
                        }
                        onPress={() => showServerDetail(server)}
                    />
                ))}
            </ItemGroup>

            {/* ── Available MCP Servers (Catalog) ── */}
            {loaded && availableServers.length > 0 && (
                <ItemGroup
                    title={`${t("settingsMcp.availableServers")} (${filteredCatalog.length})`}
                >
                    <View style={styles.searchContainer}>
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t("settingsMcp.searchServers")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                    {filteredCatalog.map((server) => (
                        <Item
                            key={server.name}
                            title={server.name}
                            subtitle={server.description}
                            detail={
                                getCategoryLabel(server.category) ??
                                server.category
                            }
                            icon={
                                <Ionicons
                                    name="server-outline"
                                    size={20}
                                    color={theme.colors.textSecondary}
                                />
                            }
                            onPress={async () => {
                                const info = [
                                    server.description,
                                    "",
                                    `Package: ${server.pkg}`,
                                    `Category: ${getCategoryLabel(server.category) ?? server.category}`,
                                    server.envHint
                                        ? `\n⚠️ Requires: ${server.envHint}`
                                        : "",
                                ]
                                    .filter(Boolean)
                                    .join("\n");

                                const shouldInstall = await Modal.confirm(
                                    server.name,
                                    info,
                                    {
                                        confirmText: t(
                                            "settingsMcp.install",
                                        ),
                                    },
                                );
                                if (shouldInstall) {
                                    doInstall(server);
                                }
                            }}
                            rightElement={
                                actionInProgress.has(server.name) ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.primary}
                                    />
                                ) : (
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.installButton,
                                            pressed && { opacity: 0.7 },
                                        ]}
                                        onPress={() => doInstall(server)}
                                    >
                                        <Text style={styles.installButtonText}>
                                            {t("settingsMcp.install")}
                                        </Text>
                                    </Pressable>
                                )
                            }
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* ── Actions ── */}
            <ItemGroup>
                <Item
                    title={t("settingsMcp.addServer")}
                    subtitle={t("settingsMcp.addServerCustom")}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={24}
                            color={theme.colors.accentBlue}
                        />
                    }
                    onPress={doAddCustom}
                />
                <Item
                    title={t("settingsMcp.refresh")}
                    icon={
                        loading ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.primary}
                            />
                        ) : (
                            <Ionicons
                                name="refresh-outline"
                                size={24}
                                color={theme.colors.accentBlue}
                            />
                        )
                    }
                    onPress={doRefresh}
                    disabled={loading}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(McpSettingsScreen);
