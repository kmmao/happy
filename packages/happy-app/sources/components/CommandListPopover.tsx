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
import { useSettingMutable } from "@/sync/storage";
import {
  getAllCommands,
  CommandItem,
  CommandItemSource,
  getCommandInsertionText,
  getCommandItemKey,
  normalizeFavoriteShortcut,
} from "@/sync/suggestionCommands";
import { t } from "@/text";
import { screenLayoutMaxWidth } from "./layout";
interface CommandListPopoverProps {
  visible: boolean;
  sessionId: string;
  onCommandSelect: (text: string) => void;
  onClose: () => void;
  /** When true, renders inline content only (no overlay/backdrop). Parent controls positioning. */
  inline?: boolean;
}

export const CommandListPopover = React.memo(
  ({
    visible,
    sessionId,
    onCommandSelect,
    onClose,
    inline,
  }: CommandListPopoverProps) => {
    const { theme } = useUnistyles();
    const opacity = React.useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = React.useState(false);
    const [allCommands, setAllCommands] = React.useState<CommandItem[]>([]);
    const [query, setQuery] = React.useState("");
    const [legacyFavoriteSlashCommands] =
      useSettingMutable("favoriteSlashCommands");
    const [favoriteShortcuts, setFavoriteShortcuts] =
      useSettingMutable("favoriteShortcuts");
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

    const normalizedFavorites = React.useMemo(() => {
      if (favoriteShortcuts.length > 0) {
        return favoriteShortcuts.map(normalizeFavoriteShortcut);
      }
      return legacyFavoriteSlashCommands.map(normalizeFavoriteShortcut);
    }, [favoriteShortcuts, legacyFavoriteSlashCommands]);

    const { favoriteItems, otherItems } = React.useMemo(() => {
      const favKeys = normalizedFavorites.map(getCommandItemKey);
      const favSet = new Set(favKeys);
      const commandMap = new Map(
        filteredCommands.map((cmd) => [getCommandItemKey(cmd), cmd]),
      );
      // Only show favorites that exist in the current session's shortcut list
      const favItems: CommandItem[] = favKeys
        .filter((fav) => commandMap.has(fav))
        .map((fav) => commandMap.get(fav)!)
        .filter((cmd) =>
          query.trim()
            ? cmd.command.toLowerCase().includes(query.trim().toLowerCase())
            : true,
        );
      const others = filteredCommands.filter((cmd) => !favSet.has(getCommandItemKey(cmd)));
      return { favoriteItems: favItems, otherItems: others };
    }, [filteredCommands, normalizedFavorites, query]);

    /**
     * Group the non-favorite commands by `source` so the popover renders one
     * section per origin. Plugin commands are sub-grouped by plugin name —
     * a user with `codex` and `commit-commands` installed sees them as two
     * distinct sub-headers instead of one bucket.
     *
     * Display order is fixed: project → user → plugin (alphabetic per plugin)
     * → codex → builtin → unknown. Empty buckets are skipped at render time.
     */
    const grouped = React.useMemo(() => {
      const buckets: Record<CommandItemSource, CommandItem[]> = {
        project: [],
        user: [],
        plugin: [],
        codex: [],
        builtin: [],
        unknown: [],
      };
      for (const item of otherItems) {
        buckets[item.source].push(item);
      }
      // Sub-group plugin entries by plugin name. Items missing the `plugin`
      // field (shouldn't happen, but defensive) land in an "(plugin)" bucket.
      const pluginGroups = new Map<string, CommandItem[]>();
      for (const item of buckets.plugin) {
        const key = item.plugin ?? "";
        const list = pluginGroups.get(key) ?? [];
        list.push(item);
        pluginGroups.set(key, list);
      }
      const sortedPluginGroups = [...pluginGroups.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return {
        project: buckets.project,
        user: buckets.user,
        plugins: sortedPluginGroups,
        codex: buckets.codex,
        builtin: buckets.builtin,
        unknown: buckets.unknown,
      };
    }, [otherItems]);

    const toggleFavorite = React.useCallback(
      (item: CommandItem) => {
        const key = getCommandItemKey(item);
        const isFav = normalizedFavorites.some((favorite) => getCommandItemKey(favorite) === key);
        const next = isFav
          ? normalizedFavorites.filter((favorite) => getCommandItemKey(favorite) !== key)
          : [...normalizedFavorites, { kind: item.kind, command: item.command }];
        setFavoriteShortcuts(next);
      },
      [normalizedFavorites, setFavoriteShortcuts],
    );

    const moveFavorite = React.useCallback(
      (item: CommandItem, direction: "up" | "down") => {
        const key = getCommandItemKey(item);
        const idx = normalizedFavorites.findIndex((favorite) => getCommandItemKey(favorite) === key);
        if (idx < 0) return;
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= normalizedFavorites.length) return;
        const next = [...normalizedFavorites];
        next[idx] = normalizedFavorites[targetIdx];
        next[targetIdx] = normalizedFavorites[idx];
        setFavoriteShortcuts(next);
      },
      [normalizedFavorites, setFavoriteShortcuts],
    );

    if (!shouldRender) return null;

    const renderItem = (
      cmd: CommandItem,
      isFav: boolean,
      favIndex?: number,
      favTotal?: number,
    ) => (
      <View key={getCommandItemKey(cmd)} style={styles.commandRow}>
        <Pressable
          style={({ pressed }) => [
            styles.commandItem,
            pressed && styles.commandItemPressed,
          ]}
          onPress={() => onCommandSelect(getCommandInsertionText(cmd))}
        >
          <Text style={styles.commandName}>{cmd.kind === "skill" ? `$${cmd.command}` : `/${cmd.command}`}</Text>
          <Text style={[styles.commandKind, { color: theme.colors.textSecondary }]}>
            {cmd.kind === "skill" ? "skill" : "cmd"}
          </Text>
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
        {isFav && favIndex !== undefined && favTotal !== undefined && (
          <View style={styles.reorderButtons}>
            <Pressable
              onPress={() => moveFavorite(cmd, "up")}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={[
                styles.reorderButton,
                favIndex === 0 && styles.reorderButtonDisabled,
              ]}
              disabled={favIndex === 0}
            >
              <Ionicons
                name="chevron-up"
                size={14}
                color={
                  favIndex === 0
                    ? theme.colors.textSecondary
                    : theme.colors.textSecondary
                }
              />
            </Pressable>
            <Pressable
              onPress={() => moveFavorite(cmd, "down")}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={[
                styles.reorderButton,
                favIndex === favTotal - 1 && styles.reorderButtonDisabled,
              ]}
              disabled={favIndex === favTotal - 1}
            >
              <Ionicons
                name="chevron-down"
                size={14}
                color={
                  favIndex === favTotal - 1
                    ? theme.colors.textSecondary
                    : theme.colors.textSecondary
                }
              />
            </Pressable>
          </View>
        )}
        <Pressable
          onPress={() => toggleFavorite(cmd)}
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

    const bubbleContent = (
      <View style={inline ? styles.inlineBubble : styles.bubble}>
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
            placeholder={t("quickCommands.searchPlaceholder")}
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
                  {t("quickCommands.favorites")}
                </Text>
              </View>
              {favoriteItems.map((cmd, idx) =>
                renderItem(cmd, true, idx, favoriteItems.length),
              )}
            </>
          )}
          {grouped.project.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t("quickCommands.groups.project")}
                </Text>
              </View>
              {grouped.project.map((cmd) => renderItem(cmd, false))}
            </>
          )}
          {grouped.user.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t("quickCommands.groups.user")}
                </Text>
              </View>
              {grouped.user.map((cmd) => renderItem(cmd, false))}
            </>
          )}
          {grouped.plugins.map(([pluginName, items]) => (
            <React.Fragment key={`plugin:${pluginName}`}>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {pluginName
                    ? t("quickCommands.groups.pluginNamed", { name: pluginName })
                    : t("quickCommands.groups.plugin")}
                </Text>
              </View>
              {items.map((cmd) => renderItem(cmd, false))}
            </React.Fragment>
          ))}
          {grouped.codex.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t("quickCommands.groups.codex")}
                </Text>
              </View>
              {grouped.codex.map((cmd) => renderItem(cmd, false))}
            </>
          )}
          {grouped.builtin.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t("quickCommands.groups.builtin")}
                </Text>
              </View>
              {grouped.builtin.map((cmd) => renderItem(cmd, false))}
            </>
          )}
          {grouped.unknown.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text
                  style={[
                    styles.sectionHeaderText,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {t("quickCommands.allCommands")}
                </Text>
              </View>
              {grouped.unknown.map((cmd) => renderItem(cmd, false))}
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
                {t("quickCommands.noCommandsFound")}
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );

    if (inline) {
      return bubbleContent;
    }

    return (
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.centerAnchor} pointerEvents="box-none">
          {bubbleContent}
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((theme, rt) => ({
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
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height) - 32,
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
  inlineBubble: {
    maxHeight: 420,
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
  commandKind: {
    ...Typography.default("semiBold"),
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 0,
  },
  commandDesc: {
    ...Typography.default(),
    fontSize: 13,
    flex: 1,
  },
  reorderButtons: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  reorderButton: {
    padding: 2,
  },
  reorderButtonDisabled: {
    opacity: 0.3,
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
