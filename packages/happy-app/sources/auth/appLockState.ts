/**
 * App Lock — runtime lock state
 *
 * Ephemeral (never persisted) "is the app currently locked" flag, shared between
 * the AppLockGate (which renders the lock screen) and any caller that wants to
 * lock the app immediately (e.g. the "Lock now" settings action). Exposed both
 * as an imperative controller and as a React hook via useSyncExternalStore.
 */

import { useSyncExternalStore } from "react";
import type { LocalSettings } from "@/sync/localSettings";

type Listener = () => void;

let locked = false;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const appLockController = {
  isLocked(): boolean {
    return locked;
  },
  lock() {
    if (!locked) {
      locked = true;
      emit();
    }
  },
  unlock() {
    if (locked) {
      locked = false;
      emit();
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Subscribe to the runtime lock state. */
export function useAppLocked(): boolean {
  return useSyncExternalStore(
    appLockController.subscribe,
    appLockController.isLocked,
    appLockController.isLocked,
  );
}

/**
 * Background duration (ms) after which the app re-locks on return to foreground.
 * `Infinity` means background never auto-locks (cold start still locks).
 */
export function appLockTimeoutMs(timeout: LocalSettings["appLockTimeout"]): number {
  switch (timeout) {
    case "immediate":
      return 0;
    case "30s":
      return 30_000;
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "never":
      return Infinity;
    default:
      return 0;
  }
}

/**
 * Cold-start lock decision. On launch the app locks once, but only if the lock was
 * already enabled when the process started — enabling mid-session (right after
 * setting a PIN) must not instantly lock the user out. Callers fire this at most
 * once per process (guarded by a ref).
 */
export function shouldLockOnColdStart(params: {
  guardActive: boolean;
  enabledAtMount: boolean;
}): boolean {
  return params.guardActive && params.enabledAtMount;
}

/**
 * Foreground re-lock decision. Returns true when, on returning to the foreground,
 * the app has been backgrounded for at least the configured timeout. A `never`
 * timeout (Infinity) never re-locks from the background; a missing `backgroundedAt`
 * (no background event recorded) or an inactive guard never locks.
 */
export function shouldRelockOnForeground(params: {
  guardActive: boolean;
  backgroundedAt: number | null;
  now: number;
  timeout: LocalSettings["appLockTimeout"];
}): boolean {
  const { guardActive, backgroundedAt, now, timeout } = params;
  if (!guardActive || backgroundedAt == null) return false;
  const ms = appLockTimeoutMs(timeout);
  if (ms === Infinity) return false;
  return now - backgroundedAt >= ms;
}
