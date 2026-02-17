import * as React from "react";
import { View, Text, Pressable, Platform, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { hapticsLight } from "./haptics";

// ==================== Types ====================

interface CommandItem {
  key: string;
  label: string;
  command: string;
  isScript: boolean;
}

interface CommandGroup {
  id: string;
  label: string;
  commands: CommandItem[];
}

interface QuickCommandsPanelProps {
  packageScripts?: Record<string, string>;
  favoriteCommands: string[];
  onCommandSelect: (command: string) => void;
  onToggleFavorite: (command: string) => void;
}

// ==================== Constants ====================

const FALLBACK_SHELL_COMMANDS = [
  "git status",
  "git diff",
  "git log --oneline -5",
  "ls -la",
  "pwd",
];

// ==================== Grouping Logic ====================

function buildAllCommands(
  packageScripts: Record<string, string> | undefined,
): CommandItem[] {
  const items: CommandItem[] = [];

  if (packageScripts) {
    for (const [label, command] of Object.entries(packageScripts)) {
      const colonIndex = label.indexOf(":");
      items.push({
        key: label,
        label: colonIndex > 0 ? label.slice(colonIndex + 1) : label,
        command,
        isScript: true,
      });
    }
  }

  for (const cmd of FALLBACK_SHELL_COMMANDS) {
    items.push({ key: cmd, label: cmd, command: cmd, isScript: false });
  }

  return items;
}

function groupCommands(
  allCommands: CommandItem[],
  packageScripts: Record<string, string> | undefined,
  favoriteCommands: string[],
): CommandGroup[] {
  const groups: CommandGroup[] = [];
  const favoriteSet = new Set(favoriteCommands);

  // Favorites group
  if (favoriteSet.size > 0) {
    const favItems = allCommands.filter((cmd) => favoriteSet.has(cmd.command));
    if (favItems.length > 0) {
      groups.push({
        id: "favorites",
        label: t("quickCommands.groups.favorites"),
        commands: favItems,
      });
    }
  }

  // Package groups
  const groupMap = new Map<string, CommandGroup>();

  if (packageScripts) {
    for (const [label, command] of Object.entries(packageScripts)) {
      const colonIndex = label.indexOf(":");
      const packageName = colonIndex > 0 ? label.slice(0, colonIndex) : "root";

      if (!groupMap.has(packageName)) {
        groupMap.set(packageName, {
          id: packageName,
          label:
            packageName === "root"
              ? t("quickCommands.groups.root")
              : packageName,
          commands: [],
        });
      }

      groupMap.get(packageName)!.commands.push({
        key: label,
        label: colonIndex > 0 ? label.slice(colonIndex + 1) : label,
        command,
        isScript: true,
      });
    }
  }

  // Sort package groups: root first, then alphabetical
  const packageGroups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.id === "root") return -1;
    if (b.id === "root") return 1;
    return a.id.localeCompare(b.id);
  });
  groups.push(...packageGroups);

  // Shell group last
  groups.push({
    id: "shell",
    label: t("quickCommands.groups.shell"),
    commands: FALLBACK_SHELL_COMMANDS.map((cmd) => ({
      key: cmd,
      label: cmd,
      command: cmd,
      isScript: false,
    })),
  });

  return groups;
}

// ==================== Styles ====================

const stylesheet = StyleSheet.create((theme) => ({
  searchContainer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.input.background,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.divider,
    paddingHorizontal: 10,
    height: 36,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    paddingVertical: 0,
    ...Typography.default(),
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  commandCount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  commandItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  commandIcon: {
    width: 22,
    alignItems: "center",
    marginRight: 8,
  },
  commandPrefix: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      web: "monospace",
    }),
  },
  commandLabel: {
    fontSize: 13,
    color: theme.colors.text,
    flex: 1,
    ...Typography.default(),
  },
  favoriteButton: {
    paddingLeft: 8,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
}));

// ==================== Component ====================

export const QuickCommandsPanel = React.memo(
  (props: QuickCommandsPanelProps) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const [searchText, setSearchText] = React.useState("");
    const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(
      () => new Set(["favorites"]),
    );

    const favoriteSet = React.useMemo(
      () => new Set(props.favoriteCommands),
      [props.favoriteCommands],
    );

    const allCommands = React.useMemo(
      () => buildAllCommands(props.packageScripts),
      [props.packageScripts],
    );

    const groups = React.useMemo(
      () =>
        groupCommands(
          allCommands,
          props.packageScripts,
          props.favoriteCommands,
        ),
      [allCommands, props.packageScripts, props.favoriteCommands],
    );

    // Expand first non-favorites group once on mount
    const initialized = React.useRef(false);
    if (!initialized.current && groups.length > 0) {
      initialized.current = true;
      const firstNonFav = groups.find((g) => g.id !== "favorites");
      if (firstNonFav) {
        expandedGroups.add(firstNonFav.id);
      }
    }

    const filteredGroups = React.useMemo(() => {
      if (!searchText.trim()) return groups;

      const query = searchText.toLowerCase();
      return groups
        .map((group) => ({
          ...group,
          commands: group.commands.filter(
            (cmd) =>
              cmd.label.toLowerCase().includes(query) ||
              cmd.command.toLowerCase().includes(query),
          ),
        }))
        .filter((group) => group.commands.length > 0);
    }, [groups, searchText]);

    const isSearching = searchText.trim().length > 0;

    const toggleGroup = React.useCallback((groupId: string) => {
      hapticsLight();
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    }, []);

    const handleCommandPress = React.useCallback(
      (command: string) => {
        hapticsLight();
        props.onCommandSelect(command);
      },
      [props.onCommandSelect],
    );

    const handleToggleFavorite = React.useCallback(
      (command: string) => {
        hapticsLight();
        props.onToggleFavorite(command);
      },
      [props.onToggleFavorite],
    );

    return (
      <View>
        {/* Search */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <Ionicons
              name="search"
              size={15}
              color={theme.colors.textSecondary}
            />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder={t("quickCommands.searchPlaceholder")}
              placeholderTextColor={theme.colors.input.placeholder}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchText.length > 0 && (
              <Pressable
                onPress={() => setSearchText("")}
                hitSlop={{
                  top: 8,
                  bottom: 8,
                  left: 8,
                  right: 8,
                }}
              >
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            )}
          </View>
        </View>

        {/* Groups */}
        {filteredGroups.map((group) => {
          const isExpanded = isSearching || expandedGroups.has(group.id);

          return (
            <View key={group.id}>
              {/* Section Header */}
              <Pressable
                style={(p) => ({
                  ...styles.sectionHeader,
                  backgroundColor: p.pressed
                    ? theme.colors.surfacePressed
                    : "transparent",
                })}
                onPress={() => toggleGroup(group.id)}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons
                    name={isExpanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={theme.colors.textSecondary}
                  />
                  <Text style={styles.sectionTitle}>{group.label}</Text>
                </View>
                <Text style={styles.commandCount}>{group.commands.length}</Text>
              </Pressable>

              {/* Command List */}
              {isExpanded &&
                group.commands.map((cmd) => (
                  <Pressable
                    key={cmd.key}
                    style={(p) => ({
                      ...styles.commandItem,
                      backgroundColor: p.pressed
                        ? theme.colors.surfacePressed
                        : "transparent",
                    })}
                    onPress={() => handleCommandPress(cmd.command)}
                  >
                    <View style={styles.commandIcon}>
                      <Text
                        style={{
                          ...styles.commandPrefix,
                          color: cmd.isScript
                            ? theme.colors.success
                            : theme.colors.textSecondary,
                        }}
                      >
                        {cmd.isScript ? "\u25B6" : "$"}
                      </Text>
                    </View>
                    <Text style={styles.commandLabel} numberOfLines={1}>
                      {cmd.label}
                    </Text>
                    <Pressable
                      style={styles.favoriteButton}
                      onPress={() => handleToggleFavorite(cmd.command)}
                      hitSlop={{
                        top: 8,
                        bottom: 8,
                        left: 8,
                        right: 8,
                      }}
                    >
                      <Ionicons
                        name={
                          favoriteSet.has(cmd.command) ? "star" : "star-outline"
                        }
                        size={16}
                        color={
                          favoriteSet.has(cmd.command)
                            ? theme.colors.box.warning.text
                            : theme.colors.textSecondary
                        }
                      />
                    </Pressable>
                  </Pressable>
                ))}
            </View>
          );
        })}

        {/* Empty State */}
        {filteredGroups.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t("quickCommands.noResults")}</Text>
          </View>
        )}
      </View>
    );
  },
);
