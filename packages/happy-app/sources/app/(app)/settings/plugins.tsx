import * as React from "react";
import { View, Text, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { useSettingMutable } from "@/sync/storage";
import {
    machineListInstalledPlugins,
    machineListMarketplaces,
    machineListAvailablePlugins,
    machinePluginAction,
    machineDiscoverPlugins,
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
    const [plugins, setPlugins] = useSettingMutable("plugins");

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
        const machineId = findOnlineMachineId();
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

    React.useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Refresh
    const [, doRefresh] = useHappyAction(async () => {
        const machineId = findOnlineMachineId();
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
            const machineId = machineIdRef.current ?? findOnlineMachineId();
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

    // Legacy: discover marketplace-level plugins for settings sync
    const [discovering, setDiscovering] = React.useState(false);
    const [, doDiscover] = useHappyAction(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.alert(
                t("settingsPlugins.discoverTitle"),
                t("settingsPlugins.discoverNoSession"),
            );
            return;
        }

        setDiscovering(true);
        try {
            const result = await machineDiscoverPlugins(machineId);
            if (result.plugins.length === 0) {
                Modal.alert(
                    t("settingsPlugins.discoverTitle"),
                    t("settingsPlugins.discoverEmpty"),
                );
                return;
            }

            const existingPaths = new Set(plugins.map((p) => p.path));
            const newPlugins = result.plugins
                .filter((p) => !existingPaths.has(p.path))
                .map((p) => ({
                    id: `discovered-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name: p.name,
                    path: p.path,
                    enabled: true,
                    source: "discovered" as const,
                    version: p.version,
                    description: p.description,
                    author: p.author,
                    homepage: p.homepage,
                    counts: p.counts,
                }));

            if (newPlugins.length === 0) {
                Modal.toast(t("settingsPlugins.discoverAllAdded"));
                return;
            }

            setPlugins([...plugins, ...newPlugins]);
            Modal.toast(
                t("settingsPlugins.discoverFound", {
                    count: newPlugins.length,
                }),
            );
        } finally {
            setDiscovering(false);
        }
    });

    const addManualPlugin = React.useCallback(async () => {
        const path = await Modal.prompt(
            t("settingsPlugins.addTitle"),
            t("settingsPlugins.addDescription"),
            {
                placeholder: "~/.claude/plugins/my-plugin",
                confirmText: t("settingsPlugins.addManual"),
            },
        );
        if (!path) return;

        const name = path.split("/").pop() || path;
        setPlugins([
            ...plugins,
            {
                id: `manual-${Date.now()}`,
                name,
                path,
                enabled: true,
                source: "manual" as const,
            },
        ]);
    }, [plugins, setPlugins]);

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
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: 14,
            backgroundColor: theme.colors.primary,
        },
        installButtonText: {
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: "600",
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
                    <View
                        style={{
                            alignItems: "center",
                            paddingVertical: 16,
                        }}
                    >
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
                                ? `${formatInstalls(plugin.installs)} installs`
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
                        onPress={() =>
                            router.push(
                                `/settings/plugin-detail?key=${encodeURIComponent(plugin.key)}&installPath=${encodeURIComponent(plugin.installPath)}` as any,
                            )
                        }
                    />
                ))}
            </ItemGroup>

            {/* ── Available Plugins (Discover) ── */}
            {loaded && availablePlugins.length > 0 && (
                <ItemGroup title={t("settingsPlugins.availablePlugins")}>
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
                            rightElement={
                                actionInProgress.has(plugin.key) ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.primary}
                                    />
                                ) : (
                                    <Text
                                        style={styles.installButtonText}
                                        onPress={() =>
                                            doPluginAction(
                                                "install",
                                                plugin.key,
                                                plugin.name,
                                            )
                                        }
                                    >
                                        <View style={styles.installButton}>
                                            <Text
                                                style={
                                                    styles.installButtonText
                                                }
                                            >
                                                {t(
                                                    "settingsPlugins.install",
                                                )}
                                            </Text>
                                        </View>
                                    </Text>
                                )
                            }
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* ── Marketplaces ── */}
            {marketplaces.length > 0 && (
                <ItemGroup title={t("settingsPlugins.marketplacesTitle")}>
                    {marketplaces.map((mp) => (
                        <Item
                            key={mp.name}
                            title={mp.name}
                            subtitle={mp.repo}
                            detail={`${mp.installedCount}/${mp.availableCount}`}
                            icon={
                                <Ionicons
                                    name="storefront-outline"
                                    size={22}
                                    color={theme.colors.accentBlue}
                                />
                            }
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* ── Actions ── */}
            <ItemGroup title={t("settingsPlugins.actions")}>
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
                    title={t("settingsPlugins.discover")}
                    subtitle={t("settingsPlugins.discoverDescription")}
                    icon={
                        discovering ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.primary}
                            />
                        ) : (
                            <Ionicons
                                name="search-outline"
                                size={24}
                                color={theme.colors.success}
                            />
                        )
                    }
                    onPress={doDiscover}
                    disabled={discovering}
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
                    onPress={addManualPlugin}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(PluginsSettingsScreen);
