import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { BaseModal } from "./BaseModal";
import { AlertModalConfig, ConfirmModalConfig } from "../types";
import { Typography } from "@/constants/Typography";
import { StyleSheet } from "react-native";
import { useUnistyles } from "react-native-unistyles";

interface WebAlertModalProps {
  config: AlertModalConfig | ConfirmModalConfig;
  onClose: () => void;
  onConfirm?: (value: boolean) => void;
}

export function WebAlertModal({
  config,
  onClose,
  onConfirm,
}: WebAlertModalProps) {
  const { theme } = useUnistyles();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const isConfirm = config.type === "confirm";
  const modalWidth = Math.min(Math.max(270, windowWidth * 0.85), 480);
  const maxMessageHeight = windowHeight * 0.4;
  /** Many action rows (e.g. Agent Loops menu) must scroll — otherwise bottom buttons are clipped by container maxHeight. */
  const maxButtonStackHeight = windowHeight * 0.42;

  const handleButtonPress = (buttonIndex: number) => {
    if (isConfirm && onConfirm) {
      onConfirm(buttonIndex === 1);
    } else if (!isConfirm && config.buttons?.[buttonIndex]?.onPress) {
      config.buttons[buttonIndex].onPress!();
    }
    onClose();
  };

  const buttons = isConfirm
    ? [
        { text: config.cancelText || "Cancel", style: "cancel" as const },
        {
          text: config.confirmText || "OK",
          style: config.destructive
            ? ("destructive" as const)
            : ("default" as const),
        },
      ]
    : config.buttons || [{ text: "OK", style: "default" as const }];

  const isVertical = buttons.length > 2;

  // 暗色主题检测（通过 surface 背景色判断）
  const isDark = (theme.colors.surface as string).toLowerCase().startsWith("#1");
  const glassBackground = isDark ? "rgba(30,30,34,0.75)" : "rgba(255,255,255,0.75)";
  const glassBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.7)";

  const styles = StyleSheet.create({
    container: {
      backgroundColor: glassBackground,
      borderRadius: 18,
      width: modalWidth,
      maxHeight: windowHeight * 0.8,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: glassBorder,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.5 : 0.2,
      shadowRadius: 24,
      elevation: 12,
    } as any,
    content: {
      paddingHorizontal: 20,
      paddingTop: 22,
      paddingBottom: 18,
      alignItems: "center",
    },
    title: {
      fontSize: 17,
      textAlign: "center",
      color: theme.colors.text,
      marginBottom: 4,
    },
    message: {
      fontSize: 13,
      textAlign: "center",
      color: theme.colors.text,
      marginTop: 4,
      lineHeight: 18,
    },
    buttonContainer: {
      borderTopWidth: 1,
      borderTopColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      flexDirection: isVertical ? "column" : "row",
    },
    button: {
      flex: isVertical ? undefined : 1,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonPressed: {
      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    },
    buttonSeparator: {
      width: isVertical ? undefined : 1,
      height: isVertical ? 1 : undefined,
      backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
    },
    buttonText: {
      fontSize: 17,
      color: theme.colors.textLink,
    },
    cancelText: {
      fontWeight: "400",
    },
    destructiveText: {
      color: theme.colors.textDestructive,
    },
  });

  return (
    <BaseModal visible={true} onClose={onClose} closeOnBackdrop={false}>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={[styles.title, Typography.default("semiBold")]}>
            {config.title}
          </Text>
          {config.message && (
            <ScrollView
              style={{ maxHeight: maxMessageHeight }}
              bounces={false}
              showsVerticalScrollIndicator
            >
              <Text style={[styles.message, Typography.default()]}>
                {config.message}
              </Text>
            </ScrollView>
          )}
        </View>

        {buttons.length > 0 ? (
          <ScrollView
            style={{ maxHeight: maxButtonStackHeight }}
            bounces={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={buttons.length > 5}
          >
            <View style={styles.buttonContainer}>
              {buttons.map((button, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <View style={styles.buttonSeparator} />}
                  <Pressable
                    style={({ pressed }) => [
                      styles.button,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => handleButtonPress(index)}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        button.style === "cancel" && styles.cancelText,
                        button.style === "destructive" && styles.destructiveText,
                        Typography.default(
                          button.style === "cancel" ? undefined : "semiBold",
                        ),
                      ]}
                    >
                      {button.text}
                    </Text>
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </View>
    </BaseModal>
  );
}
