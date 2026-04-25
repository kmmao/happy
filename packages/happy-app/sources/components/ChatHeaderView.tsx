import * as React from "react";
import { Animated, Easing, View, Text, Platform, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Avatar } from "@/components/Avatar";
import { hapticsLight } from "@/components/haptics";
import { Typography } from "@/constants/Typography";
import { useHeaderHeight } from "@/utils/responsive";
import { layout } from "@/components/layout";
import { useUnistyles } from "react-native-unistyles";
import { DevButton } from "@/components/DevButton";
import type { DevButtonState } from "@/hooks/useDevButton";

interface ChatHeaderViewProps {
  title: string;
  subtitle?: string;
  onBackPress?: () => void;
  onAvatarPress?: () => void;
  onPanelPress?: () => void;
  onRefreshPress?: () => Promise<void> | void;
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
}

export const ChatHeaderView: React.FC<ChatHeaderViewProps> = ({
  title,
  subtitle,
  onBackPress,
  onAvatarPress,
  onPanelPress,
  onRefreshPress,
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
}) => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const spinAnim = React.useRef(new Animated.Value(0)).current;
  const isSpinning = React.useRef(false);

  const handleRefreshPress = React.useCallback(async () => {
    if (isSpinning.current || !onRefreshPress) return;
    isSpinning.current = true;
    hapticsLight();

    // Start looping spin animation
    spinAnim.setValue(0);
    const loopAnim = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 750,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loopAnim.start();

    try {
      await onRefreshPress();
    } finally {
      // Stop looping and finish one last clean rotation
      loopAnim.stop();
      spinAnim.setValue(0);
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        isSpinning.current = false;
        hapticsLight();
      });
    }
  }, [onRefreshPress, spinAnim]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

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

          {onRefreshPress && (
            <Pressable
              onPress={handleRefreshPress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Animated.View style={{ transform: [{ rotate: spinInterpolation }] }}>
                <Ionicons
                  name="refresh-outline"
                  size={20}
                  color={theme.colors.header.tint}
                />
              </Animated.View>
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

const styles = StyleSheet.create({
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
    maxWidth: layout.headerMaxWidth,
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
});
