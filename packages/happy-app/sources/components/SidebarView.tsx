import {
  useSocketStatus,
  useFriendRequests,
  useSettings,
  useHasUnreadMessages,
} from "@/sync/storage";
import * as React from "react";
import { Text, View, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { useHeaderHeight } from "@/utils/responsive";
import { useIsTablet } from "@/utils/responsive";
import { Typography } from "@/constants/Typography";
import { StatusDot } from "./StatusDot";
import { CreateWorkflowMenu } from "./workflow/CreateWorkflowMenu";
import { VoiceAssistantStatusBar } from "./VoiceAssistantStatusBar";
import { useRealtimeStatus } from "@/sync/storage";
import { MainView } from "./MainView";
import { Image } from "expo-image";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { useInboxHasContent } from "@/hooks/useInboxHasContent";
import { Ionicons } from "@expo/vector-icons";
import { useSidebarState } from "./SidebarStateContext";
import { Avatar } from "./Avatar";
import { useVisibleSessionListViewData } from "@/hooks/useVisibleSessionListViewData";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import {
  getSessionAvatarId,
  getSessionProviderKey,
  useSessionStatus,
} from "@/utils/sessionUtils";
import type { Session } from "@/sync/storageTypes";

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
  railStatusDotCenter: {
    position: "absolute",
    bottom: -2,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  railSessionsScroll: {
    flex: 1,
    alignSelf: "stretch",
  },
  railSessionsContent: {
    alignItems: "center",
    paddingVertical: 4,
    gap: 6,
  },
  railSessionButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  railSessionButtonSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  railNewSessionButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
}));

const RailSessionIcon = React.memo(
  ({
    session,
    selected,
    onPress,
  }: {
    session: Session;
    selected: boolean;
    onPress: () => void;
  }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const avatarId = React.useMemo(
      () => getSessionAvatarId(session),
      [session],
    );
    const hasUnread = useHasUnreadMessages(session.id);

    return (
      <Pressable
        onPress={onPress}
        hitSlop={4}
        style={[
          styles.railSessionButton,
          selected && styles.railSessionButtonSelected,
        ]}
      >
        <Avatar
          id={avatarId}
          size={28}
          monochrome={!sessionStatus.isConnected}
          flavor={session.metadata?.flavor}
          provider={getSessionProviderKey(session)}
          hasUnreadMessages={hasUnread}
          glowColor={selected ? theme.colors.accentPurple : null}
        />
      </Pressable>
    );
  },
);

export const SidebarView = React.memo(() => {
  const styles = stylesheet;
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const headerHeight = useHeaderHeight();
  const isTablet = useIsTablet();
  const socketStatus = useSocketStatus();
  const realtimeStatus = useRealtimeStatus();
  const friendRequests = useFriendRequests();
  const inboxHasContent = useInboxHasContent();
  const settings = useSettings();
  const { collapsed, toggleCollapsed } = useSidebarState();
  const sessionListViewData = useVisibleSessionListViewData();
  const navigateToSession = useNavigateToSession();

  const railSessions = React.useMemo<Session[]>(() => {
    if (!sessionListViewData) return [];
    const result: Session[] = [];
    for (const item of sessionListViewData) {
      if (item.type === "active-sessions") {
        result.push(...item.sessions);
      } else if (item.type === "session") {
        result.push(item.session);
      }
    }
    return result;
  }, [sessionListViewData]);

  const selectedSessionId = React.useMemo(() => {
    if (!pathname.startsWith("/session/")) return undefined;
    const parts = pathname.split("/");
    return parts[2];
  }, [pathname]);

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
            <View style={styles.railStatusDotCenter}>
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

          {/* Project */}
          <Pressable
            onPress={() => router.push("/project")}
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

          {railSessions.length > 0 && <View style={styles.railDivider} />}

          {/* Sessions list - scrollable so user can switch sessions while collapsed */}
          <ScrollView
            style={styles.railSessionsScroll}
            contentContainerStyle={styles.railSessionsContent}
            showsVerticalScrollIndicator={false}
          >
            {railSessions.map((session) => (
              <RailSessionIcon
                key={session.id}
                session={session}
                selected={selectedSessionId === session.id}
                onPress={() => navigateToSession(session.id)}
              />
            ))}
          </ScrollView>

          {/* New session - pinned to bottom */}
          <Pressable
            onPress={handleNewSession}
            hitSlop={8}
            style={[
              styles.railNewSessionButton,
              { marginBottom: safeArea.bottom + 12, marginTop: 4 },
            ]}
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
            <Pressable onPress={() => router.push("/project")} hitSlop={15}>
              <Image
                source={require("@/assets/images/brutalist/Brutalism 22.png")}
                contentFit="contain"
                style={[{ width: 32, height: 32 }]}
                tintColor={theme.colors.header.tint}
              />
            </Pressable>
            <Pressable onPress={() => router.push("/settings")} hitSlop={15}>
              <Image
                source={require("@/assets/images/brutalist/Brutalism 9.png")}
                contentFit="contain"
                style={[{ width: 32, height: 32 }]}
                tintColor={theme.colors.header.tint}
              />
            </Pressable>
            <CreateWorkflowMenu />
          </View>
        </View>
        {realtimeStatus !== "disconnected" && (
          <VoiceAssistantStatusBar variant="sidebar" />
        )}
        <MainView variant="sidebar" />
      </View>
      {/* FABWide removed — the header + menu (CreateWorkflowMenu above)
          is the single source of truth for creation. The floating button
          duplicated that entry and only showed "start session", missing
          the Schedule / Webhook paths the menu exposes. */}
    </>
  );
});
