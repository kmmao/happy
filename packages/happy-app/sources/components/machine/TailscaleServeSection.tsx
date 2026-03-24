/**
 * Tailscale Serve / Funnel management section for the machine detail page.
 * Shows active serves and allows add/remove/toggle funnel.
 */

import React, { useState, useCallback, useMemo } from "react";
import {
    ActivityIndicator,
    Linking,
    Pressable,
    Text,
    TextInput,
    View,
} from "react-native";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { RoundButton } from "@/components/RoundButton";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Modal } from "@/modal";
import { t } from "@/text";
import { isMachineOnline } from "@/utils/machineUtils";
import {
    machineTailscaleServeAdd,
    machineTailscaleServeRemove,
    machineTailscaleFunnelToggle,
    machineTailscaleServeStatus,
} from "@/sync/ops";
import type { Machine } from "@/sync/storageTypes";

type ServeEntry = {
    port: number;
    path: string;
    protocol: string;
    target: string;
    funnel: boolean;
    hostname: string;
};

type Props = {
    machineId: string;
    machine: Machine;
};

type AddServeResult = {
    localPort: number;
    httpsPort: number;
    path: string;
    funnel: boolean;
};

const EMPTY_SERVES: ServeEntry[] = [];

/** Tailscale Funnel only supports these HTTPS ports */
const FUNNEL_ELIGIBLE_PORTS = [443, 8443, 10000] as const;
const FUNNEL_ELIGIBLE_SET = new Set<number>(FUNNEL_ELIGIBLE_PORTS);

/** Strip protocol from proxy target: "http://127.0.0.1:8888" → "127.0.0.1:8888" */
function formatTarget(raw: string): string {
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function parseServeStatusJson(raw: string): ServeEntry[] {
    try {
        const json = JSON.parse(raw);
        const web: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> =
            json.Web ?? {};
        const allowFunnel: Record<string, boolean> = json.AllowFunnel ?? {};
        const entries: ServeEntry[] = [];
        for (const [hostPort, config] of Object.entries(web)) {
            const colonIdx = hostPort.lastIndexOf(":");
            if (colonIdx === -1) continue;
            const hostname = hostPort.slice(0, colonIdx);
            const port = parseInt(hostPort.slice(colonIdx + 1), 10);
            if (!Number.isFinite(port)) continue;
            const funnel = allowFunnel[hostPort] === true;
            const handlers = config.Handlers ?? {};
            for (const [path, handler] of Object.entries(handlers)) {
                const target = handler?.Proxy ?? "unknown";
                entries.push({ port, path, protocol: "HTTPS", target, funnel, hostname });
            }
        }
        return entries;
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// AddServeForm — shown via Modal.show()
// ---------------------------------------------------------------------------

function AddServeForm({ onClose, onSubmit, usedPorts }: {
    onClose: () => void;
    onSubmit: (result: AddServeResult) => void;
    usedPorts: Set<number>;
}) {
    const { theme } = useUnistyles();
    const allPortsUsed = FUNNEL_ELIGIBLE_PORTS.every((p) => usedPorts.has(p));
    const [localPortText, setLocalPortText] = useState("");
    const [httpsPort, setHttpsPort] = useState<number>(
        FUNNEL_ELIGIBLE_PORTS.find((p) => !usedPorts.has(p)) ?? 443,
    );
    const [path, setPath] = useState(allPortsUsed ? "" : "/");
    const [funnel, setFunnel] = useState(false);

    const localPort = parseInt(localPortText, 10);
    const isPortValid = Number.isInteger(localPort) && localPort >= 1 && localPort <= 65535;
    const isPathValid = path.trim().length > 0 && path.trim().startsWith("/");
    const isValid = isPortValid && (allPortsUsed ? isPathValid && path.trim() !== "/" : true);

    const handleSubmit = () => {
        if (!isValid) return;
        onSubmit({ localPort, httpsPort, path: path.trim() || "/", funnel });
        onClose();
    };

    return (
        <View style={[formStyles.card, {
            backgroundColor: theme.colors.surface,
            shadowColor: theme.colors.shadow.color,
        }]}>
            <Text style={[formStyles.title, { color: theme.colors.text }]}>
                {t("machine.tailscaleServeAddTitle")}
            </Text>

            {/* Local port */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.tailscaleServeAddLocalHint")}
            </Text>
            <TextInput
                style={[formStyles.input, {
                    borderColor: theme.colors.divider,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceHigh,
                }]}
                value={localPortText}
                onChangeText={setLocalPortText}
                placeholder={t("machine.tailscaleServeAddPortPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="number-pad"
                autoFocus
            />

            {/* HTTPS port chips */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.tailscaleServeAddHttpsTitle")}
            </Text>
            <Text style={[formStyles.hint, { color: theme.colors.textSecondary }]}>
                {t("machine.tailscaleServeAddHttpsOnlyHint")}
            </Text>
            <View style={formStyles.chipRow}>
                {FUNNEL_ELIGIBLE_PORTS.map((port) => {
                    const selected = httpsPort === port;
                    const inUse = usedPorts.has(port);
                    return (
                        <Pressable
                            key={port}
                            onPress={() => setHttpsPort(port)}
                            style={[
                                formStyles.chip,
                                { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
                                selected && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                            ]}
                        >
                            <Text style={[
                                formStyles.chipText,
                                { color: theme.colors.text },
                                selected && { color: "#fff" },
                            ]}>
                                {port}
                            </Text>
                            {inUse && (
                                <Text style={[
                                    formStyles.chipBadge,
                                    { color: theme.colors.textSecondary },
                                    selected && { color: "rgba(255,255,255,0.7)" },
                                ]}>
                                    {t("machine.tailscaleServeAddPortInUseHint")}
                                </Text>
                            )}
                        </Pressable>
                    );
                })}
            </View>
            {allPortsUsed && (
                <Text style={[formStyles.allUsedHint, { color: theme.colors.accentOrange }]}>
                    {t("machine.tailscaleServeAllPortsUsedPathHint")}
                </Text>
            )}

            {/* Mount path */}
            <Text style={[formStyles.label, { color: theme.colors.text }]}>
                {t("machine.tailscaleServeAddPathTitle")}
                {allPortsUsed && <Text style={{ color: theme.colors.accentOrange }}> *</Text>}
            </Text>
            <TextInput
                style={[formStyles.input, {
                    borderColor: allPortsUsed && !isPathValid ? theme.colors.accentOrange : theme.colors.divider,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceHigh,
                }]}
                value={path}
                onChangeText={setPath}
                placeholder={allPortsUsed ? "/api" : "/"}
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
            />

            {/* Funnel toggle */}
            <Pressable
                style={formStyles.funnelRow}
                onPress={() => setFunnel((prev) => !prev)}
            >
                <View style={{ flex: 1 }}>
                    <Text style={[formStyles.funnelLabel, { color: theme.colors.text }]}>
                        Funnel
                    </Text>
                    <Text style={[formStyles.funnelHint, { color: theme.colors.textSecondary }]}>
                        {t("machine.tailscaleServeAddFunnelDesc")}
                    </Text>
                </View>
                <View style={[
                    formStyles.toggle,
                    { backgroundColor: theme.colors.divider },
                    funnel && { backgroundColor: theme.colors.success },
                ]}>
                    <Text style={formStyles.toggleText}>{funnel ? "ON" : "OFF"}</Text>
                </View>
            </Pressable>

            {/* Preview */}
            {isPortValid && (
                <View style={[formStyles.previewBox, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[formStyles.previewText, { color: theme.colors.textSecondary }]}>
                        {`localhost:${localPort} → :${httpsPort}${path === "/" ? "" : path}`}
                    </Text>
                    <Text style={{ fontSize: 14 }}>{funnel ? " 🌐" : " 🔒"}</Text>
                </View>
            )}

            {/* Actions */}
            <View style={formStyles.actions}>
                <RoundButton
                    title={t("common.cancel")}
                    onPress={onClose}
                    size="normal"
                />
                <View style={{ width: 12 }} />
                <RoundButton
                    title={t("machine.tailscaleServeAdd")}
                    onPress={handleSubmit}
                    size="normal"
                    disabled={!isValid}
                    display="inverted"
                />
            </View>
        </View>
    );
}

const formStyles = StyleSheet.create({
    card: {
        borderRadius: 14,
        padding: 20,
        width: 320,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
        textAlign: "center",
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        fontWeight: "500",
        marginTop: 14,
        marginBottom: 6,
    },
    hint: {
        fontSize: 11,
        marginBottom: 8,
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    chipRow: {
        flexDirection: "row",
        gap: 8,
    },
    chip: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
    },
    chipText: {
        fontSize: 15,
        fontWeight: "600",
    },
    chipBadge: {
        fontSize: 10,
        marginTop: 2,
    },
    allUsedHint: {
        fontSize: 12,
        marginTop: 8,
    },
    funnelRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 14,
        paddingVertical: 6,
    },
    funnelLabel: {
        fontSize: 14,
        fontWeight: "500",
    },
    funnelHint: {
        fontSize: 11,
        marginTop: 2,
    },
    toggle: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 14,
        marginLeft: 12,
        minWidth: 44,
        alignItems: "center",
    },
    toggleText: {
        fontSize: 12,
        fontWeight: "700",
        color: "#fff",
    },
    previewBox: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 14,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    previewText: {
        fontSize: 12,
        fontFamily: "Menlo",
    },
    actions: {
        flexDirection: "row",
        justifyContent: "center",
        marginTop: 18,
    },
});

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

export const TailscaleServeSection = React.memo(function TailscaleServeSection({
    machineId,
    machine,
}: Props) {
    const { theme } = useUnistyles();
    const online = isMachineOnline(machine);
    const serves: ServeEntry[] = useMemo(
        () => (machine.daemonState?.tailscale?.serves ?? []).map((s: { port: number; protocol: string; target: string; funnel: boolean; hostname: string; path?: string }) => ({
            ...s,
            path: s.path ?? "/",
        })),
        [machine.daemonState?.tailscale?.serves],
    );

    // Local overrides after mutations (until next daemon refresh)
    const [localServes, setLocalServes] = useState<ServeEntry[] | null>(null);
    const [togglingPorts, setTogglingPorts] = useState<Set<number>>(new Set());
    const displayServes = localServes ?? serves;

    // Stable key for daemon state version — reset local overrides when server pushes new data
    const daemonVersion = machine.daemonStateVersion;
    React.useEffect(() => {
        setLocalServes(null);
    }, [daemonVersion]);

    const refreshServes = useCallback(async () => {
        try {
            const result = await machineTailscaleServeStatus(machineId);
            if (result.success && result.stdout) {
                setLocalServes(parseServeStatusJson(result.stdout));
            }
        } catch {
            // ignore — next daemon refresh will update
        }
    }, [machineId]);

    const buildServeUrl = useCallback((serve: ServeEntry): string => {
        const pathSuffix = serve.path === "/" ? "/" : serve.path;
        if (serve.hostname) {
            const portSuffix = serve.port === 443 ? "" : `:${serve.port}`;
            return `https://${serve.hostname}${portSuffix}${pathSuffix}`;
        }
        return `https://localhost:${serve.port}${pathSuffix}`;
    }, []);

    const handleOpenServe = useCallback((serve: ServeEntry) => {
        Linking.openURL(buildServeUrl(serve));
    }, [buildServeUrl]);

    const handleFunnelToggle = useCallback(async (serve: ServeEntry) => {
        if (!online || togglingPorts.has(serve.port)) return;

        const funnelMsg = serve.funnel
            ? t("machine.tailscaleServeFunnelToggleOff")
            : t("machine.tailscaleServeFunnelToggleOn");
        const confirmed = await Modal.confirm(`:${serve.port}`, funnelMsg);

        if (confirmed) {
            setTogglingPorts((prev) => new Set([...prev, serve.port]));
            try {
                const result = await machineTailscaleFunnelToggle(
                    machineId,
                    serve.port,
                    !serve.funnel,
                    serve.target,
                    serve.path,
                );
                if (!result.success && result.stderr) {
                    Modal.alert(t("machine.tailscaleServeError"), result.stderr);
                } else {
                    await refreshServes();
                }
            } finally {
                setTogglingPorts((prev) => {
                    const next = new Set(prev);
                    next.delete(serve.port);
                    return next;
                });
            }
        }
    }, [machineId, online, togglingPorts, refreshServes]);

    const handleServeRemove = useCallback(async (serve: ServeEntry) => {
        if (!online) return;

        const remove = await Modal.confirm(
            t("machine.tailscaleServeRemove"),
            t("machine.tailscaleServeRemoveConfirm"),
        );
        if (remove) {
            const result = await machineTailscaleServeRemove(machineId, serve.port, serve.path);
            if (!result.success && result.stderr) {
                Modal.alert(t("machine.tailscaleServeError"), result.stderr);
            } else {
                await refreshServes();
            }
        }
    }, [machineId, online, refreshServes]);

    const usedHttpsPorts = useMemo(
        () => new Set(displayServes.map((s) => s.port)),
        [displayServes],
    );

    const handleAddServe = useCallback(() => {
        if (!online) return;

        Modal.show({
            component: AddServeForm,
            props: {
                usedPorts: usedHttpsPorts,
                onSubmit: async (result: AddServeResult) => {
                    const addResult = await machineTailscaleServeAdd(
                        machineId,
                        result.localPort,
                        result.httpsPort,
                        result.path,
                        result.funnel,
                    );
                    if (!addResult.success && addResult.stderr) {
                        Modal.alert(t("machine.tailscaleServeError"), addResult.stderr);
                    } else {
                        await refreshServes();
                    }
                },
            },
        });
    }, [machineId, online, usedHttpsPorts, refreshServes]);

    return (
        <ItemGroup title={t("machine.tailscaleServes")}>
            {displayServes.length === 0 && (
                <Item
                    title={t("machine.tailscaleServesEmpty")}
                    showChevron={false}
                />
            )}
            {displayServes.map((serve) => {
                const canFunnel = FUNNEL_ELIGIBLE_SET.has(serve.port);
                const pathLabel = serve.path === "/" ? "" : serve.path;
                return (
                    <Item
                        key={`${serve.port}${serve.path}`}
                        title={`:${serve.port}${pathLabel}`}
                        subtitle={`→ ${formatTarget(serve.target)}\n${buildServeUrl(serve)}`}
                        subtitleLines={0}
                        subtitleStyle={{
                            fontFamily: "Menlo",
                            fontSize: 12,
                            color: theme.colors.textLink,
                        }}
                        rightElement={
                            togglingPorts.has(serve.port) ? (
                                <ActivityIndicator size="small" />
                            ) : canFunnel ? (
                                <Pressable
                                    onPress={online ? () => handleFunnelToggle(serve) : undefined}
                                    hitSlop={8}
                                    style={{ flexDirection: "row", alignItems: "center" }}
                                >
                                    <Text style={{
                                        fontSize: 14,
                                        fontWeight: "500",
                                        color: serve.funnel ? theme.colors.success : theme.colors.textSecondary,
                                    }}>
                                        {serve.funnel
                                            ? t("machine.tailscaleServeFunnelOn")
                                            : t("machine.tailscaleServeFunnelOff")}
                                    </Text>
                                    <Ionicons
                                        name="chevron-forward"
                                        size={16}
                                        color={serve.funnel ? theme.colors.success : theme.colors.textSecondary}
                                        style={{ marginLeft: 4 }}
                                    />
                                </Pressable>
                            ) : (
                                <Text style={{
                                    fontSize: 14,
                                    color: theme.colors.textSecondary,
                                }}>
                                    {t("machine.tailscaleServeFunnelOff")}
                                </Text>
                            )
                        }
                        onPress={() => handleOpenServe(serve)}
                        onLongPress={online ? () => handleServeRemove(serve) : undefined}
                        showChevron={false}
                    />
                );
            })}
            {online && (
                <Item
                    title={t("machine.tailscaleServeAdd")}
                    titleStyle={{ color: theme.colors.textLink }}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={20}
                            color={theme.colors.textLink}
                        />
                    }
                    onPress={handleAddServe}
                    showChevron={false}
                />
            )}
        </ItemGroup>
    );
});
