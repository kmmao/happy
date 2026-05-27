import * as React from "react";
import { View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { PinKeypad } from "@/components/PinKeypad";
import { PIN_LENGTH, verifyPin, clearPin } from "@/auth/appLock";
import { appLockController } from "@/auth/appLockState";
import { useLocalSetting, storage } from "@/sync/storage";
import { useAuth } from "@/auth/AuthContext";
import { Modal } from "@/modal";
import { t } from "@/text";

// After this many consecutive failures the keypad enters an escalating cooldown.
const LOCKOUT_THRESHOLD = 5;

function lockoutSecondsForTier(tier: number): number {
  if (tier <= 1) return 30;
  if (tier === 2) return 60;
  return 300;
}

/**
 * Full-screen unlock surface rendered by AppLockGate while the app is locked.
 * Supports PIN entry + biometric, with an escalating cooldown (no data wipe) and
 * a forgot-PIN escape that logs out so the user can re-login and reset.
 */
export function AppLockScreen() {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const biometricEnabled = useLocalSetting("appLockBiometricEnabled");

  const [value, setValue] = React.useState("");
  const [failCount, setFailCount] = React.useState(0);
  const [error, setError] = React.useState(false);
  const [lockoutUntil, setLockoutUntil] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const [biometricAvailable, setBiometricAvailable] = React.useState(false);

  const lockedOut = lockoutUntil != null && now < lockoutUntil;
  const remainingSeconds = lockedOut
    ? Math.ceil((lockoutUntil! - now) / 1000)
    : 0;

  // Tick the countdown while locked out, and release the cooldown when it ends.
  React.useEffect(() => {
    if (lockoutUntil == null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  React.useEffect(() => {
    if (lockoutUntil != null && now >= lockoutUntil) {
      setLockoutUntil(null);
    }
  }, [now, lockoutUntil]);

  const tryBiometric = React.useCallback(async () => {
    if (lockoutUntil != null && Date.now() < lockoutUntil) return;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("settingsAppLock.biometricPrompt"),
        cancelLabel: t("common.cancel"),
        disableDeviceFallback: true,
      });
      if (result.success) {
        appLockController.unlock();
      }
    } catch {
      // Ignore — the user can still enter the PIN.
    }
  }, [lockoutUntil]);

  // Detect biometric hardware and auto-prompt once on mount when enabled.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hasHw, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (cancelled) return;
      const avail = hasHw && enrolled;
      setBiometricAvailable(avail);
      if (avail && biometricEnabled) tryBiometric();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verify once the PIN reaches full length.
  React.useEffect(() => {
    if (value.length !== PIN_LENGTH || lockedOut) return;
    let cancelled = false;
    (async () => {
      const ok = await verifyPin(value);
      if (cancelled) return;
      if (ok) {
        setFailCount(0);
        setError(false);
        appLockController.unlock();
        return;
      }
      const nextFail = failCount + 1;
      setFailCount(nextFail);
      setError(true);
      setValue("");
      if (nextFail % LOCKOUT_THRESHOLD === 0) {
        const tier = nextFail / LOCKOUT_THRESHOLD;
        setLockoutUntil(Date.now() + lockoutSecondsForTier(tier) * 1000);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, lockedOut]);

  const handleChange = (next: string) => {
    if (lockedOut) return;
    setError(false);
    setValue(next);
  };

  const handleForgot = async () => {
    const confirmed = await Modal.confirm(
      t("settingsAppLock.forgotTitle"),
      t("settingsAppLock.forgotMessage"),
      { confirmText: t("settingsAppLock.forgotConfirm"), destructive: true },
    );
    if (!confirmed) return;
    await clearPin();
    storage.getState().applyLocalSettings({
      appLockEnabled: false,
      appLockBiometricEnabled: false,
    });
    await auth.logout();
  };

  const statusText = lockedOut
    ? t("settingsAppLock.lockedOut", { seconds: remainingSeconds })
    : error
      ? t("settingsAppLock.incorrect")
      : t("settingsAppLock.unlockPrompt");

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <Ionicons
          name="lock-closed"
          size={48}
          color={theme.colors.text}
          style={{ marginBottom: 24 }}
        />
        <Text
          style={{
            fontSize: 22,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 8,
          }}
        >
          {t("settingsAppLock.unlockTitle")}
        </Text>
        <Text
          style={{
            fontSize: 15,
            color:
              lockedOut || error
                ? theme.colors.textDestructive
                : theme.colors.textSecondary,
            marginBottom: 40,
            textAlign: "center",
            minHeight: 20,
          }}
        >
          {statusText}
        </Text>

        <PinKeypad value={value} onChange={handleChange} disabled={lockedOut} />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 32,
            gap: 28,
          }}
        >
          {biometricAvailable && biometricEnabled && (
            <Pressable
              onPress={tryBiometric}
              disabled={lockedOut}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Ionicons
                name="finger-print"
                size={22}
                color={theme.colors.accentBlue}
                style={{ marginRight: 6 }}
              />
              <Text style={{ fontSize: 15, color: theme.colors.accentBlue }}>
                {t("settingsAppLock.biometricButton")}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={handleForgot} hitSlop={8}>
            <Text style={{ fontSize: 15, color: theme.colors.accentBlue }}>
              {t("settingsAppLock.forgotPin")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
