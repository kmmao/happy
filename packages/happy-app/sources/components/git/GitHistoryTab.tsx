import * as React from "react";
import {
  View,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  RefreshControl,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { FileIcon } from "@/components/FileIcon";
import { layout } from "@/components/layout";
import { t } from "@/text";
import {
  fetchGitHistory,
  fetchCommitFiles,
  type GitCommit,
  type GitCommitFile,
} from "@/sync/gitHistory";

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

interface CommitFileRowProps {
  readonly file: GitCommitFile;
  readonly sessionId: string;
  readonly commitHash: string;
  readonly isLast: boolean;
}

const CommitFileRow = React.memo<CommitFileRowProps>(function CommitFileRow({
  file,
  sessionId,
  commitHash,
  isLast,
}) {
  const router = useRouter();
  const { theme } = useUnistyles();

  const handlePress = React.useCallback(() => {
    const encodedPath = btoa(file.fullPath);
    router.push(
      `/session/${sessionId}/file?path=${encodedPath}&commit=${commitHash}`,
    );
  }, [router, sessionId, file.fullPath, commitHash]);

  return (
    <Pressable
      onPress={handlePress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 16,
        paddingLeft: 32,
        borderBottomWidth: isLast
          ? 0
          : Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.divider,
        backgroundColor: theme.colors.surfaceHigh,
      }}
    >
      <FileIcon fileName={file.fileName} size={20} />
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: "500",
            color: theme.colors.text,
            ...Typography.default(),
          }}
          numberOfLines={1}
        >
          {file.fileName}
        </Text>
        {file.filePath ? (
          <Text
            style={{
              fontSize: 11,
              color: theme.colors.textSecondary,
              marginTop: 1,
              ...Typography.default(),
            }}
            numberOfLines={1}
          >
            {file.filePath}
          </Text>
        ) : null}
      </View>
      {!file.isBinary && (file.linesAdded > 0 || file.linesRemoved > 0) && (
        <View
          style={{ flexDirection: "row", alignItems: "center", marginLeft: 8 }}
        >
          {file.linesAdded > 0 && (
            <Text
              style={{
                fontSize: 11,
                color: "#34C759",
                fontWeight: "600",
                marginRight: file.linesRemoved > 0 ? 4 : 0,
                ...Typography.mono(),
              }}
            >
              +{file.linesAdded}
            </Text>
          )}
          {file.linesRemoved > 0 && (
            <Text
              style={{
                fontSize: 11,
                color: "#FF3B30",
                fontWeight: "600",
                ...Typography.mono(),
              }}
            >
              -{file.linesRemoved}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
});

interface CommitItemProps {
  readonly commit: GitCommit;
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly isExpanded: boolean;
  readonly onToggle: (hash: string) => void;
}

const CommitItem = React.memo<CommitItemProps>(function CommitItem({
  commit,
  sessionId,
  repoPath,
  isExpanded,
  onToggle,
}) {
  const { theme } = useUnistyles();
  const [files, setFiles] = React.useState<readonly GitCommitFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);

  const handlePress = React.useCallback(() => {
    onToggle(commit.hash);
  }, [onToggle, commit.hash]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    let cancelled = false;
    setIsLoadingFiles(true);

    (async () => {
      try {
        const result = await fetchCommitFiles(sessionId, commit.hash, repoPath);
        if (!cancelled) {
          setFiles(result);
        }
      } catch {
        // Silently ignore - files will remain empty
      } finally {
        if (!cancelled) {
          setIsLoadingFiles(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isExpanded, sessionId, commit.hash, repoPath]);

  return (
    <View>
      <Pressable
        onPress={handlePress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderBottomWidth: isExpanded
            ? 0
            : Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
          backgroundColor: theme.colors.surface,
        }}
      >
        <View style={{ marginRight: 10 }}>
          <Octicons
            name="git-commit"
            size={16}
            color={theme.colors.textSecondary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.text,
              ...Typography.default(),
            }}
            numberOfLines={2}
          >
            {commit.message}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textLink,
                ...Typography.mono(),
              }}
            >
              {commit.shortHash}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                marginLeft: 8,
                ...Typography.default(),
              }}
            >
              {commit.authorName}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                marginLeft: 6,
                ...Typography.default(),
              }}
            >
              {formatRelativeTime(commit.timestamp)}
            </Text>
          </View>
        </View>
        <Octicons
          name={isExpanded ? "chevron-down" : "chevron-right"}
          size={14}
          color={theme.colors.textSecondary}
          style={{ marginLeft: 8 }}
        />
      </Pressable>
      {isExpanded && (
        <View
          style={{
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
          }}
        >
          {isLoadingFiles ? (
            <View
              style={{
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: theme.colors.surfaceHigh,
              }}
            >
              <ActivityIndicator
                size="small"
                color={theme.colors.textSecondary}
              />
            </View>
          ) : files.length > 0 ? (
            <>
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  backgroundColor: theme.colors.surfaceHigh,
                  borderBottomWidth: Platform.select({
                    ios: 0.33,
                    default: 1,
                  }),
                  borderBottomColor: theme.colors.divider,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  {t("git.commitFiles", { count: files.length })}
                </Text>
              </View>
              {files.map((file, index) => (
                <CommitFileRow
                  key={file.fullPath}
                  file={file}
                  sessionId={sessionId}
                  commitHash={commit.hash}
                  isLast={index === files.length - 1}
                />
              ))}
            </>
          ) : null}
        </View>
      )}
    </View>
  );
});

const PAGE_SIZE = 20;

const SCROLL_COLLAPSE_THRESHOLD = 20;

export const GitHistoryTab = React.memo<{
  sessionId: string;
  repoPath?: string;
  onPullDown?: () => void;
  onScrollUp?: () => void;
}>(function GitHistoryTab({ sessionId, repoPath, onPullDown, onScrollUp }) {
  const { theme } = useUnistyles();
  const [commits, setCommits] = React.useState<readonly GitCommit[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [expandedCommitHash, setExpandedCommitHash] = React.useState<
    string | null
  >(null);

  const loadInitial = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const page = await fetchGitHistory(sessionId, 0, repoPath);
      setCommits(page.commits);
      setHasMore(page.hasMore);
    } catch {
      setCommits([]);
      setHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, repoPath]);

  const loadMore = React.useCallback(async () => {
    if (isLoadingMore || !hasMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await fetchGitHistory(sessionId, commits.length, repoPath);
      setCommits((prev) => [...prev, ...page.commits]);
      setHasMore(page.hasMore);
    } catch {
      // Silently ignore - keep existing commits
    } finally {
      setIsLoadingMore(false);
    }
  }, [sessionId, repoPath, commits.length, isLoadingMore, hasMore]);

  React.useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useFocusEffect(
    React.useCallback(() => {
      loadInitial();
    }, [loadInitial]),
  );

  const handleToggleExpand = React.useCallback((hash: string) => {
    setExpandedCommitHash((prev) => (prev === hash ? null : hash));
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: GitCommit }) => (
      <CommitItem
        commit={item}
        sessionId={sessionId}
        repoPath={repoPath}
        isExpanded={expandedCommitHash === item.hash}
        onToggle={handleToggleExpand}
      />
    ),
    [sessionId, repoPath, expandedCommitHash, handleToggleExpand],
  );

  const renderFooter = React.useCallback(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textSecondary,
              marginTop: 6,
              ...Typography.default(),
            }}
          >
            {t("git.historyLoadMore")}
          </Text>
        </View>
      );
    }

    if (!hasMore && commits.length > 0) {
      return (
        <View style={styles.footer}>
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textSecondary,
              ...Typography.default(),
            }}
          >
            {t("git.historyNoMore")}
          </Text>
        </View>
      );
    }

    return null;
  }, [isLoadingMore, hasMore, commits.length, theme]);

  const keyExtractor = React.useCallback((item: GitCommit) => item.hash, []);

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
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            marginTop: 12,
            ...Typography.default(),
          }}
        >
          {t("git.historyLoading")}
        </Text>
      </View>
    );
  }

  if (commits.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Octicons name="history" size={48} color={theme.colors.textSecondary} />
        <Text
          style={{
            fontSize: 16,
            color: theme.colors.textSecondary,
            marginTop: 16,
            textAlign: "center",
            ...Typography.default(),
          }}
        >
          {t("git.historyEmpty")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={commits}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        showsVerticalScrollIndicator={false}
        onScroll={onScrollUp ? handleScroll : undefined}
        scrollEventThrottle={onScrollUp ? 16 : undefined}
        refreshControl={
          onPullDown ? (
            <RefreshControl refreshing={false} onRefresh={onPullDown} />
          ) : undefined
        }
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
    backgroundColor: theme.colors.surface,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  footer: {
    paddingVertical: 16,
    alignItems: "center",
  },
}));
