import * as React from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { useDevConfig, invalidateDevConfigCache } from "@/hooks/useDevConfig";
import { useDevSkillCheck } from "@/hooks/useDevSkillCheck";
import { DevServiceCard } from "@/components/DevServiceCard";
import { DevServiceEditSheet } from "@/components/DevServiceEditSheet";
import { serializeDevYml, type DevService, type DevConfig } from "@/utils/devYmlParser";
import { sessionBash, sessionStopTask } from "@/sync/ops";
import { useBackgroundTaskEntries } from "@/sync/storage";
import { sync } from "@/sync/sync";

export default React.memo(function DevScreen() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const { theme } = useUnistyles();
    const { hasConfig, config, loading, refresh } = useDevConfig(sessionId, true);
    const skillCheck = useDevSkillCheck(sessionId, !loading && !hasConfig);
    const [installing, setInstalling] = React.useState(false);

    const [editingService, setEditingService] = React.useState<DevService | null>(null);
    const [showEditSheet, setShowEditSheet] = React.useState(false);

    const services = config?.services ?? [];
    const allServiceKeys = React.useMemo(
        () => services.map((s) => s.key),
        [services],
    );

    // Match running background tasks to dev services by command substring
    const backgroundTasks = useBackgroundTaskEntries(sessionId);
    const runningServiceMap = React.useMemo(() => {
        const map = new Map<string, string>(); // serviceKey → taskId
        for (const service of services) {
            for (const [, entry] of backgroundTasks) {
                if (entry.status !== "running") continue;
                // Match by command: the background task command should contain the service command
                if (entry.command && service.command && entry.command.includes(service.command)) {
                    map.set(service.key, entry.taskId);
                    break;
                }
            }
        }
        return map;
    }, [services, backgroundTasks]);

    const handleEdit = React.useCallback((service: DevService) => {
        setEditingService(service);
        setShowEditSheet(true);
    }, []);

    const router = useRouter();

    /** Write dev.yml to remote machine via sessionBash + python3 base64 decode */
    const writeDevYml = React.useCallback(async (updatedConfig: DevConfig): Promise<boolean> => {
        const yml = serializeDevYml(updatedConfig);
        const bytes = new TextEncoder().encode(yml);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        const b64 = btoa(bin);
        const result = await sessionBash(sessionId, {
            command: `mkdir -p .happy && python3 -c "import base64,sys; sys.stdout.buffer.write(base64.b64decode('${b64}'))" > .happy/dev.yml`,
            timeout: 10000,
        });
        if (result.success) {
            invalidateDevConfigCache(sessionId);
            refresh();
        }
        return result.success;
    }, [sessionId, refresh]);

    const handleSave = React.useCallback(async (updated: DevService) => {
        const updatedConfig: DevConfig = {
            version: config?.version ?? 1,
            services: !config
                ? [updated]
                : editingService
                    ? config.services.map((s) => s.key === editingService.key ? updated : s)
                    : [...config.services, updated],
        };
        await writeDevYml(updatedConfig);
        setShowEditSheet(false);
        setEditingService(null);
    }, [config, editingService, writeDevYml]);

    const handleDelete = React.useCallback(async (serviceKey: string) => {
        const confirmed = await Modal.confirm(
            "Delete Service",
            `Remove "${serviceKey}" from dev configuration?`,
            { destructive: true, confirmText: "Delete" },
        );
        if (!confirmed || !config) return;

        const updatedConfig: DevConfig = {
            ...config,
            services: config.services.filter((s) => s.key !== serviceKey),
        };
        await writeDevYml(updatedConfig);
    }, [config, writeDevYml]);

    const handleConfigFilePress = React.useCallback((filePath: string) => {
        // file.tsx expects base64-encoded path
        const encoded = btoa(filePath);
        router.push(`/session/${sessionId}/file?path=${encoded}` as any);
    }, [sessionId, router]);

    const handleAddService = React.useCallback(() => {
        setEditingService(null);
        setShowEditSheet(true);
    }, []);

    const handleCloseSheet = React.useCallback(() => {
        setShowEditSheet(false);
        setEditingService(null);
    }, []);

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <View style={styles.emptyContainer}>
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        Loading...
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            {!hasConfig ? (
                <View style={styles.emptyContainer}>
                    <Ionicons
                        name="code-slash-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                    {skillCheck.status === "not-installed" || skillCheck.status === "outdated" ? (
                        <>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {skillCheck.status === "outdated"
                                    ? `/dev skill outdated (v${skillCheck.remoteVersion ?? 0})`
                                    : "/dev skill not installed"}
                            </Text>
                            <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                                {skillCheck.status === "outdated"
                                    ? "A newer version is available with improved features"
                                    : "Install to enable auto-detection and startup of dev services"}
                            </Text>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.installButton,
                                    { backgroundColor: theme.colors.primary },
                                    pressed && { opacity: 0.7 },
                                ]}
                                onPress={async () => {
                                    setInstalling(true);
                                    const ok = await skillCheck.install();
                                    setInstalling(false);
                                    if (ok) refresh();
                                }}
                                disabled={installing}
                            >
                                {installing ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <>
                                        <Ionicons name="download-outline" size={18} color="#fff" />
                                        <Text style={styles.installButtonText}>
                                            {skillCheck.status === "outdated" ? "Update /dev Skill" : "Install /dev Skill"}
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        </>
                    ) : skillCheck.status === "checking" ? (
                        <>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                                Checking environment...
                            </Text>
                        </>
                    ) : (
                        <>
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                No dev configuration found
                            </Text>
                            <Text style={[styles.emptyHint, { color: theme.colors.textSecondary }]}>
                                Scan the project to auto-detect services and generate config
                            </Text>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.installButton,
                                    { backgroundColor: theme.colors.primary },
                                    pressed && { opacity: 0.7 },
                                ]}
                                onPress={() => {
                                    // Send /dev to the session — AI will scan and generate dev.yml
                                    sync.sendMessage(sessionId, "/dev");
                                    // Navigate back to the session to see progress
                                    router.back();
                                }}
                            >
                                <Ionicons name="scan-outline" size={18} color="#fff" />
                                <Text style={styles.installButtonText}>Generate Config</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            ) : (
                <>
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                    >
                        {services.map((service) => (
                            <DevServiceCard
                                key={service.key}
                                service={service}
                                sessionId={sessionId}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onConfigFilePress={handleConfigFilePress}
                                isRunning={runningServiceMap.has(service.key)}
                                onStart={(key: string) => {
                                    sync.sendMessage(sessionId, `/dev ${key}`);
                                    router.back();
                                }}
                                onStop={async (key: string) => {
                                    const taskId = runningServiceMap.get(key);
                                    const service = services.find((s) => s.key === key);
                                    if (!taskId) return;
                                    try {
                                        await sessionStopTask(sessionId, taskId);
                                    } catch {
                                        // stopTask fails when idle — fallback to port/command kill
                                        try {
                                            const port = service?.port;
                                            const cmd = service?.command ?? "";
                                            const killCmd = port
                                                ? `lsof -ti :${port} | xargs kill 2>/dev/null || true`
                                                : `pkill -f ${JSON.stringify(cmd.slice(0, 80))} 2>/dev/null || true`;
                                            await sessionBash(sessionId, { command: killCmd });
                                        } catch {
                                            // Best effort
                                        }
                                    }
                                }}
                            />
                        ))}
                    </ScrollView>

                    {/* Start All button — prominent */}
                    <View style={[styles.startBar, { borderTopColor: theme.colors.divider }]}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.startAllButton,
                                { backgroundColor: "#4CAF50" },
                                pressed && { opacity: 0.7 },
                            ]}
                            onPress={() => {
                                sync.sendMessage(sessionId, "/dev");
                                router.back();
                            }}
                        >
                            <Ionicons name="play" size={18} color="#fff" />
                            <Text style={styles.startAllText}>Start All</Text>
                        </Pressable>
                    </View>

                    {/* Secondary actions */}
                    <View style={[styles.bottomBar, { borderTopColor: theme.colors.divider }]}>
                        <Pressable
                            style={({ pressed }) => [
                                styles.bottomButton,
                                { backgroundColor: theme.colors.surfaceHigh },
                                pressed && { opacity: 0.6 },
                            ]}
                            onPress={handleAddService}
                        >
                            <Ionicons name="add" size={18} color={theme.colors.textLink} />
                            <Text style={[styles.bottomButtonText, { color: theme.colors.textLink }]}>
                                Add Service
                            </Text>
                        </Pressable>

                        <Pressable
                            style={({ pressed }) => [
                                styles.bottomButton,
                                { backgroundColor: theme.colors.surfaceHigh },
                                pressed && { opacity: 0.6 },
                            ]}
                            onPress={async () => {
                                const confirmed = await Modal.confirm(
                                    "Rescan",
                                    "Delete current config and regenerate from project scan?",
                                    { confirmText: "Rescan", destructive: true },
                                );
                                if (!confirmed) return;
                                // Delete existing config and regenerate
                                await sessionBash(sessionId, { command: "rm -f .happy/dev.yml" });
                                invalidateDevConfigCache(sessionId);
                                sync.sendMessage(sessionId, "已删除 .happy/dev.yml，请重新执行 /dev 全量扫描项目（包括 Docker Compose 服务），生成新的配置文件");
                                router.back();
                            }}
                        >
                            <Ionicons name="refresh" size={18} color={theme.colors.textSecondary} />
                            <Text style={[styles.bottomButtonText, { color: theme.colors.textSecondary }]}>
                                Rescan
                            </Text>
                        </Pressable>
                    </View>
                </>
            )}

            {showEditSheet && (
                <DevServiceEditSheet
                    service={editingService}
                    allServiceKeys={allServiceKeys}
                    onSave={handleSave}
                    onClose={handleCloseSheet}
                    sessionId={sessionId}
                />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%",
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 15,
        ...Typography.default("semiBold"),
    },
    emptyHint: {
        fontSize: 13,
        textAlign: "center",
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingVertical: 8,
    },
    bottomBar: {
        flexDirection: "row",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    bottomButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 10,
        borderRadius: 10,
    },
    bottomButtonText: {
        fontSize: 14,
        fontWeight: "600",
        ...Typography.default("semiBold"),
    },
    installButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
        marginTop: 8,
    },
    installButtonText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "600",
    },
    startBar: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    startAllButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
        borderRadius: 10,
    },
    startAllText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "600",
    },
}));
