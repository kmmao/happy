import {
  useSocketStatus,
  useFriendRequests,
  useSettings,
  useSettingMutable,
} from "@/sync/storage";
import * as React from "react";
import { Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "@/utils/responsive";
import { useIsTablet } from "@/utils/responsive";
import { Typography } from "@/constants/Typography";
import { StatusDot } from "./StatusDot";
import { FABWide } from "./FABWide";
import { VoiceAssistantStatusBar } from "./VoiceAssistantStatusBar";
import { useRealtimeStatus } from "@/sync/storage";
import { MainView } from "./MainView";
import { Image } from "expo-image";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { useInboxHasContent } from "@/hooks/useInboxHasContent";
import { Ionicons } from "@expo/vector-icons";
import { useSidebarState } from "./SidebarStateContext";

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    borderStyle: "solid",
    backgroundColor: theme.colors.groupped.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: theme.colors.groupped.background,
    position: "relative",
  },
  logoContainer: {
    width: 32,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: 24,
    width: 24,
  },
  statusDotOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
  },
  titleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "column",
    alignItems: "center",
    pointerEvents: "none",
  },
  titleContainerLeft: {
    flex: 1,
    flexDirection: "column",
    alignItems: "flex-start",
    marginLeft: 8,
    justifyContent: "center",
  },
  titleText: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.colors.header.tint,
    ...Typography.default("semiBold"),
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: -2,
  },
  statusDot: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 16,
    ...Typography.default(),
  },
  rightContainer: {
    marginLeft: "auto",
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
  },
  settingsButton: {
    color: theme.colors.header.tint,
  },
  notificationButton: {
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: theme.colors.status.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    ...Typography.default("semiBold"),
  },
  indicatorDot: {
    position: "absolute",
    top: 0,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.text,
  },
  // Collapsed rail styles
  railContainer: {
    flex: 1,
    backgroundColor: theme.colors.groupped.background,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: theme.colors.divider,
    alignItems: "center",
  },
  railLogoButton: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  railDivider: {
    width: 28,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.divider,
    marginVertical: 8,
  },
  railNavSection: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingTop: 4,
  },
  railButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  railBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: theme.colors.status.error,
    borderRadius: 6,
    minWidth: 12,
    height: 12,
    paddingHorizontal: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  railBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    ...Typography.default("semiBold"),
  },
  railIndicatorDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.text,
  },
}));

export const SidebarView = React.memo(() => {
  const styles = stylesheet;
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const isTablet = useIsTablet();
  const socketStatus = useSocketStatus();
  const realtimeStatus = useRealtimeStatus();
  const friendRequests = useFriendRequests();
  const inboxHasContent = useInboxHasContent();
  const settings = useSettings();
  const [showProjectTab] = useSettingMutable("showProjectTab");
  const { collapsed, toggleCollapsed } = useSidebarState();

  const connectionStatus = React.useMemo(() => {
    const { status } = socketStatus;
    switch (status) {
      case "connected":
        return {
          color: theme.colors.status.connected,
          isPulsing: false,
          text: t("status.connected"),
        };
      case "connecting":
        return {
          color: theme.colors.status.connecting,
          isPulsing: true,
          text: t("status.connecting"),
        };
      case "disconnected":
        return {
          color: theme.colors.status.disconnected,
          isPulsing: false,
          text: t("status.disconnected"),
        };
      case "error":
        return {
          color: theme.colors.status.error,
          isPulsing: false,
          text: t("status.error"),
        };
      default:
        return {
          color: theme.colors.status.default,
          isPulsing: false,
          text: "",
        };
    }
  }, [socketStatus, theme.colors.status]);

  const handleNewSession = React.useCallback(() => {
    router.push("/new");
  }, [router]);

  // Collapsed rail - narrow 52px icon strip
  if (isTablet && collapsed) {
    return (
      <View style={[styles.railContainer, { paddingTop: safeArea.top }]}>
        {/* Logo area - same height as header, tappable to expand */}
        <Pressable
          onPress={toggleCollapsed}
          hitSlop={8}
          style={[
            styles.railLogoButton,
            { height: headerHeight, justifyContent: "center" },
          ]}
        >
          <Image
            source={
              theme.dark
                ? require("@/assets/images/logo-white.png")
                : require("@/assets/images/logo-black.png")
            }
            contentFit="contain"
            style={{ height: 24, width: 24 }}
          />
          {connectionStatus.color && (
            <View style={styles.statusDotOverlay}>
              <StatusDot
                color={connectionStatus.color}
                isPulsing={connectionStatus.isPulsing}
                size={6}
              />
            </View>
          )}
        </Pressable>

        <View style={styles.railDivider} />

        {/* Navigation icons */}
        <View style={styles.railNavSection}>
          {/* Inbox */}
          <Pressable
            onPress={() => router.push("/(app)/inbox")}
            hitSlop={8}
            style={styles.railButton}
          >
            <Image
              source={require("@/assets/images/brutalist/Brutalism 27.png")}
              contentFit="contain"
              style={{ width: 28, height: 28 }}
              tintColor={theme.colors.header.tint}
            />
            {friendRequests.length > 0 && (
              <View style={styles.railBadge}>
                <Text style={styles.railBadgeText}>
                  {friendRequests.length > 9 ? "9+" : friendRequests.length}
                </Text>
              </View>
            )}
            {inboxHasContent && friendRequests.length === 0 && (
              <View style={styles.railIndicatorDot} />
            )}
          </Pressable>

          {/* Project (conditional) */}
          {showProjectTab && (
            <Pressable
              onPress={() => router.push("/kanban")}
              hitSlop={8}
              style={styles.railButton}
            >
              <Image
                source={require("@/assets/images/brutalist/Brutalism 22.png")}
                contentFit="contain"
                style={{ width: 28, height: 28 }}
                tintColor={theme.colors.header.tint}
              />
            </Pressable>
          )}

          {/* Settings */}
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            style={styles.railButton}
          >
            <Image
              source={require("@/assets/images/brutalist/Brutalism 9.png")}
              contentFit="contain"
              style={{ width: 28, height: 28 }}
              tintColor={theme.colors.header.tint}
            />
          </Pressable>

          <View style={{ flex: 1 }} />

          {/* New session */}
          <Pressable
            onPress={handleNewSession}
            hitSlop={8}
            style={[styles.railButton, { marginBottom: safeArea.bottom + 12 }]}
          >
            <Ionicons
              name="add-outline"
              size={26}
              color={theme.colors.header.tint}
            />
          </Pressable>
        </View>
      </View>
    );
  }

  // Expanded full sidebar
  return (
    <>
      <View style={[styles.container, { paddingTop: safeArea.top }]}>
        <View style={[styles.header, { height: headerHeight }]}>
          {/* Logo - tappable to collapse */}
          <Pressable
            onPress={isTablet ? toggleCollapsed : undefined}
            disabled={!isTablet}
            hitSlop={8}
            style={styles.logoContainer}
          >
            <Image
              source={
                theme.dark
                  ? require("@/assets/images/logo-white.png")
                  : require("@/assets/images/logo-black.png")
              }
              contentFit="contain"
              style={[styles.logo, { height: 24, width: 24 }]}
            />
            {connectionStatus.color && (
              <View style={styles.statusDotOverlay}>
                <StatusDot
                  color={connectionStatus.color}
                  isPulsing={connectionStatus.isPulsing}
                  size={6}
                />
              </View>
            )}
          </Pressable>

          {/* Navigation icons */}
          <View style={styles.rightContainer}>
            <Pressable
              onPress={() => router.push("/(app)/inbox")}
              hitSlop={15}
              style={styles.notificationButton}
            >
              <Image
                source={require("@/assets/images/brutalist/Brutalism 27.png")}
                contentFit="contain"
                style={[{ width: 32, height: 32 }]}
                tintColor={theme.colors.header.tint}
              />
              {friendRequests.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {friendRequests.length > 99 ? "99+" : friendRequests.length}
                  </Text>
                </View>
              )}
              {inboxHasContent && friendRequests.length === 0 && (
                <View style={styles.indicatorDot} />
              )}
            </Pressable>
            {showProjectTab && (
              <Pressable onPress={() => router.push("/kanban")} hitSlop={15}>
                <Image
                  source={require("@/assets/images/brutalist/Brutalism 22.png")}
                  contentFit="contain"
                  style={[{ width: 32, height: 32 }]}
                  tintColor={theme.colors.header.tint}
                />
              </Pressable>
            )}
            <Pressable onPress={() => router.push("/settings")} hitSlop={15}>
              <Image
                source={require("@/assets/images/brutalist/Brutalism 9.png")}
                contentFit="contain"
                style={[{ width: 32, height: 32 }]}
                tintColor={theme.colors.header.tint}
              />
            </Pressable>
            <Pressable onPress={handleNewSession} hitSlop={15}>
              <Ionicons
                name="add-outline"
                size={28}
                color={theme.colors.header.tint}
              />
            </Pressable>
          </View>
        </View>
        {realtimeStatus !== "disconnected" && (
          <VoiceAssistantStatusBar variant="sidebar" />
        )}
        <MainView variant="sidebar" />
      </View>
      <FABWide onPress={handleNewSession} />
    </>
  );
});
