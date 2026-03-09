import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    Pressable,
    ScrollView,
    TextInput,
    ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { Switch } from "@/components/Switch";
import * as Clipboard from "expo-clipboard";
import {
    generateWebhookSecret,
    getWebhookUrl,
} from "@/sync/webhookRouteSync";
import { machineListGitRepos } from "@/sync/ops";
import type { GitRepoEntry } from "@/sync/ops";
import type { WebhookRepoConfig } from "@/sync/issueTypes";
import type { Provider } from "./types";

interface Props {
    readonly repo: WebhookRepoConfig;
    readonly index: number;
    readonly provider: Provider;
    readonly machines: readonly { id: string; metadata?: any }[];
    readonly theme: any;
    readonly onUpdate: (
        index: number,
        updates: Partial<WebhookRepoConfig>,
    ) => void;
    readonly onRemove: (index: number) => void;
}

export const WebhookRepoItem = React.memo(function WebhookRepoItem({
    repo,
    index,
    provider,
    machines,
    theme,
    onUpdate,
    onRemove,
}: Props) {
    const [scanning, setScanning] = useState(false);
    const [scanResults, setScanResults] = useState<readonly GitRepoEntry[]>(
        [],
    );
    const [showScanResults, setShowScanResults] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [scanSearch, setScanSearch] = useState("");
    const [testing, setTesting] = useState(false);

    const handleCopySecret = async () => {
        await Clipboard.setStringAsync(repo.secret);
        HappyModal.toast(t("gitHosts.webhookSecretCopied"));
    };

    const handleCopyUrl = async () => {
        const url = getWebhookUrl(provider);
        await Clipboard.setStringAsync(url);
        HappyModal.toast(t("gitHosts.webhookUrlCopied"));
    };

    const handleRegenSecret = () => {
        onUpdate(index, { secret: generateWebhookSecret() });
    };

    const handleScanRepos = useCallback(async () => {
        if (!repo.machineId || scanning) return;
        setScanning(true);
        setScanError(null);
        setScanResults([]);
        setScanSearch("");
        setShowScanResults(true);
        try {
            const repos = await machineListGitRepos(repo.machineId);
            setScanResults(repos);
            if (repos.length === 0) {
                setScanError(t("gitHosts.scanEmpty"));
            }
        } catch {
            setScanError(t("gitHosts.scanError"));
        } finally {
            setScanning(false);
        }
    }, [repo.machineId, scanning]);

    const handleSelectRepo = useCallback(
        (entry: GitRepoEntry) => {
            onUpdate(index, {
                repoUrl: entry.remoteUrl,
                repoPath: entry.repoPath,
            });
            setShowScanResults(false);
        },
        [index, onUpdate],
    );

    const handleShowGuide = useCallback(() => {
        const webhookUrl = getWebhookUrl(provider);
        const providerName = provider === "github" ? "GitHub" : "Gitea";
        const steps =
            provider === "github"
                ? `1. ${t("gitHosts.guideStep1GitHub")}\n2. ${t("gitHosts.guideStep2")}\n3. ${t("gitHosts.guideStep3")}\n4. ${t("gitHosts.guideStep4")}\n5. ${t("gitHosts.guideStep5")}`
                : `1. ${t("gitHosts.guideStep1Gitea")}\n2. ${t("gitHosts.guideStep2")}\n3. ${t("gitHosts.guideStep3")}\n4. ${t("gitHosts.guideStep4")}\n5. ${t("gitHosts.guideStep5")}`;
        HappyModal.confirm(
            t("gitHosts.webhookGuideTitle", { provider: providerName }),
            `${steps}\n\nWebhook URL:\n${webhookUrl}`,
            { cancelText: t("common.ok") },
        );
    }, [provider]);

    const handleTestWebhook = useCallback(async () => {
        if (testing) return;
        setTesting(true);
        try {
            const webhookUrl = getWebhookUrl(provider);
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "ping" }),
            });
            if (response.ok) {
                HappyModal.toast(t("gitHosts.webhookTestSuccess"));
            } else {
                HappyModal.toast(
                    t("gitHosts.webhookTestFail", {
                        status: String(response.status),
                    }),
                );
            }
        } catch {
            HappyModal.toast(t("gitHosts.webhookTestError"));
        } finally {
            setTesting(false);
        }
    }, [provider, testing]);

    return (
        <View
            style={{
                backgroundColor: theme.colors.surface,
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
            }}
        >
            {/* Header with enabled toggle, guide, test, remove */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                }}
            >
                <Switch
                    value={repo.enabled}
                    onValueChange={(v) => onUpdate(index, { enabled: v })}
                />
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <Pressable onPress={handleShowGuide} hitSlop={8}>
                        <Ionicons
                            name="help-circle-outline"
                            size={20}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                    <Pressable
                        onPress={handleTestWebhook}
                        hitSlop={8}
                        disabled={testing}
                        style={{ opacity: testing ? 0.5 : 1 }}
                    >
                        {testing ? (
                            <ActivityIndicator
                                size={16}
                                color={theme.colors.textLink}
                            />
                        ) : (
                            <Ionicons
                                name="flash-outline"
                                size={20}
                                color={theme.colors.textLink}
                            />
                        )}
                    </Pressable>
                    <Pressable onPress={() => onRemove(index)} hitSlop={8}>
                        <Text
                            style={{
                                fontSize: 13,
                                color: theme.colors.box.warning.text,
                                ...Typography.default(),
                            }}
                        >
                            {t("gitHosts.webhookRemoveRepo")}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Target Machine */}
            <FieldLabel theme={theme}>
                {t("gitHosts.webhookMachineId")}
            </FieldLabel>
            {machines.length === 0 ? (
                <Text
                    style={{
                        fontSize: 13,
                        color: theme.colors.box.warning.text,
                        marginBottom: 10,
                        ...Typography.default(),
                    }}
                >
                    {t("gitHosts.webhookNoMachines")}
                </Text>
            ) : (
                <View
                    style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 6,
                        marginBottom: 10,
                    }}
                >
                    {machines.map((machine) => (
                        <Pressable
                            key={machine.id}
                            style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 6,
                                backgroundColor:
                                    repo.machineId === machine.id
                                        ? theme.colors.button.primary.background
                                        : theme.colors.input.background,
                            }}
                            onPress={() =>
                                onUpdate(index, { machineId: machine.id })
                            }
                        >
                            <Text
                                style={{
                                    fontSize: 12,
                                    color:
                                        repo.machineId === machine.id
                                            ? theme.colors.button.primary.tint
                                            : theme.colors.text,
                                    ...Typography.default(
                                        repo.machineId === machine.id
                                            ? "semiBold"
                                            : undefined,
                                    ),
                                }}
                            >
                                {machine.metadata?.displayName ??
                                    machine.metadata?.host ??
                                    machine.id.slice(0, 8)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {/* Scan repos button */}
            {repo.machineId ? (
                <Pressable
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: theme.colors.input.background,
                        marginBottom: 10,
                        opacity: scanning ? 0.6 : 1,
                    }}
                    onPress={handleScanRepos}
                    disabled={scanning}
                >
                    {scanning ? (
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.textLink}
                            style={{ marginRight: 6 }}
                        />
                    ) : (
                        <Ionicons
                            name="search-outline"
                            size={16}
                            color={theme.colors.textLink}
                            style={{ marginRight: 6 }}
                        />
                    )}
                    <Text
                        style={{
                            fontSize: 13,
                            color: theme.colors.textLink,
                            ...Typography.default("semiBold"),
                        }}
                    >
                        {scanning
                            ? t("gitHosts.scanning")
                            : t("gitHosts.scanRepos")}
                    </Text>
                </Pressable>
            ) : null}

            {/* Scan results */}
            {showScanResults && (
                <View
                    style={{
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 8,
                        marginBottom: 10,
                        overflow: "hidden",
                    }}
                >
                    {scanError ? (
                        <Text
                            style={{
                                padding: 12,
                                fontSize: 13,
                                color: theme.colors.textSecondary,
                                textAlign: "center",
                                ...Typography.default(),
                            }}
                        >
                            {scanError}
                        </Text>
                    ) : (
                        <>
                            {scanResults.length > 0 && (
                                <TextInput
                                    style={{
                                        padding: 10,
                                        fontSize: 14,
                                        color: theme.colors.text,
                                        borderBottomWidth: 0.5,
                                        borderBottomColor:
                                            theme.colors.border,
                                        ...Typography.default(),
                                    }}
                                    value={scanSearch}
                                    onChangeText={setScanSearch}
                                    placeholder={t(
                                        "gitHosts.scanSearchPlaceholder",
                                    )}
                                    placeholderTextColor={
                                        theme.colors.textSecondary
                                    }
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            )}
                            <ScrollView
                                style={{ maxHeight: 240 }}
                                nestedScrollEnabled
                            >
                                {scanResults
                                    .filter((entry) => {
                                        if (!scanSearch) return true;
                                        const q = scanSearch.toLowerCase();
                                        return (
                                            entry.name
                                                .toLowerCase()
                                                .includes(q) ||
                                            entry.repoPath
                                                .toLowerCase()
                                                .includes(q) ||
                                            entry.remoteUrl
                                                .toLowerCase()
                                                .includes(q)
                                        );
                                    })
                                    .map((entry) => (
                                        <Pressable
                                            key={entry.repoPath}
                                            style={{
                                                paddingHorizontal: 12,
                                                paddingVertical: 10,
                                                borderBottomWidth: 0.5,
                                                borderBottomColor:
                                                    theme.colors.border,
                                            }}
                                            onPress={() =>
                                                handleSelectRepo(entry)
                                            }
                                        >
                                            <Text
                                                style={{
                                                    fontSize: 14,
                                                    color: theme.colors.text,
                                                    ...Typography.default(
                                                        "semiBold",
                                                    ),
                                                }}
                                                numberOfLines={1}
                                            >
                                                {entry.name}
                                            </Text>
                                            <Text
                                                style={{
                                                    fontSize: 11,
                                                    color: theme.colors
                                                        .textSecondary,
                                                    marginTop: 2,
                                                    ...Typography.mono(),
                                                }}
                                                numberOfLines={1}
                                            >
                                                {entry.repoPath}
                                            </Text>
                                        </Pressable>
                                    ))}
                            </ScrollView>
                        </>
                    )}
                </View>
            )}

            {/* Repo URL */}
            <FieldLabel theme={theme}>
                {t("gitHosts.webhookRepoUrl")}
            </FieldLabel>
            <TextInput
                style={{
                    backgroundColor: theme.colors.input.background,
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    color: theme.colors.text,
                    marginBottom: 10,
                    ...Typography.mono(),
                }}
                value={repo.repoUrl}
                onChangeText={(v) => onUpdate(index, { repoUrl: v })}
                placeholder={t("gitHosts.webhookRepoUrlPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
            />

            {/* Local repo path */}
            <FieldLabel theme={theme}>
                {t("gitHosts.webhookRepoPath")}
            </FieldLabel>
            <TextInput
                style={{
                    backgroundColor: theme.colors.input.background,
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    color: theme.colors.text,
                    marginBottom: 10,
                    ...Typography.mono(),
                }}
                value={repo.repoPath}
                onChangeText={(v) => onUpdate(index, { repoPath: v })}
                placeholder={t("gitHosts.webhookRepoPathPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
            />

            {/* Secret */}
            <FieldLabel theme={theme}>
                {t("gitHosts.webhookSecretLabel")}
            </FieldLabel>
            <View
                style={{
                    flexDirection: "row",
                    gap: 6,
                    marginBottom: 10,
                }}
            >
                <TextInput
                    style={{
                        flex: 1,
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 12,
                        color: theme.colors.text,
                        ...Typography.mono(),
                    }}
                    value={repo.secret}
                    onChangeText={(v) => onUpdate(index, { secret: v })}
                    placeholder="..."
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                <Pressable
                    style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 6,
                        backgroundColor: theme.colors.input.background,
                        justifyContent: "center",
                    }}
                    onPress={handleRegenSecret}
                >
                    <Ionicons
                        name="refresh-outline"
                        size={16}
                        color={theme.colors.textLink}
                    />
                </Pressable>
                {repo.secret.length > 0 && (
                    <Pressable
                        style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 6,
                            backgroundColor: theme.colors.input.background,
                            justifyContent: "center",
                        }}
                        onPress={handleCopySecret}
                    >
                        <Ionicons
                            name="copy-outline"
                            size={16}
                            color={theme.colors.textLink}
                        />
                    </Pressable>
                )}
            </View>

            {/* Webhook URL (read-only) */}
            <FieldLabel theme={theme}>
                {t("gitHosts.webhookUrlLabel")}
            </FieldLabel>
            <Pressable
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: theme.colors.input.background,
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 4,
                    gap: 6,
                }}
                onPress={handleCopyUrl}
            >
                <Text
                    style={{
                        flex: 1,
                        fontSize: 12,
                        color: theme.colors.text,
                        ...Typography.mono(),
                    }}
                    numberOfLines={1}
                >
                    {getWebhookUrl(provider)}
                </Text>
                <Ionicons
                    name="copy-outline"
                    size={14}
                    color={theme.colors.textLink}
                />
            </Pressable>
            <Text
                style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    marginBottom: 4,
                    lineHeight: 16,
                    ...Typography.default(),
                }}
            >
                {t("gitHosts.webhookUrlHint")}
            </Text>
        </View>
    );
});

const FieldLabel = React.memo<{
    theme: any;
    children: string;
}>(function FieldLabel({ theme, children }) {
    return (
        <Text
            style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                marginBottom: 6,
                ...Typography.default(),
            }}
        >
            {children}
        </Text>
    );
});
