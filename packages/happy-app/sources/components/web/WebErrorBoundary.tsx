import React from "react";
import { Platform } from "react-native";
import { log } from "@/log";

interface State {
    hasError: boolean;
    message: string | null;
}

const CRASH_KEY = "happy:crash:v1";
const CRASH_CAP = 10; // keep the last N crashes; ring-buffered so storage can't grow unbounded
const MESSAGE_CAP = 2_000; // char caps so one giant error can't blow the localStorage quota
const STACK_CAP = 8_000;

interface CrashRecord {
    t: number; // epoch ms
    kind: "render" | "error" | "unhandledrejection";
    message: string;
    stack?: string; // error stack and/or React component stack
}

// Persist a crash to localStorage so it survives the reload that wipes the
// in-memory `log` buffer. Mirrors the memoryWatchdog trail, but for thrown
// errors rather than heap pressure. Best-effort: storage may be full/disabled.
function recordCrash(kind: CrashRecord["kind"], message: string, stack?: string): void {
    if (typeof window === "undefined") return;
    try {
        const raw = window.localStorage.getItem(CRASH_KEY);
        const list: CrashRecord[] = raw ? JSON.parse(raw) : [];
        list.push({
            t: Date.now(),
            kind,
            message: message.slice(0, MESSAGE_CAP),
            stack: stack ? stack.slice(0, STACK_CAP) : undefined,
        });
        if (list.length > CRASH_CAP) list.splice(0, list.length - CRASH_CAP);
        window.localStorage.setItem(CRASH_KEY, JSON.stringify(list));
    } catch {
        // quota exceeded or storage disabled — diagnostics are best-effort
    }
}

// Replay persisted crashes from previous runs into the dev log so they show up
// on /dev/logs after a reload. Records are kept (not cleared) so the history
// stays inspectable; use window.__happyCrash.clear() to reset.
export function surfaceCrashTrail(): void {
    if (typeof window === "undefined") return;
    try {
        const raw = window.localStorage.getItem(CRASH_KEY);
        if (!raw) return;
        const list: CrashRecord[] = JSON.parse(raw);
        if (!Array.isArray(list) || list.length === 0) return;
        log.warn(`[crash] ===== ${list.length} persisted crash record(s) from previous runs =====`);
        for (const c of list) {
            const time = new Date(c.t).toLocaleString();
            log.error(`[crash] ${time} (${c.kind}): ${c.message}`);
            if (c.stack) log.error(`[crash] stack: ${c.stack}`);
        }
        log.warn("[crash] ===== end persisted crash trail (window.__happyCrash.clear() to reset) =====");
    } catch {
        // ignore malformed trail
    }
}

function clearCrashTrail(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(CRASH_KEY);
    } catch {
        // ignore
    }
}

export class WebErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { hasError: false, message: null };

    static getDerivedStateFromError(error: unknown): State {
        return {
            hasError: true,
            message: error instanceof Error ? error.message : String(error),
        };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = [
            error instanceof Error ? error.stack : undefined,
            info.componentStack ?? undefined,
        ]
            .filter(Boolean)
            .join("\n");
        recordCrash("render", message, stack || undefined);
        log.error("WebErrorBoundary caught render error:", error, info.componentStack);
    }

    handleReload = () => {
        if (typeof window !== "undefined") {
            window.location.reload();
        }
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    width: "100vw",
                    fontFamily: "system-ui, sans-serif",
                    backgroundColor: "#0f0f0f",
                    color: "#e0e0e0",
                    gap: 16,
                    padding: 32,
                    boxSizing: "border-box",
                }}
            >
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
                {this.state.message && (
                    <div
                        style={{
                            fontSize: 13,
                            color: "#888",
                            maxWidth: 480,
                            textAlign: "center",
                            wordBreak: "break-word",
                        }}
                    >
                        {this.state.message}
                    </div>
                )}
                <button
                    onClick={this.handleReload}
                    style={{
                        marginTop: 8,
                        padding: "10px 24px",
                        borderRadius: 8,
                        border: "none",
                        background: "#007aff",
                        color: "#fff",
                        fontSize: 15,
                        cursor: "pointer",
                        fontFamily: "inherit",
                    }}
                >
                    Reload
                </button>
            </div>
        );
    }
}

export function setupWebErrorHandlers() {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    // Replay any crashes persisted before the last reload into /dev/logs.
    surfaceCrashTrail();
    (window as unknown as { __happyCrash?: unknown }).__happyCrash = {
        dump: surfaceCrashTrail,
        clear: clearCrashTrail,
    };

    window.addEventListener("error", (event) => {
        // Prefer event.error.stack (full JS stack across frames). Fall back to
        // filename:lineno:colno when error is missing/null (cross-origin script
        // errors, runtime panics that null out the error object). Append the
        // location to the stack — having both is cheap and makes greppable
        // bug reports when source maps aren't loaded.
        const stackParts: string[] = [];
        if (event.error instanceof Error && event.error.stack) {
            stackParts.push(event.error.stack);
        }
        if (event.filename) {
            const loc = `${event.filename}:${event.lineno}${event.colno ? `:${event.colno}` : ""}`;
            if (!stackParts.some((s) => s.includes(loc))) stackParts.push(`at ${loc}`);
        }
        const stack = stackParts.length > 0 ? stackParts.join("\n") : undefined;
        recordCrash("error", event.message, stack);
        log.error("Uncaught error:", event.message, event.filename, event.lineno);
    });

    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        // Stack from a thrown Error is the common case; for non-Error rejects
        // (e.g., `Promise.reject("string")`) we have no stack, but still log
        // the string form so the message at least lands in the trail.
        let stack = reason instanceof Error ? reason.stack : undefined;
        if (!stack && reason && typeof reason === "object") {
            const candidate = (reason as { stack?: unknown }).stack;
            if (typeof candidate === "string") stack = candidate;
        }
        recordCrash("unhandledrejection", message, stack);
        log.error("Unhandled promise rejection:", event.reason);
    });
}
