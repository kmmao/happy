import { log } from "@/utils/log";
import { expireDecisions } from "./decisionExpiry";

const DECISION_EXPIRY_INTERVAL_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startDecisionExpiryScheduler(): void {
    timer = setInterval(() => {
        void expireDecisions();
    }, DECISION_EXPIRY_INTERVAL_MS);
    timer.unref();
    log({ module: "decision-expiry" }, "Decision expiry scheduler started (interval: 60s)");
}

export function stopDecisionExpiryScheduler(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    log({ module: "decision-expiry" }, "Decision expiry scheduler stopped");
}
