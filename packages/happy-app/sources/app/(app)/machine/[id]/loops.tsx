import * as React from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { BaseModal } from "@/modal/components/BaseModal";
import {
    machineCreateAgentLoop,
    machineEmitAgentLoopEvent,
    machineListAgentLoops,
    machinePauseAgentLoop,
    machineRemoveAgentLoop,
    machineResumeAgentLoop,
    machineRunAgentLoopNow,
    machineSuggestAgentLoops,
    machineUpdateAgentLoop,
    machineListGitRepos,
    machineListAgentLoopBootstrapProfiles,
    machinePauseAgentLoopBootstrapProfile,
    machineResumeAgentLoopBootstrapProfile,
    machineRunNowAgentLoopBootstrapProfile,
    machineRemoveAgentLoopBootstrapProfile,
    machineListAutoDreamProfiles,
    machinePauseAutoDreamProfile,
    machineResumeAutoDreamProfile,
    machineRunNowAutoDreamProfile,
    machineRemoveAutoDreamProfile,
    type GitRepoEntry,
    type MachineAgentLoop,
    type MachineAgentLoopBootstrapProfile,
    type MachineAgentLoopSuggestion,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { useMachine } from "@/sync/storage";
import { utf8ToBase64 } from "@/utils/stringUtils";
import {
    getLoopFormLayoutMode,
    getLoopModalMetrics,
    getQuickActionColumnCount,
} from "./loopsLayout";
import { AutoDreamProfileEditorModal } from "./AutoDreamProfileEditorModal";
import { BootstrapProfileEditorModal } from "./BootstrapProfileEditorModal";
import { OneClickSetupCard } from "./OneClickSetupCard";
import { useOneClickSetup } from "./useOneClickSetup";
import {
    formatDownstreamTriggers,
    formatEnvironmentVariables,
    formatIntervalMs,
    formatLineList,
    isRpcMethodUnavailableError,
    isValidTimeOfDay,
    parseDownstreamTriggers,
    parseEnvironmentVariables,
    parseIntervalMs,
    parseLineList,
    parsePositiveInteger,
} from "./loopsUtils";
import {
    getAutoDreamProfileDetailMessage,
    getAutoDreamProfileStatusColor,
    getAutoDreamProfileSubtitle,
    getBootstrapProfileDetailMessage,
    getBootstrapProfileStatusColor,
    getBootstrapProfileSubtitle,
    getLoopBriefPath,
    getLoopContextPath,
    getLoopDetailMessage,
    getLoopMemoryPath,
    getLoopStatusColor,
    getLoopStatusLabel,
    getLoopSubtitle,
} from "./loopsLabels";

interface RepoBootstrapEntry {
    readonly repo: GitRepoEntry;
    readonly suggestions: readonly MachineAgentLoopSuggestion[];
}

export default React.memo(function MachineLoopsPage() {
    const { id: machineIdParam, loopId: focusLoopId } = useLocalSearchParams<{ id: string; loopId?: string }>();
    const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
    const router = useRouter();
    const { theme } = useUnistyles();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const quickActionColumns = getQuickActionColumnCount({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });
    const modalMetrics = getLoopModalMetrics({
        viewportWidth,
        viewportHeight,
        isWeb: Platform.OS === "web",
    });
    const formLayout = getLoopFormLayoutMode({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });
    const machine = useMachine(machineId ?? "");
    const rpcReady = machine?.rpcReady ?? false;
    const loadRef = React.useRef<() => void>(() => {});
    const oneClickSetup = useOneClickSetup(machineId, React.useCallback(() => loadRef.current(), []));
    const [loops, setLoops] = React.useState<MachineAgentLoop[]>([]);
    const upstreamLoopIdsByLoopId = React.useMemo(() => {
        const mapping: Record<string, string[]> = {};
        loops.forEach((candidate) => {
            candidate.downstreamLoopIds?.forEach((downstreamLoopId) => {
                mapping[downstreamLoopId] = [...(mapping[downstreamLoopId] ?? []), candidate.id];
            });
        });
        return mapping;
    }, [loops]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [mutatingLoopId, setMutatingLoopId] = React.useState<string | null>(null);
    const [editingLoopId, setEditingLoopId] = React.useState<string | null>(null);
    const [suggestions, setSuggestions] = React.useState<MachineAgentLoopSuggestion[]>([]);
    const [bootstrapEntries, setBootstrapEntries] = React.useState<RepoBootstrapEntry[]>([]);
    const [bootstrapScanning, setBootstrapScanning] = React.useState(false);
    const [bootstrappingRepoPath, setBootstrappingRepoPath] = React.useState<string | null>(null);
    const [bootstrapProfiles, setBootstrapProfiles] = React.useState<MachineAgentLoopBootstrapProfile[]>([]);
    const [mutatingBootstrapProfileId, setMutatingBootstrapProfileId] = React.useState<string | null>(null);
    const [editingBootstrapProfile, setEditingBootstrapProfile] = React.useState<MachineAgentLoopBootstrapProfile | null>(null);
    const [autoDreamProfiles, setAutoDreamProfiles] = React.useState<MachineAutoDreamProfile[]>([]);
    const [mutatingAutoDreamProfileId, setMutatingAutoDreamProfileId] = React.useState<string | null>(null);
    const [editingAutoDreamProfile, setEditingAutoDreamProfile] = React.useState<MachineAutoDreamProfile | null>(null);
    const [suggesting, setSuggesting] = React.useState(false);
    const [creatingSuggestionKey, setCreatingSuggestionKey] = React.useState<string | null>(null);
    const [adoptingAllSuggestions, setAdoptingAllSuggestions] = React.useState(false);
    const [showAutomation, setShowAutomation] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [showAdvanced, setShowAdvanced] = React.useState(false);
    const [name, setName] = React.useState("");
    const [directory, setDirectory] = React.useState("");
    const [interval, setInterval] = React.useState("10m");
    const [prompt, setPrompt] = React.useState("");
    const [agent, setAgent] = React.useState<MachineAgentLoop["agent"]>("claude");
    const [profileId, setProfileId] = React.useState("");
    const [projectId, setProjectId] = React.useState("");
    const [fileWatchEnabled, setFileWatchEnabled] = React.useState(false);
    const [githubBridgeEnabled, setGithubBridgeEnabled] = React.useState(false);
    const [ciBridgeEnabled, setCiBridgeEnabled] = React.useState(false);
    const [eventSourceText, setEventSourceText] = React.useState("");
    const [eventKeywordText, setEventKeywordText] = React.useState("");
    const [goal, setGoal] = React.useState("");
    const [currentFocus, setCurrentFocus] = React.useState("");
    const [workingMemory, setWorkingMemory] = React.useState("");
    const [reflectionSummary, setReflectionSummary] = React.useState("");
    const [maxFailures, setMaxFailures] = React.useState("");
    const [retryBackoff, setRetryBackoff] = React.useState("");
    const [cooldown, setCooldown] = React.useState("");
    const [quietStart, setQuietStart] = React.useState("");
    const [quietEnd, setQuietEnd] = React.useState("");
    const [maxAutoRuns, setMaxAutoRuns] = React.useState("");
    const [maxIterations, setMaxIterations] = React.useState("");
    const [stopOnSuccess, setStopOnSuccess] = React.useState(false);
    const [downstreamLoopText, setDownstreamLoopText] = React.useState("");
    const [downstreamTriggerText, setDownstreamTriggerText] = React.useState("");
    const [environmentText, setEnvironmentText] = React.useState("");
    const [loopEditorVisible, setLoopEditorVisible] = React.useState(false);
    const [bootstrapProfileEditorVisible, setBootstrapProfileEditorVisible] = React.useState(false);
    const [autoDreamProfileEditorVisible, setAutoDreamProfileEditorVisible] = React.useState(false);
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
        setFileWatchEnabled(false);
        setGithubBridgeEnabled(false);
        setCiBridgeEnabled(false);
        setEventSourceText("");
        setEventKeywordText("");
        setGoal("");
        setCurrentFocus("");
        setWorkingMemory("");
        setReflectionSummary("");
        setMaxFailures("");
        setRetryBackoff("");
        setCooldown("");
        setQuietStart("");
        setQuietEnd("");
        setMaxAutoRuns("");
        setMaxIterations("");
        setStopOnSuccess(false);
        setDownstreamLoopText("");
        setDownstreamTriggerText("");
        setEnvironmentText("");
        setShowAdvanced(false);
    }, []);


    const closeLoopEditor = React.useCallback(() => {
        setLoopEditorVisible(false);
        resetForm();
    }, [resetForm]);

    const openCreateLoopEditor = React.useCallback(() => {
        resetForm();
        setLoopEditorVisible(true);
    }, [resetForm]);


    const [debugInfo, setDebugInfo] = React.useState("init");
    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId) {
            setDebugInfo("no machineId");
            return;
        }
        if (kind === "initial") {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            if (!rpcReady) {
                setDebugInfo(`rpcReady=false, kind=${kind}, mid=${machineId.slice(0, 8)}`);
                return;
            }
            setDebugInfo(`fetching... kind=${kind}`);
            const results = await Promise.allSettled([
                machineListAgentLoops(machineId),
                machineListAgentLoopBootstrapProfiles(machineId),
                machineListAutoDreamProfiles(machineId),
            ]);
            const loopResult = results[0];
            const bootstrapResult = results[1];
            const dreamResult = results[2];
            const loopCount = loopResult.status === "fulfilled" ? (loopResult.value.loops?.length ?? 0) : -1;
            const loopError = loopResult.status === "rejected" ? (loopResult.reason instanceof Error ? loopResult.reason.message : String(loopResult.reason)) : null;
            const bsCount = bootstrapResult.status === "fulfilled" ? (bootstrapResult.value.profiles?.length ?? 0) : -1;
            const dreamCount = dreamResult.status === "fulfilled" ? (dreamResult.value.profiles?.length ?? 0) : -1;
            setDebugInfo(`loops=${loopCount}${loopError ? ` err=${loopError}` : ""} bs=${bsCount} dream=${dreamCount} | rpc=${String(rpcReady)}`);
            if (loopResult.status === "fulfilled") {
                setLoops(loopResult.value.loops ?? []);
            }
            if (bootstrapResult.status === "fulfilled") {
                setBootstrapProfiles(bootstrapResult.value.profiles ?? []);
            }
            if (dreamResult.status === "fulfilled") {
                setAutoDreamProfiles(dreamResult.value.profiles ?? []);
            }
        } catch (error) {
            setDebugInfo(`catch: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (kind === "initial") {
                setLoading(false);
            } else {
                setRefreshing(false);
            }
        }
    }, [machineId, rpcReady]);

    // Retry loading when rpcReady becomes true after initial load
    const rpcReadyPrev = React.useRef(rpcReady);
    React.useEffect(() => {
        if (rpcReady && !rpcReadyPrev.current && loops.length === 0) {
            void load("refresh");
        }
        rpcReadyPrev.current = rpcReady;
    }, [rpcReady, load, loops.length]);

    loadRef.current = () => void load("refresh");

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
            if (editingLoopId === loop.id && action === "remove") {
                setLoopEditorVisible(false);
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
        setFileWatchEnabled(Boolean(loop.fileWatchEnabled));
        setGithubBridgeEnabled(Boolean(loop.githubBridgeEnabled));
        setCiBridgeEnabled(Boolean(loop.ciBridgeEnabled));
        setEventSourceText(formatLineList(loop.eventSourceAllowlist));
        setEventKeywordText(formatLineList(loop.eventKeywordFilters));
        setGoal(loop.goal ?? "");
        setCurrentFocus(loop.currentFocus ?? "");
        setWorkingMemory(loop.workingMemory ?? "");
        setReflectionSummary(loop.lastReflectionSummary ?? "");
        setMaxFailures(loop.maxConsecutiveFailures ? String(loop.maxConsecutiveFailures) : "");
        setRetryBackoff(loop.retryBackoffMs ? formatIntervalMs(loop.retryBackoffMs) : "");
        setCooldown(loop.cooldownMs ? formatIntervalMs(loop.cooldownMs) : "");
        setQuietStart(loop.quietHoursStart ?? "");
        setQuietEnd(loop.quietHoursEnd ?? "");
        setMaxAutoRuns(loop.maxAutoRunsPerDay ? String(loop.maxAutoRunsPerDay) : "");
        setMaxIterations(loop.maxIterations ? String(loop.maxIterations) : "");
        setStopOnSuccess(Boolean(loop.stopOnSuccess));
        setDownstreamLoopText(formatLineList(loop.downstreamLoopIds));
        setDownstreamTriggerText(formatDownstreamTriggers(loop.downstreamTriggerOn));
        setEnvironmentText(formatEnvironmentVariables(loop.environmentVariables));
        setShowAdvanced(Boolean(loop.projectId || loop.profileId || loop.environmentVariables || loop.agent !== "claude" || loop.fileWatchEnabled || loop.githubBridgeEnabled || loop.ciBridgeEnabled || loop.eventSourceAllowlist?.length || loop.eventKeywordFilters?.length || loop.goal || loop.currentFocus || loop.workingMemory || loop.lastReflectionSummary || loop.maxConsecutiveFailures || loop.retryBackoffMs || loop.cooldownMs || loop.quietHoursStart || loop.quietHoursEnd || loop.maxAutoRunsPerDay || loop.maxIterations || loop.stopOnSuccess || loop.downstreamLoopIds?.length || loop.downstreamTriggerOn?.length));
        setLoopEditorVisible(true);
    }, []);

    const openMachineFileViewer = React.useCallback((title: string, filePath: string) => {
        router.push(`/machine/${machineId}/file?path=${encodeURIComponent(utf8ToBase64(filePath))}&title=${encodeURIComponent(utf8ToBase64(title))}` as any);
    }, [machineId, router]);

    const openLoopActions = React.useCallback((loop: MachineAgentLoop) => {
        const upstreamLoopIds = upstreamLoopIdsByLoopId[loop.id] ?? [];
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

        const detailMessage = getLoopDetailMessage(loop)
            + (upstreamLoopIds.length ? `\n${t("machine.agentLoopUpstreamLoops")}: ${upstreamLoopIds.join(", ")}` : "");
        Modal.alert(loop.name || loop.id, detailMessage, buttons);
    }, [applyLoopToForm, machineId, mutateLoop, openMachineFileViewer, router, upstreamLoopIdsByLoopId]);

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

    const loadSuggestions = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        if (!directory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        setSuggesting(true);
        try {
            const result = await machineSuggestAgentLoops(machineId, {
                directory: directory.trim(),
                agent,
                projectId: projectId.trim() || undefined,
                profileId: profileId.trim() || undefined,
            });
            setSuggestions(result.suggestions ?? []);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setSuggesting(false);
        }
    }, [agent, directory, machineId, profileId, projectId]);


    const mutateBootstrapProfile = React.useCallback(async (profile: MachineAgentLoopBootstrapProfile, action: "pause" | "resume" | "run-now" | "remove") => {
        if (!machineId) {
            return;
        }
        setMutatingBootstrapProfileId(profile.id);
        try {
            const result = action === "pause"
                ? await machinePauseAgentLoopBootstrapProfile(machineId, profile.id)
                : action === "resume"
                    ? await machineResumeAgentLoopBootstrapProfile(machineId, profile.id)
                    : action === "run-now"
                        ? await machineRunNowAgentLoopBootstrapProfile(machineId, profile.id)
                        : await machineRemoveAgentLoopBootstrapProfile(machineId, profile.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingBootstrapProfile?.id === profile.id && action === "remove") {
                setBootstrapProfileEditorVisible(false);
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingBootstrapProfileId(null);
        }
    }, [editingBootstrapProfile?.id, load, machineId]);

    const openBootstrapProfileActions = React.useCallback((profile: MachineAgentLoopBootstrapProfile) => {
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("machine.agentLoopEdit"), onPress: () => { setEditingBootstrapProfile(profile); setBootstrapProfileEditorVisible(true); } },
            { text: t("machine.agentLoopRunNow"), onPress: () => void mutateBootstrapProfile(profile, "run-now") },
            profile.enabled
                ? { text: t("machine.agentLoopPause"), onPress: () => void mutateBootstrapProfile(profile, "pause") }
                : { text: t("machine.agentLoopResume"), onPress: () => void mutateBootstrapProfile(profile, "resume") },
            {
                text: t("machine.agentLoopRemove"),
                style: "destructive",
                onPress: () => Modal.alert(
                    t("machine.agentLoopRemove"),
                    t("machine.agentLoopRemoveMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("machine.agentLoopRemove"), style: "destructive", onPress: () => void mutateBootstrapProfile(profile, "remove") },
                    ],
                ),
            },
        ];
        Modal.alert(profile.name || profile.id, getBootstrapProfileDetailMessage(profile), buttons);
    }, [mutateBootstrapProfile]);


    const mutateAutoDreamProfile = React.useCallback(async (profile: MachineAutoDreamProfile, action: "pause" | "resume" | "run-now" | "remove") => {
        if (!machineId) {
            return;
        }
        setMutatingAutoDreamProfileId(profile.id);
        try {
            const result = action === "pause"
                ? await machinePauseAutoDreamProfile(machineId, profile.id)
                : action === "resume"
                    ? await machineResumeAutoDreamProfile(machineId, profile.id)
                    : action === "run-now"
                        ? await machineRunNowAutoDreamProfile(machineId, profile.id)
                        : await machineRemoveAutoDreamProfile(machineId, profile.id);
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            if (editingAutoDreamProfile?.id === profile.id && action === "remove") {
                setAutoDreamProfileEditorVisible(false);
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingAutoDreamProfileId(null);
        }
    }, [editingAutoDreamProfile?.id, load, machineId]);

    const openAutoDreamProfileActions = React.useCallback((profile: MachineAutoDreamProfile) => {
        const buttons = [
            { text: t("common.ok") },
            { text: t("machine.agentLoopEdit"), onPress: () => { setEditingAutoDreamProfile(profile); setAutoDreamProfileEditorVisible(true); } },
            profile.latestDreamFilePath ? { text: t("machine.autoDreamViewReport"), onPress: () => openMachineFileViewer(profile.name || profile.id, profile.latestDreamFilePath!) } : undefined,
            { text: t("machine.agentLoopRunNow"), onPress: () => void mutateAutoDreamProfile(profile, "run-now") },
            profile.enabled
                ? { text: t("machine.agentLoopPause"), onPress: () => void mutateAutoDreamProfile(profile, "pause") }
                : { text: t("machine.agentLoopResume"), onPress: () => void mutateAutoDreamProfile(profile, "resume") },
            {
                text: t("machine.agentLoopRemove"),
                style: "destructive" as const,
                onPress: () => {
                    Modal.alert(
                        t("machine.agentLoopRemove"),
                        t("machine.autoDreamRemoveMessage"),
                        [
                            { text: t("common.cancel"), style: "cancel" },
                            { text: t("machine.agentLoopRemove"), style: "destructive", onPress: () => void mutateAutoDreamProfile(profile, "remove") },
                        ],
                    );
                },
            },
        ].filter(Boolean) as Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> ;
        Modal.alert(profile.name || profile.id, getAutoDreamProfileDetailMessage(profile), buttons);
    }, [mutateAutoDreamProfile, openMachineFileViewer]);

    const scanBootstrapRepos = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        setBootstrapScanning(true);
        try {
            const repos = await machineListGitRepos(machineId);
            const limitedRepos = repos.slice(0, 20);
            const entries = await Promise.all(limitedRepos.map(async (repo) => {
                const result = await machineSuggestAgentLoops(machineId, {
                    directory: repo.repoPath,
                    agent,
                    projectId: projectId.trim() || undefined,
                    profileId: profileId.trim() || undefined,
                });
                return { repo, suggestions: result.suggestions ?? [] } satisfies RepoBootstrapEntry;
            }));
            setBootstrapEntries(entries.filter((entry) => entry.suggestions.length > 0));
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setBootstrapScanning(false);
        }
    }, [agent, machineId, profileId, projectId]);

    const adoptRepoSuggestions = React.useCallback(async (entry: RepoBootstrapEntry, runNow: boolean) => {
        if (!machineId) {
            return;
        }
        setBootstrappingRepoPath(entry.repo.repoPath);
        try {
            for (const suggestion of entry.suggestions) {
                if (suggestion.alreadyConfigured) {
                    continue;
                }
                const result = await machineCreateAgentLoop(machineId, {
                    name: suggestion.name,
                    directory: suggestion.directory,
                    prompt: suggestion.prompt,
                    intervalMs: suggestion.intervalMs,
                    agent: suggestion.agent,
                    projectId: projectId.trim() || undefined,
                    profileId: profileId.trim() || undefined,
                    fileWatchEnabled: suggestion.fileWatchEnabled,
                    githubBridgeEnabled: suggestion.githubBridgeEnabled,
                    ciBridgeEnabled: suggestion.ciBridgeEnabled,
                    maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
                    retryBackoffMs: suggestion.retryBackoffMs,
                    eventSourceAllowlist: suggestion.eventSourceAllowlist,
                    eventKeywordFilters: suggestion.eventKeywordFilters,
                    goal: suggestion.goal,
                    currentFocus: suggestion.currentFocus,
                    workingMemory: suggestion.workingMemory,
                    lastReflectionSummary: suggestion.lastReflectionSummary,
                    runNow,
                });
                if (!result.success) {
                    throw new Error(result.errorMessage || t("machine.agentLoopCreateFailed"));
                }
            }
            await load("refresh");
            await scanBootstrapRepos();
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setBootstrappingRepoPath(null);
        }
    }, [load, machineId, profileId, projectId, scanBootstrapRepos]);

    const createLoopFromSuggestion = React.useCallback(async (suggestion: MachineAgentLoopSuggestion) => {
        if (!machineId || suggestion.alreadyConfigured) {
            return { success: true } as const;
        }
        const result = await machineCreateAgentLoop(machineId, {
            name: suggestion.name,
            directory: suggestion.directory,
            prompt: suggestion.prompt,
            intervalMs: suggestion.intervalMs,
            agent: suggestion.agent,
            projectId: projectId.trim() || undefined,
            profileId: profileId.trim() || undefined,
            fileWatchEnabled: suggestion.fileWatchEnabled,
            githubBridgeEnabled: suggestion.githubBridgeEnabled,
            ciBridgeEnabled: suggestion.ciBridgeEnabled,
            maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
            retryBackoffMs: suggestion.retryBackoffMs,
            cooldownMs: suggestion.cooldownMs,
            quietHoursStart: suggestion.quietHoursStart,
            quietHoursEnd: suggestion.quietHoursEnd,
            maxAutoRunsPerDay: suggestion.maxAutoRunsPerDay,
            eventSourceAllowlist: suggestion.eventSourceAllowlist,
            eventKeywordFilters: suggestion.eventKeywordFilters,
            goal: suggestion.goal,
            currentFocus: suggestion.currentFocus,
            workingMemory: suggestion.workingMemory,
            lastReflectionSummary: suggestion.lastReflectionSummary,
            runNow: false,
        });
        if (!result.success) {
            throw new Error(result.errorMessage || t("machine.agentLoopCreateFailed"));
        }
        return result;
    }, [machineId, profileId, projectId]);

    const adoptSuggestion = React.useCallback(async (suggestion: MachineAgentLoopSuggestion) => {
        if (!machineId || suggestion.alreadyConfigured) {
            return;
        }
        setCreatingSuggestionKey(suggestion.key);
        try {
            await createLoopFromSuggestion(suggestion);
            await load("refresh");
            await loadSuggestions();
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setCreatingSuggestionKey(null);
        }
    }, [createLoopFromSuggestion, load, loadSuggestions, machineId]);

    const adoptAllSuggestions = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        const pendingSuggestions = suggestions.filter((entry) => !entry.alreadyConfigured);
        if (pendingSuggestions.length === 0) {
            Modal.toast(t("machine.agentLoopSuggestionConfigured"));
            return;
        }
        setAdoptingAllSuggestions(true);
        try {
            for (const suggestion of pendingSuggestions) {
                await createLoopFromSuggestion(suggestion);
            }
            await load("refresh");
            await loadSuggestions();
            Modal.toast(t("machine.agentLoopSuggestionAdoptAllSummary", { count: pendingSuggestions.length }));
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAdoptingAllSuggestions(false);
        }
    }, [createLoopFromSuggestion, load, loadSuggestions, machineId, suggestions]);

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
        const eventSourceAllowlist = parseLineList(eventSourceText);
        const eventKeywordFilters = parseLineList(eventKeywordText);
        const parsedMaxFailures = parsePositiveInteger(maxFailures);
        const parsedRetryBackoff = retryBackoff.trim() ? parseIntervalMs(retryBackoff) : undefined;
        const parsedCooldown = cooldown.trim() ? parseIntervalMs(cooldown) : undefined;
        const parsedMaxAutoRuns = parsePositiveInteger(maxAutoRuns);
        const parsedMaxIterations = parsePositiveInteger(maxIterations);
        const parsedDownstreamTriggers = parseDownstreamTriggers(downstreamTriggerText);
        if (maxFailures.trim() && parsedMaxFailures == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopMaxFailuresInvalid"));
            return;
        }
        if (retryBackoff.trim() && parsedRetryBackoff == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopRetryBackoffInvalid"));
            return;
        }
        if (cooldown.trim() && parsedCooldown == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopCooldownInvalid"));
            return;
        }
        if (maxAutoRuns.trim() && parsedMaxAutoRuns == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopMaxAutoRunsInvalid"));
            return;
        }
        if (maxIterations.trim() && parsedMaxIterations == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopMaxIterationsInvalid"));
            return;
        }
        if ((quietStart.trim() || quietEnd.trim()) && (!isValidTimeOfDay(quietStart) || !isValidTimeOfDay(quietEnd))) {
            Modal.alert(t("common.error"), t("machine.agentLoopQuietHoursInvalid"));
            return;
        }
        if (parsedDownstreamTriggers === null) {
            Modal.alert(t("common.error"), t("machine.agentLoopDownstreamTriggersInvalid"));
            return;
        }
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
                    fileWatchEnabled,
                    githubBridgeEnabled,
                    ciBridgeEnabled,
                    maxConsecutiveFailures: parsedMaxFailures ?? null,
                    retryBackoffMs: parsedRetryBackoff ?? null,
                    cooldownMs: parsedCooldown ?? null,
                    quietHoursStart: quietStart.trim() || null,
                    quietHoursEnd: quietEnd.trim() || null,
                    maxAutoRunsPerDay: parsedMaxAutoRuns ?? null,
                    maxIterations: parsedMaxIterations ?? null,
                    stopOnSuccess,
                    downstreamLoopIds: parseLineList(downstreamLoopText) ?? null,
                    downstreamTriggerOn: parsedDownstreamTriggers ?? null,
                    eventSourceAllowlist,
                    eventKeywordFilters,
                    goal,
                    currentFocus,
                    workingMemory,
                    lastReflectionSummary: reflectionSummary,
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
                    fileWatchEnabled,
                    githubBridgeEnabled,
                    ciBridgeEnabled,
                    maxConsecutiveFailures: parsedMaxFailures ?? undefined,
                    retryBackoffMs: parsedRetryBackoff ?? undefined,
                    cooldownMs: parsedCooldown ?? undefined,
                    quietHoursStart: quietStart.trim() || undefined,
                    quietHoursEnd: quietEnd.trim() || undefined,
                    maxAutoRunsPerDay: parsedMaxAutoRuns ?? undefined,
                    maxIterations: parsedMaxIterations ?? undefined,
                    stopOnSuccess,
                    downstreamLoopIds: parseLineList(downstreamLoopText) ?? undefined,
                    downstreamTriggerOn: parsedDownstreamTriggers ?? undefined,
                    eventSourceAllowlist,
                    eventKeywordFilters,
                    goal: goal.trim() || undefined,
                    currentFocus: currentFocus.trim() || undefined,
                    workingMemory: workingMemory.trim() || undefined,
                    lastReflectionSummary: reflectionSummary.trim() || undefined,
                    environmentVariables,
                    runNow: true,
                });
            if (!result.success) {
                throw new Error(result.errorMessage || (editingLoopId ? t("machine.agentLoopUpdateFailed") : t("machine.agentLoopCreateFailed")));
            }
            setLoopEditorVisible(false);
            resetForm();
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    }, [agent, ciBridgeEnabled, cooldown, currentFocus, directory, downstreamLoopText, downstreamTriggerText, editingLoopId, environmentText, eventKeywordText, eventSourceText, fileWatchEnabled, githubBridgeEnabled, goal, interval, load, machineId, maxAutoRuns, maxFailures, maxIterations, name, profileId, projectId, prompt, quietEnd, quietStart, reflectionSummary, resetForm, retryBackoff, stopOnSuccess, workingMemory]);

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

    const enabledCount = React.useMemo(() => loops.filter((loop) => loop.enabled).length, [loops]);
    const suggestionCreatableCount = React.useMemo(() => suggestions.filter((suggestion) => !suggestion.alreadyConfigured).length, [suggestions]);


    const handleSuggestAction = React.useCallback(() => {
        if (!directory.trim()) {
            openCreateLoopEditor();
            return;
        }
        void loadSuggestions();
    }, [directory, loadSuggestions, openCreateLoopEditor]);

    const renderSectionBanner = (title: string, subtitle: string, badge?: string, icon?: React.ComponentProps<typeof Ionicons>["name"]) => (
        <View style={[
            styles.sectionBanner,
            formLayout.modalHeaderStacked ? styles.sectionBannerStacked : null,
            { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface },
        ]}>
            <View style={styles.sectionBannerLeading}>
                {icon ? <Ionicons name={icon} size={18} color={theme.colors.textSecondary} /> : null}
                <View style={styles.sectionBannerTextWrap}>
                    <Text style={[styles.sectionBannerTitle, { color: theme.colors.text }]}>{title}</Text>
                    <Text style={[styles.sectionBannerSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>
                </View>
            </View>
            {badge ? (
                <View style={[styles.sectionBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}> 
                    <Text style={[styles.sectionBadgeText, { color: theme.colors.text }]}>{badge}</Text>
                </View>
            ) : null}
        </View>
    );


    const renderEmptyStateCard = (icon: React.ComponentProps<typeof Ionicons>["name"], title: string, subtitle?: string) => (
        <View style={[styles.emptyStateCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
            <Ionicons name={icon} size={20} color={theme.colors.textSecondary} />
            <View style={styles.emptyStateTextWrap}>
                <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>{title}</Text>
                {subtitle ? <Text style={[styles.emptyStateSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text> : null}
            </View>
        </View>
    );

    const renderLoopEditorForm = () => (
                            <View style={styles.formSection}>
                                <View style={[styles.modalInfoBanner, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                    <Text style={[styles.modalInfoTitle, { color: theme.colors.text }]}>{`${t("machine.agentLoopEnabled")}: ${enabledCount} / ${loops.length}`}</Text>
                                    <Text style={[styles.modalInfoText, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopsViewAllHint")}</Text>
                                </View>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopName")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopNamePlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={name}
                                    onChangeText={setName}
                                />
                                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopName")}</Text>
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
                                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopPath")}</Text>
                                <Pressable
                                    style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: suggesting ? 0.6 : 1 }]}
                                    onPress={() => void loadSuggestions()}
                                    disabled={suggesting}
                                >
                                    {suggesting ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : (
                                        <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopSuggest")}</Text>
                                    )}
                                </Pressable>
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
                                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopInterval")}</Text>
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
                                <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopPrompt")}</Text>

                                <Pressable
                                    style={[styles.advancedToggleButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
                                    onPress={() => setShowAdvanced((current) => !current)}
                                >
                                    <Ionicons name={showAdvanced ? "chevron-up-outline" : "chevron-down-outline"} size={16} color={theme.colors.textSecondary} />
                                    <Text style={[styles.advancedToggle, { color: theme.colors.textSecondary }]}>
                                        {showAdvanced ? t("machine.agentLoopAdvancedHide") : t("machine.agentLoopAdvancedShow")}
                                    </Text>
                                </Pressable>

                                {showAdvanced ? (
                                    <View style={[styles.advancedSection, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
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
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopAgent")}</Text>
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
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopProjectId")}</Text>
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
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopProfileId")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopFileWatch")}</Text>
                                        <Pressable
                                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            onPress={() => setFileWatchEnabled((current) => !current)}
                                        >
                                            <Text style={{ color: theme.colors.text }}>
                                                {fileWatchEnabled ? t("machine.agentLoopFileWatchEnabled") : t("machine.agentLoopFileWatchDisabled")}
                                            </Text>
                                        </Pressable>
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopFileWatch")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopGithubBridge")}</Text>
                                        <Pressable
                                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            onPress={() => setGithubBridgeEnabled((current) => !current)}
                                        >
                                            <Text style={{ color: theme.colors.text }}>
                                                {githubBridgeEnabled ? t("machine.agentLoopGithubBridgeEnabled") : t("machine.agentLoopGithubBridgeDisabled")}
                                            </Text>
                                        </Pressable>
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopGithubBridge")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCiBridge")}</Text>
                                        <Pressable
                                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            onPress={() => setCiBridgeEnabled((current) => !current)}
                                        >
                                            <Text style={{ color: theme.colors.text }}>
                                                {ciBridgeEnabled ? t("machine.agentLoopCiBridgeEnabled") : t("machine.agentLoopCiBridgeDisabled")}
                                            </Text>
                                        </Pressable>
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopCiBridge")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxFailures")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopMaxFailuresPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={maxFailures}
                                            onChangeText={setMaxFailures}
                                            keyboardType="number-pad"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopMaxFailures")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopRetryBackoff")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopRetryBackoffPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={retryBackoff}
                                            onChangeText={setRetryBackoff}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopRetryBackoff")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCooldown")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopCooldownPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={cooldown}
                                            onChangeText={setCooldown}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopCooldown")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopQuietHours")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopQuietHoursStart")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={quietStart}
                                            onChangeText={setQuietStart}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                        />
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopQuietHoursEnd")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={quietEnd}
                                            onChangeText={setQuietEnd}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopQuietHours")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxAutoRuns")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopMaxAutoRunsPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={maxAutoRuns}
                                            onChangeText={setMaxAutoRuns}
                                            keyboardType="number-pad"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopMaxAutoRuns")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxIterations")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopMaxIterationsPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={maxIterations}
                                            onChangeText={setMaxIterations}
                                            keyboardType="number-pad"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopMaxIterations")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopStopOnSuccess")}</Text>
                                        <Pressable
                                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            onPress={() => setStopOnSuccess((current) => !current)}
                                        >
                                            <Text style={{ color: theme.colors.text }}>
                                                {stopOnSuccess ? t("machine.agentLoopStopOnSuccessEnabled") : t("machine.agentLoopStopOnSuccessDisabled")}
                                            </Text>
                                        </Pressable>
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopStopOnSuccess")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopEventSources")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopEventSourcesPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={eventSourceText}
                                            onChangeText={setEventSourceText}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopEventSources")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopEventKeywords")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopEventKeywordsPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={eventKeywordText}
                                            onChangeText={setEventKeywordText}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopEventKeywords")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopGoal")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopGoalPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={goal}
                                            onChangeText={setGoal}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopGoal")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCurrentFocus")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopCurrentFocusPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={currentFocus}
                                            onChangeText={setCurrentFocus}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopCurrentFocus")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopWorkingMemory")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopWorkingMemoryPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={workingMemory}
                                            onChangeText={setWorkingMemory}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopWorkingMemory")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopReflectionSummary")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopReflectionSummaryPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={reflectionSummary}
                                            onChangeText={setReflectionSummary}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopReflectionSummary")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopDownstreamLoops")}</Text>
                                        <TextInput
                                            style={[styles.input, styles.memoryInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopDownstreamLoopsPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={downstreamLoopText}
                                            onChangeText={setDownstreamLoopText}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopDownstreamLoops")}</Text>
                                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopDownstreamTriggers")}</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                            placeholder={t("machine.agentLoopDownstreamTriggersPlaceholder")}
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={downstreamTriggerText}
                                            onChangeText={setDownstreamTriggerText}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            multiline
                                            textAlignVertical="top"
                                        />
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopDownstreamTriggers")}</Text>
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
                                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopEnvironment")}</Text>
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
    );



    return (
        <>
            <Stack.Screen options={{ title: t("machine.agentLoops") }} />
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
            >
                {/* 1. OneClickSetupCard — standalone at very top */}
                <OneClickSetupCard setup={oneClickSetup} onRefresh={() => void load("refresh")} />

                {/* 2. Flow guide — visual explanation of how loops work */}
                <View style={[styles.flowGuide, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.flowGuideTitle, { color: theme.colors.text }]}>{t("machine.loopsFlowTitle")}</Text>
                    <View style={styles.flowStepsRow}>
                        {[
                            { icon: "search-outline" as const, label: t("machine.loopsFlowStep1") },
                            { icon: "sparkles-outline" as const, label: t("machine.loopsFlowStep2") },
                            { icon: "add-circle-outline" as const, label: t("machine.loopsFlowStep3") },
                            { icon: "repeat-outline" as const, label: t("machine.loopsFlowStep4") },
                        ].map((step, index, arr) => (
                            <React.Fragment key={step.label}>
                                <View style={styles.flowStep}>
                                    <Ionicons name={step.icon} size={18} color={theme.colors.primary} />
                                    <Text style={[styles.flowStepLabel, { color: theme.colors.textSecondary }]}>{step.label}</Text>
                                </View>
                                {index < arr.length - 1 ? (
                                    <Ionicons name="arrow-forward" size={14} color={theme.colors.textSecondary} />
                                ) : null}
                            </React.Fragment>
                        ))}
                    </View>
                    <Text style={[styles.flowGuideSubtitle, { color: theme.colors.textSecondary }]}>{t("machine.loopsFlowSubtitle")}</Text>
                </View>

                {/* 3. Active Loops — main content */}
                <ItemGroup title={t("machine.agentLoops")}>
                    {renderSectionBanner(t("machine.agentLoops"), `${debugInfo} | rpc=${String(rpcReady)}`, String(filteredLoops.length), "repeat-outline")}
                    <View style={styles.formSection}>
                        <View style={styles.searchRow}>
                            <View style={[styles.searchBar, styles.searchBarFlex, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
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
                                    <Ionicons name="refresh-outline" size={18} color={theme.colors.primary} />
                                )}
                            </Pressable>
                        </View>
                    </View>
                    {loading ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        </View>
                    ) : filteredLoops.length === 0 ? (
                        renderEmptyStateCard("repeat-outline", loops.length === 0 ? t("machine.agentLoopsEmpty") : t("machine.agentLoopNoMatches"), t("machine.agentLoopsViewAllHint"))
                    ) : filteredLoops.map((loop) => (
                        <Item
                            key={loop.id}
                            title={loop.name || loop.id}
                            subtitle={getLoopSubtitle(loop)}
                            detail={getLoopStatusLabel(loop)}
                            detailStyle={{ color: getLoopStatusColor(loop, theme) }}
                            icon={<Ionicons name="repeat-outline" size={22} color={getLoopStatusColor(loop, theme)} />}
                            onPress={() => openLoopActions(loop)}
                            showChevron
                            rightElement={mutatingLoopId === loop.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                        />
                    ))}
                </ItemGroup>

                {/* 4. Create & Suggest — merged section with hero + 2 cards + suggestions */}
                <ItemGroup title={t("machine.agentLoopCreate")}>
                    <View style={[styles.heroPanel, formLayout.compactSpacing ? styles.heroPanelCompact : null, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                        <View style={[styles.heroPanelHeader, formLayout.modalHeaderStacked ? styles.heroPanelHeaderStacked : null]}>
                            <View style={styles.heroPanelTextWrap}>
                                <Text style={[styles.heroPanelTitle, { color: theme.colors.text }]}>{t("machine.agentLoopsViewAll")}</Text>
                                <Text style={[styles.heroPanelSubtitle, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopsViewAllHint")}</Text>
                            </View>
                            <View style={[styles.sectionBadge, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                <Text style={[styles.sectionBadgeText, { color: theme.colors.text }]}>{`${enabledCount}/${loops.length}`}</Text>
                            </View>
                        </View>
                    </View>
                    <View style={[
                        styles.quickActionsGrid,
                        quickActionColumns === 1 ? styles.quickActionsGridSingleColumn : styles.quickActionsGridTwoColumn,
                    ]}>
                        {[
                            {
                                key: "create",
                                title: editingLoopId ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate"),
                                subtitle: editingLoopId ? (name.trim() || directory.trim() || t("machine.agentLoopPathPlaceholder")) : t("machine.agentLoopsViewAllHint"),
                                detail: `${enabledCount}/${loops.length}`,
                                loading: saving,
                                icon: "add-circle-outline" as const,
                                color: theme.colors.textLink,
                                onPress: openCreateLoopEditor,
                            },
                            {
                                key: "suggest",
                                title: t("machine.agentLoopSuggest"),
                                subtitle: directory.trim() || t("machine.agentLoopPathPlaceholder"),
                                detail: suggesting ? t("common.loading") : String(suggestionCreatableCount),
                                loading: suggesting,
                                icon: "sparkles-outline" as const,
                                color: theme.colors.header.tint,
                                onPress: handleSuggestAction,
                            },
                        ].map((action) => (
                            <Pressable
                                key={action.key}
                                style={[
                                    styles.quickActionCard,
                                    quickActionColumns === 1 ? styles.quickActionCardSingleColumn : styles.quickActionCardTwoColumn,
                                    { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh },
                                ]}
                                onPress={action.onPress}
                            >
                                <View style={styles.quickActionCardHeader}>
                                    <View style={styles.quickActionTitleWrap}>
                                        <Ionicons name={action.icon} size={18} color={action.color} />
                                        <Text style={[styles.quickActionCardTitle, { color: theme.colors.text }]}>{action.title}</Text>
                                    </View>
                                    {action.loading ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : (
                                        <Text style={[styles.quickActionCardMeta, { color: theme.colors.textSecondary }]}>{action.detail}</Text>
                                    )}
                                </View>
                                <Text style={[styles.quickActionCardSubtitle, formLayout.compactSpacing ? styles.quickActionCardSubtitleCompact : null, { color: theme.colors.textSecondary }]}>{action.subtitle}</Text>
                            </Pressable>
                        ))}
                    </View>
                    {suggestions.length > 0 ? (
                        <>
                            {renderSectionBanner(t("machine.agentLoopSuggestions"), t("machine.agentLoopSuggestions"), String(suggestions.length), "sparkles-outline")}
                            <Item
                                title={t("machine.agentLoopSuggestionAdoptAll")}
                                subtitle={t("machine.agentLoopSuggestions")}
                                detail={String(suggestionCreatableCount)}
                                icon={<Ionicons name="sparkles-outline" size={22} color={theme.colors.header.tint} />}
                                onPress={() => void adoptAllSuggestions()}
                                rightElement={adoptingAllSuggestions ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                            />
                            {suggestions.map((suggestion) => (
                                <View key={suggestion.key} style={[styles.suggestionCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                    <View style={styles.cardHeaderRow}>
                                        <View style={styles.cardHeaderTextWrap}>
                                            <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{suggestion.name}</Text>
                                            <Text style={[styles.cardPathText, { color: theme.colors.textSecondary }]}>{suggestion.directory}</Text>
                                        </View>
                                        <Ionicons name="sparkles-outline" size={18} color={theme.colors.header.tint} />
                                    </View>
                                    <View style={styles.metaPillRow}>
                                        <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                            <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{formatIntervalMs(suggestion.intervalMs)}</Text>
                                        </View>
                                        <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                            <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{suggestion.agent}</Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]}>{suggestion.prompt}</Text>
                                    <View style={styles.suggestionActions}>
                                        <Pressable
                                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: suggestion.alreadyConfigured ? 0.6 : 1 }]}
                                            onPress={() => void adoptSuggestion(suggestion)}
                                            disabled={suggestion.alreadyConfigured || creatingSuggestionKey === suggestion.key}
                                        >
                                            {creatingSuggestionKey === suggestion.key ? (
                                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                            ) : (
                                                <Text style={{ color: theme.colors.text }}>
                                                    {suggestion.alreadyConfigured ? t("machine.agentLoopSuggestionConfigured") : t("machine.agentLoopSuggestionAdopt")}
                                                </Text>
                                            )}
                                        </Pressable>
                                    </View>
                                </View>
                            ))}
                        </>
                    ) : null}
                </ItemGroup>

                {/* 5. Automation — collapsible, default collapsed */}
                <ItemGroup title={t("machine.loopsAutomation")}>
                    <Pressable
                        style={[styles.automationToggle, { borderBottomColor: showAutomation ? theme.colors.divider : "transparent", borderBottomWidth: showAutomation ? 1 : 0 }]}
                        onPress={() => setShowAutomation((current) => !current)}
                    >
                        <Text style={[styles.automationToggleText, { color: theme.colors.text }]}>{t("machine.loopsAutomation")}</Text>
                        <Ionicons name={showAutomation ? "chevron-up-outline" : "chevron-down-outline"} size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                    {showAutomation ? (
                        <>
                            {/* Bootstrap Profiles sub-section */}
                            {renderSectionBanner(t("machine.agentLoopBootstrapProfiles"), t("machine.agentLoopBootstrapHint"), String(bootstrapProfiles.length), "git-branch-outline")}
                            <Item
                                title={t("machine.agentLoopCreate")}
                                subtitle={t("machine.agentLoopBootstrapHint")}
                                icon={<Ionicons name="add-circle-outline" size={22} color={theme.colors.primary} />}
                                onPress={() => { setEditingBootstrapProfile(null); setBootstrapProfileEditorVisible(true); }}
                            />
                            {bootstrapProfiles.length === 0 ? (
                                renderEmptyStateCard("git-branch-outline", t("machine.agentLoopBootstrapProfilesEmpty"), t("machine.agentLoopBootstrapHint"))
                            ) : bootstrapProfiles.map((profile) => (
                                <Item
                                    key={profile.id}
                                    title={profile.name || profile.id}
                                    subtitle={getBootstrapProfileSubtitle(profile)}
                                    detail={profile.status}
                                    detailStyle={{ color: getBootstrapProfileStatusColor(profile, theme) }}
                                    icon={<Ionicons name="git-branch-outline" size={22} color={getBootstrapProfileStatusColor(profile, theme)} />}
                                    onPress={() => openBootstrapProfileActions(profile)}
                                    showChevron
                                    rightElement={mutatingBootstrapProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                            ))}

                            {/* Auto-Dream Profiles sub-section */}
                            {renderSectionBanner(t("machine.autoDreamProfiles"), t("machine.autoDreamHint"), String(autoDreamProfiles.length), "moon-outline")}
                            <Item
                                title={t("machine.agentLoopCreate")}
                                subtitle={t("machine.autoDreamHint")}
                                icon={<Ionicons name="add-circle-outline" size={22} color={theme.colors.textLink} />}
                                onPress={() => { setEditingAutoDreamProfile(null); setAutoDreamProfileEditorVisible(true); }}
                            />
                            {autoDreamProfiles.length === 0 ? (
                                renderEmptyStateCard("moon-outline", t("machine.autoDreamProfilesEmpty"), t("machine.autoDreamHint"))
                            ) : autoDreamProfiles.map((profile) => (
                                <Item
                                    key={profile.id}
                                    title={profile.name || profile.id}
                                    subtitle={getAutoDreamProfileSubtitle(profile)}
                                    detail={profile.status}
                                    detailStyle={{ color: getAutoDreamProfileStatusColor(profile, theme) }}
                                    icon={<Ionicons name="moon-outline" size={22} color={getAutoDreamProfileStatusColor(profile, theme)} />}
                                    onPress={() => openAutoDreamProfileActions(profile)}
                                    showChevron
                                    rightElement={mutatingAutoDreamProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                                />
                            ))}

                            {/* Scan Results sub-section */}
                            {renderSectionBanner(t("machine.agentLoopBootstrap"), t("machine.agentLoopBootstrapHint"), String(bootstrapEntries.length), "search-outline")}
                            <Item
                                title={t("gitHosts.scanRepos")}
                                subtitle={t("machine.agentLoopBootstrapHint")}
                                detail={bootstrapScanning ? t("common.scanning") : String(bootstrapEntries.length)}
                                onPress={() => void scanBootstrapRepos()}
                                rightElement={bootstrapScanning ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                            />
                            {bootstrapEntries.length === 0 ? (
                                renderEmptyStateCard("search-outline", t("machine.agentLoopBootstrapEmpty"), t("machine.agentLoopBootstrapHint"))
                            ) : bootstrapEntries.map((entry) => {
                                const missingCount = entry.suggestions.filter((suggestion) => !suggestion.alreadyConfigured).length;
                                return (
                                    <View key={entry.repo.repoPath} style={[styles.suggestionCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                                        <View style={styles.cardHeaderRow}>
                                            <View style={styles.cardHeaderTextWrap}>
                                                <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{entry.repo.name}</Text>
                                                <Text style={[styles.cardPathText, { color: theme.colors.textSecondary }]}>{entry.repo.repoPath}</Text>
                                            </View>
                                            <Ionicons name="search-outline" size={18} color={theme.colors.accentOrange} />
                                        </View>
                                        <View style={styles.metaPillRow}>
                                            <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                                <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{entry.suggestions.length} suggestions</Text>
                                            </View>
                                            <View style={[styles.metaPill, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                                                <Text style={[styles.metaPillText, { color: theme.colors.textSecondary }]}>{missingCount} creatable</Text>
                                            </View>
                                        </View>
                                        <View style={styles.suggestionActions}>
                                            <Pressable
                                                style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: missingCount === 0 ? 0.6 : 1 }]}
                                                onPress={() => void adoptRepoSuggestions(entry, false)}
                                                disabled={missingCount === 0 || bootstrappingRepoPath === entry.repo.repoPath}
                                            >
                                                {bootstrappingRepoPath === entry.repo.repoPath ? (
                                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                                ) : (
                                                    <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopBootstrapCreateAll")}</Text>
                                                )}
                                            </Pressable>
                                            <Pressable
                                                style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: missingCount === 0 ? 0.6 : 1 }]}
                                                onPress={() => void adoptRepoSuggestions(entry, true)}
                                                disabled={missingCount === 0 || bootstrappingRepoPath === entry.repo.repoPath}
                                            >
                                                <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopBootstrapCreateAndRun")}</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                );
                            })}
                        </>
                    ) : null}
                </ItemGroup>
            </ScrollView>

            <BaseModal visible={loopEditorVisible} onClose={closeLoopEditor}>
                <View style={[
                    styles.modalCard,
                    {
                        backgroundColor: theme.colors.surface,
                        width: modalMetrics.width,
                        maxHeight: modalMetrics.maxHeight,
                        minWidth: modalMetrics.minWidth,
                        borderRadius: modalMetrics.borderRadius,
                    },
                ]}>
                    <View style={[
                        styles.modalHeader,
                        formLayout.modalHeaderStacked ? styles.modalHeaderStacked : null,
                        { borderBottomColor: theme.colors.divider, paddingHorizontal: modalMetrics.horizontalPadding },
                    ]}>
                        <View style={styles.modalHeaderTextWrap}>
                            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{editingLoopId ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>
                            <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>{editingLoopId ? (name.trim() || directory.trim() || t("machine.agentLoopsViewAllHint")) : t("machine.agentLoopsViewAllHint")}</Text>
                        </View>
                        <Pressable style={[styles.modalDismissButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]} onPress={closeLoopEditor}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingHorizontal: modalMetrics.horizontalPadding }]}>
                        {renderLoopEditorForm()}
                    </ScrollView>
                </View>
            </BaseModal>

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

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
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
    formSectionCompact: {
        padding: 12,
        gap: 6,
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
    memoryInput: {
        minHeight: 76,
    },
    advancedToggle: {
        fontSize: 13,
        fontWeight: "600",
    },
    advancedToggleButton: {
        marginTop: 6,
        minHeight: 40,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    advancedSection: {
        gap: 8,
        paddingTop: 4,
        marginTop: 4,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingBottom: 12,
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
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 10,
    },
    inlineSecondaryButton: {
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
        marginTop: 4,
    },
    row: {
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 8,
    },
    rowInput: {
        flex: 1,
    },
    actionsRow: {
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 10,
    },
    primaryButton: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
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
    searchRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    searchBar: {
        minHeight: 46,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    searchBarFlex: {
        flex: 1,
    },
    refreshIconButton: {
        width: 46,
        height: 46,
        borderWidth: 1,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
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
    suggestionCard: {
        padding: 16,
        gap: 8,
        marginHorizontal: 12,
        marginVertical: 8,
        borderWidth: 1,
        borderRadius: 14,
    },
    suggestionTitle: {
        fontSize: 15,
        fontWeight: "600",
    },
    cardHeaderRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    cardHeaderTextWrap: {
        flex: 1,
        gap: 4,
    },
    cardPathText: {
        fontSize: 13,
        lineHeight: 18,
    },
    metaPillRow: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
    metaPill: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    metaPillText: {
        fontSize: 12,
        fontWeight: "600",
    },
    cardDescription: {
        fontSize: 13,
        lineHeight: 18,
    },
    suggestionActions: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
        paddingTop: 2,
    },
    heroPanel: {
        margin: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
    },
    heroPanelCompact: {
        margin: 12,
        marginBottom: 6,
        padding: 12,
    },
    heroPanelHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    heroPanelHeaderStacked: {
        alignItems: "flex-start",
        flexDirection: "column",
    },
    heroPanelTextWrap: {
        flex: 1,
        gap: 4,
    },
    heroPanelTitle: {
        fontSize: 18,
        fontWeight: "700",
    },
    heroPanelSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    quickActionsGrid: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 12,
    },
    quickActionsGridSingleColumn: {
        flexDirection: "column",
    },
    quickActionsGridTwoColumn: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    quickActionCard: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 14,
        gap: 8,
        minHeight: 108,
    },
    quickActionCardSingleColumn: {
        width: "100%",
    },
    quickActionCardTwoColumn: {
        width: "48.5%",
    },
    quickActionCardHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    quickActionTitleWrap: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    quickActionCardTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: "700",
    },
    quickActionCardSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    quickActionCardSubtitleCompact: {
        lineHeight: 17,
    },
    quickActionCardMeta: {
        fontSize: 13,
        fontWeight: "600",
    },
    sectionBanner: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionBannerStacked: {
        alignItems: "flex-start",
        flexDirection: "column",
    },
    sectionBannerLeading: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    sectionBannerTextWrap: {
        flex: 1,
        gap: 4,
    },
    sectionBannerTitle: {
        fontSize: 15,
        fontWeight: "700",
    },
    sectionBannerSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    sectionBadge: {
        minWidth: 44,
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionBadgeText: {
        fontSize: 13,
        fontWeight: "700",
    },
    modalCard: {
        overflow: "hidden",
        borderWidth: 1,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 10,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 16,
        borderBottomWidth: 1,
        gap: 16,
    },
    modalHeaderStacked: {
        alignItems: "flex-start",
        flexDirection: "column",
    },
    modalHeaderTextWrap: {
        flex: 1,
        gap: 4,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: "700",
    },
    modalSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    modalDismissButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: Platform.OS === "web" ? "auto" : "flex-end",
    },
    modalScroll: {
        width: "100%",
        flexGrow: 0,
    },
    modalScrollContent: {
        paddingBottom: 24,
    },
    modalInfoBanner: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 4,
        marginBottom: 4,
    },
    modalInfoTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    modalInfoText: {
        fontSize: 13,
        lineHeight: 18,
    },
    flowGuide: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 8,
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    flowGuideTitle: {
        fontSize: 15,
        fontWeight: "700",
    },
    flowGuideSubtitle: {
        fontSize: 12,
        lineHeight: 16,
    },
    flowStepsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flexWrap: "wrap",
        paddingVertical: 4,
    },
    flowStep: {
        alignItems: "center",
        gap: 4,
        minWidth: 56,
    },
    flowStepLabel: {
        fontSize: 11,
        fontWeight: "600",
        textAlign: "center",
    },
    automationToggle: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    automationToggleText: {
        fontSize: 15,
        fontWeight: "600",
    },
}));
