import * as React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRealtimeStatus, useRealtimeMode } from "@/sync/storage";
import { StatusDot } from "./StatusDot";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { stopRealtimeSession } from "@/realtime/RealtimeSession";
import { useUnistyles } from "react-native-unistyles";
import { VoiceBars } from "./VoiceBars";
import { ThinkingDots } from "./ThinkingDots";

const THINKING_COLOR = "#F59E0B";

interface VoiceAssistantStatusBarProps {
  variant?: "full" | "sidebar";
  style?: any;
}

export const VoiceAssistantStatusBar = React.memo(
  ({ variant = "full", style }: VoiceAssistantStatusBarProps) => {
    const { theme } = useUnistyles();
    const realtimeStatus = useRealtimeStatus();
    const realtimeMode = useRealtimeMode();

    const statusInfo = React.useMemo(() => {
      if (realtimeStatus === "disconnected") {
        return null;
      }

      const base = {
        backgroundColor: theme.colors.surfaceHighest,
        textColor: theme.colors.text,
      };

      switch (realtimeStatus) {
        case "connecting":
          return {
            ...base,
            color: theme.colors.status.connecting,
            isPulsing: true,
            text: "Connecting...",
          };
        case "error":
          return {
            ...base,
            color: theme.colors.status.error,
            isPulsing: false,
            text: "Connection Error",
          };
        case "connected": {
          const connectedColor = theme.colors.status.connected;
          switch (realtimeMode) {
            case "listening":
              return {
                ...base,
                color: connectedColor,
                isPulsing: true,
                text: "Listening...",
              };
            case "thinking":
              return {
                ...base,
                color: THINKING_COLOR,
                isPulsing: true,
                text: "Processing...",
              };
            case "speaking":
              return {
                ...base,
                color: connectedColor,
                isPulsing: false,
                text: "Speaking",
              };
            default:
              return {
                ...base,
                color: connectedColor,
                isPulsing: false,
                text: "Voice Assistant Active",
              };
          }
        }
        default:
          return {
            ...base,
            color: theme.colors.status.default,
            isPulsing: false,
            text: "Voice Assistant",
          };
      }
    }, [realtimeStatus, realtimeMode, theme]);

    if (!statusInfo) {
      return null;
    }

    const handlePress = async () => {
      if (realtimeStatus === "connected" || realtimeStatus === "connecting") {
        try {
          await stopRealtimeSession();
        } catch (error) {
          console.error("Error stopping voice session:", error);
        }
      }
    };

    const renderModeAnimation = (textColor: string) => {
      if (realtimeStatus !== "connected") return null;

      switch (realtimeMode) {
        case "listening":
          return (
            <VoiceBars
              isActive={true}
              color={theme.colors.status.connected}
              size="small"
            />
          );
        case "thinking":
          return <ThinkingDots color={textColor} />;
        case "speaking":
          return <VoiceBars isActive={true} color={textColor} size="small" />;
        default:
          return null;
      }
    };

    const hasAnimation =
      realtimeMode !== "idle" && realtimeStatus === "connected";

    if (variant === "full") {
      return (
        <View
          style={{
            backgroundColor: statusInfo.backgroundColor,
            height: 32,
            width: "100%",
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 16,
          }}
        >
          <Pressable
            onPress={handlePress}
            style={{
              height: 32,
              width: "100%",
              justifyContent: "center",
              alignItems: "center",
            }}
            hitSlop={10}
          >
            <View style={styles.content}>
              <View style={styles.leftSection}>
                <StatusDot
                  color={statusInfo.color}
                  isPulsing={statusInfo.isPulsing}
                  size={8}
                  style={styles.statusDot}
                />
                <Ionicons
                  name="mic"
                  size={16}
                  color={statusInfo.textColor}
                  style={styles.micIcon}
                />
                <Text
                  style={[styles.statusText, { color: statusInfo.textColor }]}
                >
                  {statusInfo.text}
                </Text>
              </View>

              <View style={styles.rightSection}>
                {renderModeAnimation(statusInfo.textColor)}
                <Text
                  style={[
                    styles.tapToEndText,
                    {
                      color: statusInfo.textColor,
                      marginLeft: hasAnimation ? 8 : 0,
                    },
                  ]}
                >
                  Tap to end
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      );
    }

    // Sidebar version
    const containerStyle = [
      styles.container,
      styles.sidebarContainer,
      {
        backgroundColor: statusInfo.backgroundColor,
      },
      style,
    ];

    return (
      <View style={containerStyle}>
        <Pressable onPress={handlePress} style={styles.pressable} hitSlop={5}>
          <View style={styles.content}>
            <View style={styles.leftSection}>
              <StatusDot
                color={statusInfo.color}
                isPulsing={statusInfo.isPulsing}
                size={8}
                style={styles.statusDot}
              />
              <Ionicons
                name="mic"
                size={16}
                color={statusInfo.textColor}
                style={styles.micIcon}
              />
              <Text
                style={[
                  styles.statusText,
                  styles.sidebarStatusText,
                  { color: statusInfo.textColor },
                ]}
              >
                {statusInfo.text}
              </Text>
            </View>

            {renderModeAnimation(statusInfo.textColor)}

            <Ionicons
              name="close"
              size={14}
              color={statusInfo.textColor}
              style={[styles.closeIcon, { marginLeft: hasAnimation ? 4 : 8 }]}
            />
          </View>
        </Pressable>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    borderRadius: 0,
    marginHorizontal: 0,
    marginVertical: 0,
  },
  fullContainer: {
    justifyContent: "flex-end",
  },
  sidebarContainer: {},
  pressable: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 12,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  rightSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    marginRight: 6,
  },
  micIcon: {
    marginRight: 6,
  },
  closeIcon: {
    marginLeft: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "500",
    ...Typography.default(),
  },
  sidebarStatusText: {
    fontSize: 12,
  },
  tapToEndText: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.8,
    ...Typography.default(),
  },
});
