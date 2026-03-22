import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import {
    machineListMcpServers,
    machineMcpAdd,
    machineMcpRemove,
} from "@/sync/ops";
import type { McpServerInfo } from "@/sync/ops";
import { Modal } from "@/modal";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { storage } from "@/sync/storage";

/** Find the first online machine ID from storage. */
function findOnlineMachineId(): string | null {
    const machines = storage.getState().machines;
    const online = Object.values(machines).find((m) => m.active);
    return online?.id ?? null;
}

function McpSettingsScreen() {
    const { theme } = useUnistyles();

    const [servers, setServers] = React.useState<readonly McpServerInfo[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);
    const [actionInProgress, setActionInProgress] = React.useState<
        Set<string>
    >(new Set());

    const machineIdRef = React.useRef<string | null>(null);

    // Load on mount
    const loadServers = React.useCallback(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) return;
        machineIdRef.current = machineId;

        setLoading(true);
        try {
            const result = await machineListMcpServers(machineId);
            setServers(result.servers);
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        loadServers();
    }, [loadServers]);

    // Refresh
    const [, doRefresh] = useHappyAction(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.toast(t("settingsMcp.noMachineOnline"));
            return;
        }
        machineIdRef.current = machineId;
        setLoading(true);
        try {
            const result = await machineListMcpServers(machineId);
            setServers(result.servers);
            setLoaded(true);
            Modal.toast(t("settingsMcp.refreshSuccess"));
        } finally {
            setLoading(false);
        }
    });

    // Add server
    const doAdd = React.useCallback(async () => {
        const machineId = machineIdRef.current ?? findOnlineMachineId();
        if (!machineId) {
            Modal.toast(t("settingsMcp.noMachineOnline"));
            return;
        }

        const name = await Modal.prompt(
            t("settingsMcp.addServer"),
            t("settingsMcp.addServerName"),
            {
                placeholder: t("settingsMcp.addServerNamePlaceholder"),
            },
        );
        if (!name) return;

        const command = await Modal.prompt(
            t("settingsMcp.addServer"),
            t("settingsMcp.addServerCommand"),
            {
                placeholder: t("settingsMcp.addServerCommandPlaceholder"),
            },
        );
        if (!command) return;

        setActionInProgress((prev) => new Set([...prev, name]));
        try {
            const result = await machineMcpAdd(machineId, name, command);
            if (result.success) {
                Modal.toast(t("settingsMcp.addSuccess", { name }));
                await loadServers();
            } else {
                Modal.toast(
                    t("settingsMcp.actionFailed", {
                        error:
                            result.stderr?.slice(0, 100) ||
                            result.error ||
                            "Unknown error",
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
    }, [loadServers]);

    // Remove server
    const doRemove = React.useCallback(
        async (name: string) => {
            const machineId = machineIdRef.current ?? findOnlineMachineId();
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
                    await loadServers();
                } else {
                    Modal.toast(
                        t("settingsMcp.actionFailed", {
                            error:
                                result.stderr?.slice(0, 100) ||
                                result.error ||
                                "Unknown error",
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
        [loadServers],
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
    });

    return (
        <ItemList>
            {/* ── MCP Servers ── */}
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

            {/* ── Actions ── */}
            <ItemGroup>
                <Item
                    title={t("settingsMcp.addServer")}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={24}
                            color={theme.colors.accentBlue}
                        />
                    }
                    onPress={doAdd}
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
