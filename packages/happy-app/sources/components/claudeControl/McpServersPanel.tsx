import * as React from "react";
import { View, Text, Pressable, ScrollView, Switch, AppState, type AppStateStatus, TextInput } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { Modal } from "@/modal";
import {
    fetchMcpServers,
    reconnectMcpServer,
    toggleMcpServer,
    setMcpServers,
} from "@/sync/apiClaudeControl";
import { log } from "@/log";
import type { GetMcpServersResponse, SetMcpServersRequest } from "@kmmao/happy-wire";

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
 * Panel showing MCP server connection status with management controls.
 * Supports reconnect (failed servers), toggle (enable/disable), and adding
 * new servers via the SDK's hot-swap API (0.3.142+).
 * Refreshes every 30s while the app is foregrounded.
 */
export const McpServersPanel = React.memo(function McpServersPanel({
    sessionId,
}: McpServersPanelProps) {
    const { theme } = useUnistyles();
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

    const handleReconnect = React.useCallback(async (serverName: string) => {
        try {
            await reconnectMcpServer(sessionId, serverName);
            // Refresh after short delay to allow reconnection
            setTimeout(refresh, 1000);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Modal.alert(t("common.error"), msg, [{ text: t("common.ok"), style: "cancel" }]);
        }
    }, [sessionId, refresh]);

    const handleToggle = React.useCallback(async (serverName: string, enabled: boolean) => {
        try {
            await toggleMcpServer(sessionId, serverName, enabled);
            // Refresh to reflect new state
            setTimeout(refresh, 500);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Modal.alert(t("common.error"), msg, [{ text: t("common.ok"), style: "cancel" }]);
        }
    }, [sessionId, refresh]);

    const handleAddServer = React.useCallback(() => {
        Modal.show({
            component: AddMcpServerModal,
            props: { sessionId, onAdded: refresh },
        });
    }, [sessionId, refresh]);

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

    return (
        <View style={styles.container}>
            {data.servers.length === 0 ? (
                <Text style={styles.muted}>{t("claudeControl.mcpServers.noServers")}</Text>
            ) : (
                data.servers.map((server) => (
                    <ServerRow
                        key={server.name}
                        server={server}
                        onReconnect={handleReconnect}
                        onToggle={handleToggle}
                    />
                ))
            )}
            {/* Add Server button */}
            <Pressable
                onPress={handleAddServer}
                style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
            >
                <Ionicons name="add-circle-outline" size={16} color={theme.colors.primary} />
                <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>
                    {t("claudeControl.mcpServers.addServer")}
                </Text>
            </Pressable>
        </View>
    );
});

// ─── ServerRow ────────────────────────────────────────────────────────────────

interface ServerRowProps {
    server: McpServer;
    onReconnect: (name: string) => void;
    onToggle: (name: string, enabled: boolean) => void;
}

const ServerRow = React.memo(function ServerRow({
    server,
    onReconnect,
    onToggle,
}: ServerRowProps) {
    const { theme } = useUnistyles();
    const statusColor = STATUS_COLORS[server.status];
    const hasTools = (server.tools?.length ?? 0) > 0;
    const isEnabled = server.status !== "disabled";

    const handleToolsTap = React.useCallback(() => {
        Modal.show({
            component: McpToolsModal,
            props: { server },
        });
    }, [server]);

    const handleReconnect = React.useCallback(() => {
        onReconnect(server.name);
    }, [onReconnect, server.name]);

    const handleToggle = React.useCallback((value: boolean) => {
        onToggle(server.name, value);
    }, [onToggle, server.name]);

    return (
        <View style={styles.row}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={styles.rowBody}>
                <View style={styles.rowHeader}>
                    <Pressable
                        onPress={hasTools ? handleToolsTap : undefined}
                        disabled={!hasTools}
                        style={({ pressed }) => [styles.nameArea, pressed && hasTools && styles.rowPressed]}
                    >
                        <Text style={styles.serverName} numberOfLines={1}>{server.name}</Text>
                        {hasTools && (
                            <Ionicons
                                name="chevron-forward"
                                size={12}
                                color={theme.colors.textSecondary}
                                style={{ marginTop: 1 }}
                            />
                        )}
                    </Pressable>
                    <Switch
                        value={isEnabled}
                        onValueChange={handleToggle}
                        trackColor={{ false: theme.colors.surfaceHigh, true: "#34C759" }}
                        style={styles.toggle}
                    />
                </View>
                <View style={styles.rowMeta}>
                    <Text style={[styles.statusText, { color: statusColor }]}>
                        {statusLabel(server.status)}
                    </Text>
                    {server.toolCount != null && server.toolCount > 0 && (
                        <Text style={styles.toolCount}>
                            {t("claudeControl.mcpServers.toolsCount").replace("{n}", String(server.toolCount))}
                        </Text>
                    )}
                    {server.scope && (
                        <Text style={styles.scope} numberOfLines={1}>{server.scope}</Text>
                    )}
                </View>
                {server.error && (
                    <Text style={styles.serverError} numberOfLines={2}>{server.error}</Text>
                )}
                {server.status === "failed" && (
                    <Pressable
                        onPress={handleReconnect}
                        style={({ pressed }) => [styles.reconnectBtn, pressed && styles.reconnectBtnPressed]}
                    >
                        <Ionicons name="refresh" size={12} color={theme.colors.primary} />
                        <Text style={[styles.reconnectText, { color: theme.colors.primary }]}>
                            {t("claudeControl.mcpServers.reconnect")}
                        </Text>
                    </Pressable>
                )}
            </View>
        </View>
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

// ─── AddMcpServerModal ───────────────────────────────────────────────────────

type TransportType = "stdio" | "sse" | "url";

const TRANSPORT_TYPES: TransportType[] = ["stdio", "sse", "url"];

interface AddMcpServerModalProps {
    sessionId: string;
    onAdded: () => void;
    onClose: () => void;
}

/**
 * Modal form for adding a new MCP server to the running session.
 * Supports stdio (command + args) and sse/url (URL) transports.
 * Calls setMcpServers which merges with existing servers via SDK hot-swap.
 */
const AddMcpServerModal = React.memo<AddMcpServerModalProps>(function AddMcpServerModal({
    sessionId,
    onAdded,
    onClose,
}) {
    const { theme } = useUnistyles();
    const c = theme.colors;

    const [name, setName] = React.useState("");
    const [transport, setTransport] = React.useState<TransportType>("stdio");
    const [command, setCommand] = React.useState("");
    const [args, setArgs] = React.useState("");
    const [url, setUrl] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);

    const canSubmit = name.trim().length > 0 && (
        transport === "stdio" ? command.trim().length > 0 : url.trim().length > 0
    );

    const handleSubmit = React.useCallback(async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            const serverConfig: SetMcpServersRequest["servers"][string] =
                transport === "stdio"
                    ? {
                        type: "stdio",
                        command: command.trim(),
                        args: args.trim() ? args.trim().split(/\s+/) : [],
                    }
                    : {
                        type: transport === "sse" ? "sse" : "url",
                        url: url.trim(),
                    };

            // Fetch current servers, merge in the new one
            const current = await fetchMcpServers(sessionId);
            const existingConfigs: SetMcpServersRequest["servers"] = {};
            for (const s of current.servers) {
                // Preserve existing servers by re-including them with minimal config
                // The SDK keeps unchanged servers alive without reconnecting
                existingConfigs[s.name] = {};
            }
            existingConfigs[name.trim()] = serverConfig;

            const result = await setMcpServers(sessionId, existingConfigs);

            if (Object.keys(result.errors).length > 0) {
                const errorMsg = Object.entries(result.errors)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n");
                Modal.alert(t("common.error"), errorMsg, [{ text: t("common.ok"), style: "cancel" }]);
            } else {
                onAdded();
                onClose();
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            Modal.alert(t("common.error"), msg, [{ text: t("common.ok"), style: "cancel" }]);
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, submitting, transport, command, args, url, name, sessionId, onAdded, onClose]);

    return (
        <View style={[addModalStyles.container, { backgroundColor: c.surface }]}>
            {/* Header */}
            <View style={[addModalStyles.header, { borderBottomColor: c.divider }]}>
                <Text style={[addModalStyles.title, { color: c.text }]}>
                    {t("claudeControl.mcpServers.addServer")}
                </Text>
                <Pressable onPress={onClose} hitSlop={10}>
                    <Ionicons name="close" size={20} color={c.textSecondary} />
                </Pressable>
            </View>

            <ScrollView
                style={addModalStyles.scroll}
                contentContainerStyle={addModalStyles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {/* Server name */}
                <Text style={[addModalStyles.label, { color: c.textSecondary }]}>
                    {t("claudeControl.mcpServers.serverName")}
                </Text>
                <TextInput
                    style={[addModalStyles.input, { color: c.text, borderColor: c.divider, backgroundColor: c.surfaceHigh }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="my-server"
                    placeholderTextColor={c.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                />

                {/* Transport type */}
                <Text style={[addModalStyles.label, { color: c.textSecondary }]}>
                    {t("claudeControl.mcpServers.transportType")}
                </Text>
                <View style={addModalStyles.transportRow}>
                    {TRANSPORT_TYPES.map((tp) => (
                        <Pressable
                            key={tp}
                            onPress={() => setTransport(tp)}
                            style={[
                                addModalStyles.transportChip,
                                {
                                    backgroundColor: transport === tp ? c.primary : c.surfaceHigh,
                                    borderColor: transport === tp ? c.primary : c.divider,
                                },
                            ]}
                        >
                            <Text style={[
                                addModalStyles.transportChipText,
                                { color: transport === tp ? "#fff" : c.text },
                            ]}>
                                {tp.toUpperCase()}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                {/* Transport-specific fields */}
                {transport === "stdio" ? (
                    <>
                        <Text style={[addModalStyles.label, { color: c.textSecondary }]}>
                            {t("claudeControl.mcpServers.command")}
                        </Text>
                        <TextInput
                            style={[addModalStyles.input, { color: c.text, borderColor: c.divider, backgroundColor: c.surfaceHigh }]}
                            value={command}
                            onChangeText={setCommand}
                            placeholder="npx -y @modelcontextprotocol/server-memory"
                            placeholderTextColor={c.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[addModalStyles.label, { color: c.textSecondary }]}>
                            {t("claudeControl.mcpServers.args")}
                        </Text>
                        <TextInput
                            style={[addModalStyles.input, { color: c.text, borderColor: c.divider, backgroundColor: c.surfaceHigh }]}
                            value={args}
                            onChangeText={setArgs}
                            placeholder={t("claudeControl.mcpServers.argsPlaceholder")}
                            placeholderTextColor={c.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </>
                ) : (
                    <>
                        <Text style={[addModalStyles.label, { color: c.textSecondary }]}>URL</Text>
                        <TextInput
                            style={[addModalStyles.input, { color: c.text, borderColor: c.divider, backgroundColor: c.surfaceHigh }]}
                            value={url}
                            onChangeText={setUrl}
                            placeholder="http://localhost:3000/mcp"
                            placeholderTextColor={c.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                        />
                    </>
                )}
            </ScrollView>

            {/* Submit */}
            <View style={[addModalStyles.footer, { borderTopColor: c.divider }]}>
                <Pressable
                    onPress={handleSubmit}
                    disabled={!canSubmit || submitting}
                    style={({ pressed }) => [
                        addModalStyles.submitBtn,
                        { backgroundColor: canSubmit ? c.primary : c.surfaceHigh },
                        pressed && addModalStyles.submitBtnPressed,
                    ]}
                >
                    <Text style={[
                        addModalStyles.submitText,
                        { color: canSubmit ? "#fff" : c.textSecondary },
                    ]}>
                        {submitting
                            ? t("claudeControl.mcpServers.adding")
                            : t("claudeControl.mcpServers.addServer")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

// ─── AddMcpServerModal styles ────────────────────────────────────────────────

const addModalStyles = StyleSheet.create((_, rt) => ({
    container: {
        borderRadius: 16,
        overflow: "hidden",
        maxHeight: 520,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: {
        fontSize: 15,
        fontWeight: "600",
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        padding: 16,
        gap: 8,
    },
    label: {
        fontSize: 12,
        fontWeight: "500",
        marginTop: 4,
    },
    input: {
        fontSize: 14,
        fontFamily: "Menlo",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    transportRow: {
        flexDirection: "row",
        gap: 8,
    },
    transportChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
    },
    transportChipText: {
        fontSize: 12,
        fontWeight: "600",
    },
    footer: {
        padding: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    submitBtn: {
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
    },
    submitBtnPressed: {
        opacity: 0.7,
    },
    submitText: {
        fontSize: 14,
        fontWeight: "600",
    },
}));

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
        paddingVertical: 4,
    },
    rowPressed: {
        opacity: 0.6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 6,
        flexShrink: 0,
    },
    rowBody: {
        flex: 1,
        gap: 3,
    },
    rowHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    nameArea: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        flex: 1,
    },
    serverName: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.text,
        fontFamily: "Menlo",
    },
    toggle: {
        transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }],
        marginRight: -4,
    },
    rowMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    scope: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    statusText: {
        fontSize: 12,
        fontWeight: "500",
    },
    toolCount: {
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    serverError: {
        fontSize: 11,
        color: theme.colors.textDestructive,
    },
    reconnectBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
        alignSelf: "flex-start",
    },
    reconnectBtnPressed: {
        opacity: 0.5,
    },
    reconnectText: {
        fontSize: 12,
        fontWeight: "500",
    },
    addButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
        marginTop: 2,
    },
    addButtonPressed: {
        opacity: 0.5,
    },
    addButtonText: {
        fontSize: 13,
        fontWeight: "500",
    },
}));
