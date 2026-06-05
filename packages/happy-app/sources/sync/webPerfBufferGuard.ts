/**
 * Web-only mitigation for a renderer crash we hit on long-lived tabs:
 *
 *   Uncaught DataCloneError: Failed to execute 'measure' on 'Performance':
 *   Data cannot be cloned, out of memory.
 *
 * "out of memory" here is NOT the V8 heap (memwatch shows ~10% at crash
 * time). It's the browser's internal Performance entry buffer / clone arena.
 * Dev-mode bundles inject heavy `performance.mark()` / `performance.measure()`
 * instrumentation (Metro, Expo router, Reanimated, Hermes profiling). On a
 * tab with many active sessions (cmpx4r2b: ~1800 messages, 9 sessions), the
 * buffer fills within minutes and the next `measure()` call throws.
 *
 * The native Performance API exposes two cheap clear ops that drop ALL
 * outstanding marks and measures without touching navigation/resource
 * timings. We tick them every 30s — much shorter than the empirically
 * observed time-to-crash, much longer than any single profiler trace we'd
 * actually want to inspect.
 *
 * No-op on native and on browsers without the Performance API.
 */
import { Platform } from "react-native";

const CLEAR_INTERVAL_MS = 30_000;

let started = false;

function clearOnce(): void {
  try {
    performance.clearMarks();
  } catch {
    // some envs don't implement clearMarks — best-effort
  }
  try {
    performance.clearMeasures();
  } catch {
    // ditto
  }
}

/**
 * Start the periodic clear. Safe to call multiple times; only the first
 * call takes effect. No-op off web and on browsers without `performance`.
 */
export function startWebPerfBufferGuard(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  if (typeof performance === "undefined") return;
  if (typeof performance.clearMarks !== "function") return;
  if (started) return;
  started = true;

  // First clear is delayed so we don't drop boot-time marks that legit dev
  // tools may want to read once on initial render.
  setTimeout(clearOnce, CLEAR_INTERVAL_MS);
  setInterval(clearOnce, CLEAR_INTERVAL_MS);
}
