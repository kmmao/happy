import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { StatusDot } from "@/components/StatusDot";
import { Typography } from "@/constants/Typography";
import { useElapsedTime } from "@/hooks/useElapsedTime";
import {
  formatDurationMs,
  formatTokenCountShort,
  getContextWindowSize,
} from "@/utils/formatUsage";

const COMPACT_LAYOUT_BREAKPOINT = 520;

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
  innerCompact: {
    flexDirection: "column" as const,
    alignItems: "flex-end" as const,
    justifyContent: "flex-start" as const,
    gap: 8,
  },
  column: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  columnCompact: {
    alignSelf: "flex-end" as const,
  },
  statusColumn: {
    alignItems: "flex-start" as const,
    gap: 2,
    flex: 1,
  },
  statusColumnCompact: {
    flex: 0,
    alignItems: "flex-end" as const,
    width: "100%",
  },
  statusLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  statusLineCompact: {
    justifyContent: "flex-end" as const,
    alignSelf: "flex-end" as const,
  },

  button: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: theme.colors.shadow.opacity,
    elevation: 3,
    paddingHorizontal: 10,
    flexDirection: "row" as const,
    gap: 4,
  },
  buttonDefault: {
    backgroundColor: theme.colors.fab.background,
  },
  buttonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
  buttonDisabled: {
    backgroundColor: theme.colors.fab.background,
  },
  badge: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  buttonLabel: {
    fontSize: 11,
    ...Typography.default("semiBold"),
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
  totalDurationMs?: number;
  completedTurnsDurationMs?: number;
  isThinking?: boolean;
  turnStartedAt?: number;
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
  autoOptionSend?: {
    visible: boolean;
    enabled: boolean;
    remainingMs: number | null;
    onToggle: (next: boolean) => void;
  };
  onHeightChange?: (height: number) => void;
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
  autoOptionSend,
  onHeightChange,
}: InputFABProps) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const styles = stylesheet;
  const opacity = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [shouldRender, setShouldRender] = React.useState(visible);
  const isCompactLayout = width <= COMPACT_LAYOUT_BREAKPOINT;

  React.useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(opacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShouldRender(false);
      }
    });
  }, [visible, opacity]);

  React.useEffect(() => {
    if (!visible) {
      onHeightChange?.(0);
    }
  }, [visible, onHeightChange]);

  const handleLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      onHeightChange?.(event.nativeEvent.layout.height);
    },
    [onHeightChange],
  );

  if (!shouldRender) return null;

  const showNavButtons =
    hasUserMessages && onPrevUserMessage && onNextUserMessage;
  const showOptions = optionCount > 0 && onOptionsPress;
  const showBookmarks = bookmarkCount > 0 && onBookmarksPress;
  const iconColor = theme.colors.fab.icon;
  const disabledIconColor = theme.colors.textSecondary;
  const badgeColor = theme.colors.radio.dot;
  const noop = () => {};

  return (
    <Animated.View
      style={[styles.container, { opacity }]}
      onLayout={handleLayout}
    >
      <View
        style={[
          styles.inner,
          isCompactLayout && styles.innerCompact,
        ]}
      >
        {statusInfo ? (
          <CompactStatus
            info={statusInfo}
            theme={theme}
            compact={isCompactLayout}
          />
        ) : (
          <View />
        )}

        <View
          style={[
            styles.column,
            isCompactLayout && styles.columnCompact,
          ]}
        >
          <FABButton
            icon="sparkles"
            onPress={onOptionsPress ?? noop}
            styles={styles}
            iconColor={iconColor}
            disabledIconColor={disabledIconColor}
            disabled={!showOptions}
          />
          {autoOptionSend?.visible && (
            <FABButton
              icon="sparkles"
              label={
                autoOptionSend.enabled && autoOptionSend.remainingMs != null
                  ? t("session.autoOptionSendCountdown", {
                      seconds: Math.max(
                        1,
                        Math.ceil(autoOptionSend.remainingMs / 1000),
                      ),
                    })
                  : autoOptionSend.enabled
                    ? t("session.autoOptionSendActiveLabel")
                    : t("session.autoOptionSendLabel")
              }
              onPress={() => autoOptionSend.onToggle(!autoOptionSend.enabled)}
              badgeColor={autoOptionSend.enabled ? badgeColor : undefined}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
            />
          )}
          <FABButton
            icon="bookmark"
            onPress={onBookmarksPress ?? noop}
            styles={styles}
            iconColor={iconColor}
            disabledIconColor={disabledIconColor}
            disabled={!showBookmarks}
          />
          <FABButton
            icon="arrow-up"
            onPress={onPrevUserMessage ?? noop}
            styles={styles}
            iconColor={iconColor}
            disabledIconColor={disabledIconColor}
            disabled={!showNavButtons}
          />
          {showScrollDown ? (
            <FABButton
              icon="chevron-down"
              onPress={onScrollDown}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
            />
          ) : (
            <FABButton
              icon="chevron-down"
              onPress={noop}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
              disabled
            />
          )}
          <FABButton
            icon="arrow-down"
            onPress={onNextUserMessage ?? noop}
            styles={styles}
            iconColor={iconColor}
            disabledIconColor={disabledIconColor}
            disabled={!showNavButtons}
          />
          <FABButton
            icon="expand-outline"
            onPress={onExpandPress}
            badgeColor={
              hasPendingAction && !showOptions ? badgeColor : undefined
            }
            styles={styles}
            iconColor={iconColor}
            disabledIconColor={disabledIconColor}
          />
        </View>
      </View>
    </Animated.View>
  );
});

const CompactStatus = React.memo(function CompactStatus({
  info,
  theme,
  compact,
}: {
  info: InputFABStatusInfo;
  theme: ReturnType<typeof useUnistyles>["theme"];
  compact: boolean;
}) {
  const styles = stylesheet;

  const currentTurnElapsedSec = useElapsedTime(
    info.isThinking ? info.turnStartedAt : undefined,
  );

  const elapsedLabel = React.useMemo(() => {
    const currentTurnMs = currentTurnElapsedSec * 1000;
    if (info.isThinking) {
      const totalMs = (info.completedTurnsDurationMs ?? 0) + currentTurnMs;
      if (totalMs <= 0) return null;
      const totalStr = formatDurationMs(totalMs);
      if ((info.completedTurnsDurationMs ?? 0) > 0 && currentTurnMs > 0) {
        return `${totalStr} (${formatDurationMs(currentTurnMs)})`;
      }
      return totalStr;
    }
    const totalMs = info.totalDurationMs ?? 0;
    if (totalMs <= 0) return null;
    return formatDurationMs(totalMs);
  }, [
    info.totalDurationMs,
    info.completedTurnsDurationMs,
    info.isThinking,
    currentTurnElapsedSec,
  ]);

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
  const elapsedSuffix = elapsedLabel ? ` · ${elapsedLabel}` : "";
  const contextLabel = `${Math.round(percentageRemaining)}% left · ${formatTokenCountShort(contextSize)}/${formatTokenCountShort(contextWindowSize)}${sessionTokensSuffix}${costSuffix}${elapsedSuffix}`;

  const sessionTokens = info.totalSessionTokens;
  const sessionTokensLabel =
    sessionTokens != null && sessionTokens > 0
      ? `Σ${formatTokenCountShort(sessionTokens)}${costSuffix}${elapsedSuffix}`
      : null;

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
    <View
      style={[
        styles.statusColumn,
        compact && styles.statusColumnCompact,
      ]}
    >
      <View
        style={[
          styles.statusLine,
          compact && styles.statusLineCompact,
        ]}
      >
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

      {shouldShowContext ? (
        <Text
          style={{
            fontSize: 9,
            color: barColor,
            textAlign: compact ? "right" : "left",
            alignSelf: compact ? "flex-end" : "auto",
            ...Typography.default(),
          }}
          numberOfLines={1}
        >
          {contextLabel}
        </Text>
      ) : sessionTokensLabel ? (
        <Text
          style={{
            fontSize: 9,
            color: theme.colors.textSecondary,
            textAlign: compact ? "right" : "left",
            alignSelf: compact ? "flex-end" : "auto",
            ...Typography.default(),
          }}
          numberOfLines={1}
        >
          {sessionTokensLabel}
        </Text>
      ) : null}
    </View>
  );
});

interface FABButtonProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  styles: typeof stylesheet;
  iconColor: string;
  disabledIconColor: string;
  disabled?: boolean;
  label?: string;
  badgeColor?: string;
}

function FABButton({
  icon,
  onPress,
  styles,
  iconColor,
  disabledIconColor,
  disabled = false,
  label,
  badgeColor,
}: FABButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled ? styles.buttonPressed : styles.buttonDefault,
        disabled && styles.buttonDisabled,
      ]}
      hitSlop={8}
    >
      <Ionicons
        name={icon}
        size={18}
        color={disabled ? disabledIconColor : iconColor}
      />
      {label ? (
        <Text
          style={[
            styles.buttonLabel,
            { color: disabled ? disabledIconColor : iconColor },
          ]}
        >
          {label}
        </Text>
      ) : null}
      {badgeColor ? (
        <View style={[styles.badge, { backgroundColor: badgeColor }]} />
      ) : null}
    </Pressable>
  );
}
