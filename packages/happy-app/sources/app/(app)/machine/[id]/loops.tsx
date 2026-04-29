import * as React from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemGroup } from "@/components/ItemGroup";
import { screenLayoutMaxWidth } from "@/components/layout";
import { Modal } from "@/modal";
import {
    machineEmitAgentLoopEvent,
    machinePauseAgentLoop,
    machineRemoveAgentLoop,
    machineResumeAgentLoop,
    machineRunAgentLoopNow,
    machineAISuggestAgentLoops,
    machineCreateAgentLoop,
    machineListGitRepos,
    type GitRepoEntry,
    type MachineAgentLoop,
    type MachineAgentLoopSuggestion,
} from "@/sync/ops";
import { TokenStorage } from "@/auth/tokenStorage";
import { t } from "@/text";
import { useMachine, useSettings } from "@/sync/storage";
import { ProfilePicker } from "@/components/ProfilePicker";
import { getSupervisorAvailableProfiles } from "@/components/project/supervisorProfileSelection";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { utf8ToBase64 } from "@/utils/stringUtils";
import {
    getLoopFormLayoutMode,
} from "./loopsLayout";
import { AutoDreamProfileEditorModal } from "./AutoDreamProfileEditorModal";
import { BootstrapProfileEditorModal } from "./BootstrapProfileEditorModal";
import { LoopAutomationSection } from "./LoopAutomationSection";
import { LoopEditorModal } from "./LoopEditorModal";
import { LoopSuggestionsSection } from "./LoopSuggestionsSection";
import { BriefSection } from "./BriefSection";
import { useLoopsData } from "./useLoopsData";
import { useLoopSuggestions } from "./useLoopSuggestions";
import {
    getLoopBriefPath,
    getLoopContextPath,
    getLoopDetailMessage,
    getLoopListSubtitleCompact,
    getLoopMemoryPath,
    getLoopPhaseLabel,
    getLoopStatusColor,
    getLoopStatusLabel,
} from "./loopsLabels";

function LoopRow({
    loop,
    onPress,
    mutating,
}: {
    loop: MachineAgentLoop;
    onPress: () => void;
    mutating: boolean;
}) {
    const { theme } = useUnistyles();
    const hasError = !!loop.lastError;
    const isActive = loop.runtimeState === "active";
    const statusColor = hasError ? "#FF3B30" : getLoopStatusColor(loop, theme);

    return (
        <Pressable
            style={({ pressed }) => ({
                flexDirection: "row",
                backgroundColor: pressed ? theme.colors.surfaceHigh : "transparent",
                overflow: "hidden",
            })}
            onPress={onPress}
        >
            {/* Left status stripe */}
            <View style={{ width: 3, backgroundColor: statusColor }} />

            <View style={{ flex: 1, paddingVertical: 10, paddingLeft: 12, gap: 3 }}>
                {/* Row 1: name + status label */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 }}>
                    <Text
                        style={{ flex: 1, fontSize: 14, fontWeight: "600", color: theme.colors.text }}
                        numberOfLines={1}
                    >
                        {loop.name || loop.id}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        {isActive && !hasError && (
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: statusColor }} />
                        )}
                        <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor }}>
                            {isActive && !hasError
                                ? getLoopPhaseLabel(loop).toUpperCase()
                                : getLoopStatusLabel(loop).toUpperCase()}
                        </Text>
                    </View>
                </View>

                {/* Row 2: error or subtitle */}
                {hasError ? (
                    <Text style={{ fontSize: 12, color: "#FF3B30" }} numberOfLines={2}>
                        {loop.lastError}
                    </Text>
                ) : (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }} numberOfLines={1}>
                        {getLoopListSubtitleCompact(loop)}
                    </Text>
                )}
            </View>

            <View style={{ justifyContent: "center", paddingHorizontal: 12 }}>
                {mutating ? (
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : (
                    <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
                )}
            </View>
        </Pressable>
    );
}

export default React.memo(function MachineLoopsPage() {
    const { id: machineIdParam, loopId: focusLoopId } = useLocalSearchParams<{ id: string; loopId?: string }>();
    const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width: viewportWidth } = useWindowDimensions();
    const formLayout = getLoopFormLayoutMode({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });
    const machine = useMachine(machineId ?? "");
    const rpcReady = machine?.rpcReady ?? false;

    const automation = machine?.daemonState?.automation;
    const loopsData = useLoopsData({
        machineId,
        rpcReady,
        pushedLoops: automation?.loops,
        pushedBootstrapProfiles: automation?.bootstrapProfiles,
        pushedAutoDreamProfiles: automation?.autoDreamProfiles,
    });
    const {
        loops,
        loading,
        refreshing,
        bootstrapProfiles,
        autoDreamProfiles,
        upstreamLoopIdsByLoopId,
        mutatingBootstrapProfileId,
        editingBootstrapProfile,
        setEditingBootstrapProfile,
        bootstrapProfileEditorVisible,
        setBootstrapProfileEditorVisible,
        mutatingAutoDreamProfileId,
        editingAutoDreamProfile,
        setEditingAutoDreamProfile,
        autoDreamProfileEditorVisible,
        setAutoDreamProfileEditorVisible,
        profileId,
        projectId,
        load,
        mutateBootstrapProfile,
        mutateAutoDreamProfile,
    } = loopsData;

    const [mutatingLoopId, setMutatingLoopId] = React.useState<string | null>(null);
    const [editingLoop, setEditingLoop] = React.useState<MachineAgentLoop | null>(null);
    // AI 生成 loop 状态
    const [showAIInput, setShowAIInput] = React.useState(false);
    const [aiDirectory, setAIDirectory] = React.useState("");
    const [aiGenerating, setAIGenerating] = React.useState(false);
    const [aiSuggestions, setAISuggestions] = React.useState<MachineAgentLoopSuggestion[]>([]);
    const [aiAdoptingKey, setAIAdoptingKey] = React.useState<string | null>(null);
    const [aiAdoptingAll, setAIAdoptingAll] = React.useState(false);
    // AI 路径选择器状态
    const [aiRepoPickerOpen, setAIRepoPickerOpen] = React.useState(false);
    const [aiRepoList, setAIRepoList] = React.useState<GitRepoEntry[]>([]);
    const [aiRepoLoading, setAIRepoLoading] = React.useState(false);
    const [aiRepoSearch, setAIRepoSearch] = React.useState("");
    // AI 生成使用的 AiBackendProfile（null = 用 server 默认 env）
    const [aiProfileId, setAIProfileId] = React.useState<string | null>(null);
    const settings = useSettings();
    const aiProfiles = React.useMemo(() => {
        const builtIn = DEFAULT_PROFILES.map((p) => ({ id: p.id, name: p.name, isBuiltIn: true as const }));
        const user = (settings.profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
        return getSupervisorAvailableProfiles(builtIn, user);
    }, [settings.profiles]);

const loopSuggestions = useLoopSuggestions({
        machineId,
        profileId,
        projectId,
        load,
        aiProfileId,
        loops,
    });
    const {
        suggestions,
        creatingSuggestionKey,
        adoptingAllSuggestions,
        bootstrapEntries,
        bootstrapScanning,
        bootstrappingRepoPath,
        adoptSuggestion,
        adoptAllSuggestions,
        scanBootstrapRepos,
        adoptRepoSuggestions,
    } = loopSuggestions;
    const [loopEditorVisible, setLoopEditorVisible] = React.useState(false);
    const [showAutomation, setShowAutomation] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState("");
    const focusedLoopRef = React.useRef<string | null>(null);

    const closeLoopEditor = React.useCallback(() => {
        setLoopEditorVisible(false);
        setEditingLoop(null);
    }, []);

    const openCreateLoopEditor = React.useCallback(() => {
        setEditingLoop(null);
        setLoopEditorVisible(true);
    }, []);

    const handleOpenAIRepoPicker = React.useCallback(async () => {
        if (!machineId) return;
        setAIRepoPickerOpen((prev) => !prev);
        if (aiRepoList.length === 0 && !aiRepoLoading) {
            setAIRepoLoading(true);
            try {
                const repos = await machineListGitRepos(machineId);
                setAIRepoList([...repos]);
            } catch {
                // 静默失败，用户可手动输入
            } finally {
                setAIRepoLoading(false);
            }
        }
    }, [machineId, aiRepoList.length, aiRepoLoading]);

    const aiFilteredRepos = React.useMemo(() => {
        const needle = aiRepoSearch.trim().toLowerCase();
        if (!needle) return aiRepoList;
        return aiRepoList.filter(
            (r) => r.name.toLowerCase().includes(needle) || r.repoPath.toLowerCase().includes(needle),
        );
    }, [aiRepoList, aiRepoSearch]);

    const handleAIGenerate = React.useCallback(async () => {
        if (!machineId || !aiDirectory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        setAIGenerating(true);
        setAISuggestions([]);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                Modal.alert(t("common.error"), t("errors.unknownError"));
                return;
            }
            const suggestions = await machineAISuggestAgentLoops(
                machineId,
                aiDirectory.trim(),
                credentials.token,
                aiProfileId ?? undefined,
            );
            setAISuggestions(suggestions);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAIGenerating(false);
        }
    }, [machineId, aiDirectory]);

    const adoptAISuggestion = React.useCallback(async (suggestion: MachineAgentLoopSuggestion) => {
        if (!machineId || suggestion.alreadyConfigured) return;
        setAIAdoptingKey(suggestion.key);
        try {
            const result = await machineCreateAgentLoop(machineId, {
                name: suggestion.name,
                directory: suggestion.directory,
                prompt: suggestion.prompt,
                intervalMs: suggestion.intervalMs,
                agent: suggestion.agent,
                fileWatchEnabled: suggestion.fileWatchEnabled,
                githubBridgeEnabled: suggestion.githubBridgeEnabled,
                ciBridgeEnabled: suggestion.ciBridgeEnabled,
                goal: suggestion.goal,
                currentFocus: suggestion.currentFocus,
                maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
                retryBackoffMs: suggestion.retryBackoffMs,
                runNow: false,
            });
            if (!result.success) throw new Error(result.errorMessage || t("machine.agentLoopCreateFailed"));
            setAISuggestions((prev) =>
                prev.map((s) => s.key === suggestion.key ? { ...s, alreadyConfigured: true } : s),
            );
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAIAdoptingKey(null);
        }
    }, [machineId, load]);

    const adoptAllAISuggestions = React.useCallback(async () => {
        if (!machineId) return;
        const pending = aiSuggestions.filter((s) => !s.alreadyConfigured);
        if (pending.length === 0) return;
        setAIAdoptingAll(true);
        try {
            for (const s of pending) {
                await adoptAISuggestion(s);
            }
            Modal.toast(t("machine.agentLoopSuggestionAdoptAllSummary", { count: pending.length }));
        } catch { /* per-item errors handled in adoptAISuggestion */ } finally {
            setAIAdoptingAll(false);
        }
    }, [machineId, aiSuggestions, adoptAISuggestion]);

    const mutateLoop = React.useCallback(async (loop: MachineAgentLoop, action: "pause" | "resume" | "run-now" | "remove" | "event") => {
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
                        : action === "event"
                            ? await machineEmitAgentLoopEvent(machineId, loop.id, {
                                source: "ui",
                                title: t("machine.agentLoopTriggerEventTitle"),
                                details: `${t("machine.agentLoopTriggerEventDetailPrefix")}: ${new Date().toLocaleString()}`,
                                autoRun: true,
                            })
                            : await machineRemoveAgentLoop(machineId, loop.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingLoop?.id === loop.id && action === "remove") {
                closeLoopEditor();
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingLoopId(null);
        }
    }, [closeLoopEditor, editingLoop?.id, load, machineId]);

    const openMachineFileViewer = React.useCallback((title: string, filePath: string) => {
        router.push(`/machine/${machineId}/file?path=${encodeURIComponent(utf8ToBase64(filePath))}&title=${encodeURIComponent(utf8ToBase64(title))}` as any);
    }, [machineId, router]);

    const openLoopActions = React.useCallback((loop: MachineAgentLoop) => {
        const upstreamLoopIds = upstreamLoopIdsByLoopId[loop.id] ?? [];
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("machine.agentLoopEdit"),
                onPress: () => { setEditingLoop(loop); setLoopEditorVisible(true); },
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

        buttons.push({
            text: t("machine.agentLoopTriggerEvent"),
            onPress: () => void mutateLoop(loop, "event"),
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

        if (loop.lastBriefAt) {
            buttons.push({
                text: t("machine.agentLoopViewBrief"),
                onPress: () => openMachineFileViewer(loop.name || loop.id, getLoopBriefPath(loop)),
            });
        }

        buttons.push({
            text: t("machine.agentLoopViewMemory"),
            onPress: () => openMachineFileViewer(`${loop.name || loop.id} • ${t("machine.agentLoopViewMemory")}`, getLoopMemoryPath(loop)),
        });

        buttons.push({
            text: t("machine.agentLoopViewContext"),
            onPress: () => openMachineFileViewer(`${loop.name || loop.id} • ${t("machine.agentLoopViewContext")}`, getLoopContextPath(loop)),
        });

        if (loop.downstreamLoopIds?.length) {
            buttons.push({
                text: t("machine.agentLoopOpenDownstreamLoop"),
                onPress: () => router.push(`/machine/${machineId}/loops?loopId=${encodeURIComponent(loop.downstreamLoopIds![0])}` as any),
            });
        }

        if (upstreamLoopIds.length) {
            buttons.push({
                text: t("machine.agentLoopOpenUpstreamLoop"),
                onPress: () => router.push(`/machine/${machineId}/loops?loopId=${encodeURIComponent(upstreamLoopIds[0])}` as any),
            });
        }

        const detailMessage = getLoopDetailMessage(loop)
            + (upstreamLoopIds.length ? `\n${t("machine.agentLoopUpstreamLoops")}: ${upstreamLoopIds.join(", ")}` : "");
        Modal.alert(loop.name || loop.id, detailMessage, buttons);
    }, [machineId, mutateLoop, openMachineFileViewer, router, upstreamLoopIdsByLoopId]);

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
            loop.goal,
            loop.currentFocus,
            loop.workingMemory,
            loop.lastReflectionSummary,
            loop.lastError,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
    }, [loops, searchQuery]);

    const loopSectionsByDirectory = React.useMemo(() => {
        const groups = new Map<string, MachineAgentLoop[]>();
        for (const loop of filteredLoops) {
            const dir = (loop.directory ?? "").replace(/\/+$/, "").trim();
            const list = groups.get(dir) ?? [];
            list.push(loop);
            groups.set(dir, list);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredLoops]);

    const enabledCount = React.useMemo(() => loops.filter((loop) => loop.enabled).length, [loops]);
    const suggestionCreatableCount = React.useMemo(() => suggestions.filter((suggestion) => !suggestion.alreadyConfigured).length, [suggestions]);

    const renderEmptyStateCard = (
        icon: React.ComponentProps<typeof Ionicons>["name"],
        title: string,
        subtitle?: string,
    ) => (
        <View
            style={[
                styles.emptyStateCard,
                { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
            ]}
        >
            <Ionicons name={icon} size={20} color={theme.colors.textSecondary} />
            <View style={styles.emptyStateTextWrap}>
                <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>{title}</Text>
                {subtitle ? <Text style={[styles.emptyStateSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text> : null}
            </View>
        </View>
    );

    return (
        <>
            <Stack.Screen options={{ title: t("machine.agentLoops") }} />
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
            >

                <ItemGroup title={t("machine.agentLoops")}>
                    <View style={[styles.loopsIntegratedTop, { borderBottomColor: theme.colors.divider }]}>
                        {/* 区块说明 */}
                        <Text style={[styles.loopsHintText, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                            {t("machine.agentLoopsViewAllHint")}
                        </Text>
                        {/* 搜索栏 + 刷新 */}
                        <View style={styles.searchRow}>
                            <View style={[styles.searchBar, styles.searchBarFlex, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                <Ionicons name="search-outline" size={16} color={theme.colors.textSecondary} />
                                <TextInput
                                    style={[styles.searchInput, { color: theme.colors.text }]}
                                    placeholder={t("machine.agentLoopSearchPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                />
                            </View>
                            <Pressable
                                style={[styles.refreshIconButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                                onPress={() => void load("refresh")}
                            >
                                {refreshing ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <Ionicons name="refresh-outline" size={16} color={theme.colors.primary} />
                                )}
                            </Pressable>
                        </View>

                        {/* AI 配置：共用于 AI 生成和 Bootstrap 扫描 */}
                        <ProfilePicker
                            value={aiProfileId}
                            onChange={setAIProfileId}
                            profiles={aiProfiles}
                            defaultOptionLabel={t("supervisor.defaultProfileDefault")}
                            description={t("supervisor.dimAiProfileDesc")}
                        />

                        {/* 操作行：创建 + AI 生成 */}
                        <View style={styles.loopsActionRow}>
                            <Pressable
                                style={[styles.loopsActionCreate, { backgroundColor: theme.colors.button.primary.background }]}
                                onPress={openCreateLoopEditor}
                            >
                                <Ionicons name="add" size={16} color={theme.colors.button.primary.tint} />
                                <Text style={[styles.loopsActionCreateText, { color: theme.colors.button.primary.tint }]} numberOfLines={1}>
                                    {t("machine.agentLoopCreate")}
                                </Text>
                                <View style={[styles.loopsActionBadge, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
                                    <Text style={[styles.loopsActionBadgeText, { color: theme.colors.button.primary.tint }]}>{`${enabledCount}/${loops.length}`}</Text>
                                </View>
                            </Pressable>
                            <Pressable
                                style={[styles.loopsActionSuggest, {
                                    borderColor: showAIInput ? theme.colors.header.tint : theme.colors.divider,
                                    backgroundColor: showAIInput ? theme.colors.surfaceHigh : theme.colors.surfaceHigh,
                                }]}
                                onPress={() => setShowAIInput((prev) => !prev)}
                            >
                                <Ionicons name="sparkles-outline" size={16} color={theme.colors.header.tint} />
                                <Text style={[styles.loopsActionSuggestText, { color: theme.colors.header.tint }]} numberOfLines={1}>
                                    {t("machine.agentLoopAIGenerate")}
                                </Text>
                            </Pressable>
                        </View>

                        {/* AI 生成：展开的目录输入 + 仓库选择器 + 生成按钮 */}
                        {showAIInput && (
                            <View style={styles.aiInputWrap}>
                                <View style={[styles.aiInputRow, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                    <TextInput
                                        style={[styles.aiDirectoryInput, { color: theme.colors.text }]}
                                        placeholder={t("machine.agentLoopPathPlaceholder")}
                                        placeholderTextColor={theme.colors.textSecondary}
                                        value={aiDirectory}
                                        onChangeText={setAIDirectory}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                    <Pressable
                                        style={[styles.aiRepoPickerBtn, {
                                            borderColor: aiRepoPickerOpen ? theme.colors.primary : theme.colors.divider,
                                            backgroundColor: aiRepoPickerOpen ? theme.colors.surfaceHigh : "transparent",
                                        }]}
                                        onPress={() => void handleOpenAIRepoPicker()}
                                    >
                                        {aiRepoLoading ? (
                                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                        ) : (
                                            <Ionicons
                                                name={aiRepoPickerOpen ? "folder-open-outline" : "folder-outline"}
                                                size={16}
                                                color={aiRepoPickerOpen ? theme.colors.primary : theme.colors.textSecondary}
                                            />
                                        )}
                                    </Pressable>
                                    <Pressable
                                        style={[styles.aiGenerateBtn, {
                                            backgroundColor: aiGenerating ? theme.colors.surfaceHigh : theme.colors.header.tint,
                                            opacity: aiGenerating ? 0.7 : 1,
                                        }]}
                                        onPress={() => void handleAIGenerate()}
                                        disabled={aiGenerating}
                                    >
                                        {aiGenerating ? (
                                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                        ) : (
                                            <Ionicons name="sparkles" size={15} color="#fff" />
                                        )}
                                    </Pressable>
                                </View>
                                {aiRepoPickerOpen && (
                                    <View style={[styles.aiRepoPickerPanel, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                        <View style={[styles.aiRepoSearchBar, { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                            <Ionicons name="search-outline" size={14} color={theme.colors.textSecondary} />
                                            <TextInput
                                                style={[styles.aiRepoSearchInput, { color: theme.colors.text }]}
                                                placeholder={t("machine.agentLoopRepoSearch")}
                                                placeholderTextColor={theme.colors.textSecondary}
                                                value={aiRepoSearch}
                                                onChangeText={setAIRepoSearch}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                            />
                                        </View>
                                        {aiFilteredRepos.length === 0 ? (
                                            <Text style={[styles.aiRepoEmptyText, { color: theme.colors.textSecondary }]}>
                                                {aiRepoLoading ? t("common.loading") : t("machine.agentLoopRepoEmpty")}
                                            </Text>
                                        ) : (
                                            aiFilteredRepos.map((repo) => (
                                                <Pressable
                                                    key={repo.repoPath}
                                                    style={({ pressed }) => [
                                                        styles.aiRepoItem,
                                                        { borderBottomColor: theme.colors.divider, backgroundColor: pressed ? theme.colors.surfaceHigh : "transparent" },
                                                    ]}
                                                    onPress={() => {
                                                        setAIDirectory(repo.repoPath);
                                                        setAIRepoPickerOpen(false);
                                                        setAIRepoSearch("");
                                                    }}
                                                >
                                                    <Ionicons name="git-branch-outline" size={14} color={theme.colors.textSecondary} />
                                                    <View style={styles.aiRepoItemText}>
                                                        <Text style={[styles.aiRepoItemName, { color: theme.colors.text }]} numberOfLines={1}>{repo.name}</Text>
                                                        <Text style={[styles.aiRepoItemPath, { color: theme.colors.textSecondary }]} numberOfLines={1}>{repo.repoPath}</Text>
                                                    </View>
                                                    <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
                                                </Pressable>
                                            ))
                                        )}
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                    {loading ? (
                        <View style={styles.loopSkeletonBlock}>
                            <Text style={[styles.loopSkeletonHint, { color: theme.colors.textSecondary }]}>
                                {t("machine.agentLoopsLoading")}
                            </Text>
                            {Array.from({ length: 6 }, (_, skeletonIndex) => (
                                <View
                                    key={skeletonIndex}
                                    style={[styles.loopSkeletonRow, { borderBottomColor: theme.colors.divider }]}
                                >
                                    <View style={[styles.loopSkeletonIcon, { backgroundColor: theme.colors.surfaceHigh }]} />
                                    <View style={styles.loopSkeletonTextCol}>
                                        <View style={[styles.loopSkeletonLineTitle, { backgroundColor: theme.colors.surfaceHigh }]} />
                                        <View style={[styles.loopSkeletonLineMeta, { backgroundColor: theme.colors.surfaceHigh }]} />
                                    </View>
                                </View>
                            ))}
                        </View>
                    ) : filteredLoops.length === 0 ? (
                        renderEmptyStateCard("repeat-outline", loops.length === 0 ? t("machine.agentLoopsEmpty") : t("machine.agentLoopNoMatches"), t("machine.agentLoopsViewAllHint"))
                    ) : (
                        loopSectionsByDirectory.map(([directoryKey, sectionLoops]) => (
                            <View key={directoryKey || "__nodir__"}>
                                {/* Directory group header */}
                                <View
                                    style={[
                                        styles.repoGroupHeader,
                                        { borderTopColor: theme.colors.divider, borderBottomColor: theme.colors.divider },
                                    ]}
                                >
                                    <Ionicons name="folder-outline" size={12} color={theme.colors.textSecondary} />
                                    <Text
                                        style={[styles.repoGroupHeaderText, { color: theme.colors.textSecondary }]}
                                        numberOfLines={1}
                                    >
                                        {directoryKey || t("machine.agentLoopUnknownRepo")}
                                    </Text>
                                    <View style={[styles.repoGroupBadge, { backgroundColor: theme.colors.surfaceHigh, borderColor: theme.colors.divider }]}>
                                        <Text style={[styles.repoGroupBadgeText, { color: theme.colors.textSecondary }]}>
                                            {sectionLoops.length}
                                        </Text>
                                    </View>
                                </View>
                                {/* Loop rows */}
                                {sectionLoops.map((loop, idx) => (
                                    <React.Fragment key={loop.id}>
                                        <LoopRow
                                            loop={loop}
                                            onPress={() => openLoopActions(loop)}
                                            mutating={mutatingLoopId === loop.id}
                                        />
                                        {idx < sectionLoops.length - 1 && (
                                            <View style={{ height: 1, backgroundColor: theme.colors.divider, marginLeft: 15 }} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </View>
                        ))
                    )}
                    {/* AI 生成建议列表 */}
                    {aiSuggestions.length > 0 && (
                        <LoopSuggestionsSection
                            suggestions={aiSuggestions}
                            suggestionCreatableCount={aiSuggestions.filter((s) => !s.alreadyConfigured).length}
                            adoptingAllSuggestions={aiAdoptingAll}
                            creatingSuggestionKey={aiAdoptingKey}
                            adoptSuggestion={adoptAISuggestion}
                            adoptAllSuggestions={adoptAllAISuggestions}
                            formLayoutStacked={formLayout.modalHeaderStacked}
                        />
                    )}
                    {/* 规则推荐建议列表 */}
                    <LoopSuggestionsSection
                        suggestions={suggestions}
                        suggestionCreatableCount={suggestionCreatableCount}
                        adoptingAllSuggestions={adoptingAllSuggestions}
                        creatingSuggestionKey={creatingSuggestionKey}
                        adoptSuggestion={adoptSuggestion}
                        adoptAllSuggestions={adoptAllSuggestions}
                        formLayoutStacked={formLayout.modalHeaderStacked}
                    />
                </ItemGroup>

                {/* Recent Briefs from Agent Loops */}
                <BriefSection briefs={machine?.daemonState?.recentBriefs ?? []} />

                {/* Automation -- collapsible, default expanded */}
                <LoopAutomationSection
                    bootstrapProfiles={bootstrapProfiles}
                    autoDreamProfiles={autoDreamProfiles}
                    bootstrapEntries={bootstrapEntries}
                    showAutomation={showAutomation}
                    setShowAutomation={setShowAutomation}
                    mutatingBootstrapProfileId={mutatingBootstrapProfileId}
                    mutatingAutoDreamProfileId={mutatingAutoDreamProfileId}
                    bootstrapScanning={bootstrapScanning}
                    bootstrappingRepoPath={bootstrappingRepoPath}
                    setEditingBootstrapProfile={setEditingBootstrapProfile}
                    setBootstrapProfileEditorVisible={setBootstrapProfileEditorVisible}
                    setEditingAutoDreamProfile={setEditingAutoDreamProfile}
                    setAutoDreamProfileEditorVisible={setAutoDreamProfileEditorVisible}
                    mutateBootstrapProfile={mutateBootstrapProfile}
                    mutateAutoDreamProfile={mutateAutoDreamProfile}
                    scanBootstrapRepos={scanBootstrapRepos}
                    adoptRepoSuggestions={adoptRepoSuggestions}
                    openMachineFileViewer={openMachineFileViewer}
                    formLayoutStacked={formLayout.modalHeaderStacked}
                />
            </ScrollView>

            <LoopEditorModal
                visible={loopEditorVisible}
                onClose={closeLoopEditor}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingLoop={editingLoop}
                loopCount={loops.length}
                enabledCount={enabledCount}
            />

            <BootstrapProfileEditorModal
                visible={bootstrapProfileEditorVisible}
                onClose={() => setBootstrapProfileEditorVisible(false)}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingProfile={editingBootstrapProfile}
            />

            <AutoDreamProfileEditorModal
                visible={autoDreamProfileEditorVisible}
                onClose={() => setAutoDreamProfileEditorVisible(false)}
                onSaved={() => void load("refresh")}
                machineId={machineId}
                editingProfile={editingAutoDreamProfile}
            />
        </>
    );
});

const styles = StyleSheet.create((theme, rt) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
        width: "100%",
        alignSelf: "center",
        paddingBottom: 32,
    },
    loopSkeletonBlock: {
        paddingBottom: 4,
    },
    loopSkeletonHint: {
        fontSize: 12,
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    loopSkeletonRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 10,
        borderBottomWidth: 1,
    },
    loopSkeletonIcon: {
        width: 28,
        height: 28,
        borderRadius: 8,
    },
    loopSkeletonTextCol: {
        flex: 1,
        gap: 6,
    },
    loopSkeletonLineTitle: {
        height: 14,
        borderRadius: 4,
        width: "55%",
        maxWidth: 220,
    },
    loopSkeletonLineMeta: {
        height: 11,
        borderRadius: 4,
        width: "88%",
        maxWidth: 320,
    },
    repoGroupHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderTopWidth: 1,
        borderBottomWidth: 1,
    },
    repoGroupHeaderText: {
        flex: 1,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.3,
    },
    repoGroupBadge: {
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    repoGroupBadgeText: {
        fontSize: 10,
        fontWeight: "700",
    },
    searchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    searchBar: {
        minHeight: 38,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    searchBarFlex: {
        flex: 1,
    },
    loopsIntegratedTop: {
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 10,
        gap: 8,
        borderBottomWidth: 1,
    },
    loopsHintText: {
        fontSize: 12,
        lineHeight: 17,
        paddingHorizontal: 2,
    },
    loopsActionRow: {
        flexDirection: "row",
        gap: 8,
    },
    aiInputWrap: {
        gap: 4,
    },
    aiInputRow: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 4,
        gap: 8,
    },
    aiDirectoryInput: {
        flex: 1,
        fontSize: 13,
        paddingVertical: 8,
    },
    aiRepoPickerBtn: {
        width: 30,
        height: 30,
        borderRadius: 7,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    aiGenerateBtn: {
        width: 34,
        height: 34,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    aiRepoPickerPanel: {
        borderWidth: 1,
        borderRadius: 10,
        overflow: "hidden",
        maxHeight: 200,
    },
    aiRepoSearchBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderBottomWidth: 1,
    },
    aiRepoSearchInput: {
        flex: 1,
        fontSize: 13,
        paddingVertical: 0,
    },
    aiRepoEmptyText: {
        fontSize: 12,
        textAlign: "center",
        paddingVertical: 12,
    },
    aiRepoItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderBottomWidth: 1,
    },
    aiRepoItemText: {
        flex: 1,
        gap: 2,
    },
    aiRepoItemName: {
        fontSize: 13,
        fontWeight: "600",
    },
    aiRepoItemPath: {
        fontSize: 11,
        lineHeight: 15,
    },
    loopsActionCreate: {
        flex: 3,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    loopsActionCreateText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "700",
    },
    loopsActionSuggest: {
        flex: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    loopsActionSuggestText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "600",
    },
    loopsActionBadge: {
        minHeight: 22,
        minWidth: 32,
        paddingHorizontal: 6,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    loopsActionBadgeText: {
        fontSize: 11,
        fontWeight: "700",
    },
    refreshIconButton: {
        width: 38,
        height: 38,
        borderWidth: 1,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        paddingVertical: 0,
    },
    emptyStateCard: {
        marginHorizontal: 12,
        marginVertical: 12,
        padding: 16,
        borderWidth: 1,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    emptyStateTextWrap: {
        flex: 1,
        gap: 2,
    },
    emptyStateTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    emptyStateSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
}));
