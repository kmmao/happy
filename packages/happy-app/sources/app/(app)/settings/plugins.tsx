import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
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
    machineDiscoverPlugins,
} from "@/sync/ops";
import type { InstalledPlugin, MarketplaceInfo } from "@/sync/ops";
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
    const [loading, setLoading] = React.useState(false);
    const [loaded, setLoaded] = React.useState(false);

    // Load installed plugins & marketplaces on mount
    React.useEffect(() => {
        const machineId = findOnlineMachineId();
        if (!machineId) return;

        setLoading(true);
        Promise.all([
            machineListInstalledPlugins(machineId),
            machineListMarketplaces(machineId),
        ])
            .then(([installed, mps]) => {
                setInstalledPlugins(installed.plugins);
                setMarketplaces(mps.marketplaces);
                setLoaded(true);
            })
            .finally(() => setLoading(false));
    }, []);

    // Refresh action
    const [, doRefresh] = useHappyAction(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.alert(
                t("settingsPlugins.discoverTitle"),
                t("settingsPlugins.discoverNoSession"),
            );
            return;
        }
        setLoading(true);
        try {
            const [installed, mps] = await Promise.all([
                machineListInstalledPlugins(machineId),
                machineListMarketplaces(machineId),
            ]);
            setInstalledPlugins(installed.plugins);
            setMarketplaces(mps.marketplaces);
            setLoaded(true);
            Modal.toast(t("settingsPlugins.refreshSuccess"));
        } finally {
            setLoading(false);
        }
    });

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

    const styles = StyleSheet.create({
        emptyText: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: "center",
            paddingVertical: 16,
            paddingHorizontal: 16,
        },
    });

    return (
        <ItemList>
            {/* ── Installed Plugins (from installed_plugins.json) ── */}
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
                        }
                        onPress={() =>
                            router.push(
                                `/settings/plugin-detail?key=${encodeURIComponent(plugin.key)}&installPath=${encodeURIComponent(plugin.installPath)}` as any,
                            )
                        }
                    />
                ))}
            </ItemGroup>

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
