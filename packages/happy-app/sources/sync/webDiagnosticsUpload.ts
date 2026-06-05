/**
 * Web-only: one-shot upload of the previous run's diagnostic trails to
 * happy-server on app startup.
 *
 * Inputs (all in localStorage, populated by other modules):
 *   - happy:memwatch:last   — the previous run's heap-usage samples,
 *                              copied from RING_KEY by startMemoryWatchdog()
 *                              right before it resets the current ring.
 *   - happy:crash:v1        — ring buffer of WebErrorBoundary records;
 *                              not partitioned by run, so we filter by ts.
 *
 * Outputs (also in localStorage, owned by this module):
 *   - happy:webdiag:lastReportedCrashTs   — latest crash.t we've uploaded;
 *                                           next run only sends newer ones.
 *   - happy:webdiag:lastReportedMemwatchTs — last sample.t we've uploaded;
 *                                            avoids re-sending the same
 *                                            LAST_KEY snapshot twice if the
 *                                            user reloads without crashing.
 *
 * Design: fire-and-forget. No await on the caller's path. Failures only
 * log.warn and never block startup. Auth is read synchronously via
 * getCurrentAuth(); if not yet ready we retry a couple of times with a
 * short delay before giving up.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import { log } from "@/log";
import { getCurrentAuth } from "@/auth/AuthContext";
import { getServerUrl } from "@/sync/serverConfig";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";

const MEMWATCH_LAST_KEY = "happy:memwatch:last";
const CRASH_KEY = "happy:crash:v1";
const LAST_REPORTED_CRASH_TS_KEY = "happy:webdiag:lastReportedCrashTs";
const LAST_REPORTED_MEMWATCH_TS_KEY = "happy:webdiag:lastReportedMemwatchTs";

const MAX_MEMWATCH_SAMPLES = 80; // matches RING_CAPACITY in memoryWatchdog.ts
const MAX_CRASH_RECORDS = 10; // matches CRASH_CAP in WebErrorBoundary.tsx

const AUTH_WAIT_INITIAL_DELAY_MS = 3_000; // give the second useEffect time to restore credentials
const AUTH_WAIT_RETRY_DELAY_MS = 1_500;
const AUTH_WAIT_MAX_RETRIES = 2;

interface MemwatchSample {
    t: number;
    used: number;
    limit: number;
    ratio: number;
    sessions: number;
    msgs: number;
    topId: string;
    topMsgs: number;
    contentMB?: number;
    maxMsgKB?: number;
    maxMsgKind?: string;
}

interface CrashRecord {
    t: number;
    kind: "render" | "error" | "unhandledrejection";
    message: string;
    stack?: string;
}

interface UploadOptions {
    // Force=true skips the lastReported* timestamp filters and re-sends
    // everything currently in localStorage. Used by the manual console
    // trigger so the dev can verify the round trip on demand.
    force?: boolean;
}

function readJsonArray<T>(key: string): T[] {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
        return [];
    }
}

function readNumber(key: string): number {
    try {
        const raw = window.localStorage.getItem(key);
        const n = raw ? parseInt(raw, 10) : 0;
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

function writeNumber(key: string, value: number): void {
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        // localStorage full / disabled — diagnostics are best-effort
    }
}

function getAppVersion(): string {
    return Constants.expoConfig?.version ?? "unknown";
}

function getUserAgent(): string | undefined {
    if (typeof navigator === "undefined") return undefined;
    return navigator.userAgent?.slice(0, 1_000);
}

async function postTrail(
    token: string,
    body: {
        appVersion: string;
        platform: string;
        userAgent?: string;
        memwatchTrail: MemwatchSample[];
        crashRecords: CrashRecord[];
    },
): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/web-diagnostics/trail`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        throwIfNotOk(response, "Failed to upload web-diagnostics trail");
        const data = (await response.json()) as { success?: boolean };
        if (!data.success) {
            throw new Error("web-diagnostics upload: server returned non-success");
        }
    });
}

async function waitForAuthToken(): Promise<string | null> {
    for (let attempt = 0; attempt <= AUTH_WAIT_MAX_RETRIES; attempt++) {
        const delay = attempt === 0 ? AUTH_WAIT_INITIAL_DELAY_MS : AUTH_WAIT_RETRY_DELAY_MS;
        await new Promise((resolve) => setTimeout(resolve, delay));
        const token = getCurrentAuth()?.credentials?.token;
        if (token) return token;
    }
    return null;
}

/**
 * Upload the previous run's memwatch trail and any new crash records.
 * Safe to call multiple times — second call is a no-op while the first
 * is in flight.
 */
let inFlight = false;
export async function uploadWebDiagnosticsOnce(options: UploadOptions = {}): Promise<void> {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    if (inFlight) return;
    inFlight = true;

    try {
        const force = options.force === true;

        // Read inputs first so we can early-exit before waiting on auth.
        const memwatchTrail = readJsonArray<MemwatchSample>(MEMWATCH_LAST_KEY)
            .slice(-MAX_MEMWATCH_SAMPLES);
        const allCrashes = readJsonArray<CrashRecord>(CRASH_KEY);

        const lastCrashTs = force ? 0 : readNumber(LAST_REPORTED_CRASH_TS_KEY);
        const lastMemwatchTs = force ? 0 : readNumber(LAST_REPORTED_MEMWATCH_TS_KEY);

        const crashRecords = allCrashes
            .filter((c) => c.t > lastCrashTs)
            .slice(-MAX_CRASH_RECORDS);

        const memwatchLatestTs = memwatchTrail.length > 0
            ? memwatchTrail[memwatchTrail.length - 1].t
            : 0;
        const memwatchIsNew = memwatchTrail.length > 0 && memwatchLatestTs > lastMemwatchTs;

        if (crashRecords.length === 0 && !memwatchIsNew) {
            // Nothing to send.
            return;
        }

        const token = await waitForAuthToken();
        if (!token) {
            log.warn("[web-diag] no auth token after wait — skipping upload");
            return;
        }

        await postTrail(token, {
            appVersion: getAppVersion(),
            platform: Platform.OS,
            userAgent: getUserAgent(),
            memwatchTrail: memwatchIsNew ? memwatchTrail : [],
            crashRecords,
        });

        // Mark as reported only after a successful round trip.
        if (memwatchIsNew) writeNumber(LAST_REPORTED_MEMWATCH_TS_KEY, memwatchLatestTs);
        if (crashRecords.length > 0) {
            const latestCrashTs = crashRecords[crashRecords.length - 1].t;
            writeNumber(LAST_REPORTED_CRASH_TS_KEY, latestCrashTs);
        }

        log.log(
            `[web-diag] uploaded ${memwatchIsNew ? memwatchTrail.length : 0} memwatch samples, ${crashRecords.length} crash records`,
        );
    } catch (error) {
        log.warn(`[web-diag] upload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        inFlight = false;
    }
}

/**
 * Mount the console trigger so the dev can force-send the current state of
 * localStorage trails on demand:
 *   window.__happyDiagUpload.trigger()
 * No-op on native.
 */
export function installWebDiagnosticsConsoleHook(): void {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    (window as unknown as { __happyDiagUpload?: unknown }).__happyDiagUpload = {
        trigger: () => uploadWebDiagnosticsOnce({ force: true }),
    };
}
