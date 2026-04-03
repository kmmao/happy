import * as React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";
import { Modal } from "@/modal";
import { machineCreateAgentLoop, machineUpdateAgentLoop, type MachineAgentLoop } from "@/sync/ops";
import { t } from "@/text";
import {
    formatDownstreamTriggers,
    formatEnvironmentVariables,
    formatIntervalMs,
    formatLineList,
    isValidTimeOfDay,
    parseDownstreamTriggers,
    parseEnvironmentVariables,
    parseIntervalMs,
    parseLineList,
    parsePositiveInteger,
} from "./loopsUtils";
import { getLoopFormLayoutMode, getLoopModalMetrics } from "./loopsLayout";

export interface LoopEditorModalProps {
    visible: boolean;
    onClose: () => void;
    onSaved: () => void;
    machineId: string | undefined;
    editingLoop: MachineAgentLoop | null;
    loopCount: number;
    enabledCount: number;
    suggesting: boolean;
    onSuggest: (directory: string, agent: string, projectId: string, profileId: string) => void;
}

function hasAdvancedFields(loop: MachineAgentLoop): boolean {
    return Boolean(
        loop.projectId
        || loop.profileId
        || loop.environmentVariables
        || loop.agent !== "claude"
        || loop.fileWatchEnabled
        || loop.githubBridgeEnabled
        || loop.ciBridgeEnabled
        || loop.eventSourceAllowlist?.length
        || loop.eventKeywordFilters?.length
        || loop.goal
        || loop.currentFocus
        || loop.workingMemory
        || loop.lastReflectionSummary
        || loop.maxConsecutiveFailures
        || loop.retryBackoffMs
        || loop.cooldownMs
        || loop.quietHoursStart
        || loop.quietHoursEnd
        || loop.maxAutoRunsPerDay
        || loop.maxIterations
        || loop.stopOnSuccess
        || loop.downstreamLoopIds?.length
        || loop.downstreamTriggerOn?.length,
    );
}

export const LoopEditorModal = React.memo(function LoopEditorModal({
    visible,
    onClose,
    onSaved,
    machineId,
    editingLoop,
    loopCount,
    enabledCount,
    suggesting,
    onSuggest,
}: LoopEditorModalProps) {
    const { theme } = useUnistyles();
    const { width: viewportWidth, height: viewportHeight } = React.useMemo(() => ({
        width: typeof window !== "undefined" ? window.innerWidth : 400,
        height: typeof window !== "undefined" ? window.innerHeight : 800,
    }), []);
    const modalMetrics = getLoopModalMetrics({
        viewportWidth,
        viewportHeight,
        isWeb: Platform.OS === "web",
    });
    const formLayout = getLoopFormLayoutMode({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });

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
    const [cronExpression, setCronExpression] = React.useState("");
    const [downstreamLoopText, setDownstreamLoopText] = React.useState("");
    const [downstreamTriggerText, setDownstreamTriggerText] = React.useState("");
    const [environmentText, setEnvironmentText] = React.useState("");
    const [showAdvanced, setShowAdvanced] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (visible && editingLoop) {
            setName(editingLoop.name ?? "");
            setDirectory(editingLoop.directory);
            setInterval(formatIntervalMs(editingLoop.intervalMs));
            setCronExpression(editingLoop.cronExpression ?? "");
            setPrompt(editingLoop.prompt);
            setAgent(editingLoop.agent);
            setProfileId(editingLoop.profileId ?? "");
            setProjectId(editingLoop.projectId ?? "");
            setFileWatchEnabled(Boolean(editingLoop.fileWatchEnabled));
            setGithubBridgeEnabled(Boolean(editingLoop.githubBridgeEnabled));
            setCiBridgeEnabled(Boolean(editingLoop.ciBridgeEnabled));
            setEventSourceText(formatLineList(editingLoop.eventSourceAllowlist));
            setEventKeywordText(formatLineList(editingLoop.eventKeywordFilters));
            setGoal(editingLoop.goal ?? "");
            setCurrentFocus(editingLoop.currentFocus ?? "");
            setWorkingMemory(editingLoop.workingMemory ?? "");
            setReflectionSummary(editingLoop.lastReflectionSummary ?? "");
            setMaxFailures(editingLoop.maxConsecutiveFailures ? String(editingLoop.maxConsecutiveFailures) : "");
            setRetryBackoff(editingLoop.retryBackoffMs ? formatIntervalMs(editingLoop.retryBackoffMs) : "");
            setCooldown(editingLoop.cooldownMs ? formatIntervalMs(editingLoop.cooldownMs) : "");
            setQuietStart(editingLoop.quietHoursStart ?? "");
            setQuietEnd(editingLoop.quietHoursEnd ?? "");
            setMaxAutoRuns(editingLoop.maxAutoRunsPerDay ? String(editingLoop.maxAutoRunsPerDay) : "");
            setMaxIterations(editingLoop.maxIterations ? String(editingLoop.maxIterations) : "");
            setStopOnSuccess(Boolean(editingLoop.stopOnSuccess));
            setDownstreamLoopText(formatLineList(editingLoop.downstreamLoopIds));
            setDownstreamTriggerText(formatDownstreamTriggers(editingLoop.downstreamTriggerOn));
            setEnvironmentText(formatEnvironmentVariables(editingLoop.environmentVariables));
            setShowAdvanced(hasAdvancedFields(editingLoop));
        } else if (visible && !editingLoop) {
            setName("");
            setDirectory("");
            setInterval("10m");
            setCronExpression("");
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
        }
    }, [visible, editingLoop]);

    const handleClose = React.useCallback(() => {
        setSaving(false);
        onClose();
    }, [onClose]);

    const handleSave = React.useCallback(async () => {
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
            const result = editingLoop
                ? await machineUpdateAgentLoop(machineId, editingLoop.id, {
                    name,
                    directory: directory.trim(),
                    prompt: prompt.trim(),
                    intervalMs: parsedInterval,
                    cronExpression: cronExpression.trim() || null,
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
                    cronExpression: cronExpression.trim() || undefined,
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
                throw new Error(result.errorMessage || (editingLoop ? t("machine.agentLoopUpdateFailed") : t("machine.agentLoopCreateFailed")));
            }
            onSaved();
            handleClose();
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    }, [
        agent, ciBridgeEnabled, cooldown, currentFocus, directory, downstreamLoopText,
        downstreamTriggerText, editingLoop, environmentText, eventKeywordText, eventSourceText,
        fileWatchEnabled, githubBridgeEnabled, goal, handleClose, interval, machineId, maxAutoRuns,
        maxFailures, maxIterations, name, onSaved, profileId, projectId, prompt, quietEnd, quietStart,
        reflectionSummary, retryBackoff, stopOnSuccess, workingMemory,
    ]);

    return (
        <BaseModal visible={visible} onClose={handleClose}>
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
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{editingLoop ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>
                        <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>{editingLoop ? (name.trim() || directory.trim() || t("machine.agentLoopsViewAllHint")) : t("machine.agentLoopsViewAllHint")}</Text>
                    </View>
                    <Pressable style={[styles.modalDismissButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]} onPress={handleClose}>
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingHorizontal: modalMetrics.horizontalPadding }]}>
                    <View style={styles.formSection}>
                        <View style={[styles.modalInfoBanner, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                            <Text style={[styles.modalInfoTitle, { color: theme.colors.text }]}>{`${t("machine.agentLoopEnabled")}: ${enabledCount} / ${loopCount}`}</Text>
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
                        <Pressable
                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: suggesting ? 0.6 : 1 }]}
                            onPress={() => onSuggest(directory, agent, projectId, profileId)}
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
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCronExpression")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder="*/30 * * * *"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={cronExpression}
                            onChangeText={setCronExpression}
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
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopFileWatch")}</Text>
                                <Pressable
                                    style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={() => setFileWatchEnabled((current) => !current)}
                                >
                                    <Text style={{ color: theme.colors.text }}>
                                        {fileWatchEnabled ? t("machine.agentLoopFileWatchEnabled") : t("machine.agentLoopFileWatchDisabled")}
                                    </Text>
                                </Pressable>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopGithubBridge")}</Text>
                                <Pressable
                                    style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={() => setGithubBridgeEnabled((current) => !current)}
                                >
                                    <Text style={{ color: theme.colors.text }}>
                                        {githubBridgeEnabled ? t("machine.agentLoopGithubBridgeEnabled") : t("machine.agentLoopGithubBridgeDisabled")}
                                    </Text>
                                </Pressable>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopCiBridge")}</Text>
                                <Pressable
                                    style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={() => setCiBridgeEnabled((current) => !current)}
                                >
                                    <Text style={{ color: theme.colors.text }}>
                                        {ciBridgeEnabled ? t("machine.agentLoopCiBridgeEnabled") : t("machine.agentLoopCiBridgeDisabled")}
                                    </Text>
                                </Pressable>
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxFailures")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopMaxFailuresPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={maxFailures}
                                    onChangeText={setMaxFailures}
                                    keyboardType="number-pad"
                                />
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
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxAutoRuns")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopMaxAutoRunsPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={maxAutoRuns}
                                    onChangeText={setMaxAutoRuns}
                                    keyboardType="number-pad"
                                />
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopMaxIterations")}</Text>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopMaxIterationsPlaceholder")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={maxIterations}
                                    onChangeText={setMaxIterations}
                                    keyboardType="number-pad"
                                />
                                <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopStopOnSuccess")}</Text>
                                <Pressable
                                    style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={() => setStopOnSuccess((current) => !current)}
                                >
                                    <Text style={{ color: theme.colors.text }}>
                                        {stopOnSuccess ? t("machine.agentLoopStopOnSuccessEnabled") : t("machine.agentLoopStopOnSuccessDisabled")}
                                    </Text>
                                </Pressable>
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
                                onPress={() => void handleSave()}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                                ) : (
                                    <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>
                                        {editingLoop ? t("common.save") : t("machine.agentLoopCreate")}
                                    </Text>
                                )}
                            </Pressable>
                            {editingLoop ? (
                                <Pressable
                                    style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    onPress={handleClose}
                                    disabled={saving}
                                >
                                    <Text style={{ color: theme.colors.text }}>{t("common.cancel")}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    </View>
                </ScrollView>
            </View>
        </BaseModal>
    );
});

const styles = StyleSheet.create((theme) => ({
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
    formSection: {
        padding: 16,
        gap: 8,
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
    createButton: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    createButtonText: {
        fontSize: 15,
        fontWeight: "600",
    },
    secondaryButton: {
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
}));
