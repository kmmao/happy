import * as React from "react";
import { View, Text, AppState, type AppStateStatus } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
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
 * Panel showing the MCP server connection status for a remote Claude session.
 * Displays each configured server's name, status, and tool count.
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

const ServerRow = React.memo(function ServerRow({ server }: { server: McpServer }) {
    const statusColor = STATUS_COLORS[server.status];
    return (
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
        </View>
    );
});

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
