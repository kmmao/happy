/**
 * Pure formatting helpers for the machine-page Automation summary section.
 * Extracted from AutomationSummarySection.tsx so the presentation logic can
 * be unit-tested without rendering the React tree (i18n keys are looked up
 * through the same `t()` callable used at render time, so tests assert the
 * returned string identity rather than English copy).
 *
 * None of these helpers touch storage, sync, or the daemon — they take fully
 * formed inputs and return strings/colours suitable for display.
 */

import { t } from "@/text";

/** Subset of the on-wire automation job shape that the helpers actually read. */
export type AutomationJobLike = {
    id: string;
    dedupeKey: string;
    status: string;
    updatedAt: number;
    nextRunAt?: number;
    sessionId?: string;
    errorMessage?: string;
    label?: string;
    projectId?: string;
    loopId?: string;
    loopIteration?: number;
    continuityKey?: string;
    recovered?: boolean;
};

/**
 * Shorten an agent-loop continuity key for display. Keeps the visual prefix
 * recognisable (`agent-loop:`) and trims the random suffix to 8 chars so it
 * fits in a single row of the summary card.
 */
export function truncateGuardianKey(key: string): string {
    const prefix = "agent-loop:";
    if (key.startsWith(prefix)) {
        return `${prefix}${key.slice(prefix.length, prefix.length + 8)}`;
    }
    return key;
}

/** Map an automation job status to a localized label. */
export function getStatusLabel(status: string): string {
    switch (status) {
        case "queued":
            return t("machine.automationQueued");
        case "dispatching":
        case "running":
            return t("machine.automationRunning");
        case "completed":
            return t("machine.automationCompleted");
        case "failed":
            return t("machine.automationFailed");
        case "cancelled":
            return t("machine.automationCancelled");
        default:
            return status;
    }
}

/**
 * Map an automation job status to the accent color used in summary chips and
 * detail rows. Returns undefined when the status is unknown so callers can
 * fall back to a neutral theme color.
 */
export function getStatusColor(status: string): string | undefined {
    switch (status) {
        case "queued":
            return "#FF9500";
        case "dispatching":
        case "running":
            return "#0A84FF";
        case "completed":
            return "#34C759";
        case "failed":
            return "#FF3B30";
        case "cancelled":
            return "#8E8E93";
        default:
            return undefined;
    }
}

/** Prefer a human label when present; fall back to the dedup key. */
export function getJobTitle(job: AutomationJobLike): string {
    return job.label || job.dedupeKey;
}

/**
 * Compose the subtitle line for an automation job. Order of precedence:
 *   1. error message wins outright (it's the most actionable information)
 *   2. otherwise assemble " • "-joined stanzas for whatever optional fields
 *      are present (loop iteration → continuity key → session → next run →
 *      recovered flag)
 *   3. if no stanza fires, show the updatedAt timestamp
 */
export function getJobSubtitle(job: AutomationJobLike): string {
    if (job.errorMessage) {
        return job.errorMessage;
    }

    const parts: string[] = [];
    if (job.loopIteration != null) {
        parts.push(
            t("supervisor.loopIterationUnlimited", {
                current: job.loopIteration,
            }),
        );
    }
    if (job.continuityKey) {
        const shortKey = job.continuityKey.startsWith("agent-loop:")
            ? job.continuityKey.slice(0, "agent-loop:".length + 8)
            : job.continuityKey;
        parts.push(`${t("machine.automationContinuity")}: ${shortKey}`);
    }
    if (job.sessionId) {
        parts.push(`${t("machine.automationSession")}: ${job.sessionId.slice(0, 12)}…`);
    }
    if (job.nextRunAt) {
        parts.push(`${t("machine.automationNextRunAt")}: ${new Date(job.nextRunAt).toLocaleString()}`);
    }
    if (job.recovered) {
        parts.push(t("machine.automationRecoveredShort"));
    }
    if (parts.length === 0) {
        parts.push(new Date(job.updatedAt).toLocaleString());
    }
    return parts.join(" • ");
}

/**
 * Localized label for a guardian's state. Recovered + attached is its own
 * label (the guardian was rebound to a live session after a daemon restart);
 * everything else collapses to attached vs persisted.
 */
export function getGuardianStateLabel(attached?: boolean, recovered?: boolean): string {
    if (attached && recovered) {
        return t("machine.automationGuardianRecovered");
    }
    return attached ? t("machine.automationGuardianAttached") : t("machine.automationGuardianPersisted");
}

/**
 * Format a 0..1 rate as a rounded percentage. Treats null/undefined/NaN as
 * 0% so the summary card never blanks out on bad audit data.
 */
export function formatRate(value?: number): string {
    if (value == null || Number.isNaN(value)) {
        return "0%";
    }
    return `${Math.round(value * 100)}%`;
}
