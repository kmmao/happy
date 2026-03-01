import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { StatusDot } from "@/components/StatusDot";
import { Typography } from "@/constants/Typography";
import {
  formatTokenCountShort,
  getContextWindowSize,
} from "@/utils/formatUsage";

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 8,
    zIndex: 10,
    alignItems: "center",
  },
  inner: {
    maxWidth: layout.maxWidth,
    width: "100%",
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-end" as const,
    paddingHorizontal: 16,
  },
  column: {
    alignItems: "center" as const,
    gap: 6,
  },
  statusColumn: {
    alignItems: "flex-start" as const,
    gap: 2,
    flex: 1,
  },
  statusLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: theme.colors.shadow.opacity,
    elevation: 3,
  },
  buttonDefault: {
    backgroundColor: theme.colors.fab.background,
  },
  buttonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
  badge: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
}));

export interface InputFABStatusInfo {
  statusText: string;
  statusColor: string;
  statusDotColor: string;
  isPulsing: boolean;
  permissionLabel?: string;
  permissionColor?: string;
  modelLabel?: string;
  contextSize?: number;
  contextWindow?: number;
  totalSessionTokens?: number;
  totalCostUsd?: number;
  alwaysShowContext?: boolean;
  modelCode?: string | null;
}

interface InputFABProps {
  visible: boolean;
  onExpandPress: () => void;
  hasPendingAction: boolean;
  showScrollDown: boolean;
  onScrollDown: () => void;
  onPrevUserMessage?: () => void;
  onNextUserMessage?: () => void;
  hasUserMessages?: boolean;
  optionCount?: number;
  onOptionsPress?: () => void;
  bookmarkCount?: number;
  onBookmarksPress?: () => void;
  statusInfo?: InputFABStatusInfo;
}

export const InputFAB = React.memo(function InputFAB({
  visible,
  onExpandPress,
  hasPendingAction,
  showScrollDown,
  onScrollDown,
  onPrevUserMessage,
  onNextUserMessage,
  hasUserMessages,
  optionCount = 0,
  onOptionsPress,
  bookmarkCount = 0,
  onBookmarksPress,
  statusInfo,
}: InputFABProps) {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const opacity = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shouldRender, setShouldRender] = React.useState(visible);

  React.useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setShouldRender(false);
        }
      });
    }
  }, [visible, opacity]);

  if (!shouldRender) return null;

  const showNavButtons =
    hasUserMessages && onPrevUserMessage && onNextUserMessage;
  const showOptions = optionCount > 0 && onOptionsPress;
  const showBookmarks = bookmarkCount > 0 && onBookmarksPress;
  const iconColor = theme.colors.fab.icon;
  const badgeColor = theme.colors.radio.dot;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={styles.inner}>
        {/* Status info — left-aligned, bottom-aligned */}
        {statusInfo ? (
          <CompactStatus info={statusInfo} theme={theme} />
        ) : (
          <View />
        )}

        {/* Vertical button column — right side */}
        <View style={styles.column}>
          {showOptions && (
            <FABButton
              key="options"
              icon="sparkles"
              onPress={onOptionsPress}
              badgeColor={badgeColor}
              styles={styles}
              iconColor={iconColor}
            />
          )}
          {hasPendingAction && !showOptions && (
            <FABButton
              key="suggestion"
              icon="sparkles-outline"
              onPress={onExpandPress}
              badgeColor={badgeColor}
              styles={styles}
              iconColor={iconColor}
            />
          )}
          {showBookmarks && (
            <FABButton
              key="bookmarks"
              icon="bookmark"
              onPress={onBookmarksPress}
              badgeColor={badgeColor}
              styles={styles}
              iconColor={iconColor}
            />
          )}
          {showNavButtons && (
            <FABButton
              key="prev"
              icon="arrow-up"
              onPress={onPrevUserMessage}
              styles={styles}
              iconColor={iconColor}
            />
          )}
          {showScrollDown && (
            <FABButton
              key="scroll-down"
              icon="chevron-down"
              onPress={onScrollDown}
              styles={styles}
              iconColor={iconColor}
            />
          )}
          {showNavButtons && (
            <FABButton
              key="next"
              icon="arrow-down"
              onPress={onNextUserMessage}
              styles={styles}
              iconColor={iconColor}
            />
          )}

          {/* Expand input button */}
          <FABButton
            key="expand"
            icon="expand-outline"
            onPress={onExpandPress}
            styles={styles}
            iconColor={iconColor}
          />
        </View>
      </View>
    </Animated.View>
  );
});

const CompactStatus = React.memo(function CompactStatus({
  info,
  theme,
}: {
  info: InputFABStatusInfo;
  theme: ReturnType<typeof useUnistyles>["theme"];
}) {
  const styles = stylesheet;

  // Context bar computation
  const contextSize = info.contextSize ?? 0;
  const knownWindowSize = getContextWindowSize(
    info.modelCode,
    info.contextWindow,
  );
  const contextWindowSize =
    contextSize > knownWindowSize ? 1_000_000 : knownWindowSize;
  const percentageUsed = Math.min(100, (contextSize / contextWindowSize) * 100);
  const percentageRemaining = Math.max(0, 100 - percentageUsed);
  const shouldShowContext =
    info.alwaysShowContext || (contextSize > 0 && percentageRemaining <= 10);

  const barColor =
    percentageRemaining <= 5
      ? theme.colors.warningCritical
      : percentageRemaining <= 20
        ? "#FF9500"
        : theme.colors.success;

  const sessionTokensSuffix =
    info.totalSessionTokens && info.totalSessionTokens > 0
      ? ` · Σ${formatTokenCountShort(info.totalSessionTokens)}`
      : "";
  const costSuffix =
    info.totalCostUsd && info.totalCostUsd > 0
      ? ` · $${info.totalCostUsd < 0.01 ? info.totalCostUsd.toFixed(4) : info.totalCostUsd.toFixed(2)}`
      : "";
  const contextLabel = `${Math.round(percentageRemaining)}% left · ${formatTokenCountShort(contextSize)}/${formatTokenCountShort(contextWindowSize)}${sessionTokensSuffix}${costSuffix}`;

  // Build status segments: "● status · permission · model"
  const segments: { text: string; color: string }[] = [
    { text: info.statusText, color: info.statusColor },
  ];
  if (info.permissionLabel) {
    segments.push({
      text: info.permissionLabel,
      color: info.permissionColor ?? theme.colors.textSecondary,
    });
  }
  if (info.modelLabel) {
    segments.push({ text: info.modelLabel, color: theme.colors.textSecondary });
  }

  const separatorStyle = {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  } as const;

  return (
    <View style={styles.statusColumn}>
      {/* Status line: ● text · perm · model */}
      <View style={styles.statusLine}>
        <StatusDot
          color={info.statusDotColor}
          isPulsing={info.isPulsing}
          size={5}
        />
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text style={separatorStyle}>·</Text>}
            <Text
              style={{
                fontSize: 10,
                color: seg.color,
                ...Typography.default(),
              }}
              numberOfLines={1}
            >
              {seg.text}
            </Text>
          </React.Fragment>
        ))}
      </View>

      {/* Context usage */}
      {shouldShowContext && (
        <Text
          style={{
            fontSize: 9,
            color: barColor,
            ...Typography.default(),
          }}
          numberOfLines={1}
        >
          {contextLabel}
        </Text>
      )}
    </View>
  );
});

const FABButton = React.memo(function FABButton({
  icon,
  onPress,
  size = 18,
  badgeColor,
  styles,
  iconColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  size?: number;
  badgeColor?: string;
  styles: typeof stylesheet;
  iconColor: string;
}) {
  return (
    <View>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : styles.buttonDefault,
        ]}
        onPress={onPress}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        accessibilityRole="button"
      >
        <Ionicons name={icon} size={size} color={iconColor} />
      </Pressable>
      {badgeColor && (
        <View style={[styles.badge, { backgroundColor: badgeColor }]} />
      )}
    </View>
  );
});
