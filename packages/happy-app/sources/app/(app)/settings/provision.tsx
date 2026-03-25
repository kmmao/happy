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
import { getServerUrl } from "@/sync/serverConfig";
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

/** Copy text and show toast */
async function copyAndToast(text: string) {
    await Clipboard.setStringAsync(text);
    Modal.toast(t("provision.copied"));
}

function ProvisionSettingsScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const { machineId: paramMachineId } = useLocalSearchParams<{ machineId?: string }>();
    const [tokens, setTokens] = React.useState<ProvisionTokenItem[]>([]);
    const [loading, setLoading] = React.useState(true);

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
        }, [loadTokens]),
    );

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

        // Ask for container name
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

        // Find next available ttyd port (7001+)
        const portScanResult = await machineBash(machineId, "docker ps --format '{{.Ports}}' | grep -oP '0\\.0\\.0\\.0:\\K(70[0-9]{2})' | sort -n | tail -1", "/");
        const lastPort = parseInt(portScanResult.stdout?.trim() || "7000", 10);
        const ttydPort = Math.max(lastPort + 1, 7001);

        // Get machine's LAN IP for internal URLs
        const ipResult = await machineBash(machineId, "hostname -I | awk '{print $1}'", "/");
        const machineIp = ipResult.stdout?.trim() || "localhost";

        // 1. Create provision token (server creates independent account + packs secret)
        const result = await provisionCreate(auth.credentials, {
            label: safeName,
            ttlHours: 8760,
        });

        // 2. Build URLs (LAN IP + server param so webapp knows which server to connect)
        const serverUrl = "https://s.sangreal.code.xycloud.info:2443";
        const webappUrl = `http://${machineIp}:8081?provision=${encodeURIComponent(result.provisionToken)}&server=${encodeURIComponent(serverUrl)}`;
        const ttydUrl = `http://${machineIp}:${ttydPort}`;

        // 3. Save URLs to server
        await provisionUpdateUrls(auth.credentials, result.id, { webappUrl, ttydUrl });

        // 4. Docker run
        const dockerCmd = `docker run -d --name "${containerFullName}" --hostname "${safeName}" --network happy_default -v "${volumeName}:/home/coder/.happy" -v "${volumeName}-work:/work" -p ${ttydPort}:7681 -e HAPPY_SERVER_URL="http://happy-server-1:3005" -e HAPPY_PROVISION_TOKEN="${result.provisionToken}" -w /work happy-client`;
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
                const containerName = `happy-${sanitizeContainerName(label)}`;
                await machineBash(machineId, `docker rm -f "${containerName}" 2>/dev/null || true`, "/");
            }

            await provisionRevoke(auth.credentials, tokenId);
            Modal.toast(t("provision.revoked"));
            await loadTokens();
        },
        [auth.credentials, loadTokens, paramMachineId],
    );

    // Restore revoked token
    const handleRestore = React.useCallback(
        async (tokenId: string, label: string | null) => {
            if (!auth.credentials) return;
            const confirmed = await Modal.confirm(
                t("provision.restoreToken"),
                t("provision.restoreConfirm"),
                { confirmText: t("provision.restoreToken") },
            );
            if (!confirmed) return;

            await provisionRestore(auth.credentials, tokenId);
            Modal.toast(t("provision.restored"));
            await loadTokens();
        },
        [auth.credentials, loadTokens],
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

            await provisionRevoke(auth.credentials, tokenId);
            Modal.toast(t("provision.deleted"));
            await loadTokens();
        },
        [auth.credentials, loadTokens],
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
                const dockerExecCmd = containerName ? `docker exec -it ${containerName} zsh` : null;

                return (
                    <ItemGroup
                        key={token.id}
                        title={token.label ? `🟢 ${token.label}` : `🟢 ${token.id.slice(0, 8)}`}
                    >
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

                        {/* ttyd terminal link */}
                        {token.ttydUrl && (
                            <Item
                                title="Web Terminal"
                                subtitle={token.ttydUrl}
                                subtitleStyle={{ color: theme.colors.textLink, fontSize: 12 }}
                                icon={<Ionicons name="terminal-outline" size={20} color={theme.colors.accentPurple} />}
                                onPress={() => Linking.openURL(token.ttydUrl!)}
                                rightElement={
                                    <Ionicons
                                        name="copy-outline"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                        onPress={() => copyAndToast(token.ttydUrl!)}
                                    />
                                }
                            />
                        )}

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
                        onPress={() => handleRestore(token.id, token.label)}
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
