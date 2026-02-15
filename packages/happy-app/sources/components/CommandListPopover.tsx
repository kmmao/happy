import { Ionicons } from "@expo/vector-icons";
import Fuse from "fuse.js";
import * as React from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useLocalSettingMutable } from "@/sync/storage";
import { getAllCommands, CommandItem } from "@/sync/suggestionCommands";
import { layout } from "./layout";

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
    const [allCommands, setAllCommands] = React.useState<CommandItem[]>([]);
    const [query, setQuery] = React.useState("");
    const [favorites, setFavorites] =
      useLocalSettingMutable("favoriteCommands");
    const inputRef = React.useRef<TextInput>(null);

    React.useEffect(() => {
      if (visible) {
        setAllCommands(getAllCommands(sessionId));
        setQuery("");
        setShouldRender(true);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          inputRef.current?.focus();
        });
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

    const filteredCommands = React.useMemo(() => {
      if (!query.trim()) return allCommands;
      const fuse = new Fuse(allCommands, {
        keys: [
          { name: "command", weight: 0.7 },
          { name: "description", weight: 0.3 },
        ],
        threshold: 0.3,
        ignoreLocation: true,
      });
      return fuse.search(query).map((r) => r.item);
    }, [allCommands, query]);

    const { favoriteItems, otherItems } = React.useMemo(() => {
      const favSet = new Set(favorites);
      const favItems: CommandItem[] = [];
      const others: CommandItem[] = [];
      for (const cmd of filteredCommands) {
        if (favSet.has(cmd.command)) {
          favItems.push(cmd);
        } else {
          others.push(cmd);
        }
      }
      return { favoriteItems: favItems, otherItems: others };
    }, [filteredCommands, favorites]);

    const toggleFavorite = React.useCallback(
      (command: string) => {
        const isFav = favorites.includes(command);
        const next = isFav
          ? favorites.filter((c) => c !== command)
          : [...favorites, command];
        setFavorites(next);
      },
      [favorites, setFavorites],
    );

    if (!shouldRender) return null;

    const renderItem = (cmd: CommandItem, isFav: boolean) => (
      <View key={cmd.command} style={styles.commandRow}>
        <Pressable
          style={({ pressed }) => [
            styles.commandItem,
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
        <Pressable
          onPress={() => toggleFavorite(cmd.command)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.starButton}
        >
          <Ionicons
            name={isFav ? "star" : "star-outline"}
            size={16}
            color={isFav ? "#FFB800" : theme.colors.textSecondary}
          />
        </Pressable>
      </View>
    );

    return (
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.centerAnchor} pointerEvents="box-none">
          <View style={styles.bubble}>
            {/* Search input */}
            <View style={styles.searchContainer}>
              <Ionicons
                name="search"
                size={16}
                color={theme.colors.textSecondary}
              />
              <TextInput
                ref={inputRef}
                style={[styles.searchInput, { color: theme.colors.text }]}
                placeholder="Search commands..."
                placeholderTextColor={theme.colors.input.placeholder}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")}>
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              )}
            </View>

            {/* Command list */}
            <ScrollView
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {favoriteItems.length > 0 && (
                <>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="star" size={12} color="#FFB800" />
                    <Text
                      style={[
                        styles.sectionHeaderText,
                        { color: theme.colors.textSecondary },
                      ]}
                    >
                      Favorites
                    </Text>
                  </View>
                  {favoriteItems.map((cmd) => renderItem(cmd, true))}
                </>
              )}
              {otherItems.length > 0 && (
                <>
                  {favoriteItems.length > 0 && (
                    <View style={styles.sectionHeader}>
                      <Text
                        style={[
                          styles.sectionHeaderText,
                          { color: theme.colors.textSecondary },
                        ]}
                      >
                        All Commands
                      </Text>
                    </View>
                  )}
                  {otherItems.map((cmd) => renderItem(cmd, false))}
                </>
              )}
              {favoriteItems.length === 0 && otherItems.length === 0 && (
                <View style={styles.emptyState}>
                  <Text
                    style={[
                      styles.emptyText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    No commands found
                  </Text>
                </View>
              )}
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
    maxHeight: 420,
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  searchInput: {
    flex: 1,
    ...Typography.default(),
    fontSize: 15,
    paddingVertical: 0,
  },
  scrollView: {
    flexGrow: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    ...Typography.default("semiBold"),
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  commandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  commandItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
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
  starButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyText: {
    ...Typography.default(),
    fontSize: 14,
  },
}));
