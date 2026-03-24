import * as React from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import {
    provisionCreate,
    provisionList,
    provisionRevoke,
    type ProvisionTokenItem,
} from "@/sync/apiProvision";

/** Find the first online machine ID from storage. */
function findOnlineMachineId(): string | null {
    const machines = storage.getState().machines;
    const online = Object.values(machines).find((m) => m.active);
    return online?.id ?? null;
}

/** Sanitize container name: only allow [a-zA-Z0-9_.-] */
function sanitizeContainerName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-");
}

function ProvisionSettingsScreen() {
    const { theme } = useUnistyles();
    const auth = useAuth();
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

    // Create: ask name → create token → docker run → show result
    const [, handleCreate] = useHappyAction(async () => {
        if (!auth.credentials) return;

        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.alert(
                t("provision.createToken"),
                t("provision.noMachineOnline"),
            );
            return;
        }

        // Only ask for a name
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

        Modal.toast(t("provision.creatingContainer"));

        // Create token on server
        const result = await provisionCreate(auth.credentials, {
            label: safeName,
            ttlHours: 8760, // 1 year
        });

        // Execute docker run — daemon + ttyd auto-start, ttyd on random host port
        const containerFullName = `happy-${safeName}`;
        const dockerCmd = `docker run -d --name "${containerFullName}" -v "${volumeName}:/root/.happy" -p 7681 -e HAPPY_PROVISION_TOKEN="${result.provisionToken}" happy-client`;
        const bashResult = await machineBash(machineId, dockerCmd, "/");

        if (bashResult.success && bashResult.exitCode === 0) {
            // Query the assigned ttyd port
            const portResult = await machineBash(machineId, `docker port "${containerFullName}" 7681 | head -1 | cut -d: -f2`, "/");
            const ttydPort = portResult.stdout?.trim() || "?";

            // Build URLs
            const serverUrl = getServerUrl();
            const webAppUrl = `${serverUrl}/app?provision=${encodeURIComponent(result.provisionToken)}`;

            // ttyd URL: same host as server, different port
            const serverHost = new URL(serverUrl).hostname;
            const ttydUrl = `http://${serverHost}:${ttydPort}`;

            const urls = `${t("provision.webAppUrl")}\n${webAppUrl}\n\n${t("provision.terminalUrl")}\n${ttydUrl}`;
            await Clipboard.setStringAsync(webAppUrl);

            Modal.alert(
                t("provision.containerCreated"),
                t("provision.containerCreatedDescription", { name: safeName, url: urls }),
            );
        } else {
            const errorMsg = bashResult.stderr || bashResult.error || "Unknown error";
            Modal.alert(
                t("provision.containerFailed"),
                t("provision.containerFailedDescription", { error: errorMsg }),
            );
        }

        await loadTokens();
    });

    // Active token: revoke + stop container
    const handleRevoke = React.useCallback(
        async (tokenId: string, label: string | null) => {
            if (!auth.credentials) return;

            const confirmed = await Modal.confirm(
                t("provision.revokeToken"),
                t("provision.revokeConfirm"),
                { confirmText: t("provision.revokeToken"), destructive: true },
            );
            if (!confirmed) return;

            // Stop and remove the container
            const machineId = findOnlineMachineId();
            if (machineId && label) {
                const containerName = `happy-${sanitizeContainerName(label)}`;
                await machineBash(machineId, `docker rm -f "${containerName}" 2>/dev/null || true`, "/");
            }

            await provisionRevoke(auth.credentials, tokenId);
            Modal.toast(t("provision.revoked"));
            await loadTokens();
        },
        [auth.credentials, loadTokens],
    );

    // Revoked token: delete permanently
    const handleDelete = React.useCallback(
        async (tokenId: string) => {
            if (!auth.credentials) return;
            await provisionRevoke(auth.credentials, tokenId);
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
        statusBadge: {
            fontSize: 12,
            fontWeight: "500",
        },
    });

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };

    return (
        <ItemList>
            {/* Create button */}
            <ItemGroup>
                <Item
                    title={t("provision.createToken")}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={29}
                            color={theme.colors.accentBlue}
                        />
                    }
                    onPress={handleCreate}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Token list */}
            <ItemGroup title={t("provision.title")}>
                {loading && tokens.length === 0 && (
                    <View style={{ alignItems: "center", paddingVertical: 16 }}>
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.primary}
                        />
                    </View>
                )}

                {!loading && tokens.length === 0 && (
                    <View style={styles.emptyContainer}>
                        <Ionicons
                            name="key-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.emptyTitle}>
                            {t("provision.emptyTitle")}
                        </Text>
                        <Text style={styles.emptyDescription}>
                            {t("provision.emptyDescription")}
                        </Text>
                    </View>
                )}

                {tokens.map((token) => {
                    const isRevoked = !!token.revokedAt;
                    return (
                        <Item
                            key={token.id}
                            title={token.label || token.id.slice(0, 12)}
                            subtitle={formatDate(token.createdAt)}
                            icon={
                                <Ionicons
                                    name={isRevoked ? "close-circle" : "key"}
                                    size={24}
                                    color={
                                        isRevoked
                                            ? theme.colors.deleteAction
                                            : theme.colors.success
                                    }
                                />
                            }
                            rightElement={
                                <Text
                                    style={[
                                        styles.statusBadge,
                                        {
                                            color: isRevoked
                                                ? theme.colors.deleteAction
                                                : theme.colors.success,
                                        },
                                    ]}
                                >
                                    {isRevoked
                                        ? t("provision.revoked")
                                        : t("provision.active")}
                                </Text>
                            }
                            onPress={
                                isRevoked
                                    ? () => handleDelete(token.id)
                                    : () => handleRevoke(token.id, token.label)
                            }
                        />
                    );
                })}
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(ProvisionSettingsScreen);
