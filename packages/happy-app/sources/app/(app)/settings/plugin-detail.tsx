import * as React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { machineInspectPlugin } from "@/sync/ops";
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
 */
function PluginDetailScreen() {
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{
        key: string;
        installPath: string;
    }>();

    const pluginKey = params.key ?? "";
    const installPath = params.installPath ?? "";

    // Parse name and marketplace from key
    const atIdx = pluginKey.indexOf("@");
    const pluginName = atIdx > 0 ? pluginKey.slice(0, atIdx) : pluginKey;
    const marketplace = atIdx > 0 ? pluginKey.slice(atIdx + 1) : "";

    const [detail, setDetail] = React.useState<PluginDetail | null>(null);
    const [loading, setLoading] = React.useState(false);
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
                    <Text style={styles.notFound}>Plugin not found</Text>
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
            {/* Header */}
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
                            color={theme.colors.primary}
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
            <ItemGroup>
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
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(PluginDetailScreen);
