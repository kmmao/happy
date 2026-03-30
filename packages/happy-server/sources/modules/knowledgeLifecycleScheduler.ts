import { log } from "@/utils/log";
import { runGlobalDecayArchive } from "./knowledgeDecay";
import { runGlobalMergeJob } from "./knowledgeMergeJob";

// ─── Intervals ───

const DECAY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MERGE_INTERVAL_MS = parseInt(process.env.KNOWLEDGE_MERGE_INTERVAL_HOURS ?? "6", 10) * 60 * 60 * 1000;

// ─── Feature flags ───

const DECAY_ENABLED = process.env.KNOWLEDGE_DECAY === "true";
const MERGE_ENABLED = process.env.KNOWLEDGE_MERGE === "true";

// ─── Timer refs ───

let decayTimer: ReturnType<typeof setInterval> | null = null;
let mergeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the knowledge lifecycle scheduler.
 * Call once at server startup. Each Job runs on its own interval.
 * Jobs are gated by environment variable flags (disabled by default).
 */
export function startKnowledgeLifecycleScheduler(): void {
    if (DECAY_ENABLED) {
        decayTimer = setInterval(() => {
            void runGlobalDecayArchive();
        }, DECAY_INTERVAL_MS);
        log({ module: "knowledge-lifecycle" }, "Decay scheduler started (interval: 1h)");
    } else {
        log({ module: "knowledge-lifecycle" }, "Decay scheduler disabled (KNOWLEDGE_DECAY != true)");
    }

    if (MERGE_ENABLED) {
        mergeTimer = setInterval(() => {
            void runGlobalMergeJob();
        }, MERGE_INTERVAL_MS);
        log({ module: "knowledge-lifecycle" }, `Merge scheduler started (interval: ${MERGE_INTERVAL_MS / 3600000}h)`);
    } else {
        log({ module: "knowledge-lifecycle" }, "Merge scheduler disabled (KNOWLEDGE_MERGE != true)");
    }
}

/**
 * Stop the knowledge lifecycle scheduler (graceful shutdown).
 */
export function stopKnowledgeLifecycleScheduler(): void {
    if (decayTimer) {
        clearInterval(decayTimer);
        decayTimer = null;
    }
    if (mergeTimer) {
        clearInterval(mergeTimer);
        mergeTimer = null;
    }
    log({ module: "knowledge-lifecycle" }, "Lifecycle scheduler stopped");
}
