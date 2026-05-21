import { log } from "@/log";
import { randomUUID } from "expo-crypto";

/**
 * Generate a compact 8-character hex trace ID for correlating log lines.
 * Not cryptographically strong — purely a short discriminator to let you
 * grep the in-memory dev log and follow one call from "start" to "result".
 */
export function newTraceId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 8);
}

export type OutboundChannel = "http" | "ack" | "rpc-session" | "rpc-machine" | "send";

/**
 * Wrap an outbound call with start/result diagnostic logging.
 *
 * Emits two lines to `log.log` (the in-memory dev log, no console noise):
 *   [OUT] [<traceId>] [<channel>]  <label>  →  start  <extra>
 *   [OUT] [<traceId>] [<channel>]  <label>  →  ok in <duration>ms  <onResult(...)>
 *
 * On exception:
 *   [OUT] [<traceId>] [<channel>]  <label>  →  ✗ <reason> in <duration>ms
 *
 * The exception is always re-thrown — traceCall never swallows errors.
 *
 * @param channel  One of: "http" | "ack" | "rpc-session" | "rpc-machine" | "send"
 * @param label    Human-readable call name (e.g. "POST /v3/sessions/X/messages")
 * @param fn       The async operation. Receives the resolved traceId so HTTP callers
 *                 can inject it as an X-Trace-Id header.
 * @param opts.traceId   Reuse an upstream traceId (sendMessage → flushOutbox chain).
 * @param opts.extra     Extra context appended to the "start" line.
 * @param opts.onResult  Optional fn that receives the result and returns a string
 *                       appended to the "ok" line (e.g. response status).
 */
export async function traceCall<T>(
    channel: OutboundChannel,
    label: string,
    fn: (traceId: string) => Promise<T>,
    opts?: {
        traceId?: string;
        extra?: string;
        onResult?: (result: T) => string;
    },
): Promise<T> {
    const traceId = opts?.traceId ?? newTraceId();
    const extraStr = opts?.extra ? `  ${opts.extra}` : "";
    log.log(`[OUT] [${traceId}] [${channel}]  ${label}  →  start${extraStr}`);
    const startMs = Date.now();

    try {
        const result = await fn(traceId);
        const durationMs = Date.now() - startMs;
        const resultStr = opts?.onResult ? `  ${opts.onResult(result)}` : "";
        log.log(`[OUT] [${traceId}] [${channel}]  ${label}  →  ok in ${durationMs}ms${resultStr}`);
        return result;
    } catch (error) {
        const durationMs = Date.now() - startMs;
        const reason = classifyError(error);
        log.log(`[OUT] [${traceId}] [${channel}]  ${label}  →  ✗ ${reason} in ${durationMs}ms`);
        throw error;
    }
}

/**
 * Map a thrown error to a short diagnostic label.
 *
 * Covers the common failure modes for outbound HTTP / Socket calls:
 *   - User/code abort (AbortController.abort())
 *   - Socket.IO / fetch timeout ("operation has timed out", TimeoutError)
 *   - HTTP 4xx / 5xx status codes encoded in the error message by callers
 *   - Everything else → first 80 chars of the message
 */
function classifyError(error: unknown): string {
    if (!(error instanceof Error)) {
        return `unknown: ${String(error).slice(0, 80)}`;
    }
    if (error.name === "AbortError") {
        return "aborted";
    }
    if (
        error.name === "TimeoutError" ||
        error.message === "operation has timed out"
    ) {
        return "timeout";
    }
    // Look for a trailing HTTP status code as produced by our callers:
    //   "Failed to send messages for X: 404"
    //   "RPC call 'bash' timed out"
    const statusMatch = error.message.match(/:?\s*(\d{3})$/);
    if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        if (status >= 400 && status < 500) {
            return `http-${status}`;
        }
        if (status >= 500) {
            return `server-${status}`;
        }
    }
    if (error.message.includes("timed out")) {
        return "timeout";
    }
    return `error: ${error.message.slice(0, 80)}`;
}
