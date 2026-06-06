/**
 * Build a structured summary ("brief") for a completed supervisor-role
 * AgentLoop (formerly: SupervisorLoop). See ADR-0022 for the convergence.
 *
 * The brief is computed from existing DB fields only — exit reason, health
 * score delta, action counts, cost, iteration count. It's emitted as an
 * ephemeral event on loop completion and used by:
 *  - the App's loop detail screen ("Latest Brief" card)
 *  - future push notifications (short summary string)
 *
 * Per ADR-0022, this mirrors AgentLoopBrief on the CLI side. Once the
 * convergence migration completes (Phase 3+), both share a unified storage
 * path. Today the brief is server-computed because supervisor-role state
 * lives on the server; only short structured stats travel. A richer
 * per-iteration narrative belongs in an Artifact, which requires
 * client-side encryption (ADR-0001) and so is deferred until the CLI-side
 * brief generator is wired in.
 */

import type { AgentLoop } from "@prisma/client";

export interface SupervisorLoopBriefSnapshot {
    loopId: string;
    projectId: string;
    status: string;
    exitReason: string | null;
    generatedAt: number;

    // Iteration progress
    currentIteration: number;
    maxIterations: number;

    // Quality metrics
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    healthDelta: number | null;

    // Throughput
    totalActionsFound: number;
    totalActionsFixed: number;
    consecutiveFailures: number;

    // Cost
    totalCostUsd: number;
    costCapUsd: number | null;

    // Short user-facing summary string (~100 chars) suitable for push payloads.
    summary: string;
}

/**
 * Compose a one-line summary suitable for at-a-glance views and push
 * notification bodies. Kept under ~140 chars so APNs/FCM payloads stay clean.
 */
function composeSummary(params: {
    currentIteration: number;
    maxIterations: number;
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    healthDelta: number | null;
    totalActionsFound: number;
    totalActionsFixed: number;
    totalCostUsd: number;
    exitReason: string | null;
}): string {
    const parts: string[] = [];

    if (params.healthDelta != null && params.initialHealthScore != null && params.currentHealthScore != null) {
        const arrow = params.healthDelta < 0 ? "↓" : params.healthDelta > 0 ? "↑" : "→";
        parts.push(`Health ${params.initialHealthScore}${arrow}${params.currentHealthScore}`);
    }

    if (params.totalActionsFixed > 0) {
        parts.push(`fixed ${params.totalActionsFixed}`);
    }

    const pending = params.totalActionsFound - params.totalActionsFixed;
    if (pending > 0) {
        parts.push(`pending ${pending}`);
    }

    if (params.totalCostUsd > 0) {
        parts.push(`$${params.totalCostUsd.toFixed(2)}`);
    }

    const stats = parts.length > 0 ? parts.join(", ") : "no changes";
    const itersLabel = params.maxIterations > 0
        ? `${params.currentIteration}/${params.maxIterations} iters`
        : `${params.currentIteration} iters`;
    const reason = params.exitReason ? ` — ${params.exitReason}` : "";

    return `Loop done (${itersLabel}): ${stats}${reason}`;
}

/**
 * Build a brief snapshot from an AgentLoop row (supervisor-role). Pure
 * function: no DB or encryption I/O. The caller is expected to emit this via
 * the event router (and persist later, once Phase 3 lands a CLI-side
 * encrypted Artifact).
 */
export function buildSupervisorLoopBrief(loop: AgentLoop): SupervisorLoopBriefSnapshot {
    const healthDelta = loop.initialHealthScore != null && loop.currentHealthScore != null
        ? loop.currentHealthScore - loop.initialHealthScore
        : null;

    const summary = composeSummary({
        currentIteration: loop.currentIteration,
        maxIterations: loop.maxIterations,
        initialHealthScore: loop.initialHealthScore,
        currentHealthScore: loop.currentHealthScore,
        healthDelta,
        totalActionsFound: loop.totalActionsFound,
        totalActionsFixed: loop.totalActionsFixed,
        totalCostUsd: loop.totalCostUsd,
        exitReason: loop.exitReason,
    });

    return {
        loopId: loop.id,
        projectId: loop.projectId,
        status: loop.status,
        exitReason: loop.exitReason,
        generatedAt: Date.now(),
        currentIteration: loop.currentIteration,
        maxIterations: loop.maxIterations,
        initialHealthScore: loop.initialHealthScore,
        currentHealthScore: loop.currentHealthScore,
        healthDelta,
        totalActionsFound: loop.totalActionsFound,
        totalActionsFixed: loop.totalActionsFixed,
        consecutiveFailures: loop.consecutiveFailures,
        totalCostUsd: loop.totalCostUsd,
        costCapUsd: loop.costCapUsd,
        summary,
    };
}
