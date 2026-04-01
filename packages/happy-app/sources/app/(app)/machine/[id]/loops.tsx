import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import {
    machineCreateAgentLoop,
    machineListAgentLoops,
    machinePauseAgentLoop,
    machineRemoveAgentLoop,
    machineResumeAgentLoop,
    machineRunAgentLoopNow,
    machineUpdateAgentLoop,
    type MachineAgentLoop,
} from "@/sync/ops";
import { t } from "@/text";

function parseIntervalMs(raw: string): number | null {
    const match = raw.trim().match(/^(\d+)([smhd])$/i);
    if (!match) {
        return null;
    }
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return value * multiplier;
}

function formatIntervalMs(ms: number): string {
    if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
    if (ms % 60_000 === 0) return `${ms / 60_000}m`;
    return `${Math.round(ms / 1_000)}s`;
}

function formatTimestamp(value?: number | null): string {
    if (!value) {
        return "-";
    }
    return new Date(value).toLocaleString();
}

function parseEnvironmentVariables(raw: string): Record<string, string> | undefined {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return undefined;
    }
    const entries: Record<string, string> = {};
    for (const line of lines) {
        const idx = line.indexOf("=");
        if (idx <= 0) {
            throw new Error(t("machine.agentLoopEnvironmentInvalid"));
        }
        entries[line.slice(0, idx).trim()] = line.slice(idx + 1);
    }
    return Object.keys(entries).length > 0 ? entries : undefined;
}

function formatEnvironmentVariables(value?: Record<string, string>): string {
    if (!value) {
        return "";
    }
    return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join("\n");
}

function getLoopStatusLabel(loop: MachineAgentLoop): string {
    return loop.enabled ? t("machine.agentLoopEnabled") : t("machine.agentLoopPaused");
}

function getLoopSubtitle(loop: MachineAgentLoop): string {
    const parts = [
        `${t("machine.agentLoopIteration")}: ${loop.iteration}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(loop.intervalMs)}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(loop.nextRunAt)}`,
        `${t("machine.agentLoopAgent")}: ${loop.agent}`,
    ];
    if (loop.lastError) {
        parts.push(loop.lastError);
    }
    return parts.join(" • ");
}

function getLoopDetailMessage(loop: MachineAgentLoop): string {
    return [
        `${t("machine.agentLoopStatus")}: ${getLoopStatusLabel(loop)}`,
        `${t("machine.agentLoopPath")}: ${loop.directory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(loop.intervalMs)}`,
        `${t("machine.agentLoopIteration")}: ${loop.iteration}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(loop.nextRunAt)}`,
        `${t("machine.agentLoopLastRun")}: ${formatTimestamp(loop.lastCompletedAt ?? loop.lastStartedAt ?? loop.lastEnqueuedAt)}`,
        `${t("machine.agentLoopLastSession")}: ${loop.lastSessionId ?? "-"}`,
        `${t("machine.agentLoopAgent")}: ${loop.agent}`,
        loop.projectId ? `${t("machine.automationAuditProject")}: ${loop.projectId}` : undefined,
        loop.profileId ? `${t("machine.agentLoopProfile")}: ${loop.profileId}` : undefined,
        loop.lastError ? `${t("machine.automationFailed")}: ${loop.lastError}` : undefined,
        loop.environmentVariables ? `${t("machine.agentLoopEnvironment")}:\n${formatEnvironmentVariables(loop.environmentVariables)}` : undefined,
        undefined,
        `${t("machine.agentLoopPrompt")}:`,
        loop.prompt,
    ].filter(Boolean).join("\n");
}

export default React.memo(function MachineLoopsPage() {
    const { id: machineIdParam, loopId: focusLoopId } = useLocalSearchParams<{ id: string; loopId?: string }>();
    const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
    const router = useRouter();
    const { theme } = useUnistyles();
    const [loops, setLoops] = React.useState<MachineAgentLoop[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [mutatingLoopId, setMutatingLoopId] = React.useState<string | null>(null);
    const [editingLoopId, setEditingLoopId] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [showAdvanced, setShowAdvanced] = React.useState(false);
    const [name, setName] = React.useState("");
    const [directory, setDirectory] = React.useState("");
    const [interval, setInterval] = React.useState("10m");
    const [prompt, setPrompt] = React.useState("");
    const [agent, setAgent] = React.useState<MachineAgentLoop["agent"]>("claude");
    const [profileId, setProfileId] = React.useState("");
    const [projectId, setProjectId] = React.useState("");
    const [environmentText, setEnvironmentText] = React.useState("");
    const focusedLoopRef = React.useRef<string | null>(null);

    const resetForm = React.useCallback(() => {
        setEditingLoopId(null);
        setName("");
        setDirectory("");
        setInterval("10m");
        setPrompt("");
        setAgent("claude");
        setProfileId("");
        setProjectId("");
        setEnvironmentText("");
        setShowAdvanced(false);
    }, []);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId) {
            return;
        }
        if (kind === "initial") {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            const result = await machineListAgentLoops(machineId);
            setLoops(result.loops ?? []);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            if (kind === "initial") {
                setLoading(false);
            } else {
                setRefreshing(false);
            }
        }
    }, [machineId]);

    const mutateLoop = React.useCallback(async (loop: MachineAgentLoop, action: "pause" | "resume" | "run-now" | "remove") => {
        if (!machineId) {
            return;
        }
        setMutatingLoopId(loop.id);
        try {
            const result = action === "pause"
                ? await machinePauseAgentLoop(machineId, loop.id)
                : action === "resume"
                    ? await machineResumeAgentLoop(machineId, loop.id)
                    : action === "run-now"
                        ? await machineRunAgentLoopNow(machineId, loop.id)
                        : await machineRemoveAgentLoop(machineId, loop.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingLoopId === loop.id && action === "remove") {
                resetForm();
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingLoopId(null);
        }
    }, [editingLoopId, load, machineId, resetForm]);

    const applyLoopToForm = React.useCallback((loop: MachineAgentLoop) => {
        setEditingLoopId(loop.id);
        setName(loop.name ?? "");
        setDirectory(loop.directory);
        setInterval(formatIntervalMs(loop.intervalMs));
        setPrompt(loop.prompt);
        setAgent(loop.agent);
        setProfileId(loop.profileId ?? "");
        setProjectId(loop.projectId ?? "");
        setEnvironmentText(formatEnvironmentVariables(loop.environmentVariables));
        setShowAdvanced(Boolean(loop.projectId || loop.profileId || loop.environmentVariables || loop.agent !== "claude"));
    }, []);

    const openLoopActions = React.useCallback((loop: MachineAgentLoop) => {
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("machine.agentLoopEdit"),
                onPress: () => applyLoopToForm(loop),
            },
            {
                text: t("machine.agentLoopViewAutomation"),
                onPress: () => router.push(`/machine/${machineId}/automation?q=${encodeURIComponent(loop.id)}` as any),
            },
        ];

        if (loop.lastSessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${loop.lastSessionId}` as any),
            });
        }

        buttons.push({
            text: t("machine.agentLoopRunNow"),
            onPress: () => void mutateLoop(loop, "run-now"),
        });

        if (loop.enabled) {
            buttons.push({
                text: t("machine.agentLoopPause"),
                onPress: () => void mutateLoop(loop, "pause"),
            });
        } else {
            buttons.push({
                text: t("machine.agentLoopResume"),
                onPress: () => void mutateLoop(loop, "resume"),
            });
        }

        buttons.push({
            text: t("machine.agentLoopRemove"),
            style: "destructive",
            onPress: () => {
                Modal.alert(
                    t("machine.agentLoopRemove"),
                    t("machine.agentLoopRemoveMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                            text: t("machine.agentLoopRemove"),
                            style: "destructive",
                            onPress: () => void mutateLoop(loop, "remove"),
                        },
                    ],
                );
            },
        });

        Modal.alert(loop.name || loop.id, getLoopDetailMessage(loop), buttons);
    }, [applyLoopToForm, machineId, mutateLoop, router]);

    React.useEffect(() => {
        void load("initial");
    }, [load]);

    React.useEffect(() => {
        if (!focusLoopId || focusedLoopRef.current === focusLoopId) {
            return;
        }
        const target = loops.find((loop) => loop.id === focusLoopId);
        if (!target) {
            return;
        }
        focusedLoopRef.current = focusLoopId;
        setTimeout(() => openLoopActions(target), 50);
    }, [focusLoopId, loops, openLoopActions]);

    const saveLoop = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        const parsedInterval = parseIntervalMs(interval);
        if (!directory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        if (!prompt.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPromptRequired"));
            return;
        }
        if (parsedInterval == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopIntervalInvalid"));
            return;
        }

        let environmentVariables: Record<string, string> | undefined;
        try {
            environmentVariables = parseEnvironmentVariables(environmentText);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            return;
        }

        setSaving(true);
        try {
            const result = editingLoopId
                ? await machineUpdateAgentLoop(machineId, editingLoopId, {
                    name,
                    directory: directory.trim(),
                    prompt: prompt.trim(),
                    intervalMs: parsedInterval,
                    agent,
                    profileId,
                    projectId,
                    environmentVariables,
                })
                : await machineCreateAgentLoop(machineId, {
                    name: name.trim() || undefined,
                    directory: directory.trim(),
                    prompt: prompt.trim(),
                    intervalMs: parsedInterval,
                    agent,
                    profileId: profileId.trim() || undefined,
                    projectId: projectId.trim() || undefined,
                    environmentVariables,
                    runNow: true,
                });
            if (!result.success) {
                throw new Error(result.errorMessage || (editingLoopId ? t("machine.agentLoopUpdateFailed") : t("machine.agentLoopCreateFailed")));
            }
            resetForm();
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    }, [agent, directory, editingLoopId, environmentText, interval, load, machineId, name, profileId, projectId, prompt, resetForm]);

    const filteredLoops = React.useMemo(() => {
        const needle = searchQuery.trim().toLowerCase();
        if (!needle) {
            return loops;
        }
        return loops.filter((loop) => [
            loop.id,
            loop.name,
            loop.prompt,
            loop.directory,
            loop.agent,
            loop.projectId,
            loop.profileId,
            loop.lastError,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
    }, [loops, searchQuery]);

    const enabledCount = React.useMemo(() => loops.filter((loop) => loop.enabled).length, [loops]);

    return (
        <>
            <Stack.Screen options={{ title: t("machine.agentLoops") }} />
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
            >
                <ItemGroup title={editingLoopId ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}>
                    <View style={styles.formSection}>
                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>
                            {`${t("machine.agentLoopEnabled")}: ${enabledCount} / ${loops.length}`}
                        </Text>
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopName")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopNamePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={name}
                            onChangeText={setName}
                        />
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopPath")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPathPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={directory}
                            onChangeText={setDirectory}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopInterval")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopIntervalPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={interval}
                            onChangeText={setInterval}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopPrompt")}</Text>
                        <TextInput
                            style={[styles.input, styles.promptInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPromptPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={prompt}
                            onChangeText={setPrompt}
                            multiline
                            textAlignVertical="top"
                        />

                        <Pressable onPress={() => setShowAdvanced((current) => !current)}>
                            <Text style={[styles.advancedToggle, { color: theme.colors.textSecondary }]}>
                                {showAdvanced ? t("machine.agentLoopAdvancedHide") : t("machine.agentLoopAdvancedShow")}
                            </Text>
                        </Pressable>

                        {showAdvanced ? (
                            <View style={styles.advancedSection}>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopAgent")}</Text>
                                <View style={styles.agentRow}>
                                    {(["claude", "codex", "gemini"] as const).map((option) => {
                                        const active = agent === option;
                                        return (
                                            <Pressable
                                                key={option}
                                                style={[
                                                    styles.agentButton,
                                                    {
                                                        borderColor: active ? theme.colors.button.primary.background : theme.colors.divider,
                                                        backgroundColor: active ? theme.colors.button.primary.background : theme.colors.surface,
                                                    },
                                                ]}
                                                onPress={() => setAgent(option)}
                                            >
                                                <Text style={{ color: active ? theme.colors.button.primary.tint : theme.colors.text }}>{option}</Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.automationAuditProject")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopProjectPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={projectId}
                                    onChangeText={setProjectId}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopProfile")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopProfilePlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={profileId}
                                    onChangeText={setProfileId}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopEnvironment")}</Text>
                                <TextInput
                                    style={[styles.input, styles.envInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopEnvironmentPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={environmentText}
                                    onChangeText={setEnvironmentText}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    multiline
                                    textAlignVertical="top"
                                />
                            </View>
                        ) : null}

                        <View style={styles.buttonRow}>
                            <Pressable
                                style={[styles.createButton, { backgroundColor: theme.colors.button.primary.background, opacity: saving ? 0.6 : 1 }]}
                                onPress={() => void saveLoop()}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                                ) : (
                                    <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>
{editingLoopId ? t("common.save") : t("machine.agentLoopCreate")}
                                    </Text>
                                )}
                            </Pressable>
                            {editingLoopId ? (
                                <Pressable
                                    style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={resetForm}
                                    disabled={saving}
                                >
                                    <Text style={{ color: theme.colors.text }}>{t("common.cancel")}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                </ItemGroup>

                <ItemGroup title={t("machine.agentLoops")}>
                    <View style={styles.formSection}>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopSearchPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>
                    {loading ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        </View>
                    ) : filteredLoops.length === 0 ? (
                        <Item title={loops.length === 0 ? t("machine.agentLoopsEmpty") : t("machine.agentLoopNoMatches")} showChevron={false} />
                    ) : filteredLoops.map((loop) => (
                        <Item
                            key={loop.id}
                            title={loop.name || loop.id}
                            subtitle={getLoopSubtitle(loop)}
                            detail={getLoopStatusLabel(loop)}
                            detailStyle={{ color: loop.enabled ? "#34C759" : theme.colors.textSecondary }}
                            onPress={() => openLoopActions(loop)}
                            showChevron
                            rightElement={mutatingLoopId === loop.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                        />
                    ))}
                </ItemGroup>
            </ScrollView>
        </>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingBottom: 32,
    },
    formSection: {
        padding: 16,
        gap: 8,
    },
    helperText: {
        fontSize: 13,
    },
    label: {
        fontSize: 13,
        fontWeight: "600",
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    promptInput: {
        minHeight: 120,
    },
    envInput: {
        minHeight: 88,
    },
    advancedToggle: {
        marginTop: 6,
        fontSize: 13,
        fontWeight: "600",
    },
    advancedSection: {
        gap: 8,
        paddingTop: 4,
    },
    agentRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    agentButton: {
        minWidth: 88,
        minHeight: 36,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 12,
    },
    buttonRow: {
        marginTop: 8,
        flexDirection: "row",
        gap: 10,
    },
    createButton: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryButton: {
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
    createButtonText: {
        fontSize: 15,
        fontWeight: "600",
    },
    loadingWrap: {
        paddingVertical: 16,
        alignItems: "center",
        justifyContent: "center",
    },
}));
