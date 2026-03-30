import { log } from "@/utils/log";
import { regenerateProfile } from "./knowledgeProfileGenerator";
import { runMergeJob } from "./knowledgeMergeJob";

const TRIGGER_THRESHOLD = 10;
const MERGE_TRIGGER_THRESHOLD = parseInt(process.env.KNOWLEDGE_MERGE_TRIGGER_COUNT ?? "20", 10);
const MERGE_ENABLED = process.env.KNOWLEDGE_MERGE === "true";

// In-memory counters per project — reset on server restart, which is fine
// (worst case: profile/merge triggers slightly more or less often)
const addCounters = new Map<string, number>();
const mergeCounters = new Map<string, number>();

/**
 * Track new knowledge entry creation and auto-trigger:
 * 1. Profile regeneration every TRIGGER_THRESHOLD entries
 * 2. Merge job every MERGE_TRIGGER_THRESHOLD entries (if enabled)
 *
 * Fire-and-forget, no error propagation.
 */
export function trackKnowledgeCreation(projectId: string): void {
    const count = (addCounters.get(projectId) ?? 0) + 1;
    addCounters.set(projectId, count);

    if (count >= TRIGGER_THRESHOLD) {
        addCounters.set(projectId, 0);
        log({ module: "knowledge-auto-profile" }, `Auto-regenerating profile for project ${projectId} (${TRIGGER_THRESHOLD} new entries)`);
        void regenerateProfile(projectId).catch((err) => {
            log({ module: "knowledge-auto-profile" }, `Auto-regeneration failed for ${projectId}: ${err}`);
        });
    }

    // Merge trigger (separate counter, higher threshold)
    if (MERGE_ENABLED) {
        const mergeCount = (mergeCounters.get(projectId) ?? 0) + 1;
        mergeCounters.set(projectId, mergeCount);

        if (mergeCount >= MERGE_TRIGGER_THRESHOLD) {
            mergeCounters.set(projectId, 0);
            log({ module: "knowledge-auto-merge" }, `Auto-triggering merge for project ${projectId} (${MERGE_TRIGGER_THRESHOLD} new entries)`);
            void runMergeJob(projectId).catch((err) => {
                log({ module: "knowledge-auto-merge" }, `Auto-merge failed for ${projectId}: ${err}`);
            });
        }
    }
}
