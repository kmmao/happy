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
    machineCreateAgentLoopBootstrapProfile,
    machineUpdateAgentLoopBootstrapProfile,
    machinePauseAgentLoopBootstrapProfile,
    machineResumeAgentLoopBootstrapProfile,
    machineRunNowAgentLoopBootstrapProfile,
    machineRemoveAgentLoopBootstrapProfile,
    machineListAutoDreamProfiles,
    machineCreateAutoDreamProfile,
    machineUpdateAutoDreamProfile,
    machinePauseAutoDreamProfile,
    machineResumeAutoDreamProfile,
    machineRunNowAutoDreamProfile,
    machineRemoveAutoDreamProfile,
    type GitRepoEntry,
    type MachineAgentLoop,
    type MachineAgentLoopBootstrapProfile,
    type MachineAgentLoopEvent,
    type MachineAgentLoopSuggestion,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { utf8ToBase64 } from "@/utils/stringUtils";

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

function getLoopBriefPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/brief-latest.md`;
}

function getLoopMemoryPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/memory.md`;
}

function getLoopContextPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/context.md`;
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

function parseLineList(raw: string): string[] | undefined {
    const values = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
}

function formatLineList(value?: string[]): string {
    return value?.join("\n") ?? "";
}


function parsePositiveInteger(raw: string): number | null | undefined {
    const normalized = raw.trim();
    if (!normalized) {
        return undefined;
    }
    if (!/^\d+$/.test(normalized)) {
        return null;
    }
    const value = Number(normalized);
    return value > 0 ? value : null;
}

function isValidTimeOfDay(raw: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw.trim());
}

function parseDownstreamTriggers(raw: string): Array<"completed" | "failed"> | null | undefined {
    const values = parseLineList(raw);
    if (!values) {
        return undefined;
    }
    const normalized = [...new Set(values.map((value) => value.toLowerCase()))];
    if (normalized.every((value) => value === "completed" || value === "failed")) {
        return normalized as Array<"completed" | "failed">;
    }
    return null;
}

function formatDownstreamTriggers(value?: Array<"completed" | "failed">): string {
    return value?.join("\n") ?? "";
}

function getDownstreamTriggerLabel(value: "completed" | "failed"): string {
    return value === "completed" ? t("machine.agentLoopDownstreamTriggerCompleted") : t("machine.agentLoopDownstreamTriggerFailed");
}

function getLoopRuntimeLabel(loop: MachineAgentLoop): string {
    if (loop.runtimeState === "blocked") {
        return t("machine.agentLoopRuntimeBlocked");
    }
    if (loop.runtimeState === "active") {
        if (loop.phase === "planning") return t("machine.agentLoopPhasePlanning");
        if (loop.phase === "acting") return t("machine.agentLoopPhaseActing");
        if (loop.phase === "reflecting") return t("machine.agentLoopPhaseReflecting");
        return t("machine.agentLoopRuntimeActive");
    }
    if (loop.runtimeState === "paused") {
        return t("machine.agentLoopPaused");
    }
    return t("machine.agentLoopPhaseSleeping");
}

function getLoopPhaseLabel(loop: MachineAgentLoop): string {
    switch (loop.phase) {
        case "planning":
            return t("machine.agentLoopPhasePlanning");
        case "acting":
            return t("machine.agentLoopPhaseActing");
        case "reflecting":
            return t("machine.agentLoopPhaseReflecting");
        case "blocked":
            return t("machine.agentLoopRuntimeBlocked");
        case "paused":
            return t("machine.agentLoopPaused");
        case "sleeping":
        default:
            return t("machine.agentLoopPhaseSleeping");
    }
}

function isWithinQuietHoursLocal(loop: MachineAgentLoop, now = Date.now()): boolean {
    if (!loop.quietHoursStart || !loop.quietHoursEnd || loop.quietHoursStart === loop.quietHoursEnd) {
        return false;
    }
    const [startHour, startMinute] = loop.quietHoursStart.split(":").map(Number);
    const [endHour, endMinute] = loop.quietHoursEnd.split(":").map(Number);
    const current = new Date(now);
    const currentMinutes = current.getHours() * 60 + current.getMinutes();
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function getLoopPolicyReasonLabel(reason?: string): string {
    switch (reason) {
        case "quiet-hours":
            return t("machine.agentLoopPolicyStateQuietHours");
        case "cooldown":
            return t("machine.agentLoopPolicyStateCooldown");
        case "max-auto-runs":
            return t("machine.agentLoopPolicyStateMaxAutoRuns");
        case "max-iterations":
            return t("machine.agentLoopPolicyStateMaxIterations");
        case "stop-on-success":
            return t("machine.agentLoopStopReasonSuccess");
        default:
            return t("machine.agentLoopPolicyStateReady");
    }
}

function getLoopPolicyStateLabel(loop: MachineAgentLoop, now = Date.now()): string {
    if (loop.stopReason) {
        return getLoopPolicyReasonLabel(loop.stopReason);
    }
    if (loop.maxIterations && loop.iteration >= loop.maxIterations) {
        return t("machine.agentLoopPolicyStateMaxIterations");
    }
    if (isWithinQuietHoursLocal(loop, now)) {
        return t("machine.agentLoopPolicyStateQuietHours");
    }
    if (loop.cooldownMs && loop.lastCompletedAt && now < loop.lastCompletedAt + loop.cooldownMs) {
        return t("machine.agentLoopPolicyStateCooldown");
    }
    if (loop.maxAutoRunsPerDay && (loop.autoRunsToday ?? 0) >= loop.maxAutoRunsPerDay) {
        return t("machine.agentLoopPolicyStateMaxAutoRuns");
    }
    return t("machine.agentLoopPolicyStateReady");
}

function getLoopTriggerLabel(loop: MachineAgentLoop): string {
    if (!loop.lastTriggerSource) {
        return "-";
    }
    switch (loop.lastTriggerSource) {
        case "manual":
            return t("machine.agentLoopTriggerManual");
        case "schedule":
            return t("machine.agentLoopTriggerSchedule");
        case "event":
            return t("machine.agentLoopTriggerEvent");
        default:
            return loop.lastTriggerSource;
    }
}

function getLoopStatusLabel(loop: MachineAgentLoop): string {
    if (loop.runtimeState === "blocked") {
        return t("machine.agentLoopRuntimeBlocked");
    }
    return loop.enabled ? t("machine.agentLoopEnabled") : t("machine.agentLoopPaused");
}

function getLoopSubtitle(loop: MachineAgentLoop): string {
    const parts = [
        `${t("machine.agentLoopIteration")}: ${loop.iteration}`,
        `${t("machine.agentLoopRuntime")}: ${getLoopRuntimeLabel(loop)}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(loop.intervalMs)}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(loop.nextRunAt)}`,
        `${t("machine.agentLoopAgent")}: ${loop.agent}`,
        `${t("machine.agentLoopFileWatch")}: ${loop.fileWatchEnabled ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopGithubBridge")}: ${loop.githubBridgeEnabled ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopCiBridge")}: ${loop.ciBridgeEnabled ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopFailurePolicy")}: ${loop.consecutiveFailures ?? 0}/${loop.maxConsecutiveFailures ?? 1}${loop.retryBackoffMs ? ` • ${formatIntervalMs(loop.retryBackoffMs)}` : ""}`,
        `${t("machine.agentLoopPolicyState")}: ${getLoopPolicyStateLabel(loop)}`,
        loop.cooldownMs ? `${t("machine.agentLoopCooldown")}: ${formatIntervalMs(loop.cooldownMs)}` : undefined,
        loop.quietHoursStart && loop.quietHoursEnd ? `${t("machine.agentLoopQuietHours")}: ${loop.quietHoursStart} → ${loop.quietHoursEnd}` : undefined,
        loop.maxAutoRunsPerDay ? `${t("machine.agentLoopMaxAutoRuns")}: ${loop.autoRunsToday ?? 0}/${loop.maxAutoRunsPerDay}` : undefined,
        loop.maxIterations ? `${t("machine.agentLoopMaxIterations")}: ${loop.iteration}/${loop.maxIterations}` : undefined,
        loop.stopOnSuccess ? `${t("machine.agentLoopStopOnSuccess")}: ${t("common.yes")}` : undefined,
        loop.stopReason ? `${t("machine.agentLoopStopReason")}: ${getLoopPolicyReasonLabel(loop.stopReason)}` : undefined,
        loop.downstreamLoopIds?.length ? `${t("machine.agentLoopDownstreamLoops")}: ${loop.downstreamLoopIds.join(", ")}` : undefined,
        loop.downstreamTriggerOn?.length ? `${t("machine.agentLoopDownstreamTriggers")}: ${loop.downstreamTriggerOn.map(getDownstreamTriggerLabel).join(", ")}` : undefined,
        loop.notifyEvents?.length ? `${t("machine.agentLoopNotifyEvents")}: ${loop.notifyEvents.join(", ")}` : undefined,
        loop.notificationChannels?.length ? `${t("machine.agentLoopNotifyChannels")}: ${loop.notificationChannels.join(", ")}` : undefined,
        loop.notificationWebhookUrl ? `${t("machine.agentLoopNotifyWebhook")}: ${loop.notificationWebhookUrl}` : undefined,
        loop.lastBriefAt ? `${t("machine.agentLoopLastBrief")}: ${formatTimestamp(loop.lastBriefAt)}${loop.lastBriefSummary ? ` • ${loop.lastBriefSummary}` : ""}` : undefined,
        loop.eventSourceAllowlist?.length ? `${t("machine.agentLoopEventSources")}: ${loop.eventSourceAllowlist.join(", ")}` : undefined,
        loop.eventKeywordFilters?.length ? `${t("machine.agentLoopEventKeywords")}: ${loop.eventKeywordFilters.join(", ")}` : undefined,
        `${t("machine.agentLoopLastTrigger")}: ${getLoopTriggerLabel(loop)} • ${formatTimestamp(loop.lastTriggerAt)}`,
        loop.lastBriefSummary ? `${t("machine.agentLoopLastBrief")}: ${loop.lastBriefSummary}` : undefined,
    ];
    if (loop.currentFocus) {
        parts.push(`${t("machine.agentLoopCurrentFocus")}: ${loop.currentFocus}`);
    }
    const pendingEvents = loop.recentEvents?.filter((event) => event.status === "pending").length ?? 0;
    if (pendingEvents > 0) {
        parts.push(`${t("machine.agentLoopPendingEvents")}: ${pendingEvents}`);
    }
    if (loop.lastError) {
        parts.push(loop.lastError);
    }
    return parts.join(" • ");
}


function getLoopEventStatusLabel(event: MachineAgentLoopEvent): string {
    switch (event.status) {
        case "pending":
            return t("machine.agentLoopEventPending");
        case "dispatched":
            return t("machine.agentLoopEventDispatched");
        case "completed":
            return t("machine.automationCompleted");
        case "failed":
            return t("machine.automationFailed");
        case "cancelled":
            return t("machine.automationCancelled");
        case "ignored":
            return t("machine.agentLoopEventIgnored");
        default:
            return event.status;
    }
}

function formatLoopEvents(loop: MachineAgentLoop): string | undefined {
    if (!loop.recentEvents || loop.recentEvents.length === 0) {
        return undefined;
    }
    return loop.recentEvents.slice(0, 5).map((event) => `• ${formatTimestamp(event.createdAt)} — ${event.title} (${getLoopEventStatusLabel(event)})${event.source ? ` [${event.source}]` : ""}`).join("\n");
}

interface RepoBootstrapEntry {
    readonly repo: GitRepoEntry;
    readonly suggestions: readonly MachineAgentLoopSuggestion[];
}

function getLoopStatusColor(loop: MachineAgentLoop, theme: any): string {
    if (loop.runtimeState === "blocked") {
        return "#FF3B30";
    }
    if (loop.runtimeState === "active") {
        return "#0A84FF";
    }
    if (loop.enabled) {
        return "#34C759";
    }
    return theme.colors.textSecondary;
}

function getLoopDetailMessage(loop: MachineAgentLoop): string {
    return [
        `${t("machine.agentLoopStatus")}: ${getLoopStatusLabel(loop)}`,
        `${t("machine.agentLoopPath")}: ${loop.directory}`,
        `${t("machine.agentLoopRuntime")}: ${getLoopRuntimeLabel(loop)}`,
        `${t("machine.agentLoopPhase")}: ${getLoopPhaseLabel(loop)}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(loop.intervalMs)}`,
        `${t("machine.agentLoopIteration")}: ${loop.iteration}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(loop.nextRunAt)}`,
        `${t("machine.agentLoopLastRun")}: ${formatTimestamp(loop.lastCompletedAt ?? loop.lastStartedAt ?? loop.lastEnqueuedAt)}`,
        `${t("machine.agentLoopLastTrigger")}: ${getLoopTriggerLabel(loop)} • ${formatTimestamp(loop.lastTriggerAt)}`,
        loop.lastBriefSummary ? `${t("machine.agentLoopLastBrief")}: ${loop.lastBriefSummary}` : undefined,
        `${t("machine.agentLoopPhaseUpdatedAt")}: ${formatTimestamp(loop.phaseUpdatedAt)}`,
        `${t("machine.agentLoopLastSession")}: ${loop.lastSessionId ?? "-"}`,
        `${t("machine.agentLoopAgent")}: ${loop.agent}`,
        `${t("machine.agentLoopFileWatch")}: ${loop.fileWatchEnabled ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopGithubBridge")}: ${loop.githubBridgeEnabled ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopCiBridge")}: ${loop.ciBridgeEnabled ? t("common.yes") : t("common.no")}`,
        loop.eventSourceAllowlist?.length ? `${t("machine.agentLoopEventSources")}: ${loop.eventSourceAllowlist.join(", ")}` : undefined,
        loop.eventKeywordFilters?.length ? `${t("machine.agentLoopEventKeywords")}: ${loop.eventKeywordFilters.join(", ")}` : undefined,
        loop.cooldownMs ? `${t("machine.agentLoopCooldown")}: ${formatIntervalMs(loop.cooldownMs)}` : undefined,
        loop.quietHoursStart && loop.quietHoursEnd ? `${t("machine.agentLoopQuietHours")}: ${loop.quietHoursStart} → ${loop.quietHoursEnd}` : undefined,
        `${t("machine.agentLoopPolicyState")}: ${getLoopPolicyStateLabel(loop)}`,
        loop.maxAutoRunsPerDay ? `${t("machine.agentLoopMaxAutoRuns")}: ${loop.maxAutoRunsPerDay}` : undefined,
        loop.maxIterations ? `${t("machine.agentLoopMaxIterations")}: ${loop.maxIterations}` : undefined,
        `${t("machine.agentLoopStopOnSuccess")}: ${loop.stopOnSuccess ? t("common.yes") : t("common.no")}`,
        loop.stopReason ? `${t("machine.agentLoopStopReason")}: ${getLoopPolicyReasonLabel(loop.stopReason)}` : undefined,
        `${t("machine.agentLoopAutoRunsToday")}: ${loop.autoRunsToday ?? 0}`,
        `${t("machine.agentLoopAutoRunWindow")}: ${formatTimestamp(loop.autoRunWindowStartedAt)}`,
        loop.lastPolicyGateReason ? `${t("machine.agentLoopLastPolicyGate")}: ${getLoopPolicyReasonLabel(loop.lastPolicyGateReason)} • ${formatTimestamp(loop.lastPolicyGateAt)}` : undefined,
        loop.downstreamLoopIds?.length ? `${t("machine.agentLoopDownstreamLoops")}: ${loop.downstreamLoopIds.join(", ")}` : undefined,
        loop.downstreamTriggerOn?.length ? `${t("machine.agentLoopDownstreamTriggers")}: ${loop.downstreamTriggerOn.map(getDownstreamTriggerLabel).join(", ")}` : undefined,
        loop.notifyEvents?.length ? `${t("machine.agentLoopNotifyEvents")}: ${loop.notifyEvents.join(", ")}` : undefined,
        loop.notificationChannels?.length ? `${t("machine.agentLoopNotifyChannels")}: ${loop.notificationChannels.join(", ")}` : undefined,
        loop.notificationWebhookUrl ? `${t("machine.agentLoopNotifyWebhook")}: ${loop.notificationWebhookUrl}` : undefined,
        loop.lastBriefAt ? `${t("machine.agentLoopLastBrief")}: ${formatTimestamp(loop.lastBriefAt)}${loop.lastBriefSummary ? ` • ${loop.lastBriefSummary}` : ""}` : undefined,
        loop.goal ? `${t("machine.agentLoopGoal")}: ${loop.goal}` : undefined,
        loop.currentFocus ? `${t("machine.agentLoopCurrentFocus")}: ${loop.currentFocus}` : undefined,
        loop.workingMemory ? `${t("machine.agentLoopWorkingMemory")}:
${loop.workingMemory}` : undefined,
        loop.lastReflectionSummary ? `${t("machine.agentLoopReflectionSummary")}:
${loop.lastReflectionSummary}` : undefined,
        loop.memoryUpdatedAt ? `${t("machine.agentLoopMemoryUpdated")}: ${formatTimestamp(loop.memoryUpdatedAt)}` : undefined,
        loop.projectId ? `${t("machine.automationAuditProject")}: ${loop.projectId}` : undefined,
        loop.profileId ? `${t("machine.agentLoopProfile")}: ${loop.profileId}` : undefined,
        loop.lastError ? `${t("machine.automationFailed")}: ${loop.lastError}` : undefined,
        loop.blockedReason ? `${t("machine.agentLoopBlockedReason")}: ${loop.blockedReason}` : undefined,
        loop.environmentVariables ? `${t("machine.agentLoopEnvironment")}:\n${formatEnvironmentVariables(loop.environmentVariables)}` : undefined,
        formatLoopEvents(loop) ? `${t("machine.agentLoopRecentEvents")}:
${formatLoopEvents(loop)}` : undefined,
        undefined,
        `${t("machine.agentLoopPrompt")}:`,
        loop.prompt,
    ].filter(Boolean).join("\n");
}

function getBootstrapProfileStatusColor(profile: MachineAgentLoopBootstrapProfile, theme: any): string {
    if (profile.status === "failed") return "#FF3B30";
    if (profile.status === "running") return "#0A84FF";
    if (profile.status === "paused") return theme.colors.textSecondary;
    return "#34C759";
}

function getBootstrapProfileSubtitle(profile: MachineAgentLoopBootstrapProfile): string {
    return [
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.agentLoopBootstrapStatus")}: ${profile.status}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.agentLoopBootstrapCreatedCount")}: ${profile.lastCreatedCount ?? 0}`,
        profile.lastError ? profile.lastError : undefined,
    ].filter(Boolean).join(" • ");
}

function getBootstrapProfileDetailMessage(profile: MachineAgentLoopBootstrapProfile): string {
    return [
        `${t("machine.agentLoopStatus")}: ${profile.status}`,
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.agentLoopBootstrapMaxDepth")}: ${profile.maxDepth ?? "-"}`,
        `${t("machine.agentLoopBootstrapLimit")}: ${profile.limit ?? "-"}`,
        `${t("machine.agentLoopAgent")}: ${profile.agent ?? "-"}`,
        `${t("machine.agentLoopProfile")}: ${profile.profileId ?? "-"}`,
        `${t("machine.automationAuditProject")}: ${profile.projectId ?? "-"}`,
        `${t("machine.agentLoopBootstrapAutoRunCreated")}: ${profile.autoRunCreatedLoops ? t("common.yes") : t("common.no")}`,
        `${t("machine.agentLoopLastRun")}: ${formatTimestamp(profile.lastRunAt)}`,
        `${t("machine.agentLoopBootstrapRepoCount")}: ${profile.lastRepoCount ?? 0}`,
        `${t("machine.agentLoopBootstrapSuggestionCount")}: ${profile.lastSuggestionCount ?? 0}`,
        `${t("machine.agentLoopBootstrapCreatedCount")}: ${profile.lastCreatedCount ?? 0}`,
        profile.lastError ? `${t("machine.automationFailed")}: ${profile.lastError}` : undefined,
    ].filter(Boolean).join("\n");
}


function getAutoDreamProfileStatusColor(profile: MachineAutoDreamProfile, theme: any): string {
    if (profile.status === "failed") return "#FF3B30";
    if (profile.status === "running") return "#0A84FF";
    if (profile.status === "paused") return theme.colors.textSecondary;
    return "#34C759";
}

function getAutoDreamProfileSubtitle(profile: MachineAutoDreamProfile): string {
    return [
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.autoDreamStage")}: ${profile.stage}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.autoDreamMemoryFiles")}: ${profile.lastMemoryFiles ?? 0}`,
        profile.lastError ? profile.lastError : undefined,
    ].filter(Boolean).join(" • ");
}

function getAutoDreamProfileDetailMessage(profile: MachineAutoDreamProfile): string {
    return [
        `${t("machine.agentLoopStatus")}: ${profile.status}`,
        `${t("machine.autoDreamStage")}: ${profile.stage}`,
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.agentLoopBootstrapMaxDepth")}: ${profile.maxDepth ?? "-"}`,
        `${t("machine.agentLoopBootstrapLimit")}: ${profile.limit ?? "-"}`,
        `${t("machine.agentLoopLastRun")}: ${formatTimestamp(profile.lastRunAt)}`,
        `${t("machine.autoDreamMemoryFiles")}: ${profile.lastMemoryFiles ?? 0}`,
        `${t("machine.autoDreamUpdatedFiles")}: ${profile.lastUpdatedFiles ?? 0}`,
        `${t("machine.autoDreamLatestReport")}: ${profile.latestDreamFilePath ?? "-"}`,
        profile.lastError ? `${t("machine.automationFailed")}: ${profile.lastError}` : undefined,
    ].filter(Boolean).join("\n");
}

export default React.memo(function MachineLoopsPage() {
    const { id: machineIdParam, loopId: focusLoopId } = useLocalSearchParams<{ id: string; loopId?: string }>();
    const machineId = typeof machineIdParam === "string" ? machineIdParam : undefined;
    const router = useRouter();
    const { theme } = useUnistyles();
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
    const [bootstrapSaving, setBootstrapSaving] = React.useState(false);
    const [mutatingBootstrapProfileId, setMutatingBootstrapProfileId] = React.useState<string | null>(null);
    const [editingBootstrapProfileId, setEditingBootstrapProfileId] = React.useState<string | null>(null);
    const [bootstrapProfileName, setBootstrapProfileName] = React.useState("");
    const [bootstrapRootDirectory, setBootstrapRootDirectory] = React.useState("");
    const [bootstrapInterval, setBootstrapInterval] = React.useState("6h");
    const [bootstrapMaxDepth, setBootstrapMaxDepth] = React.useState("");
    const [bootstrapLimit, setBootstrapLimit] = React.useState("");
    const [bootstrapAgent, setBootstrapAgent] = React.useState<MachineAgentLoop["agent"]>("claude");
    const [bootstrapProjectId, setBootstrapProjectId] = React.useState("");
    const [bootstrapProfileIdValue, setBootstrapProfileIdValue] = React.useState("");
    const [bootstrapAutoRunCreated, setBootstrapAutoRunCreated] = React.useState(false);
    const [autoDreamProfiles, setAutoDreamProfiles] = React.useState<MachineAutoDreamProfile[]>([]);
    const [autoDreamSaving, setAutoDreamSaving] = React.useState(false);
    const [mutatingAutoDreamProfileId, setMutatingAutoDreamProfileId] = React.useState<string | null>(null);
    const [editingAutoDreamProfileId, setEditingAutoDreamProfileId] = React.useState<string | null>(null);
    const [autoDreamName, setAutoDreamName] = React.useState("");
    const [autoDreamRootDirectory, setAutoDreamRootDirectory] = React.useState("");
    const [autoDreamInterval, setAutoDreamInterval] = React.useState("12h");
    const [autoDreamMaxDepth, setAutoDreamMaxDepth] = React.useState("");
    const [autoDreamLimit, setAutoDreamLimit] = React.useState("");
    const [suggesting, setSuggesting] = React.useState(false);
    const [creatingSuggestionKey, setCreatingSuggestionKey] = React.useState<string | null>(null);
    const [adoptingAllSuggestions, setAdoptingAllSuggestions] = React.useState(false);
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

    const resetBootstrapProfileForm = React.useCallback(() => {
        setEditingBootstrapProfileId(null);
        setBootstrapProfileName("");
        setBootstrapRootDirectory("");
        setBootstrapInterval("6h");
        setBootstrapMaxDepth("");
        setBootstrapLimit("");
        setBootstrapAgent("claude");
        setBootstrapProjectId("");
        setBootstrapProfileIdValue("");
        setBootstrapAutoRunCreated(false);
    }, []);

    const resetAutoDreamProfileForm = React.useCallback(() => {
        setEditingAutoDreamProfileId(null);
        setAutoDreamName("");
        setAutoDreamRootDirectory("");
        setAutoDreamInterval("12h");
        setAutoDreamMaxDepth("");
        setAutoDreamLimit("");
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
            const [result, bootstrapResult, autoDreamResult] = await Promise.all([
                machineListAgentLoops(machineId),
                machineListAgentLoopBootstrapProfiles(machineId),
                machineListAutoDreamProfiles(machineId),
            ]);
            setLoops(result.loops ?? []);
            setBootstrapProfiles(bootstrapResult.profiles ?? []);
            setAutoDreamProfiles(autoDreamResult.profiles ?? []);
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

    const saveBootstrapProfile = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        const parsedInterval = parseIntervalMs(bootstrapInterval);
        const parsedMaxDepth = parsePositiveInteger(bootstrapMaxDepth);
        const parsedLimit = parsePositiveInteger(bootstrapLimit);
        if (!bootstrapRootDirectory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        if (parsedInterval == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopIntervalInvalid"));
            return;
        }
        if (bootstrapMaxDepth.trim() && parsedMaxDepth == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapDepthInvalid"));
            return;
        }
        if (bootstrapLimit.trim() && parsedLimit == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapLimitInvalid"));
            return;
        }
        setBootstrapSaving(true);
        try {
            const result = editingBootstrapProfileId
                ? await machineUpdateAgentLoopBootstrapProfile(machineId, editingBootstrapProfileId, {
                    name: bootstrapProfileName.trim() || null,
                    rootDirectory: bootstrapRootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? null,
                    limit: parsedLimit ?? null,
                    agent: bootstrapAgent,
                    profileId: bootstrapProfileIdValue.trim() || null,
                    projectId: bootstrapProjectId.trim() || null,
                    autoRunCreatedLoops: bootstrapAutoRunCreated,
                })
                : await machineCreateAgentLoopBootstrapProfile(machineId, {
                    name: bootstrapProfileName.trim() || undefined,
                    rootDirectory: bootstrapRootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? undefined,
                    limit: parsedLimit ?? undefined,
                    agent: bootstrapAgent,
                    profileId: bootstrapProfileIdValue.trim() || undefined,
                    projectId: bootstrapProjectId.trim() || undefined,
                    autoRunCreatedLoops: bootstrapAutoRunCreated,
                    runNow: false,
                });
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            resetBootstrapProfileForm();
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setBootstrapSaving(false);
        }
    }, [bootstrapAgent, bootstrapAutoRunCreated, bootstrapInterval, bootstrapLimit, bootstrapMaxDepth, bootstrapProfileIdValue, bootstrapProfileName, bootstrapProjectId, bootstrapRootDirectory, editingBootstrapProfileId, load, machineId, resetBootstrapProfileForm]);

    const applyBootstrapProfileToForm = React.useCallback((profile: MachineAgentLoopBootstrapProfile) => {
        setEditingBootstrapProfileId(profile.id);
        setBootstrapProfileName(profile.name ?? "");
        setBootstrapRootDirectory(profile.rootDirectory);
        setBootstrapInterval(formatIntervalMs(profile.intervalMs));
        setBootstrapMaxDepth(profile.maxDepth != null ? String(profile.maxDepth) : "");
        setBootstrapLimit(profile.limit != null ? String(profile.limit) : "");
        setBootstrapAgent(profile.agent ?? "claude");
        setBootstrapProfileIdValue(profile.profileId ?? "");
        setBootstrapProjectId(profile.projectId ?? "");
        setBootstrapAutoRunCreated(Boolean(profile.autoRunCreatedLoops));
    }, []);

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
            if (editingBootstrapProfileId === profile.id && action === "remove") {
                resetBootstrapProfileForm();
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingBootstrapProfileId(null);
        }
    }, [editingBootstrapProfileId, load, machineId, resetBootstrapProfileForm]);

    const openBootstrapProfileActions = React.useCallback((profile: MachineAgentLoopBootstrapProfile) => {
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("machine.agentLoopEdit"), onPress: () => applyBootstrapProfileToForm(profile) },
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
    }, [applyBootstrapProfileToForm, mutateBootstrapProfile]);

    const saveAutoDreamProfile = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        const parsedInterval = parseIntervalMs(autoDreamInterval);
        const parsedMaxDepth = parsePositiveInteger(autoDreamMaxDepth);
        const parsedLimit = parsePositiveInteger(autoDreamLimit);
        if (!autoDreamRootDirectory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        if (parsedInterval == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopIntervalInvalid"));
            return;
        }
        if (autoDreamMaxDepth.trim() && parsedMaxDepth == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapDepthInvalid"));
            return;
        }
        if (autoDreamLimit.trim() && parsedLimit == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapLimitInvalid"));
            return;
        }
        setAutoDreamSaving(true);
        try {
            const result = editingAutoDreamProfileId
                ? await machineUpdateAutoDreamProfile(machineId, editingAutoDreamProfileId, {
                    name: autoDreamName.trim() || null,
                    rootDirectory: autoDreamRootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? null,
                    limit: parsedLimit ?? null,
                })
                : await machineCreateAutoDreamProfile(machineId, {
                    name: autoDreamName.trim() || undefined,
                    rootDirectory: autoDreamRootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? undefined,
                    limit: parsedLimit ?? undefined,
                    runNow: false,
                });
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            resetAutoDreamProfileForm();
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAutoDreamSaving(false);
        }
    }, [autoDreamInterval, autoDreamLimit, autoDreamMaxDepth, autoDreamName, autoDreamRootDirectory, editingAutoDreamProfileId, load, machineId, resetAutoDreamProfileForm]);

    const applyAutoDreamProfileToForm = React.useCallback((profile: MachineAutoDreamProfile) => {
        setEditingAutoDreamProfileId(profile.id);
        setAutoDreamName(profile.name ?? "");
        setAutoDreamRootDirectory(profile.rootDirectory);
        setAutoDreamInterval(formatIntervalMs(profile.intervalMs));
        setAutoDreamMaxDepth(profile.maxDepth != null ? String(profile.maxDepth) : "");
        setAutoDreamLimit(profile.limit != null ? String(profile.limit) : "");
    }, []);

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
            if (editingAutoDreamProfileId === profile.id && action === "remove") {
                resetAutoDreamProfileForm();
            }
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setMutatingAutoDreamProfileId(null);
        }
    }, [editingAutoDreamProfileId, load, machineId, resetAutoDreamProfileForm]);

    const openAutoDreamProfileActions = React.useCallback((profile: MachineAutoDreamProfile) => {
        const buttons = [
            { text: t("common.ok") },
            { text: t("machine.agentLoopEdit"), onPress: () => applyAutoDreamProfileToForm(profile) },
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
    }, [applyAutoDreamProfileToForm, mutateAutoDreamProfile, openMachineFileViewer]);

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

                <ItemGroup title={t("machine.agentLoopSuggestions")}>
                    {suggestions.length > 0 ? (
                        <View style={[styles.buttonRow, { marginBottom: 12 }]}>
                            <Pressable
                                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: adoptingAllSuggestions ? 0.7 : 1 }]}
                                onPress={() => void adoptAllSuggestions()}
                                disabled={adoptingAllSuggestions}
                            >
                                {adoptingAllSuggestions ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopSuggestionAdoptAll")}</Text>
                                )}
                            </Pressable>
                        </View>
                    ) : null}
                    {suggestions.length === 0 ? (
                        <Item title={t("machine.agentLoopSuggestionsEmpty")} showChevron={false} />
                    ) : suggestions.map((suggestion) => (
                        <View key={suggestion.key} style={styles.suggestionCard}>
                            <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{suggestion.name}</Text>
                            <Text style={{ color: theme.colors.textSecondary }}>
                                {`${suggestion.description} • ${suggestion.confidence} • ${formatIntervalMs(suggestion.intervalMs)}`}
                            </Text>
                            <Text style={{ color: theme.colors.textSecondary }}>{suggestion.rationale}</Text>
                            {suggestion.currentFocus ? (
                                <Text style={{ color: theme.colors.textSecondary }}>{`${t("machine.agentLoopCurrentFocus")}: ${suggestion.currentFocus}`}</Text>
                            ) : null}
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
                                {suggestion.existingLoopId ? (
                                    <Pressable
                                        style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                        onPress={() => router.push(`/machine/${machineId}/loops?loopId=${encodeURIComponent(suggestion.existingLoopId!)}` as any)}
                                    >
                                        <Text style={{ color: theme.colors.text }}>{t("machine.agentLoopViewAutomation")}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        </View>
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.agentLoopBootstrapProfiles")}>
                    <View style={styles.formSection}>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopNameOptional")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapProfileName}
                            onChangeText={setBootstrapProfileName}
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPathPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapRootDirectory}
                            onChangeText={setBootstrapRootDirectory}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopIntervalPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapInterval}
                            onChangeText={setBootstrapInterval}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopBootstrapMaxDepth")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapMaxDepth}
                            onChangeText={setBootstrapMaxDepth}
                            keyboardType="number-pad"
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopBootstrapLimit")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapLimit}
                            onChangeText={setBootstrapLimit}
                            keyboardType="number-pad"
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.automationAuditProject")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapProjectId}
                            onChangeText={setBootstrapProjectId}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopProfile")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={bootstrapProfileIdValue}
                            onChangeText={setBootstrapProfileIdValue}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopBootstrapAutoRunCreated")}</Text>
                        <Pressable
                            style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            onPress={() => setBootstrapAutoRunCreated((current) => !current)}
                        >
                            <Text style={{ color: theme.colors.text }}>{bootstrapAutoRunCreated ? t("common.yes") : t("common.no")}</Text>
                        </Pressable>
                        <View style={styles.buttonRow}>
                            <Pressable
                                style={[styles.createButton, { backgroundColor: theme.colors.primary, opacity: bootstrapSaving ? 0.7 : 1 }]}
                                onPress={() => void saveBootstrapProfile()}
                                disabled={bootstrapSaving}
                            >
                                {bootstrapSaving ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} /> : <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>{editingBootstrapProfileId ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>}
                            </Pressable>
                            <Pressable
                                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                onPress={resetBootstrapProfileForm}
                            >
                                <Text style={{ color: theme.colors.textSecondary }}>{t("common.reset")}</Text>
                            </Pressable>
                        </View>
                    </View>
                    {bootstrapProfiles.length === 0 ? (
                        <Item title={t("machine.agentLoopBootstrapProfilesEmpty")} showChevron={false} />
                    ) : bootstrapProfiles.map((profile) => (
                        <Item
                            key={profile.id}
                            title={profile.name || profile.id}
                            subtitle={getBootstrapProfileSubtitle(profile)}
                            detail={profile.status}
                            detailStyle={{ color: getBootstrapProfileStatusColor(profile, theme) }}
                            onPress={() => openBootstrapProfileActions(profile)}
                            showChevron
                            rightElement={mutatingBootstrapProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.autoDreamProfiles")}>
                    <View style={styles.formSection}>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopNameOptional")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={autoDreamName}
                            onChangeText={setAutoDreamName}
                        />
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPath")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={autoDreamRootDirectory}
                            onChangeText={setAutoDreamRootDirectory}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <View style={styles.row}>
                            <TextInput
                                style={[styles.input, styles.rowInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder={t("machine.agentLoopInterval")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={autoDreamInterval}
                                onChangeText={setAutoDreamInterval}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <TextInput
                                style={[styles.input, styles.rowInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder={t("machine.agentLoopBootstrapMaxDepth")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={autoDreamMaxDepth}
                                onChangeText={setAutoDreamMaxDepth}
                                keyboardType="number-pad"
                            />
                            <TextInput
                                style={[styles.input, styles.rowInput, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder={t("machine.agentLoopBootstrapLimit")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={autoDreamLimit}
                                onChangeText={setAutoDreamLimit}
                                keyboardType="number-pad"
                            />
                        </View>
                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.autoDreamHint")}</Text>
                        <View style={styles.actionsRow}>
                            <Pressable
                                style={[styles.primaryButton, { backgroundColor: theme.colors.button.primary.background, opacity: autoDreamSaving ? 0.7 : 1 }]}
                                onPress={() => void saveAutoDreamProfile()}
                                disabled={autoDreamSaving}
                            >
                                {autoDreamSaving ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} /> : <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>{editingAutoDreamProfileId ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>}
                            </Pressable>
                            <Pressable
                                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                onPress={resetAutoDreamProfileForm}
                            >
                                <Text style={{ color: theme.colors.textSecondary }}>{t("common.reset")}</Text>
                            </Pressable>
                        </View>
                    </View>
                    {autoDreamProfiles.length === 0 ? (
                        <Item title={t("machine.autoDreamProfilesEmpty")} showChevron={false} />
                    ) : autoDreamProfiles.map((profile) => (
                        <Item
                            key={profile.id}
                            title={profile.name || profile.id}
                            subtitle={getAutoDreamProfileSubtitle(profile)}
                            detail={profile.status}
                            detailStyle={{ color: getAutoDreamProfileStatusColor(profile, theme) }}
                            onPress={() => openAutoDreamProfileActions(profile)}
                            showChevron
                            rightElement={mutatingAutoDreamProfileId === profile.id ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.agentLoopBootstrap")}>
                    <View style={styles.formSection}>
                        <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopBootstrapHint")}</Text>
                        <Pressable
                            style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, opacity: bootstrapScanning ? 0.7 : 1 }]}
                            onPress={() => void scanBootstrapRepos()}
                            disabled={bootstrapScanning}
                        >
                            {bootstrapScanning ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Text style={{ color: theme.colors.text }}>{t("gitHosts.scanRepos")}</Text>
                            )}
                        </Pressable>
                    </View>
                    {bootstrapEntries.length === 0 ? (
                        <Item title={t("machine.agentLoopBootstrapEmpty")} showChevron={false} />
                    ) : bootstrapEntries.map((entry) => {
                        const missingCount = entry.suggestions.filter((suggestion) => !suggestion.alreadyConfigured).length;
                        return (
                            <View key={entry.repo.repoPath} style={[styles.suggestionCard, { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}> 
                                <Text style={[styles.suggestionTitle, { color: theme.colors.text }]}>{entry.repo.name}</Text>
                                <Text style={{ color: theme.colors.textSecondary }}>{entry.repo.repoPath}</Text>
                                <Text style={{ color: theme.colors.textSecondary }}>
                                    {entry.suggestions.length} suggestions • {missingCount} creatable
                                </Text>
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
                            detailStyle={{ color: getLoopStatusColor(loop, theme) }}
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
    memoryInput: {
        minHeight: 76,
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
        flexDirection: "row",
        gap: 8,
    },
    rowInput: {
        flex: 1,
    },
    actionsRow: {
        flexDirection: "row",
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
    suggestionCard: {
        padding: 16,
        gap: 8,
    },
    suggestionTitle: {
        fontSize: 15,
        fontWeight: "600",
    },
    suggestionActions: {
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
    },
}));
