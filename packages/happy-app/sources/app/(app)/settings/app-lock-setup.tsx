import * as React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { PinKeypad } from "@/components/PinKeypad";
import { PIN_LENGTH, setPin } from "@/auth/appLock";
import { storage } from "@/sync/storage";
import { t } from "@/text";

/**
 * Two-step PIN setup used both to enable App Lock and to change the PIN: enter a
 * new 6-digit PIN, then confirm it. On a successful match the PIN is stored and
 * App Lock is marked enabled, then we navigate back.
 */
function AppLockSetupScreen() {
  const router = useRouter();
  const { theme } = useUnistyles();

  const [phase, setPhase] = React.useState<"enter" | "confirm">("enter");
  const [first, setFirst] = React.useState("");
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    if (value.length !== PIN_LENGTH) return;
    if (phase === "enter") {
      setFirst(value);
      setValue("");
      setError(null);
      setPhase("confirm");
      return;
    }
    if (value === first) {
      if (savingRef.current) return;
      savingRef.current = true;
      (async () => {
        await setPin(value);
        storage.getState().applyLocalSettings({ appLockEnabled: true });
        router.back();
      })();
    } else {
      setFirst("");
      setValue("");
      setPhase("enter");
      setError(t("settingsAppLock.setupMismatch"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const prompt =
    phase === "enter"
      ? t("settingsAppLock.setupEnterNew")
      : t("settingsAppLock.setupConfirm");

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          fontSize: 17,
          color: theme.colors.text,
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        {prompt}
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: error ? theme.colors.textDestructive : theme.colors.textSecondary,
          marginBottom: 40,
          textAlign: "center",
          minHeight: 20,
        }}
      >
        {error ?? t("settingsAppLock.setupHint")}
      </Text>
      <PinKeypad value={value} onChange={setValue} />
    </View>
  );
}

export default React.memo(AppLockSetupScreen);
