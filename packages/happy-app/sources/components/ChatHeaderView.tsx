import * as React from "react";
import { View, Text, Platform, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    Easing,
} from "react-native-reanimated";
import { Avatar } from "@/components/Avatar";
import { Typography } from "@/constants/Typography";
import { useHeaderHeight } from "@/utils/responsive";
import { screenHeaderMaxWidth } from "@/components/layout";
import { useUnistyles } from "react-native-unistyles";
import { DevButton } from "@/components/DevButton";
import type { DevButtonState } from "@/hooks/useDevButton";
import { formatActiveCwd } from "./chatHeaderActiveCwd";

interface ChatHeaderViewProps {
  title: string;
  subtitle?: string;
  /**
   * The cwd the session was launched in (`metadata.path`). Shown as a
   * faint third line **only** when `activeCwd` is present and differs
   * from `launchPath` — i.e. Claude has actually moved out of the launch
   * directory. We display only the basename so the row stays compact;
   * full path lives on Session Info.
   */
  launchPath?: string;
  /**
   * Claude's current working directory, written by happy-cli when the
   * Claude Code 2.1.121+ `CwdChanged` hook fires. Absent on older CLIs
   * and before the first cwd change — the header silently omits the row
   * in that case.
   */
  activeCwd?: string;
  onBackPress?: () => void;
  onAvatarPress?: () => void;
  onPanelPress?: () => void;
  avatarId?: string;
  backgroundColor?: string;
  tintColor?: string;
  isConnected?: boolean;
  flavor?: string | null;
  provider?: string | null;
  knowledgeCount?: number;
  onKnowledgePress?: () => void;
  onResumePress?: () => void;
  onForkPress?: () => void;
  devButtonState?: DevButtonState;
  devRunningCount?: number;
  devTotalCount?: number;
  onDevPress?: () => void;
  onDevLongPress?: () => void;
  onUpgradePress?: () => void;
  onReloadPress?: () => void;
}

export const ChatHeaderView: React.FC<ChatHeaderViewProps> = ({
  title,
  subtitle,
  launchPath,
  activeCwd,
  onBackPress,
  onAvatarPress,
  onPanelPress,
  avatarId,
  isConnected = true,
  flavor,
  provider,
  knowledgeCount,
  onKnowledgePress,
  onResumePress,
  onForkPress,
  devButtonState,
  devRunningCount,
  devTotalCount,
  onDevPress,
  onDevLongPress,
  onUpgradePress,
  onReloadPress,
}) => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const reloadRotation = useSharedValue(0);
  const reloadAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${reloadRotation.value}deg` }],
  }));
  const handleReloadPress = React.useCallback(() => {
      reloadRotation.value = withTiming(reloadRotation.value + 360, {
          duration: 600,
          easing: Easing.out(Easing.cubic),
      });
      onReloadPress?.();
  }, [onReloadPress, reloadRotation]);

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      router.back();
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          backgroundColor: theme.colors.header.background,
        },
      ]}
    >
      <View style={styles.contentWrapper}>
        <View style={[styles.content, { height: headerHeight }]}>
          <Pressable
            onPress={handleBackPress}
            style={styles.backButton}
            hitSlop={15}
          >
            <Ionicons
              name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
              size={Platform.select({ ios: 28, default: 24 })}
              color={theme.colors.header.tint}
            />
          </Pressable>

          <View style={styles.titleContainer}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.title,
                {
                  color: theme.colors.header.tint,
                  ...Typography.default("semiBold"),
                },
              ]}
            >
              {title}
            </Text>
            {subtitle && (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.subtitle,
                  {
                    color: theme.colors.header.tint,
                    opacity: 0.7,
                    ...Typography.default(),
                  },
                ]}
              >
                {subtitle}
              </Text>
            )}
            {/* Live working directory — third header line, only when Claude
                has actually moved out of the launch cwd. Suppressed when
                activeCwd is unset (older CLIs) or equal to launchPath. */}
            {activeCwd && activeCwd !== launchPath && (
              <View style={styles.activeCwdRow}>
                <Ionicons
                  name="folder-open-outline"
                  size={10}
                  color={theme.colors.header.tint}
                  style={{ opacity: 0.55 }}
                />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={[
                    styles.activeCwd,
                    {
                      color: theme.colors.header.tint,
                      opacity: 0.55,
                      ...Typography.default(),
                    },
                  ]}
                >
                  {formatActiveCwd(activeCwd, launchPath)}
                </Text>
              </View>
            )}
          </View>

          {knowledgeCount != null && knowledgeCount > 0 && (
            <Pressable
              style={[styles.knowledgeBadge, { backgroundColor: theme.colors.primary + "20" }]}
              onPress={onKnowledgePress}
              hitSlop={6}
            >
              <Ionicons name="bulb-outline" size={11} color={theme.colors.primary} />
              <Text style={[styles.knowledgeBadgeText, { color: theme.colors.primary }]}>
                {knowledgeCount}
              </Text>
            </Pressable>
          )}

          {devButtonState && devButtonState !== "hidden" && onDevPress && (
            <DevButton
              state={devButtonState}
              runningCount={devRunningCount ?? 0}
              totalCount={devTotalCount ?? 0}
              onPress={onDevPress}
              onLongPress={onDevLongPress}
              tintColor={theme.colors.header.tint}
            />
          )}

          {onResumePress && (
            <Pressable
              onPress={onResumePress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Ionicons
                name="play-circle-outline"
                size={24}
                color="#34C759"
              />
            </Pressable>
          )}

          {onForkPress && (
            <Pressable
              onPress={onForkPress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Ionicons
                name="git-branch-outline"
                size={20}
                color={theme.colors.header.tint}
              />
            </Pressable>
          )}

          {onUpgradePress && (
            <Pressable
              onPress={onUpgradePress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Ionicons
                name="arrow-up-circle"
                size={22}
                color="#F59E0B"
              />
            </Pressable>
          )}

          {onReloadPress && (
            <Pressable
              onPress={handleReloadPress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Animated.View style={reloadAnimatedStyle}>
                <Ionicons
                  name="refresh-outline"
                  size={20}
                  color={theme.colors.header.tint}
                />
              </Animated.View>
            </Pressable>
          )}

          {onPanelPress && (
            <Pressable
              onPress={onPanelPress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Ionicons
                name="grid-outline"
                size={20}
                color={theme.colors.header.tint}
              />
            </Pressable>
          )}

          {avatarId && onAvatarPress && (
            <Pressable
              onPress={onAvatarPress}
              hitSlop={15}
              style={styles.avatarButton}
            >
              <Avatar
                id={avatarId}
                size={32}
                monochrome={!isConnected}
                flavor={flavor}
                provider={provider}
              />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create((_, rt) => ({
  container: {
    position: "relative",
    zIndex: 100,
  },
  contentWrapper: {
    width: "100%",
    alignItems: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Platform.OS === "ios" ? 8 : 16,
    width: "100%",
    maxWidth: screenHeaderMaxWidth(rt.screen.width, rt.screen.height),
  },
  backButton: {
    marginRight: 8,
  },
  titleContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  title: {
    fontSize: Platform.select({
      ios: 15,
      android: 15,
      default: 16,
    }),
    fontWeight: "600",
    marginBottom: 1,
    width: "100%",
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 14,
  },
  activeCwdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
    width: "100%",
  },
  activeCwd: {
    fontSize: 11,
    fontWeight: "400",
    lineHeight: 13,
    flexShrink: 1,
  },
  actionButton: {
    width: 36,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Platform.select({ ios: -8, default: -8 }),
  },
  knowledgeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
    gap: 2,
  },
  knowledgeBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
}));
