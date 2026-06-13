/**
 * Shared automation summary timings.
 *
 * Both the global per-fleet header (SessionsAutomationHeader) and the
 * per-machine summary hook (useAutomationSummaryCounts) refetch on
 * `sync.onTaskStatusChanged`. Task-status events can fan out 10+/sec during
 * heavy swarm activity; with N machines expanded the second hook fans out
 * to N concurrent fetches per event.
 *
 * Both call sites pass this value into `useThrottledCallback`, so a single
 * tweak here keeps the fleet-wide window and per-machine windows from
 * drifting apart over time — and keeps cross-source reasoning simple.
 */
export const AUTOMATION_SUMMARY_THROTTLE_MS = 1500;
