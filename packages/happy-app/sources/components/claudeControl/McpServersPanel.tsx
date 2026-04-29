import * as React from "react";
import { View, Text, Pressable, ScrollView, AppState, type AppStateStatus } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Modal } from "@/modal";
import { fetchMcpServers } from "@/sync/apiClaudeControl";
import { log } from "@/log";
import type { GetMcpServersResponse } from "@kmmao/happy-wire";

// Refresh every 30s while active — server state can change between turns
const REFRESH_INTERVAL_MS = 30_000;

type McpServer = GetMcpServersResponse["servers"][number];

const STATUS_COLORS: Record<McpServer["status"], string> = {
    connected: "#34C759",
    failed: "#FF3B30",
    "needs-auth": "#FF9500",
    pending: "#8E8E93",
    disabled: "#8E8E93",
};

function statusLabel(status: McpServer["status"]): string {
    switch (status) {
        case "connected": return t("claudeControl.mcpServers.statusConnected");
        case "failed": return t("claudeControl.mcpServers.statusFailed");
        case "needs-auth": return t("claudeControl.mcpServers.statusNeedsAuth");
        case "pending": return t("claudeControl.mcpServers.statusPending");
        case "disabled": return t("claudeControl.mcpServers.statusDisabled");
    }
}

interface McpServersPanelProps {
    sessionId: string;
}

/**
 * Panel showing MCP server connection status for a remote Claude session.
 * Rows with tools are tappable — tapping opens a modal listing the server's tools.
 * Refreshes every 30s while the app is foregrounded.
 */
export const McpServersPanel = React.memo(function McpServersPanel({
    sessionId,
}: McpServersPanelProps) {
    const [data, setData] = React.useState<GetMcpServersResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);
    const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);

    const refresh = React.useCallback(async () => {
        try {
            const res = await fetchMcpServers(sessionId);
            setData(res);
            setError(false);
        } catch (e) {
            log.log("[McpServersPanel] fetch failed", e);
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
                <Text style={styles.muted}>{t("claudeControl.mcpServers.loading")}</Text>
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>{t("claudeControl.mcpServers.error")}</Text>
            </View>
        );
    }

    if (data.servers.length === 0) {
        return (
            <View style={styles.container}>
                <Text style={styles.muted}>{t("claudeControl.mcpServers.noServers")}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {data.servers.map((server) => (
                <ServerRow key={server.name} server={server} />
            ))}
        </View>
    );
});

// ─── ServerRow ────────────────────────────────────────────────────────────────

const ServerRow = React.memo(function ServerRow({ server }: { server: McpServer }) {
    const { theme } = useUnistyles();
    const statusColor = STATUS_COLORS[server.status];
    const hasTools = (server.tools?.length ?? 0) > 0;

    const handlePress = React.useCallback(() => {
        Modal.show({
            component: McpToolsModal,
            props: { server },
        });
    }, [server]);

    const rowContent = (
        <View style={styles.row}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={styles.rowBody}>
                <Text style={styles.serverName} numberOfLines={1}>{server.name}</Text>
                {server.scope && (
                    <Text style={styles.scope} numberOfLines={1}>{server.scope}</Text>
                )}
                {server.error && (
                    <Text style={styles.errorText} numberOfLines={2}>{server.error}</Text>
                )}
            </View>
            <View style={styles.rowRight}>
                <Text style={[styles.statusText, { color: statusColor }]}>
                    {statusLabel(server.status)}
                </Text>
                {server.toolCount != null && server.toolCount > 0 && (
                    <Text style={styles.toolCount}>
                        {t("claudeControl.mcpServers.toolsCount").replace("{n}", String(server.toolCount))}
                    </Text>
                )}
            </View>
            {hasTools && (
                <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={theme.colors.textSecondary}
                    style={{ marginLeft: 2, marginTop: 2 }}
                />
            )}
        </View>
    );

    if (!hasTools) return rowContent;

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => [pressed && styles.rowPressed]}
        >
            {rowContent}
        </Pressable>
    );
});

// ─── McpToolsModal ────────────────────────────────────────────────────────────

interface McpToolsModalProps {
    server: McpServer;
    onClose: () => void;
}

/**
 * Modal listing all tools provided by a single MCP server.
 * Injected via Modal.show; receives onClose from the modal manager.
 */
const McpToolsModal = React.memo<McpToolsModalProps>(function McpToolsModal({
    server,
    onClose,
}) {
    const { theme } = useUnistyles();
    const c = theme.colors;

    return (
        <View style={[modalStyles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[modalStyles.header, { borderBottomColor: c.divider }]}>
                <View style={modalStyles.headerText}>
                    <Text style={[modalStyles.title, { color: c.text }]} numberOfLines={1}>
                        {server.name}
                    </Text>
                    <Text style={[modalStyles.subtitle, { color: c.textSecondary }]}>
                        {t("claudeControl.mcpServers.toolsCount").replace("{n}", String(server.tools?.length ?? 0))}
                    </Text>
                </View>
                <Pressable onPress={onClose} hitSlop={10} style={modalStyles.closeBtn}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>

            {/* Tools list */}
            <ScrollView
                style={modalStyles.scroll}
                contentContainerStyle={modalStyles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {(server.tools ?? []).map((tool) => (
                    <View
                        key={tool.name}
                        style={[modalStyles.toolRow, { borderBottomColor: c.divider }]}
                    >
                        <Text style={[modalStyles.toolName, { color: c.text }]}>
                            {tool.name}
                        </Text>
                        {tool.description ? (
                            <Text style={[modalStyles.toolDesc, { color: c.textSecondary }]}>
                                {tool.description}
                            </Text>
                        ) : null}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
});

const modalStyles = StyleSheet.create((_, rt) => ({
    container: {
        borderRadius: 16,
        overflow: "hidden",
        maxHeight: 480,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    headerText: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 15,
        fontWeight: "600",
        fontFamily: "Menlo",
    },
    subtitle: {
        fontSize: 12,
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
    toolRow: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 3,
    },
    toolName: {
        fontSize: 13,
        fontWeight: "500",
        fontFamily: "Menlo",
    },
    toolDesc: {
        fontSize: 12,
        lineHeight: 16,
    },
}));

// ─── Panel styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 6,
    },
    muted: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    errorText: {
        fontSize: 12,
        color: theme.colors.textDestructive,
    },
    row: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 3,
    },
    rowPressed: {
        opacity: 0.6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 4,
        flexShrink: 0,
    },
    rowBody: {
        flex: 1,
        gap: 2,
    },
    serverName: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.text,
        fontFamily: "Menlo",
    },
    scope: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    rowRight: {
        alignItems: "flex-end",
        gap: 2,
        flexShrink: 0,
    },
    statusText: {
        fontSize: 12,
        fontWeight: "500",
    },
    toolCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
}));
