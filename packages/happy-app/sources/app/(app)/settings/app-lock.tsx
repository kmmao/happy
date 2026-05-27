import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useUnistyles } from "react-native-unistyles";
import * as LocalAuthentication from "expo-local-authentication";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { Switch } from "@/components/Switch";
import { storage, useLocalSetting, useLocalSettingMutable } from "@/sync/storage";
import { clearPin } from "@/auth/appLock";
import { appLockController } from "@/auth/appLockState";
import type { LocalSettings } from "@/sync/localSettings";
import { Modal } from "@/modal";
import { t } from "@/text";

const TIMEOUT_ORDER: LocalSettings["appLockTimeout"][] = [
  "immediate",
  "30s",
  "1m",
  "5m",
  "never",
];

function timeoutLabel(value: LocalSettings["appLockTimeout"]): string {
  switch (value) {
    case "immediate":
      return t("settingsAppLock.timeoutImmediate");
    case "30s":
      return t("settingsAppLock.timeout30s");
    case "1m":
      return t("settingsAppLock.timeout1m");
    case "5m":
      return t("settingsAppLock.timeout5m");
    case "never":
      return t("settingsAppLock.timeoutNever");
  }
}

function AppLockSettingsScreen() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const enabled = useLocalSetting("appLockEnabled");
  const [lockTimeout, setLockTimeout] = useLocalSettingMutable("appLockTimeout");
  const [biometricEnabled, setBiometricEnabled] = useLocalSettingMutable(
    "appLockBiometricEnabled",
  );
  const [biometricAvailable, setBiometricAvailable] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hasHw, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!cancelled) setBiometricAvailable(hasHw && enrolled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleEnabled = async (next: boolean) => {
    if (next) {
      // Enabling requires setting a PIN first; the setup screen flips the flag.
      router.push("/settings/app-lock-setup");
    } else {
      const confirmed = await Modal.confirm(
        t("settingsAppLock.disableTitle"),
        t("settingsAppLock.disableMessage"),
        { confirmText: t("settingsAppLock.disableConfirm"), destructive: true },
      );
      if (!confirmed) return;
      await clearPin();
      storage.getState().applyLocalSettings({
        appLockEnabled: false,
        appLockBiometricEnabled: false,
      });
    }
  };

  const cycleTimeout = () => {
    const idx = TIMEOUT_ORDER.indexOf(lockTimeout);
    setLockTimeout(TIMEOUT_ORDER[(idx + 1) % TIMEOUT_ORDER.length]);
  };

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <ItemGroup footer={t("settingsAppLock.footer")}>
        <Item
          title={t("settingsAppLock.enable")}
          subtitle={t("settingsAppLock.enableSubtitle")}
          icon={
            <Ionicons
              name="lock-closed-outline"
              size={29}
              color={theme.colors.accentBlue}
            />
          }
          rightElement={
            <Switch value={enabled} onValueChange={handleToggleEnabled} />
          }
        />
      </ItemGroup>

      {enabled && (
        <ItemGroup footer={t("settingsAppLock.timeoutSubtitle")}>
          <Item
            title={t("settingsAppLock.changePin")}
            icon={
              <Ionicons
                name="keypad-outline"
                size={29}
                color={theme.colors.accentPurple}
              />
            }
            onPress={() => router.push("/settings/app-lock-setup")}
          />
          <Item
            title={t("settingsAppLock.timeout")}
            icon={
              <Ionicons
                name="time-outline"
                size={29}
                color={theme.colors.accentOrange}
              />
            }
            detail={timeoutLabel(lockTimeout)}
            onPress={cycleTimeout}
          />
          {biometricAvailable && (
            <Item
              title={t("settingsAppLock.biometric")}
              subtitle={t("settingsAppLock.biometricSubtitle")}
              icon={
                <Ionicons
                  name="finger-print-outline"
                  size={29}
                  color={theme.colors.success}
                />
              }
              rightElement={
                <Switch
                  value={biometricEnabled}
                  onValueChange={setBiometricEnabled}
                />
              }
            />
          )}
          <Item
            title={t("settingsAppLock.lockNow")}
            icon={
              <Ionicons
                name="lock-closed"
                size={29}
                color={theme.colors.textDestructive}
              />
            }
            onPress={() => appLockController.lock()}
            showChevron={false}
          />
        </ItemGroup>
      )}
    </ItemList>
  );
}

export default React.memo(AppLockSettingsScreen);
