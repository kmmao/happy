import * as React from "react";
import { AppState, AppStateStatus, Platform, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { useLocalSetting } from "@/sync/storage";
import { useAuth } from "@/auth/AuthContext";
import { hasPin } from "@/auth/appLock";
import {
  appLockController,
  shouldLockOnColdStart,
  shouldRelockOnForeground,
  useAppLocked,
} from "@/auth/appLockState";
import { AppLockScreen } from "@/components/AppLockScreen";

const absoluteFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/**
 * Gates the whole app UI behind a PIN/biometric lock when enabled on this device.
 *
 * Behavior (mobile only — no-op on web):
 * - Cold start: if the lock was enabled at launch, the app starts locked.
 * - Background → foreground: re-locks if the app was backgrounded longer than the
 *   configured timeout. `never` means background never auto-locks (but cold start
 *   still does).
 * - App-switcher masking: content is covered with an opaque screen whenever the app
 *   is not active, so the OS snapshot does not leak session content.
 * - Only active while authenticated; logging out (incl. the forgot-PIN escape)
 *   releases the lock so the login screen stays reachable.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const isWeb = Platform.OS === "web";
  const enabled = useLocalSetting("appLockEnabled");
  const timeout = useLocalSetting("appLockTimeout");
  const { isAuthenticated } = useAuth();
  const locked = useAppLocked();
  const { theme } = useUnistyles();

  const [hasPinConfigured, setHasPinConfigured] = React.useState(false);
  const [appState, setAppState] = React.useState<AppStateStatus>(
    AppState.currentState,
  );
  const backgroundedAtRef = React.useRef<number | null>(null);
  const coldStartHandledRef = React.useRef(false);
  // Whether the lock was already enabled when the app launched. Enabling mid-session
  // (just after setting a PIN) should NOT instantly lock the user out.
  const enabledAtMountRef = React.useRef(enabled);

  const guardActive = !isWeb && enabled && isAuthenticated && hasPinConfigured;

  // Resolve whether a PIN is actually configured (async secure-store read).
  React.useEffect(() => {
    if (isWeb || !enabled) {
      setHasPinConfigured(false);
      return;
    }
    let cancelled = false;
    hasPin().then((has) => {
      if (!cancelled) setHasPinConfigured(has);
    });
    return () => {
      cancelled = true;
    };
  }, [isWeb, enabled]);

  // Cold start: lock once per process, only if the lock was on at launch.
  React.useEffect(() => {
    if (!guardActive || coldStartHandledRef.current) return;
    coldStartHandledRef.current = true;
    if (
      shouldLockOnColdStart({
        guardActive,
        enabledAtMount: enabledAtMountRef.current,
      })
    ) {
      appLockController.lock();
    }
  }, [guardActive]);

  // Release the lock if the guard turns off (disabled or logged out).
  React.useEffect(() => {
    if (!guardActive && locked) {
      appLockController.unlock();
    }
  }, [guardActive, locked]);

  // Re-lock on background timeout.
  React.useEffect(() => {
    if (isWeb) return;
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next);
      if (next === "background") {
        backgroundedAtRef.current = Date.now();
      } else if (next === "active") {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (
          shouldRelockOnForeground({
            guardActive,
            backgroundedAt: bgAt,
            now: Date.now(),
            timeout,
          })
        ) {
          appLockController.lock();
        }
      }
    });
    return () => sub.remove();
  }, [isWeb, guardActive, timeout]);

  const showMask = guardActive && !locked && appState !== "active";

  return (
    <View style={{ flex: 1 }}>
      {children}
      {showMask && (
        <View
          style={[
            absoluteFill,
            {
              backgroundColor: theme.colors.groupped.background,
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9998,
            },
          ]}
        >
          <Ionicons
            name="lock-closed"
            size={64}
            color={theme.colors.textSecondary}
          />
        </View>
      )}
      {guardActive && locked && (
        <View style={[absoluteFill, { zIndex: 9999 }]}>
          <AppLockScreen />
        </View>
      )}
    </View>
  );
}
