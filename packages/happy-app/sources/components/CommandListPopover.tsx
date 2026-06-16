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
import { Modal } from "@/modal";
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

    // Favorites tab = subset view of `filteredCommands`, ordered by the
    // user's saved favorite shortcut list. The source tabs (otherItems)
    // intentionally include favorited commands too — otherwise favoriting
    // every command of a source (e.g. /compact + /clear in builtin) would
    // make that whole source tab disappear, which surprised the user. Each
    // command therefore shows up in BOTH ⭐收藏 AND its source tab; the
    // star icon's filled / outline state reflects the favorited status
    // identically in either tab.
    const favoriteKeySet = React.useMemo(
      () => new Set(normalizedFavorites.map(getCommandItemKey)),
      [normalizedFavorites],
    );
    const { favoriteItems, otherItems } = React.useMemo(() => {
      const commandMap = new Map(
        filteredCommands.map((cmd) => [getCommandItemKey(cmd), cmd]),
      );
      const favItems: CommandItem[] = normalizedFavorites
        .map(getCommandItemKey)
        .filter((key) => commandMap.has(key))
        .map((key) => commandMap.get(key)!)
        .filter((cmd) =>
          query.trim()
            ? cmd.command.toLowerCase().includes(query.trim().toLowerCase())
            : true,
        );
      return { favoriteItems: favItems, otherItems: filteredCommands };
    }, [filteredCommands, normalizedFavorites, query]);

    /**
     * Group the non-favorite commands by `source` so the popover renders one
     * tab per origin. Plugin commands are sub-grouped by plugin name —
     * a user with `codex` and `commit-commands` installed sees them as two
     * distinct plugin tabs instead of one bucket.
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

    /**
     * Build the tab strip from the favorites list + grouped buckets. Empty
     * buckets are dropped so the user only sees tabs that have content.
     *
     * `isFavoriteTab` flips on the reorder chevrons + star icon — the only
     * tab whose item layout differs from the others.
     */
    type Tab = {
      key: string;
      label: string;
      items: CommandItem[];
      isFavoriteTab?: boolean;
    };
    const tabs = React.useMemo<Tab[]>(() => {
      const list: Tab[] = [];
      if (favoriteItems.length > 0) {
        list.push({
          key: "fav",
          label: t("quickCommands.favorites"),
          items: favoriteItems,
          isFavoriteTab: true,
        });
      }
      if (grouped.project.length > 0) {
        list.push({
          key: "project",
          label: t("quickCommands.groups.project"),
          items: grouped.project,
        });
      }
      if (grouped.user.length > 0) {
        list.push({
          key: "user",
          label: t("quickCommands.groups.user"),
          items: grouped.user,
        });
      }
      for (const [pluginName, items] of grouped.plugins) {
        list.push({
          key: `plugin:${pluginName}`,
          label: pluginName
            ? t("quickCommands.groups.pluginNamed", { name: pluginName })
            : t("quickCommands.groups.plugin"),
          items,
        });
      }
      if (grouped.codex.length > 0) {
        list.push({
          key: "codex",
          label: t("quickCommands.groups.codex"),
          items: grouped.codex,
        });
      }
      if (grouped.builtin.length > 0) {
        list.push({
          key: "builtin",
          label: t("quickCommands.groups.builtin"),
          items: grouped.builtin,
        });
      }
      if (grouped.unknown.length > 0) {
        list.push({
          key: "unknown",
          label: t("quickCommands.allCommands"),
          items: grouped.unknown,
        });
      }
      return list;
    }, [favoriteItems, grouped]);

    // Active tab is sticky between renders (won't snap back to "fav" on every
    // keystroke), but resets to the first available tab whenever the prior
    // active tab disappears (e.g. user un-stars their last favorite or a
    // session-switch swaps the command set).
    const [activeTabKey, setActiveTabKey] = React.useState<string | null>(null);
    React.useEffect(() => {
      if (tabs.length === 0) {
        if (activeTabKey !== null) setActiveTabKey(null);
        return;
      }
      if (!activeTabKey || !tabs.some((tab) => tab.key === activeTabKey)) {
        setActiveTabKey(tabs[0].key);
      }
    }, [tabs, activeTabKey]);

    const activeTab =
      tabs.find((tab) => tab.key === activeTabKey) ?? tabs[0] ?? null;

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

    /**
     * Open an action sheet for reordering a single favorite. Used by the
     * inline drag-handle icon in each favorites row — replaces the previous
     * pair of stacked chevrons, which made favorites rows visually denser
     * than other tabs' rows. Up/down options are conditionally enabled
     * based on the item's index so the alert never offers a no-op.
     */
    const openReorderMenu = React.useCallback(
      (item: CommandItem, favIndex: number, favTotal: number) => {
        const buttons: {
          text: string;
          onPress?: () => void;
          style?: "default" | "cancel" | "destructive";
        }[] = [];
        if (favIndex > 0) {
          buttons.push({
            text: t("quickCommands.reorder.up"),
            onPress: () => moveFavorite(item, "up"),
          });
        }
        if (favIndex < favTotal - 1) {
          buttons.push({
            text: t("quickCommands.reorder.down"),
            onPress: () => moveFavorite(item, "down"),
          });
        }
        buttons.push({ text: t("common.cancel"), style: "cancel" });
        Modal.alert(t("quickCommands.reorder.title"), undefined, buttons);
      },
      [moveFavorite],
    );

    if (!shouldRender) return null;

    // Two orthogonal flags after the favorites-also-appear-in-source-tabs
    // refactor:
    //   - `inFavoritesTab`: render the drag-handle for reordering. Only true
    //     when the row is inside the ⭐收藏 tab; even a favorited command in
    //     its source tab gets NO chevron because reorder only makes sense
    //     against the favorites list itself.
    //   - `isFavorited`: render the star as filled gold. True whenever the
    //     command is in the user's favorites set, regardless of tab.
    const renderItem = (
      cmd: CommandItem,
      inFavoritesTab: boolean,
      favIndex?: number,
      favTotal?: number,
    ) => {
      const isFavorited = favoriteKeySet.has(getCommandItemKey(cmd));
      return (
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
              >
                {cmd.description}
              </Text>
            ) : null}
          </Pressable>
          {inFavoritesTab && favIndex !== undefined && favTotal !== undefined && favTotal > 1 && (
            // Single drag-handle icon — replaces the stacked chevron column
            // that made favorites rows visually denser than other tabs'.
            // Tapping opens an action sheet with Move up / Move down options
            // (kept off when the item is already at the boundary).
            <Pressable
              onPress={() => openReorderMenu(cmd, favIndex, favTotal)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.reorderHandle}
              accessibilityLabel={t("quickCommands.reorder.title")}
            >
              <Ionicons
                name="reorder-three-outline"
                size={20}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          )}
          <Pressable
            onPress={() => toggleFavorite(cmd)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.starButton}
          >
            <Ionicons
              name={isFavorited ? "star" : "star-outline"}
              size={16}
              color={isFavorited ? "#FFB800" : theme.colors.textSecondary}
            />
          </Pressable>
        </View>
      );
    };

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

        {/* Tab strip — horizontally scrollable, one tab per source bucket */}
        {tabs.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabStrip}
            contentContainerStyle={styles.tabStripContent}
            keyboardShouldPersistTaps="handled"
          >
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab?.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTabKey(tab.key)}
                  style={[
                    styles.tabItem,
                    isActive && {
                      borderBottomColor: theme.colors.text,
                    },
                  ]}
                >
                  {tab.isFavoriteTab && (
                    <View style={styles.tabIconWrap}>
                      <Ionicons
                        name="star"
                        size={12}
                        color={
                          isActive ? "#FFB800" : theme.colors.textSecondary
                        }
                      />
                    </View>
                  )}
                  <Text
                    style={[
                      styles.tabLabel,
                      {
                        color: isActive
                          ? theme.colors.text
                          : theme.colors.textSecondary,
                      },
                    ]}
                  >
                    {tab.label}
                  </Text>
                  <View
                    style={[
                      styles.tabCountBadge,
                      {
                        backgroundColor: isActive
                          ? theme.colors.text
                          : theme.colors.surfaceHigh,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabCountText,
                        {
                          color: isActive
                            ? theme.colors.surface
                            : theme.colors.textSecondary,
                        },
                      ]}
                    >
                      {tab.items.length}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Command list — only the active tab's items */}
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {activeTab && activeTab.items.length > 0
            ? activeTab.isFavoriteTab
              ? activeTab.items.map((cmd, idx) =>
                  renderItem(cmd, true, idx, activeTab.items.length),
                )
              : activeTab.items.map((cmd) => renderItem(cmd, false))
            : (
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
  // `flexShrink: 0` is mandatory on the three fixed-height children of
  // `bubble` (search container, tab strip, command rows). The bubble has
  // `maxHeight: 420` and a flex-column layout — once its content overflows,
  // RN's flexbox shrinks every child proportionally by their default
  // `flexShrink: 1`, regardless of explicit `height`. That's exactly what
  // caused the favorites tab (17 items) to compress search/tabs/rows
  // visually shorter than the project tab (4 items, no overflow).
  // Pinning `flexShrink: 0` here forces ScrollView (which keeps its own
  // default shrink: 1) to absorb 100% of the overflow via internal scroll.
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
    flexShrink: 0,
  },
  // Horizontal tab strip sitting between the search input and the command
  // list. `flexGrow: 0` keeps it from stealing the popover's vertical space
  // when the list scrolls. `flexShrink: 0` keeps it from being squeezed
  // when the list overflows.
  tabStrip: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  tabStripContent: {
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  // Every tab chip must render at the SAME height regardless of whether
  // it has the leading star icon (favorites only) or how wide its count
  // badge is. Without a fixed `height` the row collapses to its tallest
  // descendant, which varies between platforms (Ionicons baseline ≠ Text
  // line-height ≠ Badge padding box).
  tabItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 40,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    // Pull the active underline down so it overlaps the divider beneath the
    // tab strip instead of sitting above it.
    marginBottom: -1,
  },
  // Fixed icon container so the favorites star renders inside the same
  // 14×14 box as if a text glyph occupied that slot — keeps the row baseline
  // identical across favorites vs non-favorites tabs.
  tabIconWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    ...Typography.default("semiBold"),
    fontSize: 13,
    lineHeight: 18,
  },
  tabCountBadge: {
    paddingHorizontal: 6,
    height: 16,
    borderRadius: 8,
    minWidth: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCountText: {
    ...Typography.default("semiBold"),
    fontSize: 10,
    lineHeight: 14,
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
  // `minHeight: 56` keeps the baseline tab-to-tab visual rhythm (so short
  // descriptions still render at the same row height as those with text),
  // while letting long descriptions push the row taller — they wrap to
  // multi-line and the row grows around them. `flexShrink: 0` blocks the
  // popover's `maxHeight: 420` from compressing the row via flex layout
  // when overflow scrolls.
  commandRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    flexShrink: 0,
  },
  commandItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    minHeight: 56,
    flexShrink: 0,
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
  // Single drag-handle slot, sized to match the star button's footprint so
  // favorites rows look identical to non-favorites rows on the right edge —
  // just two icons (handle + star) instead of a stacked chevron column.
  // `minHeight` so it grows with multi-line descriptions; icon stays
  // vertically centered via row's `alignItems: center`.
  reorderHandle: {
    width: 40,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  // Match commandRow height so the star button fills the full row vertically,
  // giving favorites + non-favorites rows the same touch-target footprint.
  // `minHeight` so it grows with multi-line descriptions.
  starButton: {
    paddingHorizontal: 12,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
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
