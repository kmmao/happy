import "react-native-quick-base64";
import "../theme.css";
import * as React from "react";
import * as SplashScreen from "expo-splash-screen";
import * as Fonts from "expo-font";
import * as Notifications from "expo-notifications";
import { FontAwesome } from "@expo/vector-icons";
import { AuthCredentials, TokenStorage } from "@/auth/tokenStorage";
import { hasCredentialSecret } from "@/auth/authCredentials";
import { AuthProvider } from "@/auth/AuthContext";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SidebarNavigator } from "@/components/SidebarNavigator";
import { AppLockGate } from "@/components/AppLockGate";
import sodium from "@/encryption/libsodium.lib";
import { View, Platform } from "react-native";
import { ModalProvider } from "@/modal";
import { PostHogProvider } from "posthog-react-native";
import { tracking } from "@/track/tracking";
import { syncRestore } from "@/sync/sync";
import { setServerUrl } from "@/sync/serverConfig";
import { useTrackScreens } from "@/track/useTrackScreens";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { FaviconPermissionIndicator } from "@/components/web/FaviconPermissionIndicator";
import { WebErrorBoundary, setupWebErrorHandlers } from "@/components/web/WebErrorBoundary";
import { startMemoryWatchdog } from "@/sync/memoryWatchdog";
import { CommandPaletteProvider } from "@/components/CommandPalette/CommandPaletteProvider";
import { StatusBarProvider } from "@/components/StatusBarProvider";
// import * as SystemUI from 'expo-system-ui';
import { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } from "@/utils/remoteLogger";
import { useUnistyles } from "react-native-unistyles";
import { AsyncLock } from "@/utils/lock";
import { useNotificationNavigation } from "@/hooks/useNotificationNavigation";
import { log } from '@/log';

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Setup Android notification channel (required for Android 8.0+)
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
  });
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

// Configure splash screen
SplashScreen.setOptions({
  fade: true,
  duration: 300,
});
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// NEVER ENABLE REMOTE LOGGING IN PRODUCTION
// This is for local debugging with AI only
// So AI will have all the logs easily accessible in one file for analysis
if (!!process.env.PUBLIC_EXPO_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
  monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
}

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {children}
    </View>
  );
}

let lock = new AsyncLock();
let loaded = false;
async function loadFonts() {
  await lock.inLock(async () => {
    if (loaded) {
      return;
    }
    loaded = true;
    // Check if running in Tauri
    const isTauri =
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      (window as any).__TAURI_INTERNALS__ !== undefined;

    if (!isTauri) {
      // Normal font loading for non-Tauri environments (native and regular web)
      await Fonts.loadAsync({
        // Keep existing font
        SpaceMono: require("@/assets/fonts/SpaceMono-Regular.ttf"),

        // IBM Plex Sans family
        "IBMPlexSans-Regular": require("@/assets/fonts/IBMPlexSans-Regular.ttf"),
        "IBMPlexSans-Italic": require("@/assets/fonts/IBMPlexSans-Italic.ttf"),
        "IBMPlexSans-SemiBold": require("@/assets/fonts/IBMPlexSans-SemiBold.ttf"),

        // IBM Plex Mono family
        "IBMPlexMono-Regular": require("@/assets/fonts/IBMPlexMono-Regular.ttf"),
        "IBMPlexMono-Italic": require("@/assets/fonts/IBMPlexMono-Italic.ttf"),
        "IBMPlexMono-SemiBold": require("@/assets/fonts/IBMPlexMono-SemiBold.ttf"),

        // Bricolage Grotesque
        "BricolageGrotesque-Bold": require("@/assets/fonts/BricolageGrotesque-Bold.ttf"),

        ...FontAwesome.font,
      });
    } else {
      // For Tauri, skip Font Face Observer as fonts are loaded via CSS
      log.log("Do not wait for fonts to load");
      (async () => {
        try {
          await Fonts.loadAsync({
            // Keep existing font
            SpaceMono: require("@/assets/fonts/SpaceMono-Regular.ttf"),

            // IBM Plex Sans family
            "IBMPlexSans-Regular": require("@/assets/fonts/IBMPlexSans-Regular.ttf"),
            "IBMPlexSans-Italic": require("@/assets/fonts/IBMPlexSans-Italic.ttf"),
            "IBMPlexSans-SemiBold": require("@/assets/fonts/IBMPlexSans-SemiBold.ttf"),

            // IBM Plex Mono family
            "IBMPlexMono-Regular": require("@/assets/fonts/IBMPlexMono-Regular.ttf"),
            "IBMPlexMono-Italic": require("@/assets/fonts/IBMPlexMono-Italic.ttf"),
            "IBMPlexMono-SemiBold": require("@/assets/fonts/IBMPlexMono-SemiBold.ttf"),

            // Bricolage Grotesque
            "BricolageGrotesque-Bold": require("@/assets/fonts/BricolageGrotesque-Bold.ttf"),

            ...FontAwesome.font,
          });
        } catch (e) {
          // Ignore
        }
      })();
    }
  });
}

export default function RootLayout() {
  const { theme } = useUnistyles();
  const navigationTheme = React.useMemo(() => {
    if (theme.dark) {
      return {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.colors.groupped.background,
        },
      };
    }
    return {
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: theme.colors.groupped.background,
      },
    };
  }, [theme.dark]);

  //
  // Init sequence
  //
  const [initState, setInitState] = React.useState<{
    credentials: AuthCredentials | null;
  } | null>(null);
  React.useEffect(() => {
    setupWebErrorHandlers();
    // Web-only heap watchdog: persists a localStorage trail so the run-up to a
    // renderer-OOM crash (Chrome error code 5) can be inspected after reload.
    startMemoryWatchdog();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        await loadFonts();
        await sodium.ready;

        // Auto-login via provision token in URL (Web only)
        // URL format: ?provision=hp_xxx
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const provisionToken = params.get("provision");
          const serverParam = params.get("server");
          if (provisionToken) {
            // Set custom server URL if provided (so webapp connects to the right server)
            if (serverParam) {
              setServerUrl(serverParam);
            }
            const raw = provisionToken.startsWith("hp_") ? provisionToken.slice(3) : provisionToken;
            try {
              const packed = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
              if (packed.t) {
                const provisionCredentials: AuthCredentials = {
                  token: packed.t,
                  ...(packed.s ? { secret: packed.s } : {}), // Secret-backed credentials enable full sync restore
                };
                await TokenStorage.setCredentials(provisionCredentials);
                // Clean URL to avoid re-processing on refresh
                window.history.replaceState({}, "", window.location.pathname);
                if (hasCredentialSecret(provisionCredentials)) {
                  await syncRestore(provisionCredentials);
                } else {
                  log.warn("Provision credentials missing sync secret; skipping sync restore");
                }
                setInitState({ credentials: provisionCredentials });
                return;
              }
            } catch (e) {
              log.error("Failed to parse provision token from URL:", e);
            }
          }
        }

        const credentials = await TokenStorage.getCredentials();
        if (credentials) {
          if (hasCredentialSecret(credentials)) {
            await syncRestore(credentials);
          } else {
            log.warn("Stored credentials missing sync secret; app remains in limited auth mode");
          }
        }

        setInitState({ credentials });
      } catch (error) {
        log.error("Error initializing:", error);
      }
    })();
  }, []);

  React.useEffect(() => {
    if (initState) {
      setTimeout(() => {
        SplashScreen.hideAsync();
      }, 100);
    }
  }, [initState]);

  // Track the screens
  useTrackScreens();

  // Handle push notification deep links
  useNotificationNavigation();

  //
  // Not inited
  //

  if (!initState) {
    return null;
  }

  //
  // Boot
  //

  let providers = (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AuthProvider initialCredentials={initState.credentials}>
            <ThemeProvider value={navigationTheme}>
              <StatusBarProvider />
              <AppLockGate>
                <ModalProvider>
                  <CommandPaletteProvider>
                    <RealtimeProvider>
                      <HorizontalSafeAreaWrapper>
                        <SidebarNavigator />
                      </HorizontalSafeAreaWrapper>
                    </RealtimeProvider>
                  </CommandPaletteProvider>
                </ModalProvider>
              </AppLockGate>
            </ThemeProvider>
          </AuthProvider>
        </GestureHandlerRootView>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
  if (tracking) {
    providers = (
      <PostHogProvider client={tracking}>{providers}</PostHogProvider>
    );
  }

  return (
    <WebErrorBoundary>
      <FaviconPermissionIndicator />
      {providers}
    </WebErrorBoundary>
  );
}
