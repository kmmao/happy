import { log } from "@/utils/log";
import { regenerateProfile } from "./knowledgeProfileGenerator";

const TRIGGER_THRESHOLD = 10;

// In-memory counter per project — resets on server restart, which is fine
// (worst case: profile regenerates slightly more or less often)
const addCounters = new Map<string, number>();

/**
 * Track new knowledge entry creation and auto-trigger profile regeneration
 * every TRIGGER_THRESHOLD entries. Fire-and-forget, no error propagation.
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
}
