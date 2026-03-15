import * as React from "react";
import { Animated, Easing, View, Text, StyleSheet, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Avatar } from "@/components/Avatar";
import { hapticsLight } from "@/components/haptics";
import { Typography } from "@/constants/Typography";
import { useHeaderHeight } from "@/utils/responsive";
import { layout } from "@/components/layout";
import { useUnistyles } from "react-native-unistyles";

interface ChatHeaderViewProps {
  title: string;
  subtitle?: string;
  onBackPress?: () => void;
  onAvatarPress?: () => void;
  onPreviewPress?: () => void;
  onRefreshPress?: () => void;
  avatarId?: string;
  backgroundColor?: string;
  tintColor?: string;
  isConnected?: boolean;
  flavor?: string | null;
}

export const ChatHeaderView: React.FC<ChatHeaderViewProps> = ({
  title,
  subtitle,
  onBackPress,
  onAvatarPress,
  onPreviewPress,
  onRefreshPress,
  avatarId,
  isConnected = true,
  flavor,
}) => {
  const { theme } = useUnistyles();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const spinAnim = React.useRef(new Animated.Value(0)).current;
  const isSpinning = React.useRef(false);

  const handleRefreshPress = React.useCallback(() => {
    if (isSpinning.current || !onRefreshPress) return;
    isSpinning.current = true;
    onRefreshPress();
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 1500,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      isSpinning.current = false;
      hapticsLight();
    });
  }, [onRefreshPress, spinAnim]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "720deg"],
  });

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      navigation.goBack();
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

          {onPreviewPress && (
            <Pressable
              onPress={onPreviewPress}
              hitSlop={15}
              style={styles.actionButton}
            >
              <Ionicons
                name="eye-outline"
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
});
