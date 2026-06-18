import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import {
  Animated,
  LayoutChangeEvent,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { screenLayoutMaxWidth } from "@/components/layout";
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

const stylesheet = StyleSheet.create((theme, rt) => ({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 8,
    zIndex: 10,
    alignItems: "center",
  },
  inner: {
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
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
  autoCompactChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
  autoCompactChipText: {
    fontSize: 9,
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
  buttonActive: {
    backgroundColor: theme.colors.radio.active,
  },
  buttonActivePressed: {
    backgroundColor: theme.colors.radio.active,
    opacity: 0.8,
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
  onStatusPress?: () => void;
  /**
   * Caveman skill toggle, mirrored from AgentInput's expanded status row.
   * When `onCavemanPress` is provided, CompactStatus renders the same
   * always-visible CAVEMAN pill inside its summary capsule so users can
   * flip Caveman mode from the collapsed FAB layout too.
   */
  cavemanActive?: boolean;
  onCavemanPress?: () => void;
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
  /**
   * AUTO/1M chip next to the context-usage label. `enabled === true` shows
   * "AUTO" (200K + happy auto-`/compact` at 150K, the default).
   * `enabled === false` shows "1M" (1M premium context, no happy compact).
   * Tapping calls `onToggle(!enabled)`; the change is lazy — it reaches the
   * CLI on the next user message via `message.meta.autoCompact`.
   */
  autoCompact?: {
    enabled: boolean;
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
  autoCompact,
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
            autoCompact={autoCompact}
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
              active={autoOptionSend.enabled}
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
  autoCompact,
}: {
  info: InputFABStatusInfo;
  theme: ReturnType<typeof useUnistyles>["theme"];
  maxWidth: number;
  autoCompact?: {
    enabled: boolean;
    onToggle: (next: boolean) => void;
  };
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
            <Pressable
              onPress={info.onStatusPress}
              disabled={!info.onStatusPress}
              accessibilityRole={info.onStatusPress ? "button" : undefined}
              hitSlop={8}
              style={({ pressed }) => [
                styles.statusInlineGroup,
                pressed && info.onStatusPress ? { opacity: 0.55 } : null,
              ]}
            >
              <StatusDot
                color={info.statusDotColor}
                isPulsing={info.isPulsing}
                size={5}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.activityText,
                  {
                    color: info.statusColor,
                    textDecorationLine: info.onStatusPress ? "underline" : "none",
                  },
                ]}
              >
                {info.statusText}
              </Text>
              {info.onStatusPress ? (
                <Ionicons
                  name="chevron-forward"
                  size={10}
                  color={info.statusColor}
                />
              ) : null}
            </Pressable>
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
                  // Android doesn't support colored shadow/glow — border+elevation
                  // look like a thick green outline instead of a soft halo.
                  ...(Platform.OS === "android" && {
                    borderWidth: 0,
                    elevation: 0,
                    shadowOpacity: 0,
                  }),
                },
              ]}
            >
              {showSummaryCapsule ? (
                <View style={styles.summaryCapsuleLine}>
                  {info.onCavemanPress ? (() => {
                    // Mirror the CAVEMAN toggle from AgentInput's expanded
                    // status row into the collapsed InputFAB so users can
                    // flip Caveman from either layout. Always-visible per
                    // the original "toggle from any device" contract.
                    // Label is always the short "CM"; state is signalled
                    // by color alone (green fill = active, gray outline
                    // = inactive).
                    const active = !!info.cavemanActive;
                    const tone = active
                      ? theme.colors.success
                      : theme.colors.textSecondary;
                    return (
                      <Pressable
                        onPress={info.onCavemanPress}
                        hitSlop={6}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 999,
                          backgroundColor: active
                            ? `${theme.colors.success}18`
                            : "transparent",
                          borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                          borderColor: active ? "transparent" : tone,
                          opacity: pressed ? 0.6 : 1,
                          cursor: "pointer" as any,
                          flexShrink: 0,
                        })}
                      >
                        <StatusDot color={tone} size={4} />
                        <Text
                          style={{
                            fontSize: 9,
                            color: tone,
                            ...Typography.default("semiBold"),
                          }}
                          numberOfLines={1}
                        >
                          {t("session.cavemanBadgeShort")}
                        </Text>
                      </Pressable>
                    );
                  })() : null}
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
                  <Text style={styles.statusLineText}>
                    {detailSegments.map((seg, i) => (
                      <Text key={`${seg.text}-${i}`} style={{ color: seg.color }}>
                        {i > 0 ? <Text style={separatorStyle}> · </Text> : null}
                        {seg.text}
                      </Text>
                    ))}
                  </Text>
                </View>
              ) : null}

              {shouldShowContext || autoCompact ? (
                <View style={styles.statusStatsLine}>
                  {shouldShowContext ? (
                    <Text
                      style={[styles.statusSummaryLine, { color: barColor }]}
                      numberOfLines={1}
                    >
                      {contextLabel}
                    </Text>
                  ) : null}
                  {autoCompact ? (
                    <Pressable
                      onPress={() => autoCompact.onToggle(!autoCompact.enabled)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={
                        autoCompact.enabled
                          ? t("agentInput.context.autoCompactHintOn")
                          : t("agentInput.context.autoCompactHintOff")
                      }
                      style={({ pressed }) => [
                        styles.autoCompactChip,
                        {
                          borderColor: autoCompact.enabled
                            ? theme.colors.success
                            : theme.colors.textLink,
                          backgroundColor: autoCompact.enabled
                            ? "transparent"
                            : theme.colors.textLink + "1A",
                          opacity: pressed ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.autoCompactChipText,
                          {
                            color: autoCompact.enabled
                              ? theme.colors.success
                              : theme.colors.textLink,
                          },
                        ]}
                      >
                        {autoCompact.enabled
                          ? t("agentInput.context.autoCompactOn")
                          : t("agentInput.context.autoCompactOff")}
                      </Text>
                    </Pressable>
                  ) : null}
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
  /** Renders the button with a solid accent background to indicate an active/on state. */
  active?: boolean;
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
  active = false,
  label,
  badgeColor,
}: FABButtonProps) {
  const activeIconColor = "#FFFFFF";
  const effectiveIconColor = disabled
    ? disabledIconColor
    : active
      ? activeIconColor
      : iconColor;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        active
          ? pressed
            ? styles.buttonActivePressed
            : styles.buttonActive
          : pressed && !disabled
            ? styles.buttonPressed
            : styles.buttonDefault,
        disabled && styles.buttonDisabled,
      ]}
      hitSlop={8}
    >
      <Ionicons
        name={icon}
        size={18}
        color={effectiveIconColor}
      />
      {label ? (
        <Text
          style={[
            styles.buttonLabel,
            { color: effectiveIconColor },
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
