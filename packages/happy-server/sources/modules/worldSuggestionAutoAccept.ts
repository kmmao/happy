import type { SuggestionAcceptAudit, SuggestionSummary, WorldAutonomyPolicy, SupervisorMode } from "@kmmao/happy-wire";
import { SUPERVISOR_MODES } from "@kmmao/happy-wire";
import { db } from "@/storage/db";
import { worldSuggestionAccept } from "./worldSuggestionAccept";

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

export function resolveWorldAutonomyPolicy(input: {
    supervisorMode: string | null;
    supervisorConfig: string | null;
}): WorldAutonomyPolicy {
    const level = parseSupervisorModeLevel(input.supervisorMode)
        ?? legacyBooleanFallback(input.supervisorConfig)
        ?? "disabled";

    const params = parseConfigNumericParams(input.supervisorConfig);

    return {
        level,
        maxAutoAcceptsPerDay: params.maxAutoAcceptsPerDay,
        maxConcurrentAutoTasks: params.maxConcurrentAutoTasks,
        autoTaskTypes: ["suggested_task"],
    };
}

function parseSupervisorModeLevel(mode: string | null): SupervisorMode | null {
    if (mode && (SUPERVISOR_MODES as readonly string[]).includes(mode)) {
        return mode as SupervisorMode;
    }
    return null;
}

function legacyBooleanFallback(supervisorConfig: string | null): SupervisorMode | null {
    try {
        if (supervisorConfig) {
            const cfg = JSON.parse(supervisorConfig);
            if (cfg?.worldAutonomy?.autoAcceptSafeSuggestedTasks === true) {
                return "semi-auto";
            }
        }
    } catch {
        // Ignore invalid JSON.
    }
    return null;
}

function parseConfigNumericParams(supervisorConfig: string | null): {
    maxAutoAcceptsPerDay: number | null;
    maxConcurrentAutoTasks: number | null;
} {
    try {
        if (supervisorConfig) {
            const cfg = JSON.parse(supervisorConfig);
            const wa = cfg?.worldAutonomy;
            const rawDay = wa?.maxAutoAcceptsPerDay;
            const rawConc = wa?.maxConcurrentAutoTasks;
            return {
                maxAutoAcceptsPerDay: Number.isInteger(rawDay) && rawDay > 0 ? rawDay : null,
                maxConcurrentAutoTasks: Number.isInteger(rawConc) && rawConc > 0 ? rawConc : null,
            };
        }
    } catch {
        // Ignore invalid JSON.
    }
    return { maxAutoAcceptsPerDay: null, maxConcurrentAutoTasks: null };
}

// ---------------------------------------------------------------------------
// Legacy shim (kept for existing callers / tests during migration)
// ---------------------------------------------------------------------------

export interface WorldSuggestionAutoAcceptProjectConfig {
    autoAcceptSafeSuggestedTasks: boolean;
    maxAutoAcceptsPerDay: number | null;
}

export function parseWorldSuggestionAutoAcceptProjectConfig(
    supervisorConfig: string | null,
): WorldSuggestionAutoAcceptProjectConfig {
    try {
        if (supervisorConfig) {
            const cfg = JSON.parse(supervisorConfig);
            const enabled = cfg?.worldAutonomy?.autoAcceptSafeSuggestedTasks;
            const rawLimit = cfg?.worldAutonomy?.maxAutoAcceptsPerDay;
            const maxAutoAcceptsPerDay = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : null;
            if (typeof enabled === "boolean") {
                return {
                    autoAcceptSafeSuggestedTasks: enabled,
                    maxAutoAcceptsPerDay,
                };
            }
        }
    } catch {
        // Ignore invalid JSON and fall back to disabled.
    }

    return { autoAcceptSafeSuggestedTasks: false, maxAutoAcceptsPerDay: null };
}

// ---------------------------------------------------------------------------
// Eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns true if the suggestion should be auto-accepted under the given policy.
 *
 * Tier 1 (semi-auto + auto): safe next-step suggested_tasks with requiresHuman=false
 *   and no message/decision evidence — unless the dedupeKey marks them as tier 2.
 * Tier 2 (auto only): retryable_failed_task and blocked_goal_supplement dedupeKey prefixes.
 */
export function shouldAutoAcceptSuggestedTask(input: {
    policy: WorldAutonomyPolicy;
    suggestion: SuggestionSummary;
}): boolean {
    const { policy, suggestion } = input;

    if (policy.level === "disabled" || policy.level === "suggest") {
        return false;
    }

    if (suggestion.status !== "open") {
        return false;
    }

    if (suggestion.type !== "suggested_task") {
        return false;
    }

    if (suggestion.bucket !== "next_step") {
        return false;
    }

    if (suggestion.requiresHuman) {
        return false;
    }

    if (!("task" in suggestion.payload) || !suggestion.payload.task.title.trim() || !suggestion.payload.task.prompt.trim()) {
        return false;
    }

    if (suggestion.evidence.some((item) => item.kind === "message" || item.kind === "decision")) {
        return false;
    }

    // Tier 2 suggestions require "auto" mode.
    if (isExtendedAutoTier(suggestion.dedupeKey)) {
        return policy.level === "auto";
    }

    return true;
}

function isExtendedAutoTier(dedupeKey: string): boolean {
    return dedupeKey.startsWith("retryable_failed_task:")
        || dedupeKey.startsWith("blocked_goal_supplement:");
}

// ---------------------------------------------------------------------------
// Audit snapshot
// ---------------------------------------------------------------------------

export function buildAutoAcceptAudit(input: {
    suggestion: SuggestionSummary;
}): SuggestionAcceptAudit {
    const { dedupeKey } = input.suggestion;
    const rule = dedupeKey.startsWith("retryable_failed_task:")
        ? "retryable_failed_task_auto_accept"
        : dedupeKey.startsWith("blocked_goal_supplement:")
            ? "blocked_goal_supplement_auto_accept"
            : "safe_suggested_task_auto_accept";

    return {
        rule,
        checks: [
            `type:${input.suggestion.type}`,
            `bucket:${input.suggestion.bucket}`,
            `requiresHuman:${String(input.suggestion.requiresHuman)}`,
            "payload:task_title_prompt_present",
            "evidence:no_message_decision",
            `dedupeKey:${dedupeKey.split(":")[0]}`,
        ],
    };
}

// ---------------------------------------------------------------------------
// Concurrency check
// ---------------------------------------------------------------------------

export async function countRunningAutoTasks(input: {
    accountId: string;
    projectId: string;
}): Promise<number> {
    return db.task.count({
        where: {
            accountId: input.accountId,
            projectId: input.projectId,
            triggerType: "suggestion_auto",
            status: { in: ["dispatching", "running"] },
        },
    });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function autoAcceptSuggestedTasksIfEnabled(input: {
    accountId: string;
    projectId: string;
    supervisorMode?: string | null;
    supervisorConfig: string | null;
    suggestions: SuggestionSummary[];
}): Promise<void> {
    const policy = resolveWorldAutonomyPolicy({
        supervisorMode: input.supervisorMode ?? null,
        supervisorConfig: input.supervisorConfig,
    });

    if (policy.level === "disabled" || policy.level === "suggest") {
        return;
    }

    // Concurrency protection
    if (policy.maxConcurrentAutoTasks !== null) {
        const running = await countRunningAutoTasks({
            accountId: input.accountId,
            projectId: input.projectId,
        });
        if (running >= policy.maxConcurrentAutoTasks) {
            for (const suggestion of input.suggestions) {
                if (shouldAutoAcceptSuggestedTask({ policy, suggestion })) {
                    await markAutoAcceptOutcome({
                        suggestionId: suggestion.id,
                        status: "skipped",
                        reasonCode: "concurrency_exceeded",
                    });
                }
            }
            return;
        }
    }

    // Daily quota
    const remainingQuota = await getRemainingDailyAutoAcceptQuota({
        accountId: input.accountId,
        projectId: input.projectId,
        maxAutoAcceptsPerDay: policy.maxAutoAcceptsPerDay,
    });

    let acceptedCount = 0;

    for (const suggestion of input.suggestions) {
        if (!shouldAutoAcceptSuggestedTask({ policy, suggestion })) {
            continue;
        }

        if (remainingQuota !== null && acceptedCount >= remainingQuota) {
            await markAutoAcceptOutcome({
                suggestionId: suggestion.id,
                status: "skipped",
                reasonCode: "quota_exhausted",
            });
            continue;
        }

        try {
            await worldSuggestionAccept({
                accountId: input.accountId,
                projectId: input.projectId,
                suggestionId: suggestion.id,
                acceptSource: "system_auto",
                acceptAudit: buildAutoAcceptAudit({ suggestion }),
            });
            acceptedCount += 1;
        } catch (error) {
            if (isAlreadyActedSuggestionError(error)) {
                await markAutoAcceptOutcome({
                    suggestionId: suggestion.id,
                    status: "skipped",
                    reasonCode: "already_acted",
                    suggestionStatus: "expired",
                });
                continue;
            }

            await markAutoAcceptOutcome({
                suggestionId: suggestion.id,
                status: "failed",
                reasonCode: "accept_failed",
                failureDetail: normalizeAutoAcceptFailureDetail(error),
            });
            throw new Error(`Auto-accept failed for suggestion ${suggestion.id}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getRemainingDailyAutoAcceptQuota(input: {
    accountId: string;
    projectId: string;
    maxAutoAcceptsPerDay: number | null;
}): Promise<number | null> {
    if (input.maxAutoAcceptsPerDay === null) {
        return null;
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const currentCount = await db.worldSuggestion.count({
        where: {
            accountId: input.accountId,
            projectId: input.projectId,
            status: "accepted",
            acceptSource: "system_auto",
            actedAt: { gte: dayStart },
        },
    });

    return Math.max(input.maxAutoAcceptsPerDay - currentCount, 0);
}

async function markAutoAcceptOutcome(input: {
    suggestionId: string;
    status: "skipped" | "failed";
    reasonCode: "quota_exhausted" | "already_acted" | "accept_failed" | "concurrency_exceeded" | "mode_disabled";
    failureDetail?: "dispatch_failed" | "payload_invalid" | "auto_accept_failed";
    suggestionStatus?: "expired";
}): Promise<void> {
    await db.worldSuggestion.update({
        where: { id: input.suggestionId },
        data: {
            ...(input.suggestionStatus
                ? {
                    status: input.suggestionStatus,
                    actedAt: new Date(),
                }
                : {}),
            autoAcceptStatus: input.status,
            autoAcceptReasonCode: input.reasonCode,
            ...(input.failureDetail ? { autoAcceptFailureDetail: input.failureDetail } : {}),
        } as any,
    });
}

function isAlreadyActedSuggestionError(error: unknown): boolean {
    return error instanceof Error && error.message === "Suggestion not found or already acted upon";
}

function normalizeAutoAcceptFailureDetail(error: unknown): "dispatch_failed" | "payload_invalid" | "auto_accept_failed" {
    if (!(error instanceof Error)) {
        return "auto_accept_failed";
    }

    if (error.message.startsWith("Task dispatch failed:")) {
        return "dispatch_failed";
    }

    if (error.message === "Suggestion payload does not match suggestion type") {
        return "payload_invalid";
    }

    return "auto_accept_failed";
}
