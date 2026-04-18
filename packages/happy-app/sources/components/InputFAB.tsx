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
  getRpcSummaryStatusLabel,
  getRpcSummaryVisualState,
} from "@/components/rpcSummaryVisualState";
import {
  formatDurationMs,
  formatTokenCountShort,
  getContextWindowSize,
} from "@/utils/formatUsage";
import type { SessionRpcVisualState } from "@/utils/sessionRpcVisualState";

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
    flexDirection: "column" as const,
    alignItems: "stretch" as const,
    paddingHorizontal: 16,
    gap: 8,
  },
  buttonsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    alignSelf: "stretch" as const,
    width: "100%",
    justifyContent: "flex-end" as const,
    flexWrap: "wrap" as const,
  },
  statusWrap: {
    alignSelf: "flex-end" as const,
    width: "100%",
    alignItems: "flex-end" as const,
    gap: 6,
  },
  statusShell: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    justifyContent: "flex-end" as const,
    gap: 10,
    maxWidth: "100%",
  },
  statusCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.08,
    elevation: 2,
  },
  statusLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 6,
    minWidth: 0,
  },
  statusStatsLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 10,
    minWidth: 0,
  },
  statusInlineGroup: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  activityText: {
    textAlign: "left" as const,
    fontSize: 10,
    flexShrink: 1,
    ...Typography.default(),
  },
  statusLineText: {
    flexShrink: 1,
    textAlign: "right" as const,
    fontSize: 10,
    ...Typography.default(),
  },
  statusSummaryLine: {
    fontSize: 10,
    textAlign: "right" as const,
    flexShrink: 1,
    ...Typography.default("semiBold"),
  },
  summaryCapsuleLine: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "flex-end" as const,
    gap: 6,
    minWidth: 0,
  },
  summaryPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    flexShrink: 0,
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
  rpcState?: SessionRpcVisualState;
  modelSummaryText?: string | null;
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
      <View style={styles.inner}>
        {statusInfo ? (
          <CompactStatus
            info={statusInfo}
            theme={theme}
            maxWidth={Math.min(width - 32, 420)}
          />
        ) : (
          <View />
        )}

        <View style={styles.buttonsRow}>
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
  maxWidth,
}: {
  info: InputFABStatusInfo;
  theme: ReturnType<typeof useUnistyles>["theme"];
  maxWidth: number;
}) {
  const styles = stylesheet;
  const rpcVisualState = React.useMemo(
    () => getRpcSummaryVisualState(info.rpcState, theme.colors),
    [info.rpcState, theme.colors],
  );
  const rpcStatusLabel = React.useMemo(
    () => getRpcSummaryStatusLabel({ rpcState: info.rpcState, translate: t }),
    [info.rpcState],
  );
  const modelSummaryText = info.modelSummaryText?.trim() || null;
  const showSummaryCapsule = Boolean(rpcStatusLabel || modelSummaryText);

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

  const detailSegments: { text: string; color: string }[] = [];
  if (!showSummaryCapsule && info.permissionLabel) {
    detailSegments.push({
      text: info.permissionLabel,
      color: info.permissionColor ?? theme.colors.textSecondary,
    });
  }
  if (!showSummaryCapsule && info.modelLabel) {
    detailSegments.push({
      text: info.modelLabel,
      color: theme.colors.textSecondary,
    });
  }

  const separatorStyle = {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  } as const;

  const showStatusCard = Boolean(
    showSummaryCapsule ||
      detailSegments.length > 0 ||
      shouldShowContext ||
      sessionTokensLabel,
  );
  const showExternalStatus = Boolean(info.statusText);

  return (
    <View style={styles.statusWrap}>
      {showExternalStatus || showStatusCard ? (
        <View style={styles.statusShell}>
          {showExternalStatus ? (
            <View style={styles.statusInlineGroup}>
              <StatusDot
                color={info.statusDotColor}
                isPulsing={info.isPulsing}
                size={5}
              />
              <Text
                numberOfLines={1}
                style={[styles.activityText, { color: info.statusColor }]}
              >
                {info.statusText}
              </Text>
            </View>
          ) : null}

          {showStatusCard ? (
            <View
              style={[
                styles.statusCard,
                {
                  maxWidth,
                  borderColor: rpcVisualState.borderColor,
                  backgroundColor: rpcVisualState.backgroundColor,
                  shadowColor: rpcVisualState.glowColor,
                },
              ]}
            >
              {showSummaryCapsule ? (
                <View style={styles.summaryCapsuleLine}>
                  {rpcStatusLabel ? (
                    <View
                      style={[
                        styles.summaryPill,
                        { backgroundColor: rpcVisualState.pillBackgroundColor },
                      ]}
                    >
                      <StatusDot
                        color={rpcVisualState.pillDotColor}
                        isPulsing={info.rpcState === "reconnecting"}
                        size={5}
                      />
                      <Text
                        style={{
                          fontSize: 10,
                          color: rpcVisualState.pillTextColor,
                          ...Typography.default("semiBold"),
                        }}
                        numberOfLines={1}
                      >
                        {rpcStatusLabel}
                      </Text>
                    </View>
                  ) : null}
                  {modelSummaryText ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.statusLineText,
                        { color: rpcVisualState.summaryTextColor },
                      ]}
                    >
                      {modelSummaryText}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {!showSummaryCapsule && detailSegments.length > 0 ? (
                <View style={styles.statusLine}>
                  <Text numberOfLines={1} style={styles.statusLineText}>
                    {detailSegments.map((seg, i) => (
                      <Text key={`${seg.text}-${i}`} style={{ color: seg.color }}>
                        {i > 0 ? <Text style={separatorStyle}> · </Text> : null}
                        {seg.text}
                      </Text>
                    ))}
                  </Text>
                </View>
              ) : null}

              {shouldShowContext ? (
                <View style={styles.statusStatsLine}>
                  <Text
                    style={[styles.statusSummaryLine, { color: barColor }]}
                    numberOfLines={1}
                  >
                    {contextLabel}
                  </Text>
                </View>
              ) : sessionTokensLabel ? (
                <View style={styles.statusStatsLine}>
                  <Text
                    style={[
                      styles.statusSummaryLine,
                      { color: rpcVisualState.summaryTextColor },
                    ]}
                    numberOfLines={1}
                  >
                    {sessionTokensLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
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
