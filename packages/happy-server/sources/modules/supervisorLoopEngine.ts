/**
 * Supervisor Loop Engine — event-driven state machine for autopilot mode.
 *
 * The loop cycles:  analyzing → deciding → fixing → analyzing (next iteration)
 *
 * Each transition is triggered by a Run or Fix completing, NOT by polling.
 * Concurrency safety: optimistic locking via status+phase conditions on updates.
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
    buildSupervisorLoopStatusEphemeral,
} from "@/app/events/eventRouter";
import { computeHealthScore, countSeverities } from "@/modules/supervisorScoring";
import { checkDailyRunLimit, incrementDailyRunCount } from "@/modules/supervisorLimits";
import { auth } from "@/app/auth/auth";
import {
    BUILT_IN_AI_BACKEND_PROFILE_IDS,
    normalizeResolvedRuntimeProfile,
    type ResolvedRuntimeProfile,
} from "@/types/aiBackendProfile";

// ── Types ──

export interface LoopConfig {
    maxIterations: number;
    costCapUsd?: number;
    healthScoreTarget?: number;
    autoApproveThreshold: number;
    maxConsecutiveFailures?: number;
    maxDurationMinutes?: number;
    runtimeProfile?: ResolvedRuntimeProfile;
}

export type LoopExitReason =
    | "max_iterations"
    | "cost_cap"
    | "health_target"
    | "no_new_actions"
    | "consecutive_failures"
    | "user_stopped"
    | "timeout";

interface ExitCheck {
    shouldExit: boolean;
    reason: LoopExitReason | null;
}

const BUILT_IN_PROFILE_ID_SET = BUILT_IN_AI_BACKEND_PROFILE_IDS as ReadonlySet<string>;

function isBuiltInProfileId(profileId: string): boolean {
    return BUILT_IN_PROFILE_ID_SET.has(profileId);
}

function getStoredLoopRuntimeProfile(
    profileId: string | null,
    storedRuntimeProfile: unknown,
): ResolvedRuntimeProfile | undefined {
    return normalizeResolvedRuntimeProfile(storedRuntimeProfile, {
        allowLegacyEnvironmentVariables: true,
        profileId,
        profileName: profileId,
        source:
            profileId && isBuiltInProfileId(profileId)
                ? "built-in-profile"
                : "account-profile",
        trust: "trusted",
        isBuiltIn: profileId ? isBuiltInProfileId(profileId) : undefined,
    });
}

// ── Pure Functions ──

export function checkExitConditions(loop: {
    currentIteration: number;
    maxIterations: number;
    totalCostUsd: number;
    costCapUsd: number | null;
    currentHealthScore: number | null;
    healthScoreTarget: number | null;
    consecutiveFailures: number;
    maxConsecutiveFailures: number;
    createdAt: Date;
    maxDurationMinutes: number;
}): ExitCheck {
    if (loop.maxIterations > 0 && loop.currentIteration >= loop.maxIterations) {
        return { shouldExit: true, reason: "max_iterations" };
    }
    if (loop.costCapUsd !== null && loop.totalCostUsd >= loop.costCapUsd) {
        return { shouldExit: true, reason: "cost_cap" };
    }
    // healthScore: lower = healthier. Exit when score drops below target.
    if (
        loop.healthScoreTarget !== null &&
        loop.currentHealthScore !== null &&
        loop.currentHealthScore <= loop.healthScoreTarget
    ) {
        return { shouldExit: true, reason: "health_target" };
    }
    if (loop.consecutiveFailures >= loop.maxConsecutiveFailures) {
        return { shouldExit: true, reason: "consecutive_failures" };
    }
    // Timeout check
    const elapsedMs = Date.now() - loop.createdAt.getTime();
    if (elapsedMs >= loop.maxDurationMinutes * 60 * 1000) {
        return { shouldExit: true, reason: "timeout" };
    }
    return { shouldExit: false, reason: null };
}

// ── Start Loop ──

export async function startLoop(
    projectId: string,
    accountId: string,
    config: LoopConfig,
): Promise<{ loopId: string } | { error: string; code: number }> {
    // Verify project exists and belongs to user
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: {
            id: true,
            machineId: true,
            path: true,
            supervisorMode: true,
            supervisorEnabledDimensions: true,
            supervisorCustomRules: true,
            supervisorConfig: true,
        },
    });

    if (!project) {
        return { error: "Project not found", code: 404 };
    }

    // Mutual exclusion: no active loop, no active run
    const [activeLoop, activeRun] = await Promise.all([
        db.supervisorLoop.findFirst({
            where: {
                projectId,
                accountId,
                status: { in: ["running", "paused"] },
            },
            select: { id: true },
        }),
        db.supervisorRun.findFirst({
            where: {
                projectId,
                accountId,
                status: { in: ["pending", "running"] },
            },
            select: { id: true },
        }),
    ]);

    if (activeLoop) {
        return { error: "A supervisor loop is already active", code: 409 };
    }
    if (activeRun) {
        return { error: "A supervisor run is already in progress", code: 409 };
    }

    // Daily limit check
    const limitCheck = await checkDailyRunLimit(projectId);
    if (!limitCheck.allowed) {
        return {
            error: `Daily supervisor run limit reached (${limitCheck.currentCount}/${limitCheck.limit})`,
            code: 429,
        };
    }

    // Create loop + first run atomically
    const loop = await db.$transaction(async (tx) => {
        const newLoop = await tx.supervisorLoop.create({
            data: {
                projectId,
                accountId,
                status: "running",
                currentPhase: "analyzing",
                currentIteration: 1,
                maxIterations: config.maxIterations,
                costCapUsd: config.costCapUsd ?? null,
                healthScoreTarget: config.healthScoreTarget ?? null,
                autoApproveThreshold: config.autoApproveThreshold,
                maxConsecutiveFailures: config.maxConsecutiveFailures ?? 2,
                maxDurationMinutes: config.maxDurationMinutes ?? 240,
                profileId: config.runtimeProfile?.profileId ?? null,
                runtimeProfile: config.runtimeProfile ?? undefined,
            },
        });

        const run = await tx.supervisorRun.create({
            data: {
                projectId,
                accountId,
                trigger: "manual",
                status: "pending",
                loopId: newLoop.id,
                loopIteration: 1,
                loopPhase: "analyzing",
            },
        });

        await tx.supervisorLoop.update({
            where: { id: newLoop.id },
            data: { activeRunId: run.id },
        });

        return { ...newLoop, firstRunId: run.id };
    });

    await incrementDailyRunCount(projectId);

    // Emit trigger to CLI daemon
    const dimensions = project.supervisorEnabledDimensions
        ? project.supervisorEnabledDimensions.split(",").map((d) => d.trim()).filter(Boolean)
        : undefined;

    const concurrency = parseConcurrencyConfig(project.supervisorConfig);
    const callbackToken = await auth.createSupervisorCallbackToken({
        userId: accountId,
        projectId,
        machineId: project.machineId,
        purpose: "run-status",
        runId: loop.firstRunId,
    });

    eventRouter.emitEphemeral({
        userId: accountId,
        payload: buildSupervisorTriggerEphemeral({
            projectId,
            runId: loop.firstRunId,
            trigger: "manual",
            machineId: project.machineId,
            repoPath: project.path,
            callbackToken,
            mode: project.supervisorMode ?? undefined,
            dimensions,
            customRules: project.supervisorCustomRules ?? undefined,
            maxConcurrentAnalysis: concurrency.maxAnalysis,
            maxConcurrentFix: concurrency.maxFix,
            maxFindings: concurrency.maxFindings,
            runtimeProfile: config.runtimeProfile,
        }),
        recipientFilter: {
            type: "machine-scoped-only",
            machineId: project.machineId,
        },
    });

    // Broadcast loop status to App
    emitLoopStatus(accountId, loop);

    log(
        { module: "supervisor" },
        `Loop ${loop.id} started for project ${projectId} (maxIterations=${config.maxIterations})`,
    );

    return { loopId: loop.id };
}

// ── Run Completed → Decide Next Step ──

export async function onRunCompleted(
    userId: string,
    runId: string,
    projectId: string,
): Promise<void> {
    // Find the run and its loop
    const run = await db.supervisorRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            loopId: true,
            loopPhase: true,
            status: true,
            healthScore: true,
            costUsd: true,
            tokenCount: true,
            actionsCount: true,
        },
    });

    if (!run?.loopId) return; // Not part of a loop

    const loop = await db.supervisorLoop.findUnique({
        where: { id: run.loopId },
    });

    if (!loop || loop.status !== "running") return;

    // Accumulate cost/tokens
    const costDelta = run.costUsd ?? 0;
    const tokenDelta = run.tokenCount ?? 0;

    await db.supervisorLoop.update({
        where: { id: loop.id },
        data: {
            totalCostUsd: { increment: costDelta },
            totalTokens: { increment: tokenDelta },
            currentHealthScore: run.healthScore ?? loop.currentHealthScore,
            ...(loop.initialHealthScore === null && run.healthScore !== null
                ? { initialHealthScore: run.healthScore }
                : {}),
        },
    });

    // Re-fetch with updated values
    const updatedLoop = await db.supervisorLoop.findUnique({
        where: { id: loop.id },
    });
    if (!updatedLoop) return;

    if (run.status === "failed") {
        await handleRunFailed(userId, updatedLoop);
        return;
    }

    // Run completed successfully — decide what to do next
    await decideNextStep(userId, projectId, updatedLoop);
}

// ── Fix Completed → Check if All Fixes Done ──

export async function onFixCompleted(
    userId: string,
    actionId: string,
    projectId: string,
    fixStatus: "completed" | "failed" | "analyzed",
): Promise<void> {
    // Find the action and its run's loop
    const action = await db.supervisorAction.findUnique({
        where: { id: actionId },
        select: { id: true, runId: true },
    });
    if (!action) return;

    const run = await db.supervisorRun.findUnique({
        where: { id: action.runId },
        select: { loopId: true },
    });
    if (!run?.loopId) return;

    const loop = await db.supervisorLoop.findUnique({
        where: { id: run.loopId },
    });
    if (!loop || loop.status !== "running" || loop.currentPhase !== "fixing") return;

    // Track fix result
    if (fixStatus === "completed") {
        await db.supervisorLoop.update({
            where: { id: loop.id },
            data: {
                totalActionsFixed: { increment: 1 },
                consecutiveFailures: 0,
            },
        });
    } else {
        await db.supervisorLoop.update({
            where: { id: loop.id },
            data: {
                consecutiveFailures: { increment: 1 },
            },
        });
    }

    // Check if all loop-triggered fixes are done (no more running/pending)
    const pendingFixes = await db.supervisorAction.count({
        where: {
            projectId,
            accountId: userId,
            approval: "approved",
            fixStatus: { in: ["pending", "running"] },
            run: { loopId: loop.id },
        },
    });

    if (pendingFixes > 0) return; // Still waiting for other fixes

    // All fixes done — re-fetch loop and check exit conditions
    const updatedLoop = await db.supervisorLoop.findUnique({
        where: { id: loop.id },
    });
    if (!updatedLoop || updatedLoop.status !== "running") return;

    const exitCheck = checkExitConditions(updatedLoop);
    if (exitCheck.shouldExit) {
        await completeLoop(userId, updatedLoop, exitCheck.reason!);
        return;
    }

    // Not done yet — start next iteration (analysis)
    await triggerNextAnalysis(userId, projectId, updatedLoop);
}

// ── Pause / Resume / Stop ──

export async function pauseLoop(
    loopId: string,
    userId: string,
): Promise<{ success: boolean }> {
    const result = await db.supervisorLoop.updateMany({
        where: {
            id: loopId,
            accountId: userId,
            status: "running",
        },
        data: {
            status: "paused",
        },
    });

    if (result.count === 0) return { success: false };

    const loop = await db.supervisorLoop.findUnique({ where: { id: loopId } });
    if (loop) emitLoopStatus(userId, loop);

    log({ module: "supervisor" }, `Loop ${loopId} paused`);
    return { success: true };
}

export async function resumeLoop(
    loopId: string,
    userId: string,
): Promise<{ success: boolean }> {
    const loop = await db.supervisorLoop.findFirst({
        where: {
            id: loopId,
            accountId: userId,
            status: "paused",
        },
    });

    if (!loop) return { success: false };

    // Optimistic lock: only resume if still paused
    const result = await db.supervisorLoop.updateMany({
        where: { id: loopId, status: "paused" },
        data: { status: "running" },
    });

    if (result.count === 0) return { success: false };

    // Re-fetch and decide next step based on current phase
    const updated = await db.supervisorLoop.findUnique({ where: { id: loopId } });
    if (!updated) return { success: false };

    emitLoopStatus(userId, updated);

    // If the loop was paused while a run/fix was in progress, it will
    // naturally resume when that run/fix completes (the handler checks for "running" status).
    // If the loop was paused in "deciding" phase (between steps), trigger next step now.
    if (updated.currentPhase === "deciding" || updated.currentPhase === "idle") {
        await decideNextStep(userId, updated.projectId, updated);
    }

    log({ module: "supervisor" }, `Loop ${loopId} resumed`);
    return { success: true };
}

export async function stopLoop(
    loopId: string,
    userId: string,
): Promise<{ success: boolean }> {
    const result = await db.supervisorLoop.updateMany({
        where: {
            id: loopId,
            accountId: userId,
            status: { in: ["running", "paused"] },
        },
        data: {
            status: "stopped",
            exitReason: "user_stopped",
            completedAt: new Date(),
        },
    });

    if (result.count === 0) return { success: false };

    const loop = await db.supervisorLoop.findUnique({ where: { id: loopId } });
    if (loop) emitLoopStatus(userId, loop);

    log({ module: "supervisor" }, `Loop ${loopId} stopped by user`);
    return { success: true };
}

// ── Internal Helpers ──

async function decideNextStep(
    userId: string,
    projectId: string,
    loop: NonNullable<Awaited<ReturnType<typeof db.supervisorLoop.findUnique>>>,
): Promise<void> {
    // Find actions eligible for auto-approval BEFORE checking exit conditions.
    // This ensures the last iteration's findings get processed even if we've
    // reached max_iterations — exit happens after fixing, not after analysis.
    const approvableActions = await db.supervisorAction.findMany({
        where: {
            projectId,
            accountId: userId,
            approval: "pending",
            confidence: { gte: loop.autoApproveThreshold },
            suggestedFix: { not: null },
        },
        select: {
            id: true,
            title: true,
            description: true,
            suggestedFix: true,
            category: true,
            severity: true,
            confidence: true,
        },
        orderBy: [
            { severity: "asc" }, // critical first
            { confidence: "desc" },
        ],
        take: 5, // Process up to 5 fixes per iteration
    });

    if (approvableActions.length === 0) {
        // Nothing to fix — check exit conditions and complete
        const exitCheck = checkExitConditions(loop);
        await completeLoop(userId, loop, exitCheck.shouldExit ? exitCheck.reason! : "no_new_actions");
        return;
    }

    // Check exit conditions — but only for non-iteration limits.
    // Even if max_iterations is reached, we still process the last batch of
    // findings before stopping. The exit will happen after these fixes complete
    // (in onFixCompleted → checkExitConditions).
    const exitCheck = checkExitConditions(loop);
    if (exitCheck.shouldExit && exitCheck.reason !== "max_iterations") {
        await completeLoop(userId, loop, exitCheck.reason!);
        return;
    }

    // Update loop metrics
    await db.supervisorLoop.updateMany({
        where: { id: loop.id, status: "running" },
        data: {
            currentPhase: "fixing",
            totalActionsFound: { increment: approvableActions.length },
        },
    });

    // Auto-approve and trigger fixes
    await db.supervisorAction.updateMany({
        where: {
            id: { in: approvableActions.map((a) => a.id) },
            approval: "pending",
        },
        data: {
            approval: "approved",
            fixStatus: "pending",
        },
    });

    // Fetch project for trigger data
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: {
            machineId: true,
            path: true,
            fixStrategy: true,
            supervisorConfig: true,
        },
    });

    if (!project) return;

    const concurrency = parseConcurrencyConfig(project.supervisorConfig);

    // Trigger fix for each approved action
    for (const action of approvableActions) {
        const runtimeProfile = getStoredLoopRuntimeProfile(
            loop.profileId ?? null,
            loop.runtimeProfile,
        );
        const callbackToken = await auth.createSupervisorCallbackToken({
            userId,
            projectId,
            machineId: project.machineId,
            purpose: "fix-status",
            actionId: action.id,
        });
        eventRouter.emitEphemeral({
            userId,
            payload: buildSupervisorTriggerEphemeral({
                projectId,
                runId: action.id,
                trigger: "fix",
                machineId: project.machineId,
                repoPath: project.path,
                callbackToken,
                mode: "auto",
                fixAction: {
                    title: action.title,
                    description: action.description,
                    suggestedFix: action.suggestedFix,
                    category: action.category,
                    severity: action.severity,
                },
                fixStrategy: "direct", // Loop always uses direct strategy
                maxConcurrentAnalysis: concurrency.maxAnalysis,
                maxConcurrentFix: concurrency.maxFix,
                runtimeProfile,
            }),
            recipientFilter: {
                type: "machine-scoped-only",
                machineId: project.machineId,
            },
        });
    }

    const updatedLoop = await db.supervisorLoop.findUnique({ where: { id: loop.id } });
    if (updatedLoop) emitLoopStatus(userId, updatedLoop);

    log(
        { module: "supervisor" },
        `Loop ${loop.id}: iteration ${loop.currentIteration} — triggered ${approvableActions.length} fixes`,
    );

    // Schedule a stale-fix watchdog: if fix sessions complete without reporting
    // back (e.g. Claude didn't execute the curl callback), the loop would hang
    // forever. After 15 minutes, check for orphaned "running" fixes whose
    // sessions are no longer active and force-complete them.
    scheduleFixWatchdog(userId, projectId, loop.id, approvableActions.map((a) => a.id));
}

async function triggerNextAnalysis(
    userId: string,
    projectId: string,
    loop: NonNullable<Awaited<ReturnType<typeof db.supervisorLoop.findUnique>>>,
): Promise<void> {
    const nextIteration = loop.currentIteration + 1;

    // Daily limit check
    const limitCheck = await checkDailyRunLimit(projectId);
    if (!limitCheck.allowed) {
        await completeLoop(userId, loop, "max_iterations");
        return;
    }

    // Create next analysis run
    const run = await db.supervisorRun.create({
        data: {
            projectId,
            accountId: userId,
            trigger: "manual",
            status: "pending",
            loopId: loop.id,
            loopIteration: nextIteration,
            loopPhase: "analyzing",
        },
    });

    await db.supervisorLoop.updateMany({
        where: { id: loop.id, status: "running" },
        data: {
            currentPhase: "analyzing",
            currentIteration: nextIteration,
            activeRunId: run.id,
        },
    });

    await incrementDailyRunCount(projectId);

    // Fetch project for trigger data
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: {
            machineId: true,
            path: true,
            supervisorMode: true,
            supervisorEnabledDimensions: true,
            supervisorCustomRules: true,
            supervisorConfig: true,
        },
    });

    if (!project) return;

    const dimensions = project.supervisorEnabledDimensions
        ? project.supervisorEnabledDimensions.split(",").map((d) => d.trim()).filter(Boolean)
        : undefined;

    const concurrency = parseConcurrencyConfig(project.supervisorConfig);

    // Query existing actions for dedup prompt
    const existingActions = await db.supervisorAction.findMany({
        where: {
            projectId,
            accountId: userId,
            approval: { in: ["pending", "approved", "skipped", "ignored"] },
        },
        select: { category: true, title: true, severity: true, approval: true, fixStatus: true },
        take: 100,
        orderBy: { createdAt: "desc" },
    });

    const callbackToken = await auth.createSupervisorCallbackToken({
        userId,
        projectId,
        machineId: project.machineId,
        purpose: "run-status",
        runId: run.id,
    });

    eventRouter.emitEphemeral({
        userId,
        payload: buildSupervisorTriggerEphemeral({
            projectId,
            runId: run.id,
            trigger: "manual",
            machineId: project.machineId,
            repoPath: project.path,
            callbackToken,
            mode: project.supervisorMode ?? undefined,
            dimensions,
            customRules: project.supervisorCustomRules ?? undefined,
            existingActions,
            maxConcurrentAnalysis: concurrency.maxAnalysis,
            maxConcurrentFix: concurrency.maxFix,
            runtimeProfile: getStoredLoopRuntimeProfile(
                loop.profileId ?? null,
                loop.runtimeProfile,
            ),
        }),
        recipientFilter: {
            type: "machine-scoped-only",
            machineId: project.machineId,
        },
    });

    const updatedLoop = await db.supervisorLoop.findUnique({ where: { id: loop.id } });
    if (updatedLoop) emitLoopStatus(userId, updatedLoop);

    log(
        { module: "supervisor" },
        `Loop ${loop.id}: starting iteration ${nextIteration} analysis`,
    );
}

async function handleRunFailed(
    userId: string,
    loop: NonNullable<Awaited<ReturnType<typeof db.supervisorLoop.findUnique>>>,
): Promise<void> {
    const updated = await db.supervisorLoop.update({
        where: { id: loop.id },
        data: {
            consecutiveFailures: { increment: 1 },
        },
    });

    const exitCheck = checkExitConditions(updated);
    if (exitCheck.shouldExit) {
        await completeLoop(userId, updated, exitCheck.reason!);
        return;
    }

    // Try next iteration despite failure
    await triggerNextAnalysis(userId, loop.projectId, updated);
}

async function completeLoop(
    userId: string,
    loop: { id: string; projectId: string },
    reason: LoopExitReason,
): Promise<void> {
    await db.supervisorLoop.updateMany({
        where: {
            id: loop.id,
            status: { in: ["running", "paused"] },
        },
        data: {
            status: "completed",
            currentPhase: "idle",
            exitReason: reason,
            completedAt: new Date(),
            activeRunId: null,
        },
    });

    const updated = await db.supervisorLoop.findUnique({ where: { id: loop.id } });
    if (updated) emitLoopStatus(userId, updated);

    log(
        { module: "supervisor" },
        `Loop ${loop.id} completed: ${reason}`,
    );
}

function emitLoopStatus(
    userId: string,
    loop: {
        id: string;
        projectId: string;
        status: string;
        currentIteration: number;
        maxIterations: number;
        currentPhase: string;
        totalCostUsd: number;
        totalActionsFound: number;
        totalActionsFixed: number;
        currentHealthScore: number | null;
        initialHealthScore: number | null;
        exitReason: string | null;
        consecutiveFailures: number;
    },
): void {
    eventRouter.emitEphemeral({
        userId,
        payload: buildSupervisorLoopStatusEphemeral({
            loopId: loop.id,
            projectId: loop.projectId,
            status: loop.status,
            currentIteration: loop.currentIteration,
            maxIterations: loop.maxIterations,
            currentPhase: loop.currentPhase,
            totalCostUsd: loop.totalCostUsd,
            totalActionsFound: loop.totalActionsFound,
            totalActionsFixed: loop.totalActionsFixed,
            currentHealthScore: loop.currentHealthScore,
            initialHealthScore: loop.initialHealthScore,
            exitReason: loop.exitReason,
            consecutiveFailures: loop.consecutiveFailures,
        }),
        recipientFilter: { type: "user-scoped-only" },
    });
}

function parseConcurrencyConfig(configJson: string | null | undefined): {
    maxAnalysis: number | undefined;
    maxFix: number | undefined;
    maxFindings: number | undefined;
} {
    if (!configJson) return { maxAnalysis: undefined, maxFix: undefined, maxFindings: undefined };
    try {
        const config = JSON.parse(configJson);
        const c = config?.concurrency;
        const maxFindings = typeof config?.maxFindings === "number" ? config.maxFindings : undefined;
        if (!c || typeof c !== "object") return { maxAnalysis: undefined, maxFix: undefined, maxFindings };
        return {
            maxAnalysis: typeof c.maxAnalysisSessions === "number" ? c.maxAnalysisSessions : undefined,
            maxFix: typeof c.maxFixSessions === "number" ? c.maxFixSessions : undefined,
            maxFindings,
        };
    } catch {
        return { maxAnalysis: undefined, maxFix: undefined, maxFindings: undefined };
    }
}

/**
 * Watchdog for stale fix sessions within a loop.
 *
 * Fix sessions may complete without reporting back (e.g. Claude didn't execute
 * the curl callback). After FIX_WATCHDOG_DELAY_MS, check if any of the
 * triggered actions still have fixStatus="running" but their session is no
 * longer active. Force-complete them and trigger loop progression.
 */
const FIX_WATCHDOG_DELAY_MS = 15 * 60_000; // 15 minutes

function scheduleFixWatchdog(
    userId: string,
    projectId: string,
    loopId: string,
    actionIds: readonly string[],
): void {
    setTimeout(async () => {
        try {
            // Only act if loop is still running and in fixing phase
            const loop = await db.supervisorLoop.findUnique({
                where: { id: loopId },
                select: { status: true, currentPhase: true },
            });
            if (!loop || loop.status !== "running" || loop.currentPhase !== "fixing") return;

            // Find actions that are still "running" but whose session is inactive
            const staleActions = await db.supervisorAction.findMany({
                where: {
                    id: { in: [...actionIds] },
                    fixStatus: "running",
                    approval: "approved",
                },
                select: { id: true, fixSessionId: true, title: true },
            });

            if (staleActions.length === 0) return;

            // Batch-fetch all related sessions in one query (avoids N+1)
            const sessionIds = [
                ...new Set(staleActions.map((a) => a.fixSessionId).filter(Boolean) as string[]),
            ];
            const activeSessions = sessionIds.length > 0
                ? await db.session.findMany({
                    where: { id: { in: sessionIds }, active: true },
                    select: { id: true },
                })
                : [];
            const activeSessionIds = new Set(activeSessions.map((s) => s.id));

            // Determine which actions are truly stale
            const trueStaleActions = staleActions.filter(
                (a) => !a.fixSessionId || !activeSessionIds.has(a.fixSessionId),
            );

            if (trueStaleActions.length === 0) return;

            // Batch-update all stale actions in one query
            const staleActionIds = trueStaleActions.map((a) => a.id);
            await db.supervisorAction.updateMany({
                where: { id: { in: staleActionIds } },
                data: { fixStatus: "failed" },
            });

            // Log and trigger loop progression for each stale action
            for (const action of trueStaleActions) {
                log(
                    { module: "supervisor", level: "warn" },
                    `Fix watchdog: force-failed stale action ${action.id} ("${action.title}") — session inactive but fixStatus was still "running"`,
                );

                // Trigger loop progression
                await onFixCompleted(userId, action.id, projectId, "failed");
            }
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `Fix watchdog error for loop ${loopId}: ${error}`,
            );
        }
    }, FIX_WATCHDOG_DELAY_MS);
}
