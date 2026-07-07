/**
 * sleepWithAbort — cancellable sleep.
 *
 * `utils/time.ts:delay` is a bare `setTimeout` and cannot be interrupted
 * — a stop / teardown mid-delay would freeze the CLI for the full
 * window. This helper listens to an optional `AbortSignal`: an abort
 * (before or during the sleep) resolves the promise on the next tick
 * and clears the timer / event listener. Never rejects — callers treat
 * an early return as "resume normal flow"; the aborted state, if
 * relevant, is checked at their own chokepoint.
 *
 * Behaviour is deliberately identical to the sleep block that used to
 * live inline in `claudeRemote.ts:maybeDelayPlanRestartWrite`, so that
 * function was refactored to call this instead. New consumers include
 * the plan-continuation auto-retry policy in
 * `claudeRemoteLauncherCore.ts`.
 */
export function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
