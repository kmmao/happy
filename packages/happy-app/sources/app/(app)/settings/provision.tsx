import * as React from "react";
import { View, ActivityIndicator, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Modal } from "@/modal";
import { t } from "@/text";
import { useAuth } from "@/auth/AuthContext";
import { useHappyAction } from "@/hooks/useHappyAction";
import { machineBash } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { MMKV } from "react-native-mmkv";
import { isMachineOnline } from "@/utils/machineUtils";
import {
    provisionCreate,
    provisionList,
    provisionRevoke,
    provisionRestore,
    provisionUpdateUrls,
    type ProvisionTokenItem,
} from "@/sync/apiProvision";

function findOnlineMachineId(): string | null {
    const machines = storage.getState().machines;
    const online = Object.values(machines).find((m) => m.active);
    return online?.id ?? null;
}

function sanitizeContainerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-");
}

/** Escape a value for safe use in shell single-quoted strings */
function shellEscape(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Copy text and show toast */
async function copyAndToast(text: string) {
    await Clipboard.setStringAsync(text);
    Modal.toast(t("provision.copied"));
}

/** Parse ttydUrl (JSON or legacy plain URL) into structured parts */
function parseTtydUrl(ttydUrl: string | null): {
    httpsUrl: string;
    lanUrl: string;
    fullUrl: string;
    cleanUrl: string;
    user: string;
    password: string;
    config: { memory?: string | null; cpu?: string | null; sudo?: boolean };
} | null {
    if (!ttydUrl) return null;
    let httpsUrl = "";
    let lanUrl = "";
    let config: { memory?: string | null; cpu?: string | null; sudo?: boolean } = {};
    try {
        const parsed = JSON.parse(ttydUrl);
        httpsUrl = parsed.https || "";
        lanUrl = parsed.lan || "";
        config = parsed.config || {};
    } catch {
        httpsUrl = ttydUrl;
    }
    if (!httpsUrl) return null;
    let user = "";
    let password = "";
    let cleanUrl = httpsUrl;
    let fullUrl = httpsUrl;
    try {
        const u = new URL(httpsUrl);
        user = decodeURIComponent(u.username);
        password = decodeURIComponent(u.password);
        cleanUrl = `${u.protocol}//${u.host}`;
        fullUrl = httpsUrl;
    } catch {
        // keep as-is
    }
    return { httpsUrl, lanUrl, fullUrl, cleanUrl, user, password, config };
}

/** Extract provision token and server URL from webappUrl query params */
function parseWebappUrl(webappUrl: string | null): { provisionToken: string; serverUrl: string } | null {
    if (!webappUrl) return null;
    try {
        const u = new URL(webappUrl);
        const provisionToken = u.searchParams.get("provision");
        const serverUrl = u.searchParams.get("server");
        if (!provisionToken || !serverUrl) return null;
        return { provisionToken, serverUrl };
    } catch {
        return null;
    }
}

const provisionStorage = new MMKV({ id: "provision-config" });
const API_BASE_URL_KEY = "api-base-url";
const API_KEY_KEY = "api-key";
const MEMORY_LIMIT_KEY = "memory-limit";
const CPU_LIMIT_KEY = "cpu-limit";
const DISABLE_SUDO_KEY = "disable-sudo";

function ProvisionSettingsScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const { machineId: paramMachineId } = useLocalSearchParams<{ machineId?: string }>();
    const [tokens, setTokens] = React.useState<ProvisionTokenItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [apiBaseUrl, setApiBaseUrl] = React.useState(() => provisionStorage.getString(API_BASE_URL_KEY) ?? "");
    const [apiKey, setApiKey] = React.useState(() => provisionStorage.getString(API_KEY_KEY) ?? "");
    const [memoryLimit, setMemoryLimit] = React.useState(() => provisionStorage.getString(MEMORY_LIMIT_KEY) ?? "");
    const [cpuLimit, setCpuLimit] = React.useState(() => provisionStorage.getString(CPU_LIMIT_KEY) ?? "");
    const [disableSudo, setDisableSudo] = React.useState(() => provisionStorage.getBoolean(DISABLE_SUDO_KEY) ?? false);
    const [expandedTokens, setExpandedTokens] = React.useState<Record<string, boolean>>({});
    const [runningContainers, setRunningContainers] = React.useState<Set<string> | null>(null);

    const toggleExpanded = React.useCallback((tokenId: string) => {
        setExpandedTokens(prev => ({ ...prev, [tokenId]: !prev[tokenId] }));
    }, []);

    /** Check which happy-* containers are running on the machine */
    const refreshContainerStatuses = React.useCallback(async () => {
        const machineId = paramMachineId || findOnlineMachineId();
        if (!machineId) {
            setRunningContainers(new Set());
            return;
        }
        const result = await machineBash(machineId, "docker ps --format '{{.Names}}' --filter 'name=happy-'", "/");
        if (result.success) {
            const names = result.stdout
                ? result.stdout.trim().split("\n").filter(Boolean).filter(n => n.startsWith("happy-"))
                : [];
            setRunningContainers(new Set(names));
        }
    }, [paramMachineId]);

    const loadTokens = React.useCallback(async () => {
        if (!auth.credentials) return;
        setLoading(true);
        try {
            const result = await provisionList(auth.credentials);
            setTokens(result);
        } finally {
            setLoading(false);
        }
    }, [auth.credentials]);

    useFocusEffect(
        React.useCallback(() => {
            loadTokens();
            refreshContainerStatuses();
        }, [loadTokens, refreshContainerStatuses]),
    );

    /** Scan ports 7001-7099 and return the first available one */
    const findAvailablePort = React.useCallback(async (machineId: string): Promise<number | null> => {
        const portCheckResult = await machineBash(machineId, [
            "(",
            "docker ps -a --format '{{.Ports}}' | grep -o '0\\.0\\.0\\.0:70[0-9][0-9]' | sed 's/0\\.0\\.0\\.0://'",
            ";",
            "ss -tlnH 2>/dev/null | grep -o ':70[0-9][0-9] ' | sed 's/://' | sed 's/ //' || true",
            ")",
            "| sort -un",
        ].join(" "), "/");
        const usedPorts = new Set(
            (portCheckResult.stdout?.trim() || "").split("\n").map(Number).filter(Boolean),
        );
        let port = 7001;
        while (usedPorts.has(port) && port < 7100) port++;
        return port < 7100 ? port : null;
    }, []);

    /** Get machine LAN IP */
    const getMachineIp = React.useCallback(async (machineId: string): Promise<string> => {
        const ipResult = await machineBash(machineId, "hostname -I | awk '{print $1}'", "/");
        return ipResult.stdout?.trim() || "localhost";
    }, []);

    /** Create Caddy site file and reload */
    const setupCaddySite = React.useCallback(async (machineId: string, safeName: string, port: number) => {
        const caddySiteContent = `t-${safeName}.code.xycloud.info {\n\treverse_proxy host.docker.internal:${port}\n\timport cloudflare_tls\n}`;
        await machineBash(machineId, `docker exec happy-caddy-1 sh -c 'mkdir -p /etc/caddy/sites && cat > /etc/caddy/sites/t-${safeName}.caddy << CADDYEOF\n${caddySiteContent}\nCADDYEOF'`, "/");
        await machineBash(machineId, `docker exec happy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, "/");
    }, []);

    // Create container
    const [, handleCreate] = useHappyAction(async () => {
        if (!auth.credentials) return;

        const machineId = paramMachineId || findOnlineMachineId();
        if (!machineId) {
            Modal.alert(t("provision.createToken"), t("provision.noMachineOnline"));
            return;
        }

        const machines = storage.getState().machines;
        const machine = machines[machineId];
        if (machine && !isMachineOnline(machine)) {
            Modal.alert(t("provision.createToken"), t("provision.noMachineOnline"));
            return;
        }

        // Ask for container name (API config is set in the settings section above)
        const containerName = await Modal.prompt(
            t("provision.createToken"),
            t("provision.containerNameDescription"),
            {
                placeholder: t("provision.containerNamePlaceholder"),
                confirmText: t("common.ok"),
            },
        );
        if (!containerName?.trim()) return;

        const safeName = sanitizeContainerName(containerName.trim());
        const volumeName = `happy-${safeName}-data`;
        const containerFullName = `happy-${safeName}`;

        Modal.toast(t("provision.creatingContainer"));

        const ttydPort = await findAvailablePort(machineId);
        if (!ttydPort) {
            Modal.alert(t("provision.containerFailed"), "No available ports (7001-7099)");
            return;
        }

        const machineIp = await getMachineIp(machineId);

        // 1. Create provision token (server creates independent account + packs secret)
        const result = await provisionCreate(auth.credentials, {
            label: safeName,
            ttlHours: 8760,
        });

        // 2. Generate ttyd password and build HTTPS URLs
        const ttydPassword = Math.random().toString(36).slice(2, 10);
        const serverUrl = "https://s.sangreal.code.xycloud.info:2443";
        const webappUrl = `https://w.sangreal.code.xycloud.info:2443?provision=${encodeURIComponent(result.provisionToken)}&server=${encodeURIComponent(serverUrl)}`;
        const ttydHttpsUrl = `https://coder:${ttydPassword}@t-${safeName}.code.xycloud.info:2443`;
        const ttydLanUrl = `http://${machineIp}:${ttydPort}`;
        const ttydUrl = JSON.stringify({
            https: ttydHttpsUrl,
            lan: ttydLanUrl,
            config: {
                memory: memoryLimit?.trim() || null,
                cpu: cpuLimit?.trim() || null,
                sudo: !disableSudo,
            },
        });

        // 3. Save URLs to server
        await provisionUpdateUrls(auth.credentials, result.id, { webappUrl, ttydUrl });

        // 4. Create Caddy site file for ttyd reverse proxy
        await setupCaddySite(machineId, safeName, ttydPort);

        // 5. Docker run (API keys + resource limits passed at runtime, shell-escaped)
        const extraArgs = [
            apiBaseUrl?.trim() ? `-e ANTHROPIC_BASE_URL=${shellEscape(apiBaseUrl.trim())}` : "",
            apiKey?.trim() ? `-e ANTHROPIC_AUTH_TOKEN=${shellEscape(apiKey.trim())}` : "",
            memoryLimit?.trim() ? `--memory=${shellEscape(memoryLimit.trim())}` : "",
            cpuLimit?.trim() ? `--cpus=${shellEscape(cpuLimit.trim())}` : "",
            disableSudo ? `-e DISABLE_SUDO=1` : "",
        ].filter(Boolean).join(" ");
        const dockerCmd = `docker run -d --name ${shellEscape(containerFullName)} --hostname ${shellEscape(safeName)} --add-host=host.docker.internal:host-gateway --add-host=s.sangreal.code.xycloud.info:host-gateway --dns 8.8.8.8 -v ${shellEscape(`${volumeName}:/home/coder/.happy`)} -v ${shellEscape(`${volumeName}-work:/work`)} -p ${ttydPort}:7681 -e HAPPY_SERVER_URL=${shellEscape(serverUrl)} -e HAPPY_PROVISION_TOKEN=${shellEscape(result.provisionToken)} -e TTYD_CREDENTIAL=${shellEscape(`coder:${ttydPassword}`)} ${extraArgs} -w /work happy-client`;
        const bashResult = await machineBash(machineId, dockerCmd, "/");

        if (bashResult.success && bashResult.exitCode === 0) {
            Modal.toast(t("provision.containerCreated"));
        } else {
            const errorMsg = bashResult.stderr || bashResult.error || "Unknown error";
            Modal.alert(
                t("provision.containerFailed"),
                t("provision.containerFailedDescription", { error: errorMsg }),
            );
        }

        await loadTokens();
    });

    // Revoke + stop container
    const handleRevoke = React.useCallback(
        async (tokenId: string, label: string | null) => {
            if (!auth.credentials) return;
            const confirmed = await Modal.confirm(
                t("provision.revokeToken"),
                t("provision.revokeConfirm"),
                { confirmText: t("provision.revokeToken"), destructive: true },
            );
            if (!confirmed) return;

            const machineId = paramMachineId || findOnlineMachineId();
            if (machineId && label) {
                const safeName = sanitizeContainerName(label);
                const containerName = `happy-${safeName}`;
                await machineBash(machineId, `docker rm -f ${shellEscape(containerName)} 2>/dev/null || true`, "/");
                // Remove Caddy site file and reload
                await machineBash(machineId, `docker exec happy-caddy-1 rm -f /etc/caddy/sites/t-${shellEscape(safeName)}.caddy && docker exec happy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true`, "/");
            }

            await provisionRevoke(auth.credentials, tokenId);
            Modal.toast(t("provision.revoked"));
            await loadTokens();
        },
        [auth.credentials, loadTokens, paramMachineId],
    );

    // Restore revoked token + rebuild container
    const handleRestore = React.useCallback(
        async (token: ProvisionTokenItem) => {
            if (!auth.credentials) return;
            const confirmed = await Modal.confirm(
                t("provision.restoreToken"),
                t("provision.restoreConfirm"),
                { confirmText: t("provision.restoreToken") },
            );
            if (!confirmed) return;

            // 1. Always restore the token first (even if container rebuild fails)
            await provisionRestore(auth.credentials, token.id);

            // 2. Parse existing data for container rebuild
            const ttydInfo = parseTtydUrl(token.ttydUrl);
            const webappInfo = parseWebappUrl(token.webappUrl);
            const machineId = paramMachineId || findOnlineMachineId();

            if (!machineId) {
                Modal.toast(t("provision.restoreNoMachine"));
                await loadTokens();
                return;
            }

            if (!ttydInfo || !webappInfo || !token.label) {
                Modal.toast(t("provision.restoreNoUrlData"));
                await loadTokens();
                return;
            }

            // 3. Rebuild container
            Modal.toast(t("provision.restoringContainer"));
            const safeName = sanitizeContainerName(token.label);
            const containerName = `happy-${safeName}`;
            const volumeName = `happy-${safeName}-data`;

            const port = await findAvailablePort(machineId);
            if (!port) {
                Modal.alert(t("provision.containerFailed"), "No available ports (7001-7099)");
                await loadTokens();
                return;
            }

            const machineIp = await getMachineIp(machineId);

            // 4. Remove stale container if it still exists
            await machineBash(machineId, `docker rm -f ${shellEscape(containerName)} 2>/dev/null || true`, "/");

            // 5. Setup Caddy reverse proxy
            await setupCaddySite(machineId, safeName, port);

            // 6. Docker run with existing volumes and credentials (shell-escaped)
            const extraArgs = [
                apiBaseUrl?.trim() ? `-e ANTHROPIC_BASE_URL=${shellEscape(apiBaseUrl.trim())}` : "",
                apiKey?.trim() ? `-e ANTHROPIC_AUTH_TOKEN=${shellEscape(apiKey.trim())}` : "",
                ttydInfo.config.memory ? `--memory=${shellEscape(ttydInfo.config.memory)}` : "",
                ttydInfo.config.cpu ? `--cpus=${shellEscape(ttydInfo.config.cpu)}` : "",
                ttydInfo.config.sudo === false ? `-e DISABLE_SUDO=1` : "",
            ].filter(Boolean).join(" ");

            const dockerCmd = `docker run -d --name ${shellEscape(containerName)} --hostname ${shellEscape(safeName)} --add-host=host.docker.internal:host-gateway --add-host=s.sangreal.code.xycloud.info:host-gateway --dns 8.8.8.8 -v ${shellEscape(`${volumeName}:/home/coder/.happy`)} -v ${shellEscape(`${volumeName}-work:/work`)} -p ${port}:7681 -e HAPPY_SERVER_URL=${shellEscape(webappInfo.serverUrl)} -e HAPPY_PROVISION_TOKEN=${shellEscape(webappInfo.provisionToken)} -e TTYD_CREDENTIAL=${shellEscape(`coder:${ttydInfo.password}`)} ${extraArgs} -w /work happy-client`;
            const bashResult = await machineBash(machineId, dockerCmd, "/");

            if (bashResult.success && bashResult.exitCode === 0) {
                // 6. Update LAN URL if port changed
                const newLanUrl = `http://${machineIp}:${port}`;
                if (newLanUrl !== ttydInfo.lanUrl) {
                    const newTtydUrl = JSON.stringify({
                        https: ttydInfo.httpsUrl,
                        lan: newLanUrl,
                        config: ttydInfo.config,
                    });
                    await provisionUpdateUrls(auth.credentials, token.id, { ttydUrl: newTtydUrl });
                }
                Modal.toast(t("provision.containerRestored"));
            } else {
                // Clean up Caddy site file since container failed to start
                await machineBash(machineId, `docker exec happy-caddy-1 rm -f /etc/caddy/sites/t-${shellEscape(safeName)}.caddy && docker exec happy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true`, "/");
                const errorMsg = bashResult.stderr || bashResult.error || "Unknown error";
                Modal.alert(
                    t("provision.containerFailed"),
                    t("provision.restoreContainerFailed", { error: errorMsg }),
                );
            }

            await loadTokens();
        },
        [auth.credentials, loadTokens, paramMachineId, findAvailablePort, getMachineIp, setupCaddySite, apiBaseUrl, apiKey],
    );

    // Restart a running container
    const handleRestart = React.useCallback(
        async (containerName: string) => {
            const machineId = paramMachineId || findOnlineMachineId();
            if (!machineId) {
                Modal.alert(t("provision.restartContainer"), t("provision.noMachineOnline"));
                return;
            }
            const confirmed = await Modal.confirm(
                t("provision.restartContainer"),
                t("provision.restartConfirm"),
                { confirmText: t("provision.restartContainer") },
            );
            if (!confirmed) return;

            Modal.toast(t("provision.restarting"));
            const result = await machineBash(machineId, `docker restart ${shellEscape(containerName)}`, "/");
            if (result.success && result.exitCode === 0) {
                Modal.toast(t("provision.restarted"));
            } else {
                Modal.alert(t("provision.containerFailed"), result.stderr || result.error || "Unknown error");
            }
            await refreshContainerStatuses();
        },
        [paramMachineId, refreshContainerStatuses],
    );

    // Delete permanently
    const handleDelete = React.useCallback(
        async (tokenId: string, label: string | null) => {
            if (!auth.credentials) return;
            const confirmed = await Modal.confirm(
                t("provision.deleteToken"),
                t("provision.deleteConfirm"),
                { confirmText: t("provision.deleteToken"), destructive: true },
            );
            if (!confirmed) return;

            // Clean up Caddy site file if machine is online
            const machineId = paramMachineId || findOnlineMachineId();
            if (machineId && label) {
                const safeName = sanitizeContainerName(label);
                await machineBash(machineId, `docker exec happy-caddy-1 rm -f /etc/caddy/sites/t-${shellEscape(safeName)}.caddy && docker exec happy-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true`, "/");
            }

            await provisionRevoke(auth.credentials, tokenId);
            Modal.toast(t("provision.deleted"));
            await loadTokens();
        },
        [auth.credentials, loadTokens, paramMachineId],
    );

    const styles = StyleSheet.create({
        emptyContainer: {
            alignItems: "center",
            paddingVertical: 32,
            paddingHorizontal: 24,
        },
        emptyTitle: {
            fontSize: 17,
            fontWeight: "600",
            color: theme.colors.text,
            marginTop: 12,
            marginBottom: 6,
        },
        emptyDescription: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            lineHeight: 20,
        },
    });

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const activeTokens = tokens.filter(tk => !tk.revokedAt);
    const revokedTokens = tokens.filter(tk => !!tk.revokedAt);

    return (
        <ItemList>
            {/* API Configuration */}
            <ItemGroup title={t("provision.apiConfig")}>
                <Item
                    title="API Base URL"
                    subtitle={apiBaseUrl || t("provision.apiNotSet")}
                    subtitleStyle={apiBaseUrl ? { fontFamily: "Menlo", fontSize: 12 } : { color: theme.colors.textSecondary, fontSize: 13 }}
                    icon={<Ionicons name="server-outline" size={20} color={theme.colors.textSecondary} />}
                    onPress={async () => {
                        const val = await Modal.prompt("API Base URL", t("provision.apiBaseUrlDescription"), {
                            placeholder: "https://api.anthropic.com",
                            defaultValue: apiBaseUrl,
                        });
                        if (val !== null) {
                            setApiBaseUrl(val);
                            provisionStorage.set(API_BASE_URL_KEY, val);
                        }
                    }}
                    showChevron={false}
                />
                <Item
                    title="API Key"
                    subtitle={apiKey ? `${apiKey.slice(0, 10)}...` : t("provision.apiNotSet")}
                    subtitleStyle={apiKey ? { fontFamily: "Menlo", fontSize: 12 } : { color: theme.colors.textSecondary, fontSize: 13 }}
                    icon={<Ionicons name="key-outline" size={20} color={theme.colors.textSecondary} />}
                    onPress={async () => {
                        const val = await Modal.prompt("API Key", t("provision.apiKeyDescription"), {
                            placeholder: "sk-ant-...",
                            defaultValue: apiKey,
                        });
                        if (val !== null) {
                            setApiKey(val);
                            provisionStorage.set(API_KEY_KEY, val);
                        }
                    }}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Resource Limits */}
            <ItemGroup title={t("provision.resourceLimits")}>
                <Item
                    title={t("provision.memoryLimit")}
                    subtitle={memoryLimit || t("provision.unlimited")}
                    subtitleStyle={memoryLimit ? { fontFamily: "Menlo", fontSize: 13 } : { color: theme.colors.textSecondary, fontSize: 13 }}
                    icon={<Ionicons name="hardware-chip-outline" size={20} color={theme.colors.textSecondary} />}
                    onPress={async () => {
                        const val = await Modal.prompt(t("provision.memoryLimit"), t("provision.memoryLimitDescription"), {
                            placeholder: "4g",
                            defaultValue: memoryLimit,
                        });
                        if (val !== null) {
                            setMemoryLimit(val);
                            provisionStorage.set(MEMORY_LIMIT_KEY, val);
                        }
                    }}
                    showChevron={false}
                />
                <Item
                    title={t("provision.cpuLimit")}
                    subtitle={cpuLimit || t("provision.unlimited")}
                    subtitleStyle={cpuLimit ? { fontFamily: "Menlo", fontSize: 13 } : { color: theme.colors.textSecondary, fontSize: 13 }}
                    icon={<Ionicons name="speedometer-outline" size={20} color={theme.colors.textSecondary} />}
                    onPress={async () => {
                        const val = await Modal.prompt(t("provision.cpuLimit"), t("provision.cpuLimitDescription"), {
                            placeholder: "2",
                            defaultValue: cpuLimit,
                        });
                        if (val !== null) {
                            setCpuLimit(val);
                            provisionStorage.set(CPU_LIMIT_KEY, val);
                        }
                    }}
                    showChevron={false}
                />
                <Item
                    title={t("provision.disableSudo")}
                    subtitle={disableSudo ? t("provision.sudoDisabled") : t("provision.sudoEnabled")}
                    subtitleStyle={{ color: theme.colors.textSecondary, fontSize: 13 }}
                    icon={<Ionicons name="shield-outline" size={20} color={disableSudo ? theme.colors.accentOrange : theme.colors.textSecondary} />}
                    onPress={() => {
                        const next = !disableSudo;
                        setDisableSudo(next);
                        provisionStorage.set(DISABLE_SUDO_KEY, next);
                    }}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Create button */}
            <ItemGroup>
                <Item
                    title={t("provision.createToken")}
                    icon={<Ionicons name="add-circle-outline" size={29} color={theme.colors.accentBlue} />}
                    onPress={handleCreate}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Loading */}
            {loading && tokens.length === 0 && (
                <ItemGroup>
                    <View style={{ alignItems: "center", paddingVertical: 16 }}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                    </View>
                </ItemGroup>
            )}

            {/* Empty state */}
            {!loading && tokens.length === 0 && (
                <ItemGroup>
                    <View style={styles.emptyContainer}>
                        <Ionicons name="key-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={styles.emptyTitle}>{t("provision.emptyTitle")}</Text>
                        <Text style={styles.emptyDescription}>{t("provision.emptyDescription")}</Text>
                    </View>
                </ItemGroup>
            )}

            {/* Active tokens — each token is its own card */}
            {activeTokens.map((token) => {
                const containerName = token.label ? `happy-${sanitizeContainerName(token.label)}` : null;
                const dockerExecCmd = containerName ? `docker exec -it -u coder ${containerName} zsh` : null;
                const isRunning = runningContainers !== null && containerName ? runningContainers.has(containerName) : null;

                const ttydInfo = parseTtydUrl(token.ttydUrl);
                const ttydLanUrl = ttydInfo?.lanUrl ?? "";
                const ttydFullUrl = ttydInfo?.fullUrl ?? "";
                const ttydCleanUrl = ttydInfo?.cleanUrl ?? "";
                const ttydUser = ttydInfo?.user ?? "";
                const ttydPass = ttydInfo?.password ?? "";
                const containerConfig = ttydInfo?.config ?? {};

                const isExpanded = expandedTokens[token.id] ?? false;

                return (
                    <ItemGroup
                        key={token.id}
                        title={`${isRunning === null ? "⚪" : isRunning ? "🟢" : "🔴"} ${token.label || token.id.slice(0, 8)}`}
                    >
                        {/* === Core section (always visible) === */}

                        {/* Web App link */}
                        {token.webappUrl && (
                            <Item
                                title="Web App"
                                subtitle={token.webappUrl.length > 60 ? token.webappUrl.slice(0, 60) + "…" : token.webappUrl}
                                subtitleStyle={{ color: theme.colors.textLink, fontSize: 12 }}
                                icon={<Ionicons name="globe-outline" size={20} color={theme.colors.accentBlue} />}
                                onPress={() => Linking.openURL(token.webappUrl!)}
                                rightElement={
                                    <Ionicons
                                        name="copy-outline"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                        onPress={() => copyAndToast(token.webappUrl!)}
                                    />
                                }
                            />
                        )}

                        {/* Web Terminal — HTTPS */}
                        {ttydCleanUrl ? (
                            <Item
                                title="Web Terminal"
                                subtitle={ttydCleanUrl}
                                subtitleStyle={{ color: theme.colors.textLink, fontSize: 12 }}
                                icon={<Ionicons name="terminal-outline" size={20} color={theme.colors.accentPurple} />}
                                onPress={() => Linking.openURL(ttydFullUrl)}
                                rightElement={
                                    <Ionicons
                                        name="copy-outline"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                        onPress={() => copyAndToast(ttydFullUrl)}
                                    />
                                }
                            />
                        ) : null}

                        {/* Details toggle */}
                        <Item
                            title={isExpanded ? t("provision.hideDetails") : t("provision.showDetails")}
                            titleStyle={{ color: theme.colors.textSecondary }}
                            icon={<Ionicons name={isExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={20} color={theme.colors.textSecondary} />}
                            onPress={() => toggleExpanded(token.id)}
                            showChevron={false}
                        />

                        {/* === Expanded section === */}
                        {isExpanded && (
                            <>
                                {/* Container name */}
                                {containerName && (
                                    <Item
                                        title={t("provision.containerName")}
                                        subtitle={containerName}
                                        subtitleStyle={{ fontFamily: "Menlo", fontSize: 13 }}
                                        icon={<Ionicons name="cube-outline" size={20} color={theme.colors.textSecondary} />}
                                        showChevron={false}
                                    />
                                )}

                                {/* Created at */}
                                <Item
                                    title={t("provision.createdAt")}
                                    subtitle={formatDate(token.createdAt)}
                                    icon={<Ionicons name="time-outline" size={20} color={theme.colors.textSecondary} />}
                                    showChevron={false}
                                />

                                {/* Web Terminal — LAN */}
                                {ttydLanUrl ? (
                                    <Item
                                        title="Web Terminal (LAN)"
                                        subtitle={ttydLanUrl}
                                        subtitleStyle={{ color: theme.colors.textLink, fontSize: 12 }}
                                        icon={<Ionicons name="wifi-outline" size={20} color={theme.colors.textSecondary} />}
                                        onPress={() => Linking.openURL(ttydLanUrl)}
                                        rightElement={
                                            <Ionicons
                                                name="copy-outline"
                                                size={18}
                                                color={theme.colors.textSecondary}
                                                onPress={() => copyAndToast(ttydLanUrl)}
                                            />
                                        }
                                    />
                                ) : null}

                                {/* ttyd credentials */}
                                {ttydUser ? (
                                    <Item
                                        title={t("provision.terminalUser")}
                                        subtitle={ttydUser}
                                        subtitleStyle={{ fontFamily: "Menlo", fontSize: 13 }}
                                        icon={<Ionicons name="person-outline" size={20} color={theme.colors.textSecondary} />}
                                        onPress={() => copyAndToast(ttydUser)}
                                        showChevron={false}
                                    />
                                ) : null}
                                {ttydPass ? (
                                    <Item
                                        title={t("provision.terminalPassword")}
                                        subtitle={ttydPass}
                                        subtitleStyle={{ fontFamily: "Menlo", fontSize: 13 }}
                                        icon={<Ionicons name="lock-closed-outline" size={20} color={theme.colors.textSecondary} />}
                                        onPress={() => copyAndToast(ttydPass)}
                                        showChevron={false}
                                    />
                                ) : null}

                                {/* Docker exec command */}
                                {dockerExecCmd && (
                                    <Item
                                        title="Docker Exec"
                                        subtitle={dockerExecCmd}
                                        subtitleStyle={{ fontFamily: "Menlo", fontSize: 12 }}
                                        icon={<Ionicons name="code-slash-outline" size={20} color={theme.colors.textSecondary} />}
                                        onPress={() => copyAndToast(dockerExecCmd)}
                                        showChevron={false}
                                    />
                                )}

                                {/* Container config summary */}
                                {(containerConfig.memory || containerConfig.cpu || containerConfig.sudo === false) ? (
                                    <Item
                                        title={t("provision.containerConfig")}
                                        subtitle={[
                                            containerConfig.memory ? `${t("provision.memoryLimit")}: ${containerConfig.memory}` : null,
                                            containerConfig.cpu ? `${t("provision.cpuLimit")}: ${containerConfig.cpu}` : null,
                                            containerConfig.sudo === false ? t("provision.sudoDisabled") : null,
                                        ].filter(Boolean).join(" · ")}
                                        subtitleStyle={{ fontSize: 12 }}
                                        icon={<Ionicons name="settings-outline" size={20} color={theme.colors.textSecondary} />}
                                        showChevron={false}
                                    />
                                ) : null}
                            </>
                        )}

                        {/* Restart button — only when container is confirmed running */}
                        {isRunning === true && containerName && (
                            <Item
                                title={t("provision.restartContainer")}
                                titleStyle={{ color: theme.colors.accentOrange }}
                                icon={<Ionicons name="refresh-outline" size={20} color={theme.colors.accentOrange} />}
                                onPress={() => handleRestart(containerName)}
                                showChevron={false}
                            />
                        )}

                        {/* Revoke button */}
                        <Item
                            title={t("provision.revokeToken")}
                            titleStyle={{ color: theme.colors.deleteAction }}
                            icon={<Ionicons name="trash-outline" size={20} color={theme.colors.deleteAction} />}
                            onPress={() => handleRevoke(token.id, token.label)}
                            showChevron={false}
                        />
                    </ItemGroup>
                );
            })}

            {/* Revoked tokens — each as its own card */}
            {revokedTokens.map((token) => (
                <ItemGroup
                    key={token.id}
                    title={`⛔ ${token.label || token.id.slice(0, 8)}`}
                >
                    {/* Revoked at */}
                    <Item
                        title={t("provision.revokedAt")}
                        subtitle={formatDate(token.revokedAt!)}
                        icon={<Ionicons name="time-outline" size={20} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />

                    {/* Created at */}
                    <Item
                        title={t("provision.createdAt")}
                        subtitle={formatDate(token.createdAt)}
                        icon={<Ionicons name="calendar-outline" size={20} color={theme.colors.textSecondary} />}
                        showChevron={false}
                    />

                    {/* Restore */}
                    <Item
                        title={t("provision.restoreToken")}
                        titleStyle={{ color: theme.colors.accentBlue }}
                        icon={<Ionicons name="refresh-outline" size={20} color={theme.colors.accentBlue} />}
                        onPress={() => handleRestore(token)}
                        showChevron={false}
                    />

                    {/* Delete permanently */}
                    <Item
                        title={t("provision.deleteToken")}
                        titleStyle={{ color: theme.colors.deleteAction }}
                        icon={<Ionicons name="trash-outline" size={20} color={theme.colors.deleteAction} />}
                        onPress={() => handleDelete(token.id, token.label)}
                        showChevron={false}
                    />
                </ItemGroup>
            ))}
        </ItemList>
    );
}

export default React.memo(ProvisionSettingsScreen);
