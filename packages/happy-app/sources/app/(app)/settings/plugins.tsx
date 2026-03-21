import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Switch } from "@/components/Switch";
import { useSettingMutable } from "@/sync/storage";
import { sessionDiscoverPlugins } from "@/sync/ops";
import { Modal } from "@/modal";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { storage } from "@/sync/storage";

type PluginEntry = {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
    source: "manual" | "discovered";
};

function PluginsSettingsScreen() {
    const { theme } = useUnistyles();
    const [plugins, setPlugins] = useSettingMutable("plugins");
    const [discovering, setDiscovering] = React.useState(false);

    const togglePlugin = React.useCallback(
        (id: string, enabled: boolean) => {
            setPlugins(
                plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
            );
        },
        [plugins, setPlugins],
    );

    const removePlugin = React.useCallback(
        async (id: string) => {
            const confirmed = await Modal.confirm(
                t("settingsPlugins.removeTitle"),
                t("settingsPlugins.removeConfirm"),
                { destructive: true },
            );
            if (confirmed) {
                setPlugins(plugins.filter((p) => p.id !== id));
            }
        },
        [plugins, setPlugins],
    );

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
        const newPlugin: PluginEntry = {
            id: `manual-${Date.now()}`,
            name,
            path,
            enabled: true,
            source: "manual",
        };
        setPlugins([...plugins, newPlugin]);
    }, [plugins, setPlugins]);

    const [, doDiscover] = useHappyAction(async () => {
        // Find an active session to run discovery RPC
        const sessions = storage.getState().sessions;
        const activeSession = Object.values(sessions).find(
            (s) => s.active,
        );
        if (!activeSession) {
            Modal.alert(
                t("settingsPlugins.discoverTitle"),
                t("settingsPlugins.discoverNoSession"),
            );
            return;
        }

        setDiscovering(true);
        try {
            const result = await sessionDiscoverPlugins(activeSession.id);
            if (result.plugins.length === 0) {
                Modal.alert(
                    t("settingsPlugins.discoverTitle"),
                    t("settingsPlugins.discoverEmpty"),
                );
                return;
            }

            // Merge discovered plugins with existing — skip already-added paths
            const existingPaths = new Set(plugins.map((p) => p.path));
            const newPlugins = result.plugins
                .filter((p) => !existingPaths.has(p.path))
                .map((p) => ({
                    id: `discovered-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    name: p.name,
                    path: p.path,
                    enabled: true,
                    source: "discovered" as const,
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
            <ItemGroup
                title={t("settingsPlugins.installed")}
                footer={t("settingsPlugins.installedDescription")}
            >
                {plugins.length === 0 && (
                    <View>
                        <Text style={styles.emptyText}>
                            {t("settingsPlugins.noPlugins")}
                        </Text>
                    </View>
                )}
                {plugins.map((plugin) => (
                    <Item
                        key={plugin.id}
                        title={plugin.name}
                        subtitle={plugin.path}
                        icon={
                            <Ionicons
                                name={
                                    plugin.source === "discovered"
                                        ? "cube-outline"
                                        : "folder-outline"
                                }
                                size={24}
                                color={theme.colors.primary}
                            />
                        }
                        rightElement={
                            <Switch
                                value={plugin.enabled}
                                onValueChange={(v) =>
                                    togglePlugin(plugin.id, v)
                                }
                            />
                        }
                        showChevron={false}
                        onLongPress={() => removePlugin(plugin.id)}
                    />
                ))}
            </ItemGroup>

            <ItemGroup title={t("settingsPlugins.actions")}>
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
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(PluginsSettingsScreen);
