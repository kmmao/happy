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
import { getWebappUrl } from "@/sync/serverConfig";
import { isMachineOnline } from "@/utils/machineUtils";
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

    // Create: ask name → create token → docker run → show result
    const [, handleCreate] = useHappyAction(async () => {
        if (!auth.credentials) return;

        // Use specified machine or fallback to first online
        const machineId = paramMachineId || findOnlineMachineId();
        if (!machineId) {
            Modal.alert(t("provision.createToken"), t("provision.noMachineOnline"));
            return;
        }

        // Verify machine is online
        const machines = storage.getState().machines;
        const machine = machines[machineId];
        if (machine && !isMachineOnline(machine)) {
            Modal.alert(t("provision.createToken"), t("provision.noMachineOnline"));
            return;
        }

        // Check webapp URL is configured
        const webappBaseUrl = getWebappUrl();
        if (!webappBaseUrl) {
            Modal.alert(
                t("provision.createToken"),
                t("provision.webappUrlNotConfigured"),
            );
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

        Modal.toast(t("provision.creatingContainer"));

        // Find next available ttyd port (7001-7100)
        const portScanResult = await machineBash(machineId, "docker ps --format '{{.Ports}}' | grep -oP '0\\.0\\.0\\.0:\\K(70[0-9]{2})' | sort -n | tail -1", "/");
        const lastPort = parseInt(portScanResult.stdout?.trim() || "7000", 10);
        const ttydPort = Math.max(lastPort + 1, 7001);

        // Create token on server (with URLs pre-computed)
        const serverHost = new URL(webappBaseUrl).hostname.replace(/^w\./, "");
        const webappUrl = `${webappBaseUrl}?provision=PLACEHOLDER`;
        const ttydUrl = `http://${serverHost}:${ttydPort}`;

        const result = await provisionCreate(auth.credentials, {
            label: safeName,
            ttlHours: 8760,
            // Store final URLs after we have the token
        });

        // Now we have the provision token, build the real webapp URL
        const finalWebappUrl = `${webappBaseUrl}?provision=${encodeURIComponent(result.provisionToken)}`;
        const finalTtydUrl = ttydUrl;

        // Update the server record with the real URLs
        // (We'll do a PATCH-like approach — just create with the URLs embedded)
        // For now, the URLs are passed at creation time, so we need to create AFTER we know them.
        // Since the current API creates the token and returns it, we do a second call to update.
        // Actually, let's just re-create properly...

        // Workaround: delete and re-create with URLs
        await provisionRevoke(auth.credentials, result.id);
        const resultWithUrls = await provisionCreate(auth.credentials, {
            label: safeName,
            ttlHours: 8760,
            webappUrl: finalWebappUrl,
            ttydUrl: finalTtydUrl,
        });

        // Build the real webapp URL with the NEW token
        const realWebappUrl = `${webappBaseUrl}?provision=${encodeURIComponent(resultWithUrls.provisionToken)}`;

        // Execute docker run
        const containerFullName = `happy-${safeName}`;
        const dockerCmd = `docker run -d --name "${containerFullName}" -v "${volumeName}:/root/.happy" -p ${ttydPort}:7681 -e HAPPY_PROVISION_TOKEN="${resultWithUrls.provisionToken}" happy-client`;
        const bashResult = await machineBash(machineId, dockerCmd, "/");

        if (bashResult.success && bashResult.exitCode === 0) {
            await Clipboard.setStringAsync(realWebappUrl);
            Modal.alert(
                t("provision.containerCreated"),
                t("provision.containerCreatedDescription", { name: safeName, url: `${t("provision.webAppUrl")}\n${realWebappUrl}\n\n${t("provision.terminalUrl")}\n${finalTtydUrl}` }),
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
        linkItem: {
            fontSize: 13,
            color: theme.colors.textLink,
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
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                    </View>
                )}

                {!loading && tokens.length === 0 && (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="key-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={styles.emptyTitle}>{t("provision.emptyTitle")}</Text>
                        <Text style={styles.emptyDescription}>{t("provision.emptyDescription")}</Text>
                    </View>
                )}

                {tokens.map((token) => {
                    const isRevoked = !!token.revokedAt;
                    return (
                        <React.Fragment key={token.id}>
                            <Item
                                title={token.label || token.id.slice(0, 12)}
                                subtitle={formatDate(token.createdAt)}
                                icon={
                                    <Ionicons
                                        name={isRevoked ? "close-circle" : "key"}
                                        size={24}
                                        color={isRevoked ? theme.colors.deleteAction : theme.colors.success}
                                    />
                                }
                                rightElement={
                                    <Text
                                        style={[
                                            styles.statusBadge,
                                            { color: isRevoked ? theme.colors.deleteAction : theme.colors.success },
                                        ]}
                                    >
                                        {isRevoked ? t("provision.revoked") : t("provision.active")}
                                    </Text>
                                }
                                onPress={
                                    isRevoked
                                        ? () => handleDelete(token.id)
                                        : () => handleRevoke(token.id, token.label)
                                }
                            />
                            {/* Show clickable URLs for active tokens */}
                            {!isRevoked && token.webappUrl && (
                                <Item
                                    title={t("provision.webAppUrl")}
                                    subtitle={token.webappUrl}
                                    subtitleLines={1}
                                    subtitleStyle={styles.linkItem}
                                    icon={<Ionicons name="globe-outline" size={20} color={theme.colors.textLink} />}
                                    onPress={() => Linking.openURL(token.webappUrl!)}
                                    showChevron={false}
                                />
                            )}
                            {!isRevoked && token.ttydUrl && (
                                <Item
                                    title={t("provision.terminalUrl")}
                                    subtitle={token.ttydUrl}
                                    subtitleLines={1}
                                    subtitleStyle={styles.linkItem}
                                    icon={<Ionicons name="terminal-outline" size={20} color={theme.colors.textLink} />}
                                    onPress={() => Linking.openURL(token.ttydUrl!)}
                                    showChevron={false}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(ProvisionSettingsScreen);
