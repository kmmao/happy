import type {
    MachineAgentLoop,
    MachineAgentLoopBootstrapProfile,
    MachineAgentLoopEvent,
    MachineAutoDreamProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { formatEnvironmentVariables, formatIntervalMs, formatTimestamp } from "./loopsUtils";

export function getLoopBriefPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/brief-latest.md`;
}

export function getLoopMemoryPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/memory.md`;
}

export function getLoopContextPath(loop: MachineAgentLoop): string {
    return `${loop.directory}/.happy/agent-loops/${loop.id}/context.md`;
}

export function getDownstreamTriggerLabel(value: "completed" | "failed"): string {
    return value === "completed" ? t("machine.agentLoopDownstreamTriggerCompleted") : t("machine.agentLoopDownstreamTriggerFailed");
}

export function getLoopRuntimeLabel(loop: MachineAgentLoop): string {
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

export function getLoopPhaseLabel(loop: MachineAgentLoop): string {
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

export function isWithinQuietHoursLocal(loop: MachineAgentLoop, now = Date.now()): boolean {
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

export function getLoopPolicyReasonLabel(reason?: string): string {
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

export function getLoopPolicyStateLabel(loop: MachineAgentLoop, now = Date.now()): string {
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

export function getLoopTriggerLabel(loop: MachineAgentLoop): string {
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

export function getLoopStatusLabel(loop: MachineAgentLoop): string {
    if (loop.runtimeState === "blocked") {
        return t("machine.agentLoopRuntimeBlocked");
    }
    return loop.enabled ? t("machine.agentLoopEnabled") : t("machine.agentLoopPaused");
}

export function getLoopSubtitle(loop: MachineAgentLoop): string {
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

export function getLoopEventStatusLabel(event: MachineAgentLoopEvent): string {
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

export function formatLoopEvents(loop: MachineAgentLoop): string | undefined {
    if (!loop.recentEvents || loop.recentEvents.length === 0) {
        return undefined;
    }
    return loop.recentEvents.slice(0, 5).map((event) => `• ${formatTimestamp(event.createdAt)} — ${event.title} (${getLoopEventStatusLabel(event)})${event.source ? ` [${event.source}]` : ""}`).join("\n");
}

export function getLoopStatusColor(loop: MachineAgentLoop, theme: any): string {
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

export function getLoopDetailMessage(loop: MachineAgentLoop): string {
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
        loop.workingMemory ? `${t("machine.agentLoopWorkingMemory")}:\n${loop.workingMemory}` : undefined,
        loop.lastReflectionSummary ? `${t("machine.agentLoopReflectionSummary")}:\n${loop.lastReflectionSummary}` : undefined,
        loop.memoryUpdatedAt ? `${t("machine.agentLoopMemoryUpdated")}: ${formatTimestamp(loop.memoryUpdatedAt)}` : undefined,
        loop.projectId ? `${t("machine.automationAuditProject")}: ${loop.projectId}` : undefined,
        loop.profileId ? `${t("machine.agentLoopProfile")}: ${loop.profileId}` : undefined,
        loop.lastError ? `${t("machine.automationFailed")}: ${loop.lastError}` : undefined,
        loop.blockedReason ? `${t("machine.agentLoopBlockedReason")}: ${loop.blockedReason}` : undefined,
        loop.environmentVariables ? `${t("machine.agentLoopEnvironment")}:\n${formatEnvironmentVariables(loop.environmentVariables)}` : undefined,
        formatLoopEvents(loop) ? `${t("machine.agentLoopRecentEvents")}:\n${formatLoopEvents(loop)}` : undefined,
        undefined,
        `${t("machine.agentLoopPrompt")}:`,
        loop.prompt,
    ].filter(Boolean).join("\n");
}

export function getBootstrapProfileStatusColor(profile: MachineAgentLoopBootstrapProfile, theme: any): string {
    if (profile.status === "failed") return "#FF3B30";
    if (profile.status === "running") return "#0A84FF";
    if (profile.status === "paused") return theme.colors.textSecondary;
    return "#34C759";
}

export function getBootstrapProfileSubtitle(profile: MachineAgentLoopBootstrapProfile): string {
    return [
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.agentLoopBootstrapStatus")}: ${profile.status}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.agentLoopBootstrapCreatedCount")}: ${profile.lastCreatedCount ?? 0}`,
        profile.lastError ? profile.lastError : undefined,
    ].filter(Boolean).join(" • ");
}

export function getBootstrapProfileDetailMessage(profile: MachineAgentLoopBootstrapProfile): string {
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

export function getAutoDreamProfileStatusColor(profile: MachineAutoDreamProfile, theme: any): string {
    if (profile.status === "failed") return "#FF3B30";
    if (profile.status === "running") return "#0A84FF";
    if (profile.status === "paused") return theme.colors.textSecondary;
    return "#34C759";
}

export function getAutoDreamProfileSubtitle(profile: MachineAutoDreamProfile): string {
    return [
        `${t("machine.agentLoopPath")}: ${profile.rootDirectory}`,
        `${t("machine.agentLoopInterval")}: ${formatIntervalMs(profile.intervalMs)}`,
        `${t("machine.autoDreamStage")}: ${profile.stage}`,
        `${t("machine.agentLoopNextRun")}: ${formatTimestamp(profile.nextRunAt)}`,
        `${t("machine.autoDreamMemoryFiles")}: ${profile.lastMemoryFiles ?? 0}`,
        profile.lastError ? profile.lastError : undefined,
    ].filter(Boolean).join(" • ");
}

export function getAutoDreamProfileDetailMessage(profile: MachineAutoDreamProfile): string {
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
