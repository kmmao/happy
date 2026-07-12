import { Prisma } from "@prisma/client";
import {
    parseSkillFrontmatter,
    resolveSkillModelId,
} from "@kmmao/happy-wire";
import { db } from "@/storage/db";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import type { ResolvedRuntimeProfile } from "@/types/aiBackendProfile";
import {
    isUnifiedRuntimeProfileResolverEnabled,
    notifyRuntimeProfileFailure,
    resolveRuntimeProfile,
    type ResolveRuntimeProfileFailure,
    type RuntimeProfilePurpose,
} from "@/modules/runtimeProfileResolver";

/**
 * Task intake — the single home for turning a creation request (manual,
 * webhook, or cron) into a dispatched Task. Each trigger path varies only in
 * directory policy, the transaction it runs inside, and what it does on a
 * profile-resolution failure; everything else (runtime-profile resolution
 * protocol, skill loading, the Task row shape + skillBindings, the
 * `task-trigger` dispatch payload) is identical and lives here.
 *
 * Callers keep ownership of their own transaction (webhook updates trigger
 * stats; cron optimistically claims the schedule) by calling `buildTaskCreateData`
 * to obtain the create-data and running `tx.task.create` themselves, then
 * `dispatchTaskTrigger` after commit.
 */

export type TaskTriggerType = "manual" | "webhook" | "cron";

// ============================================================================
// Runtime-profile resolution
// ============================================================================

export interface ResolveTaskRuntimeProfileInput {
    accountId: string;
    /** profileId persisted on the triggering record (or null/undefined). */
    explicitProfileId: string | null | undefined;
    projectSupervisorConfig: string | null;
    purpose: RuntimeProfilePurpose;
    /** Inbox notice target used when resolution fails. */
    failureNotice: { referenceUrl: string; refType: string; refId: string };
}

export type TaskRuntimeProfileResolution =
    | { kind: "disabled" }
    | { kind: "ok"; profileId: string; runtimeProfile: ResolvedRuntimeProfile }
    | { kind: "failed"; failure: ResolveRuntimeProfileFailure };

/**
 * Resolve the runtime profile for a Task before it is created. Returns
 * `disabled` when the unified resolver feature flag is off (legacy "dispatch
 * without a profile" behavior), `ok` with the resolved profile, or `failed`
 * after firing the operator Inbox notice — the caller decides whether a failure
 * means an HTTP error (manual/webhook) or a skipped iteration (cron).
 */
export async function resolveTaskRuntimeProfile(
    input: ResolveTaskRuntimeProfileInput,
): Promise<TaskRuntimeProfileResolution> {
    if (!isUnifiedRuntimeProfileResolverEnabled()) {
        return { kind: "disabled" };
    }
    const result = await resolveRuntimeProfile({
        accountId: input.accountId,
        explicitProfileId: input.explicitProfileId ?? null,
        projectSupervisorConfig: input.projectSupervisorConfig,
        purpose: input.purpose,
    });
    if (!result.ok) {
        notifyRuntimeProfileFailure({
            accountId: input.accountId,
            purpose: input.purpose,
            failure: result,
            referenceUrl: input.failureNotice.referenceUrl,
            refType: input.failureNotice.refType,
            refId: input.failureNotice.refId,
        });
        return { kind: "failed", failure: result };
    }
    return { kind: "ok", profileId: result.profileId, runtimeProfile: result.runtimeProfile };
}

export interface ResolveTaskRuntimeProfileBestEffortInput {
    accountId: string;
    explicitProfileId: string | null | undefined;
    projectSupervisorConfig: string | null;
    purpose: RuntimeProfilePurpose;
    /** profileId to keep when the resolver is disabled or resolution fails. */
    fallbackProfileId?: string;
}

/**
 * Best-effort profile resolution for re-dispatch paths (swarm) where a failure
 * must NOT abort or notify — the Task already exists and carries its own
 * profileId. On success the freshly resolved profile wins; otherwise we keep the
 * fallback profileId and dispatch without a runtimeProfile (legacy behavior).
 */
export async function resolveTaskRuntimeProfileBestEffort(
    input: ResolveTaskRuntimeProfileBestEffortInput,
): Promise<{ profileId: string | undefined; runtimeProfile: ResolvedRuntimeProfile | undefined }> {
    if (!isUnifiedRuntimeProfileResolverEnabled()) {
        return { profileId: input.fallbackProfileId, runtimeProfile: undefined };
    }
    const result = await resolveRuntimeProfile({
        accountId: input.accountId,
        explicitProfileId: input.explicitProfileId ?? null,
        projectSupervisorConfig: input.projectSupervisorConfig,
        purpose: input.purpose,
    });
    return result.ok
        ? { profileId: result.profileId, runtimeProfile: result.runtimeProfile }
        : { profileId: input.fallbackProfileId, runtimeProfile: undefined };
}

/**
 * The response body every strict caller sends when profile resolution fails.
 * Single-sourced here so the wire contract `{ error, reason, message }` stays
 * identical across the manual (400), retry (400), and webhook (503) paths —
 * the HTTP *status code* stays caller-owned (Task intake decision), only the
 * body shape is shared.
 */
export function profileUnavailableBody(failure: ResolveRuntimeProfileFailure): {
    error: "profile_unavailable";
    reason: ResolveRuntimeProfileFailure["reason"];
    message: ResolveRuntimeProfileFailure["message"];
} {
    return { error: "profile_unavailable", reason: failure.reason, message: failure.message };
}

/** Flatten a resolution into the profileId + runtimeProfile carried downstream. */
export function taskProfileFields(resolution: TaskRuntimeProfileResolution): {
    profileId: string | undefined;
    runtimeProfile: ResolvedRuntimeProfile | undefined;
} {
    return resolution.kind === "ok"
        ? { profileId: resolution.profileId, runtimeProfile: resolution.runtimeProfile }
        : { profileId: undefined, runtimeProfile: undefined };
}

// ============================================================================
// Skill loading
// ============================================================================

/**
 * Load the encrypted-name/content pairs for the given skill ids, scoped to the
 * account and excluding archived skills. Returns undefined when nothing resolves
 * so callers can omit `skillContents` from the dispatch payload entirely.
 *
 * Cron uses a pre-batched skill map instead (it fans out across many schedules
 * and must avoid an N+1), so this is consumed by the manual + webhook paths.
 */
export async function loadTaskSkillContents(
    accountId: string,
    skillIds: string[],
    options?: { interactive?: boolean },
): Promise<Array<{ name: string; content: string; model?: string }> | undefined> {
    if (skillIds.length === 0) return undefined;
    const skills = await db.skill.findMany({
        where: { id: { in: skillIds }, accountId, archived: false },
        orderBy: { name: "asc" },
    });
    return resolveSkillContents(skills, options);
}

/**
 * Apply Phase 3 front-matter routing to a set of raw skill rows: strip the
 * front-matter block from the injected body, resolve any per-skill `model`,
 * and — for non-interactive triggers (webhook/cron) — drop skills the author
 * marked as user-only (`disable_model_invocation` / `user_invocable: false`)
 * so the model can never autonomously run a guarded skill.
 *
 * Pure so every dispatch path (create, retry, swarm) shares one behaviour.
 */
export function resolveSkillContents(
    rawSkills: Array<{ name: string; content: string }>,
    options?: { interactive?: boolean },
): Array<{ name: string; content: string; model?: string }> | undefined {
    const interactive = options?.interactive ?? false;
    const resolved = rawSkills
        .map((s) => {
            const { frontmatter, body } = parseSkillFrontmatter(s.content);
            return {
                name: s.name,
                content: body,
                model: resolveSkillModelId(frontmatter.model),
                userOnly:
                    frontmatter.disableModelInvocation === true ||
                    frontmatter.userInvocable === false,
            };
        })
        .filter((s) => interactive || !s.userOnly)
        .map(({ name, content, model }) => ({ name, content, ...(model ? { model } : {}) }));

    return resolved.length > 0 ? resolved : undefined;
}

/**
 * Derive the effective model override for a task from its resolved skill
 * contents: the first skill that declares a front-matter `model` wins. Returns
 * undefined when no skill pins a model, letting the caller keep the task's own
 * model selection.
 */
export function deriveSkillModelOverride(
    skillContents: Array<{ model?: string }> | undefined,
): string | undefined {
    return skillContents?.find((s) => s.model)?.model;
}

// ============================================================================
// Task row creation
// ============================================================================

export interface BuildTaskCreateDataInput {
    accountId: string;
    machineId: string;
    projectId: string | null;
    prompt: string;
    /**
     * Working directory persisted on the Task row. Only the manual path stores
     * it; webhook/cron leave the column null and carry the resolved directory in
     * the dispatch payload only. Omit to preserve the null.
     */
    directory?: string;
    priority: string;
    maxAttempts: number;
    triggerType: TaskTriggerType;
    triggerRef?: string | null;
    profileId?: string;
    skillIds: string[];
    worktreeIsolation?: boolean;
    parentTaskId?: string | null;
}

/**
 * Build the Prisma create-data for a Task row in its initial `dispatching`
 * state, including the ordered skillBindings. The caller runs the actual
 * `tx.task.create` inside its own transaction.
 */
export function buildTaskCreateData(
    input: BuildTaskCreateDataInput,
): Prisma.TaskUncheckedCreateInput {
    return {
        accountId: input.accountId,
        projectId: input.projectId,
        machineId: input.machineId,
        prompt: input.prompt,
        priority: input.priority,
        maxAttempts: input.maxAttempts,
        triggerType: input.triggerType,
        triggerRef: input.triggerRef ?? null,
        status: "dispatching",
        profileId: input.profileId,
        ...(input.directory !== undefined ? { directory: input.directory } : {}),
        worktreeIsolation: input.worktreeIsolation ?? false,
        parentTaskId: input.parentTaskId ?? null,
        ...(input.skillIds.length > 0
            ? {
                  skillBindings: {
                      create: input.skillIds.map((sid, idx) => ({ skillId: sid, order: idx })),
                  },
              }
            : {}),
    };
}

// ============================================================================
// Dispatch
// ============================================================================

export interface DispatchTaskTriggerInput {
    taskId: string;
    machineId: string;
    prompt: string;
    directory: string;
    priority: string;
    projectId: string | null;
    skillContents?: Array<{ name: string; content: string; model?: string }>;
    profileId?: string;
    runtimeProfile?: ResolvedRuntimeProfile;
    resultToken?: string;
    worktreeIsolation?: boolean;
    /** App model-mode KEY (e.g. "opus-4-8-1m") — drives 1M capability in the CLI. */
    modelMode?: string | null;
    /**
     * Raw model id override (e.g. from a skill's front-matter `model`). Takes
     * effect for the run when set; null/omitted keeps the CLI default.
     */
    modelOverride?: string | null;
    /** Reasoning effort for the first turn (low|medium|high|xhigh|max). */
    effort?: string | null;
}

/**
 * Dispatch the created Task to its Machine's CLI daemon via the `task-trigger`
 * ephemeral. Must run AFTER the creating transaction commits.
 */
export async function dispatchTaskTrigger(
    accountId: string,
    input: DispatchTaskTriggerInput,
): Promise<void> {
    await emitSyncEphemeral(accountId, {
        t: "task-trigger",
        machineId: input.machineId,
        taskId: input.taskId,
        prompt: input.prompt,
        directory: input.directory,
        priority: input.priority,
        projectId: input.projectId ?? undefined,
        resultToken: input.resultToken,
        skillContents: input.skillContents,
        profileId: input.profileId,
        runtimeProfile: input.runtimeProfile,
        modelMode: input.modelMode ?? undefined,
        // Prefer an explicit override; otherwise route from a skill's front-matter.
        modelOverride:
            input.modelOverride ?? deriveSkillModelOverride(input.skillContents) ?? undefined,
        effort: input.effort ?? undefined,
        worktreeIsolation: input.worktreeIsolation || undefined,
    });
}
