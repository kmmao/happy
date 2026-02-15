import * as React from "react";
import { Animated, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { layout } from "./layout";
import { getAllCommands, CommandItem } from "@/sync/suggestionCommands";

interface CommandListPopoverProps {
  visible: boolean;
  sessionId: string;
  onCommandSelect: (command: string) => void;
  onClose: () => void;
}

export const CommandListPopover = React.memo(
  ({
    visible,
    sessionId,
    onCommandSelect,
    onClose,
  }: CommandListPopoverProps) => {
    const { theme } = useUnistyles();
    const opacity = React.useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = React.useState(false);
    const [commands, setCommands] = React.useState<CommandItem[]>([]);

    React.useEffect(() => {
      if (visible) {
        setCommands(getAllCommands(sessionId));
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
    }, [visible, sessionId]);

    if (!shouldRender) return null;

    return (
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.centerAnchor} pointerEvents="box-none">
          <View style={styles.bubble}>
            <View style={styles.header}>
              <Text style={styles.headerText}>/ Commands</Text>
            </View>
            <ScrollView
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {commands.map((cmd, index) => (
                <Pressable
                  key={cmd.command}
                  style={({ pressed }) => [
                    styles.commandItem,
                    index < commands.length - 1 && styles.commandItemBorder,
                    pressed && styles.commandItemPressed,
                  ]}
                  onPress={() => onCommandSelect(cmd.command)}
                >
                  <Text style={styles.commandName}>/{cmd.command}</Text>
                  {cmd.description ? (
                    <Text
                      style={[
                        styles.commandDesc,
                        { color: theme.colors.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {cmd.description}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...Platform.select({
      web: { position: "fixed" as any },
      default: { position: "absolute" },
    }),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    ...Platform.select({
      web: { position: "fixed" as any },
      default: { position: "absolute" },
    }),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centerAnchor: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  bubble: {
    maxWidth: layout.maxWidth - 32,
    width: "90%",
    maxHeight: 360,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: Platform.OS === "web" ? 0 : 0.5,
    borderColor: theme.colors.modal.border,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: theme.colors.shadow.opacity * 1.5,
    elevation: 8,
    overflow: "hidden",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  headerText: {
    ...Typography.default("semiBold"),
    fontSize: 15,
    color: theme.colors.text,
  },
  scrollView: {
    flexGrow: 0,
  },
  commandItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  commandItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  commandItemPressed: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  commandName: {
    ...Typography.default("semiBold"),
    fontSize: 14,
    color: theme.colors.text,
    flexShrink: 0,
  },
  commandDesc: {
    ...Typography.default(),
    fontSize: 13,
    flex: 1,
  },
}));
