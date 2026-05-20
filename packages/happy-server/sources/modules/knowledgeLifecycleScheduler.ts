import { log } from "@/utils/log";
import { runGlobalDecayArchive } from "./knowledgeDecay";
import { runGlobalMergeJob } from "./knowledgeMergeJob";

// ─── Intervals ───

const DECAY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MERGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── Timer refs ───

let decayTimer: ReturnType<typeof setInterval> | null = null;
let mergeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the knowledge lifecycle scheduler.
 * Call once at server startup.
 *
 * Both timers always run — project-level config filtering
 * happens inside runGlobalDecayArchive/runGlobalMergeJob.
 * Projects with decay/merge disabled are skipped at runtime.
 */
export function startKnowledgeLifecycleScheduler(): void {
    decayTimer = setInterval(async () => {
        const start = Date.now();
        log({ module: "knowledge-lifecycle" }, "decay job started");
        try {
            await runGlobalDecayArchive();
            log({ module: "knowledge-lifecycle" }, `decay job completed in ${Date.now() - start}ms`);
        } catch (err) {
            log({ module: "knowledge-lifecycle" }, `decay job failed after ${Date.now() - start}ms`, err);
        }
    }, DECAY_INTERVAL_MS);

    mergeTimer = setInterval(async () => {
        const start = Date.now();
        log({ module: "knowledge-lifecycle" }, "merge job started");
        try {
            await runGlobalMergeJob();
            log({ module: "knowledge-lifecycle" }, `merge job completed in ${Date.now() - start}ms`);
        } catch (err) {
            log({ module: "knowledge-lifecycle" }, `merge job failed after ${Date.now() - start}ms`, err);
        }
    }, MERGE_INTERVAL_MS);

    log({ module: "knowledge-lifecycle" }, "Lifecycle scheduler started (decay: 1h, merge: 6h — project config controls per-project execution)");
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
