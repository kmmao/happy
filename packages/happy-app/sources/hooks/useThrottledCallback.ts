import * as React from "react";

/**
 * Trailing-edge throttle controller: at most one call per `intervalMs`. The
 * first call (and any call outside the window) fires immediately; calls
 * inside an active window are coalesced into a single trailing call at the
 * window's end.
 *
 * Unlike debounce, this guarantees forward progress under sustained bursts —
 * a stream that never goes idle still gets one call per window instead of
 * being deferred indefinitely.
 *
 * Pure factory (no React) so the throttle behavior is unit-testable with
 * fake timers. The matching React hook `useThrottledCallback` wraps this.
 */
export function createTrailingThrottle(
  fn: () => void,
  intervalMs: number,
  now: () => number = Date.now,
): { trigger: () => void; cancel: () => void } {
  let lastRunAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  };

  const trigger = () => {
    const currentTime = now();
    const elapsed = currentTime - lastRunAt;

    if (elapsed >= intervalMs) {
      // Outside throttle window — fire immediately and reset the window.
      // Any previously scheduled trailing call is now redundant; drop it
      // so we don't double-fire at the original window boundary.
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      lastRunAt = currentTime;
      fn();
      return;
    }

    // Inside the window. If no trailing call is queued yet, schedule one
    // for the moment the window ends. Subsequent triggers inside the same
    // window are dropped — the trailing call uses the latest `fn` closure.
    if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        lastRunAt = now();
        trailingTimer = null;
        fn();
      }, intervalMs - elapsed);
    }
  };

  return { trigger, cancel };
}

/**
 * React hook wrapper around `createTrailingThrottle`. The returned function
 * is stable across renders; the underlying `fn` is captured via ref so each
 * call always invokes the latest closure. A pending trailing timer is
 * cleared on unmount.
 */
export function useThrottledCallback(
  fn: () => void,
  intervalMs: number,
): () => void {
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  const controllerRef = React.useRef<ReturnType<
    typeof createTrailingThrottle
  > | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createTrailingThrottle(
      () => fnRef.current(),
      intervalMs,
    );
  }

  React.useEffect(() => {
    return () => {
      controllerRef.current?.cancel();
    };
  }, []);

  return controllerRef.current.trigger;
}
