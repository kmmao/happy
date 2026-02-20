import * as React from "react";
import {
  View,
  Pressable,
  ActivityIndicator,
  Platform,
  RefreshControl,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Octicons, Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemList } from "@/components/ItemList";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { FileIcon } from "@/components/FileIcon";
import { layout } from "@/components/layout";
import { t } from "@/text";
import {
  fetchGitStashList,
  fetchStashFiles,
  GitStashEntry,
  GitStashFile,
} from "@/sync/gitStash";

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderLineChanges(file: GitStashFile): string {
  const parts: string[] = [];
  if (file.linesAdded > 0) {
    parts.push(`+${file.linesAdded}`);
  }
  if (file.linesRemoved > 0) {
    parts.push(`-${file.linesRemoved}`);
  }
  return parts.join(" ");
}

const SCROLL_COLLAPSE_THRESHOLD = 20;

export const GitStashTab = React.memo<{
  sessionId: string;
  repoPath?: string;
  onPullDown?: () => void;
  onScrollUp?: () => void;
}>(function GitStashTab({ sessionId, repoPath, onPullDown, onScrollUp }) {
  const { theme } = useUnistyles();

  const [stashList, setStashList] = React.useState<readonly GitStashEntry[]>(
    [],
  );
  const [isLoading, setIsLoading] = React.useState(true);
  const [expandedStashIndex, setExpandedStashIndex] = React.useState<
    number | null
  >(null);
  const [stashFiles, setStashFiles] = React.useState<readonly GitStashFile[]>(
    [],
  );
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);

  const loadStashList = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await fetchGitStashList(sessionId, repoPath);
      setStashList(result);
    } catch {
      setStashList([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, repoPath]);

  // Load on mount
  React.useEffect(() => {
    loadStashList();
  }, [loadStashList]);

  // Refresh when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      loadStashList();
    }, [loadStashList]),
  );

  const handleStashPress = React.useCallback(
    async (stashIndex: number) => {
      if (expandedStashIndex === stashIndex) {
        setExpandedStashIndex(null);
        setStashFiles([]);
        return;
      }

      setExpandedStashIndex(stashIndex);
      setStashFiles([]);
      setIsLoadingFiles(true);

      try {
        const files = await fetchStashFiles(sessionId, stashIndex, repoPath);
        setStashFiles(files);
      } catch {
        setStashFiles([]);
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [sessionId, repoPath, expandedStashIndex],
  );

  const scrollCollapseCalledRef = React.useRef(false);
  const handleScroll = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!onScrollUp) return;
      const y = e.nativeEvent.contentOffset.y;
      if (y > SCROLL_COLLAPSE_THRESHOLD && !scrollCollapseCalledRef.current) {
        scrollCollapseCalledRef.current = true;
        onScrollUp();
      } else if (y <= 0) {
        scrollCollapseCalledRef.current = false;
      }
    },
    [onScrollUp],
  );

  if (isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
      </View>
    );
  }

  if (stashList.length === 0) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.centered}>
          <Octicons
            name="archive"
            size={48}
            color={theme.colors.textSecondary}
          />
          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              textAlign: "center",
              marginTop: 16,
              ...Typography.default(),
            }}
          >
            {t("git.stashEmpty")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <ItemList
        style={{ flex: 1 }}
        onScroll={onScrollUp ? handleScroll : undefined}
        scrollEventThrottle={onScrollUp ? 16 : undefined}
        refreshControl={
          onPullDown ? (
            <RefreshControl refreshing={false} onRefresh={onPullDown} />
          ) : undefined
        }
      >
        {stashList.map((stash, index) => {
          const isExpanded = expandedStashIndex === stash.index;
          return (
            <React.Fragment key={`stash-${stash.index}`}>
              <Pressable
                onPress={() => handleStashPress(stash.index)}
                style={({ pressed }) => ({
                  backgroundColor: pressed
                    ? theme.colors.surfacePressedOverlay
                    : "transparent",
                })}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <View
                    style={{
                      marginRight: 12,
                      width: 32,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Octicons
                      name="archive"
                      size={20}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "500",
                        color: theme.colors.text,
                        ...Typography.default(),
                      }}
                      numberOfLines={1}
                    >
                      {stash.message}
                    </Text>
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        marginTop: 2,
                        ...Typography.default(),
                      }}
                      numberOfLines={1}
                    >
                      {stash.ref}
                      {"  "}
                      {formatRelativeTime(stash.timestamp)}
                    </Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? "chevron-down" : "chevron-forward"}
                    size={16}
                    color={theme.colors.textSecondary}
                    style={{ marginLeft: 8 }}
                  />
                </View>
                {(!isExpanded || index < stashList.length - 1) && (
                  <View
                    style={{
                      height: Platform.select({
                        ios: 0.33,
                        default: 1,
                      }),
                      backgroundColor: theme.colors.divider,
                      marginLeft: 60,
                    }}
                  />
                )}
              </Pressable>

              {isExpanded && (
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                  }}
                >
                  {isLoadingFiles ? (
                    <View
                      style={{
                        paddingVertical: 20,
                        alignItems: "center",
                      }}
                    >
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.textSecondary}
                      />
                    </View>
                  ) : stashFiles.length === 0 ? (
                    <View
                      style={{
                        paddingVertical: 16,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          color: theme.colors.textSecondary,
                          ...Typography.default(),
                        }}
                      >
                        {t("git.stashFiles", {
                          count: 0,
                        })}
                      </Text>
                    </View>
                  ) : (
                    <>
                      <View
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderBottomWidth: Platform.select({
                            ios: 0.33,
                            default: 1,
                          }),
                          borderBottomColor: theme.colors.divider,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                          }}
                        >
                          {t("git.stashFiles", {
                            count: stashFiles.length,
                          })}
                        </Text>
                      </View>
                      {stashFiles.map((file, fileIndex) => {
                        const lineChanges = renderLineChanges(file);
                        const subtitle = lineChanges
                          ? `${file.filePath || "."} \u2022 ${lineChanges}`
                          : file.filePath || ".";

                        return (
                          <Item
                            key={`stash-file-${stash.index}-${file.fullPath}-${fileIndex}`}
                            title={file.fileName}
                            subtitle={subtitle}
                            icon={
                              <FileIcon fileName={file.fileName} size={29} />
                            }
                            showChevron={false}
                            showDivider={fileIndex < stashFiles.length - 1}
                          />
                        );
                      })}
                    </>
                  )}
                  <View
                    style={{
                      height: Platform.select({
                        ios: 0.33,
                        default: 1,
                      }),
                      backgroundColor: theme.colors.divider,
                    }}
                  />
                </View>
              )}
            </React.Fragment>
          );
        })}
      </ItemList>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 20,
  },
}));
