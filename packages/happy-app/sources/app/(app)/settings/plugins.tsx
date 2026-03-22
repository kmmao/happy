import * as React from "react";
import { View, Text, TextInput, ActivityIndicator, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import {
    machineListInstalledPlugins,
    machineListMarketplaces,
    machineListAvailablePlugins,
    machinePluginAction,
} from "@/sync/ops";
import type { InstalledPlugin, MarketplaceInfo, AvailablePlugin } from "@/sync/ops";
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

/** Format install count: 233901 → "233.9K" */
function formatInstalls(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

function PluginsSettingsScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { machineId: paramMachineId } = useLocalSearchParams<{
        machineId?: string;
    }>();

    /** Resolve machineId: prefer route param, fallback to first online. */
    const resolveMachineId = React.useCallback(
        (): string | null => paramMachineId || findOnlineMachineId(),
        [paramMachineId],
    );

    // Remote data loaded from machine
    const [installedPlugins, setInstalledPlugins] = React.useState<
        readonly InstalledPlugin[]
    >([]);
    const [marketplaces, setMarketplaces] = React.useState<
        readonly MarketplaceInfo[]
    >([]);
    const [availablePlugins, setAvailablePlugins] = React.useState<
        readonly AvailablePlugin[]
    >([]);
    const [loading, setLoading] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = React.useState("");

    // Currently executing action on plugin keys
    const [actionInProgress, setActionInProgress] = React.useState<Set<string>>(
        new Set(),
    );

    const machineIdRef = React.useRef<string | null>(null);

    // Load all data on mount
    const loadAll = React.useCallback(async () => {
        const machineId = resolveMachineId();
        if (!machineId) return;
        machineIdRef.current = machineId;

        setLoading(true);
        try {
            const [installed, mps, available] = await Promise.all([
                machineListInstalledPlugins(machineId),
                machineListMarketplaces(machineId),
                machineListAvailablePlugins(machineId),
            ]);
            setInstalledPlugins(installed.plugins);
            setMarketplaces(mps.marketplaces);
            setAvailablePlugins(available.plugins);
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }, []);

    // Reload when screen gains focus (e.g. after uninstall/enable in detail page)
    useFocusEffect(
        React.useCallback(() => {
            loadAll();
        }, [loadAll]),
    );

    // Refresh
    const [, doRefresh] = useHappyAction(async () => {
        const machineId = resolveMachineId();
        if (!machineId) {
            Modal.alert(
                t("settingsPlugins.discoverTitle"),
                t("settingsPlugins.discoverNoSession"),
            );
            return;
        }
        machineIdRef.current = machineId;
        setLoading(true);
        try {
            const [installed, mps, available] = await Promise.all([
                machineListInstalledPlugins(machineId),
                machineListMarketplaces(machineId),
                machineListAvailablePlugins(machineId),
            ]);
            setInstalledPlugins(installed.plugins);
            setMarketplaces(mps.marketplaces);
            setAvailablePlugins(available.plugins);
            setLoaded(true);
            Modal.toast(t("settingsPlugins.refreshSuccess"));
        } finally {
            setLoading(false);
        }
    });

    // Plugin action (install/uninstall/enable/disable)
    const doPluginAction = React.useCallback(
        async (
            action: "install" | "uninstall" | "enable" | "disable",
            pluginKey: string,
            pluginName: string,
        ) => {
            const machineId = machineIdRef.current ?? resolveMachineId();
            if (!machineId) {
                Modal.toast(t("settingsPlugins.noMachineOnline"));
                return;
            }

            if (action === "uninstall") {
                const confirmed = await Modal.confirm(
                    t("settingsPlugins.uninstall"),
                    t("settingsPlugins.confirmUninstall"),
                    { destructive: true },
                );
                if (!confirmed) return;
            }

            setActionInProgress((prev) => new Set([...prev, pluginKey]));
            try {
                const result = await machinePluginAction(
                    machineId,
                    action,
                    pluginKey,
                );
                if (result.success) {
                    const successKey = `${action}Success` as
                        | "installSuccess"
                        | "uninstallSuccess"
                        | "enableSuccess"
                        | "disableSuccess";
                    Modal.toast(
                        t(`settingsPlugins.${successKey}`, {
                            name: pluginName,
                        }),
                    );
                    // Reload data after action
                    await loadAll();
                } else {
                    Modal.toast(
                        t("settingsPlugins.actionFailed", {
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
                    next.delete(pluginKey);
                    return next;
                });
            }
        },
        [loadAll],
    );

    // Filter available plugins by search query (exclude installed)
    const filteredAvailable = React.useMemo(() => {
        const notInstalled = availablePlugins.filter((p) => !p.installed);
        if (!searchQuery) return notInstalled;
        const q = searchQuery.toLowerCase();
        return notInstalled.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                p.description?.toLowerCase().includes(q) ||
                p.category?.toLowerCase().includes(q),
        );
    }, [availablePlugins, searchQuery]);

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
        searchContainer: {
            paddingHorizontal: 16,
            paddingVertical: 8,
        },
        searchInput: {
            backgroundColor: theme.colors.groupped.background,
            color: theme.colors.text,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontSize: 15,
        },
        installButton: {
            paddingHorizontal: 14,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: theme.colors.groupped.background,
        },
        installButtonText: {
            color: theme.colors.primary,
            fontSize: 13,
            fontWeight: "600",
        },
        enabledBadge: {
            fontSize: 12,
            color: theme.colors.success,
            fontWeight: "500",
        },
        disabledBadge: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            fontWeight: "500",
        },
    });

    return (
        <ItemList>
            {/* ── Installed Plugins ── */}
            <ItemGroup
                title={t("settingsPlugins.installed")}
                footer={t("settingsPlugins.installedDescription")}
            >
                {loading && !loaded && (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator
                            size="small"
                            color={theme.colors.primary}
                        />
                    </View>
                )}
                {loaded && installedPlugins.length === 0 && (
                    <View>
                        <Text style={styles.emptyText}>
                            {t("settingsPlugins.noPlugins")}
                        </Text>
                    </View>
                )}
                {installedPlugins.map((plugin) => (
                    <Item
                        key={plugin.key}
                        title={plugin.name}
                        subtitle={
                            plugin.description ||
                            `${plugin.marketplace} · v${plugin.version}`
                        }
                        detail={
                            plugin.installs
                                ? t("settingsPlugins.installs", {
                                      count: formatInstalls(
                                          plugin.installs,
                                      ),
                                  })
                                : plugin.marketplace
                        }
                        icon={
                            actionInProgress.has(plugin.key) ? (
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.primary}
                                />
                            ) : (
                                <Ionicons
                                    name={
                                        plugin.enabled
                                            ? "checkmark-circle"
                                            : "ellipse-outline"
                                    }
                                    size={22}
                                    color={
                                        plugin.enabled
                                            ? theme.colors.success
                                            : theme.colors.textSecondary
                                    }
                                />
                            )
                        }
                        rightElement={
                            <Text
                                style={
                                    plugin.enabled
                                        ? styles.enabledBadge
                                        : styles.disabledBadge
                                }
                            >
                                {plugin.enabled
                                    ? t("settingsPlugins.enable")
                                    : t("settingsPlugins.disable")}
                            </Text>
                        }
                        onPress={() =>
                            router.push(
                                `/settings/plugin-detail?key=${encodeURIComponent(plugin.key)}&installPath=${encodeURIComponent(plugin.installPath)}&enabled=${plugin.enabled ? "1" : "0"}` as any,
                            )
                        }
                    />
                ))}
            </ItemGroup>

            {/* ── Available Plugins (Discover) ── */}
            {loaded && availablePlugins.length > 0 && (
                <ItemGroup
                    title={`${t("settingsPlugins.availablePlugins")} (${filteredAvailable.length})`}
                >
                    <View style={styles.searchContainer}>
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t("settingsPlugins.searchPlugins")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                    {searchQuery && filteredAvailable.length === 0 && (
                        <View>
                            <Text style={styles.emptyText}>
                                {t("settingsPlugins.noResults")}
                            </Text>
                        </View>
                    )}
                    {filteredAvailable.slice(0, 50).map((plugin) => (
                        <Item
                            key={plugin.key}
                            title={plugin.name}
                            subtitle={plugin.description || plugin.marketplace}
                            detail={
                                plugin.installs
                                    ? t("settingsPlugins.installs", {
                                          count: formatInstalls(
                                              plugin.installs,
                                          ),
                                      })
                                    : plugin.category
                            }
                            icon={
                                <Ionicons
                                    name="cube-outline"
                                    size={20}
                                    color={theme.colors.textSecondary}
                                />
                            }
                            onPress={async () => {
                                const desc =
                                    plugin.description ||
                                    t("settingsPlugins.noDescription");
                                const info = [
                                    desc,
                                    "",
                                    `${t("settingsPlugins.marketplacesTitle")}: ${plugin.marketplace}`,
                                    plugin.category
                                        ? `Category: ${plugin.category}`
                                        : "",
                                    plugin.installs
                                        ? t("settingsPlugins.installs", {
                                              count: formatInstalls(
                                                  plugin.installs,
                                              ),
                                          })
                                        : "",
                                    plugin.homepage
                                        ? `${t("settingsPlugins.homepage")}: ${plugin.homepage}`
                                        : "",
                                ]
                                    .filter(Boolean)
                                    .join("\n");

                                const shouldInstall = await Modal.confirm(
                                    plugin.name,
                                    info,
                                    {
                                        confirmText: t(
                                            "settingsPlugins.install",
                                        ),
                                    },
                                );
                                if (shouldInstall) {
                                    doPluginAction(
                                        "install",
                                        plugin.key,
                                        plugin.name,
                                    );
                                }
                            }}
                            rightElement={
                                actionInProgress.has(plugin.key) ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.primary}
                                    />
                                ) : (
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.installButton,
                                            pressed && { opacity: 0.7 },
                                        ]}
                                        onPress={() =>
                                            doPluginAction(
                                                "install",
                                                plugin.key,
                                                plugin.name,
                                            )
                                        }
                                    >
                                        <Text style={styles.installButtonText}>
                                            {t("settingsPlugins.install")}
                                        </Text>
                                    </Pressable>
                                )
                            }
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* ── Marketplaces ── */}
            {marketplaces.length > 0 && (
                <ItemGroup
                    title={t("settingsPlugins.marketplacesTitle")}
                    footer={t("settingsPlugins.marketplaceFooter")}
                >
                    {marketplaces.map((mp) => (
                        <Item
                            key={mp.name}
                            title={mp.name}
                            subtitle={`${mp.repo} · ${mp.installedCount}/${mp.availableCount}`}
                            detail={mp.lastUpdated.split("T")[0]}
                            icon={
                                actionInProgress.has(`mp:${mp.name}`) ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.primary}
                                    />
                                ) : (
                                    <Ionicons
                                        name="storefront-outline"
                                        size={22}
                                        color={theme.colors.accentBlue}
                                    />
                                )
                            }
                            onPress={async () => {
                                const machineId =
                                    machineIdRef.current ??
                                    resolveMachineId();
                                if (!machineId) {
                                    Modal.toast(
                                        t("settingsPlugins.noMachineOnline"),
                                    );
                                    return;
                                }
                                const mpKey = `mp:${mp.name}`;
                                setActionInProgress(
                                    (prev) => new Set([...prev, mpKey]),
                                );
                                try {
                                    const result = await machinePluginAction(
                                        machineId,
                                        "marketplace-update" as any,
                                        mp.name,
                                    );
                                    if (result.success) {
                                        Modal.toast(
                                            t(
                                                "settingsPlugins.updateMarketplaceSuccess",
                                            ),
                                        );
                                        await loadAll();
                                    } else {
                                        Modal.toast(
                                            t(
                                                "settingsPlugins.actionFailed",
                                                {
                                                    error:
                                                        result.stderr?.slice(
                                                            0,
                                                            100,
                                                        ) || "Update failed",
                                                },
                                            ),
                                        );
                                    }
                                } finally {
                                    setActionInProgress((prev) => {
                                        const next = new Set(prev);
                                        next.delete(mpKey);
                                        return next;
                                    });
                                }
                            }}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* ── Actions ── */}
            <ItemGroup
                title={t("settingsPlugins.actions")}
                footer={t("settingsPlugins.restartHint")}
            >
                <Item
                    title={t("settingsPlugins.refreshMetadata")}
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
                <Item
                    title={t("settingsPlugins.addManual")}
                    subtitle={t("settingsPlugins.addManualDescription")}
                    icon={
                        <Ionicons
                            name="add-circle-outline"
                            size={24}
                            color={theme.colors.accentBlue}
                        />
                    }
                    onPress={async () => {
                        const path = await Modal.prompt(
                            t("settingsPlugins.addTitle"),
                            t("settingsPlugins.addDescription"),
                            {
                                placeholder: t("settingsPlugins.addPlaceholder"),
                                confirmText: t("settingsPlugins.addManual"),
                            },
                        );
                        if (!path) return;
                        const machineId =
                            machineIdRef.current ?? resolveMachineId();
                        if (!machineId) {
                            Modal.toast(t("settingsPlugins.noMachineOnline"));
                            return;
                        }
                        const name = path.split("/").pop() || path;
                        const result = await machinePluginAction(
                            machineId,
                            "install",
                            path,
                        );
                        if (result.success) {
                            Modal.toast(
                                t("settingsPlugins.installSuccess", { name }),
                            );
                            await loadAll();
                        } else {
                            Modal.toast(
                                t("settingsPlugins.actionFailed", {
                                    error:
                                        result.stderr?.slice(0, 100) ||
                                        "Install failed",
                                }),
                            );
                        }
                    }}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(PluginsSettingsScreen);
