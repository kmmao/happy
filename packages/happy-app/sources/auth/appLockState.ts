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
