import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Switch } from "@/components/Switch";
import { machineInspectPlugin, machinePluginAction } from "@/sync/ops";
import type { PluginDetail } from "@/sync/ops";
import { t } from "@/text";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { storage } from "@/sync/storage";

/** Find the first online machine ID. */
function findOnlineMachineId(): string | null {
    const machines = storage.getState().machines;
    const online = Object.values(machines).find((m) => m.active);
    return online?.id ?? null;
}

/**
 * Plugin detail page.
 *
 * Route params:
 * - key: plugin key like "frontend-design@claude-plugins-official"
 * - installPath: path to the installed plugin directory
 * - enabled: "1" or "0" (current enabled state)
 */
function PluginDetailScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const params = useLocalSearchParams<{
        key: string;
        installPath: string;
        enabled: string;
    }>();

    const pluginKey = params.key ?? "";
    const installPath = params.installPath ?? "";
    const initialEnabled = params.enabled !== "0";

    // Parse name and marketplace from key
    const atIdx = pluginKey.indexOf("@");
    const pluginName = atIdx > 0 ? pluginKey.slice(0, atIdx) : pluginKey;
    const marketplace = atIdx > 0 ? pluginKey.slice(atIdx + 1) : "";

    const [detail, setDetail] = React.useState<PluginDetail | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [actionLoading, setActionLoading] = React.useState(false);
    const [enabled, setEnabled] = React.useState(initialEnabled);
    const [expandedSection, setExpandedSection] = React.useState<
        "commands" | "skills" | "agents" | null
    >(null);

    // Load detail from machine RPC on mount
    React.useEffect(() => {
        if (!installPath) return;
        const machineId = findOnlineMachineId();
        if (!machineId) return;

        setLoading(true);
        machineInspectPlugin(machineId, installPath)
            .then((result) => {
                if (result) setDetail(result);
            })
            .finally(() => setLoading(false));
    }, [installPath]);

    const [, doRefresh] = useHappyAction(async () => {
        if (!installPath) return;
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.toast(t("settingsPlugins.noMachineOnline"));
            return;
        }
        setLoading(true);
        try {
            const result = await machineInspectPlugin(machineId, installPath);
            if (result) {
                setDetail(result);
                Modal.toast(t("settingsPlugins.refreshSuccess"));
            }
        } finally {
            setLoading(false);
        }
    });

    // Toggle enabled/disabled
    const toggleEnabled = React.useCallback(
        async (newValue: boolean) => {
            const machineId = findOnlineMachineId();
            if (!machineId) {
                Modal.toast(t("settingsPlugins.noMachineOnline"));
                return;
            }

            const action = newValue ? "enable" : "disable";
            setActionLoading(true);
            setEnabled(newValue); // Optimistic update
            try {
                const result = await machinePluginAction(
                    machineId,
                    action,
                    pluginKey,
                );
                if (result.success) {
                    const successKey = newValue
                        ? "enableSuccess"
                        : "disableSuccess";
                    Modal.toast(
                        t(`settingsPlugins.${successKey}`, {
                            name: pluginName,
                        }),
                    );
                } else {
                    setEnabled(!newValue); // Revert on failure
                    Modal.toast(
                        t("settingsPlugins.actionFailed", {
                            error:
                                result.stderr?.slice(0, 100) ||
                                result.error ||
                                "Unknown error",
                        }),
                    );
                }
            } catch {
                setEnabled(!newValue); // Revert on error
            } finally {
                setActionLoading(false);
            }
        },
        [pluginKey, pluginName],
    );

    // Uninstall
    const doUninstall = React.useCallback(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.toast(t("settingsPlugins.noMachineOnline"));
            return;
        }

        const confirmed = await Modal.confirm(
            t("settingsPlugins.uninstall"),
            t("settingsPlugins.confirmUninstall"),
            { destructive: true },
        );
        if (!confirmed) return;

        setActionLoading(true);
        try {
            const result = await machinePluginAction(
                machineId,
                "uninstall",
                pluginKey,
            );
            if (result.success) {
                Modal.toast(
                    t("settingsPlugins.uninstallSuccess", {
                        name: pluginName,
                    }),
                );
                router.back();
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
            setActionLoading(false);
        }
    }, [pluginKey, pluginName, router]);

    // Update plugin
    const doUpdate = React.useCallback(async () => {
        const machineId = findOnlineMachineId();
        if (!machineId) {
            Modal.toast(t("settingsPlugins.noMachineOnline"));
            return;
        }

        setActionLoading(true);
        try {
            const result = await machinePluginAction(
                machineId,
                "update" as any,
                pluginKey,
            );
            if (result.success) {
                Modal.toast(
                    t("settingsPlugins.refreshSuccess"),
                );
                // Reload detail after update
                const updated = await machineInspectPlugin(
                    machineId,
                    installPath,
                );
                if (updated) setDetail(updated);
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
            setActionLoading(false);
        }
    }, [pluginKey, installPath]);

    const toggleSection = React.useCallback(
        (section: "commands" | "skills" | "agents") => {
            setExpandedSection((prev) => (prev === section ? null : section));
        },
        [],
    );

    const styles = StyleSheet.create({
        loadingContainer: {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 12,
            gap: 8,
        },
        listItem: {
            paddingVertical: 6,
            paddingHorizontal: 16,
        },
        listItemText: {
            fontSize: 14,
            color: theme.colors.textSecondary,
            fontFamily: "monospace",
        },
        notFound: {
            fontSize: 16,
            color: theme.colors.textSecondary,
            textAlign: "center",
            paddingVertical: 32,
        },
    });

    if (!pluginKey) {
        return (
            <ItemList>
                <View>
                    <Text style={styles.notFound}>{t("settingsPlugins.pluginNotFound")}</Text>
                </View>
            </ItemList>
        );
    }

    const version = detail?.version;
    const description = detail?.description;
    const author = detail?.author;
    const homepage = detail?.homepage;
    const license = detail?.license;
    const counts = detail?.counts;
    const subPlugins = detail?.subPlugins;

    return (
        <ItemList>
            {/* Header with enable toggle */}
            <ItemGroup>
                <Item
                    title={pluginName}
                    subtitle={
                        description ?? t("settingsPlugins.noDescription")
                    }
                    icon={
                        <Ionicons
                            name="cube-outline"
                            size={24}
                            color={
                                enabled
                                    ? theme.colors.primary
                                    : theme.colors.textSecondary
                            }
                        />
                    }
                    rightElement={
                        <Switch
                            value={enabled}
                            onValueChange={toggleEnabled}
                            disabled={actionLoading}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Basic info */}
            <ItemGroup title={t("settingsPlugins.basicInfo")}>
                {version ? (
                    <Item
                        title={t("settingsPlugins.version")}
                        detail={version}
                        showChevron={false}
                    />
                ) : null}
                {author ? (
                    <Item
                        title={t("settingsPlugins.author")}
                        detail={author}
                        showChevron={false}
                    />
                ) : null}
                {marketplace ? (
                    <Item
                        title={t("settingsPlugins.marketplacesTitle")}
                        detail={marketplace}
                        showChevron={false}
                    />
                ) : null}
                {homepage ? (
                    <Item
                        title={t("settingsPlugins.homepage")}
                        subtitle={homepage}
                        subtitleLines={1}
                        showChevron={false}
                    />
                ) : null}
                {license ? (
                    <Item
                        title={t("settingsPlugins.license")}
                        detail={license}
                        showChevron={false}
                    />
                ) : null}
                <Item
                    title={t("settingsPlugins.path")}
                    subtitle={installPath}
                    subtitleLines={2}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Loading indicator */}
            {loading && !detail && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator
                        size="small"
                        color={theme.colors.primary}
                    />
                </View>
            )}

            {/* Contents */}
            {counts &&
            (counts.commands > 0 ||
                counts.skills > 0 ||
                counts.agents > 0) ? (
                <ItemGroup title={t("settingsPlugins.contents")}>
                    {counts.commands > 0 && (
                        <>
                            <Item
                                title={t("settingsPlugins.commands", {
                                    count: counts.commands,
                                })}
                                icon={
                                    <Ionicons
                                        name="terminal-outline"
                                        size={20}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                                onPress={() => toggleSection("commands")}
                                showChevron={false}
                                rightElement={
                                    <Ionicons
                                        name={
                                            expandedSection === "commands"
                                                ? "chevron-up"
                                                : "chevron-down"
                                        }
                                        size={16}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                            />
                            {expandedSection === "commands" &&
                                detail?.commandList?.map((cmd) => (
                                    <View key={cmd} style={styles.listItem}>
                                        <Text style={styles.listItemText}>
                                            /{cmd}
                                        </Text>
                                    </View>
                                ))}
                        </>
                    )}
                    {counts.skills > 0 && (
                        <>
                            <Item
                                title={t("settingsPlugins.skills", {
                                    count: counts.skills,
                                })}
                                icon={
                                    <Ionicons
                                        name="sparkles-outline"
                                        size={20}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                                onPress={() => toggleSection("skills")}
                                showChevron={false}
                                rightElement={
                                    <Ionicons
                                        name={
                                            expandedSection === "skills"
                                                ? "chevron-up"
                                                : "chevron-down"
                                        }
                                        size={16}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                            />
                            {expandedSection === "skills" &&
                                detail?.skillList?.map((skill) => (
                                    <View key={skill} style={styles.listItem}>
                                        <Text style={styles.listItemText}>
                                            {skill}
                                        </Text>
                                    </View>
                                ))}
                        </>
                    )}
                    {counts.agents > 0 && (
                        <>
                            <Item
                                title={t("settingsPlugins.agents", {
                                    count: counts.agents,
                                })}
                                icon={
                                    <Ionicons
                                        name="people-outline"
                                        size={20}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                                onPress={() => toggleSection("agents")}
                                showChevron={false}
                                rightElement={
                                    <Ionicons
                                        name={
                                            expandedSection === "agents"
                                                ? "chevron-up"
                                                : "chevron-down"
                                        }
                                        size={16}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                            />
                            {expandedSection === "agents" &&
                                detail?.agentList?.map((agent) => (
                                    <View key={agent} style={styles.listItem}>
                                        <Text style={styles.listItemText}>
                                            {agent}
                                        </Text>
                                    </View>
                                ))}
                        </>
                    )}
                </ItemGroup>
            ) : null}

            {/* Sub-plugins (for marketplace aggregators) */}
            {subPlugins && subPlugins.length > 0 && (
                <ItemGroup title={t("settingsPlugins.subPlugins")}>
                    {subPlugins.map((sub) => (
                        <Item
                            key={sub.name}
                            title={sub.name}
                            subtitle={sub.description}
                            detail={sub.category}
                            showChevron={false}
                        />
                    ))}
                </ItemGroup>
            )}

            {/* Actions */}
            <ItemGroup title={t("settingsPlugins.actions")}>
                <Item
                    title={t("settingsPlugins.update")}
                    icon={
                        actionLoading ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.primary}
                            />
                        ) : (
                            <Ionicons
                                name="cloud-download-outline"
                                size={24}
                                color={theme.colors.accentBlue}
                            />
                        )
                    }
                    onPress={doUpdate}
                    disabled={actionLoading}
                />
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
                    title={t("settingsPlugins.uninstall")}
                    icon={
                        <Ionicons
                            name="trash-outline"
                            size={24}
                            color={theme.colors.deleteAction}
                        />
                    }
                    onPress={doUninstall}
                    disabled={actionLoading}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(PluginDetailScreen);
