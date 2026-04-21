import * as React from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Octicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { Modal } from "@/modal";
import { IssueFilterBar } from "./IssueFilterBar";
import { IssueCard } from "./IssueCard";
import { IssueCreateSheet } from "./IssueCreateSheet";
import { IssueDetailSheet } from "./IssueDetailSheet";
import {
  issueStore,
  useAggregatedIssueListState,
  useAggregatedOpenCount,
  useAggregatedClosedCount,
  useAggregatedHasMore,
  useIssueFilters,
} from "@/sync/issueStore";
import { storage, useSetting } from "@/sync/storage";
import type { GitStatus } from "@/sync/storageTypes";
import type { SubmoduleInfo } from "@/sync/projectManager";
import type {
  Issue,
  AggregatedIssue,
  IssueFilterState,
  IssueSortField,
  IssueSortDirection,
} from "@/sync/issueTypes";
import { launchIssueSession } from "@/utils/launchIssueSession";
import { useIssuePolling } from "@/hooks/useIssuePolling";
import { useRouter } from "expo-router";
import { SharedStateView } from "@/components/SharedStateView";

interface GitIssuesTabProps {
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly gitStatus: GitStatus | null;
  readonly submodules?: readonly SubmoduleInfo[];
  readonly onPullDown?: () => void;
  readonly onScrollUp?: () => void;
}

function getSessionMeta(sessionId: string): {
  machineId: string;
  path: string;
} | null {
  const session = storage.getState().sessions[sessionId];
  if (!session?.metadata?.machineId || !session?.metadata?.path) return null;
  return {
    machineId: session.metadata.machineId,
    path: session.metadata.path,
  };
}

/**
 * Build projectKey list for root + all submodules that have a remoteUrl.
 * Stabilizes allKeys reference using string comparison to avoid infinite re-renders.
 */
function useProjectKeys(
  sessionId: string,
  gitStatus: GitStatus | null,
  submodules?: readonly SubmoduleInfo[],
): {
  allKeys: readonly string[];
  repoPathByKey: Readonly<Record<string, string | undefined>>;
} {
  const computed = React.useMemo(() => {
    const meta = getSessionMeta(sessionId);
    if (!meta)
      return {
        keys: [] as string[],
        pathMap: {} as Record<string, string | undefined>,
      };

    const keys: string[] = [];
    const pathMap: Record<string, string | undefined> = {};

    // Root project
    if (gitStatus?.remoteUrl) {
      const rootKey = `${meta.machineId}:${meta.path}`;
      keys.push(rootKey);
      pathMap[rootKey] = undefined;
    }

    // Submodules
    if (submodules) {
      for (const sub of submodules) {
        if (!sub.gitStatus?.remoteUrl) continue;
        const subKey = `${meta.machineId}:${meta.path}|${sub.path}`;
        keys.push(subKey);
        pathMap[subKey] = sub.path;
      }
    }

    return { keys, pathMap };
  }, [sessionId, gitStatus?.remoteUrl, submodules]);

  // Stabilize allKeys reference — only change when key list actually changes
  const keysString = computed.keys.join("\n");
  const stableKeysRef = React.useRef<readonly string[]>([]);
  const stablePathMapRef = React.useRef<
    Readonly<Record<string, string | undefined>>
  >({});

  if (stableKeysRef.current.join("\n") !== keysString) {
    stableKeysRef.current = computed.keys;
    stablePathMapRef.current = computed.pathMap;
  }

  return {
    allKeys: stableKeysRef.current,
    repoPathByKey: stablePathMapRef.current,
  };
}

export const GitIssuesTab = React.memo<GitIssuesTabProps>(
  function GitIssuesTab({
    sessionId,
    repoPath,
    gitStatus,
    submodules,
    onPullDown,
    onScrollUp,
  }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const gitHosts = useSetting("gitHosts");
    const { allKeys, repoPathByKey } = useProjectKeys(
      sessionId,
      gitStatus,
      submodules,
    );
    const multiRepo = allKeys.length > 1;

    const {
      issues,
      loading,
      error,
      state: issuesState,
    } = useAggregatedIssueListState(allKeys);
    const filters = useIssueFilters();
    const openCount = useAggregatedOpenCount(allKeys);
    const closedCount = useAggregatedClosedCount(allKeys);
    const hasMore = useAggregatedHasMore(allKeys);

    // Detect repo info for all projects — use stable gitHosts ref
    const gitHostsRef = React.useRef(gitHosts);
    gitHostsRef.current = gitHosts;

    React.useEffect(() => {
      const meta = getSessionMeta(sessionId);
      if (!meta) return;
      const hosts = gitHostsRef.current;

      // Root
      if (gitStatus?.remoteUrl) {
        const rootKey = `${meta.machineId}:${meta.path}`;
        issueStore
          .getState()
          .detectRepoInfo(rootKey, gitStatus.remoteUrl, hosts);
      }

      // Submodules
      if (submodules) {
        for (const sub of submodules) {
          if (!sub.gitStatus?.remoteUrl) continue;
          const subKey = `${meta.machineId}:${meta.path}|${sub.path}`;
          issueStore
            .getState()
            .detectRepoInfo(subKey, sub.gitStatus.remoteUrl, hosts);
        }
      }
      // Only re-run when allKeys actually change (stabilized ref)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allKeys, sessionId]);

    // Also re-detect when gitHosts settings change
    React.useEffect(() => {
      if (allKeys.length === 0) return;
      const meta = getSessionMeta(sessionId);
      if (!meta) return;

      if (gitStatus?.remoteUrl) {
        const rootKey = `${meta.machineId}:${meta.path}`;
        issueStore
          .getState()
          .detectRepoInfo(rootKey, gitStatus.remoteUrl, gitHosts);
      }
      if (submodules) {
        for (const sub of submodules) {
          if (!sub.gitStatus?.remoteUrl) continue;
          const subKey = `${meta.machineId}:${meta.path}|${sub.path}`;
          issueStore
            .getState()
            .detectRepoInfo(subKey, sub.gitStatus.remoteUrl, gitHosts);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gitHosts]);

    // Load issues for all projects
    React.useEffect(() => {
      for (const key of allKeys) {
        const repoInfo = issueStore.getState().repoInfoByProject[key];
        if (!repoInfo || repoInfo.provider === "unknown") continue;
        issueStore.getState().loadIssues(key, sessionId, 1, repoPathByKey[key]);
      }
    }, [
      allKeys,
      sessionId,
      repoPathByKey,
      filters.state,
      filters.sort,
      filters.direction,
      filters.labels,
    ]);

    // Auto-poll issues every 60s while mounted & app is active
    useIssuePolling(allKeys, sessionId, repoPathByKey, issues.length > 0);

    const handleRefresh = React.useCallback(() => {
      issueStore.getState().refreshAllIssues(allKeys, sessionId, repoPathByKey);
    }, [allKeys, sessionId, repoPathByKey]);

    const loadingMoreRef = React.useRef(false);
    const handleLoadMore = React.useCallback(async () => {
      if (loadingMoreRef.current || loading || !hasMore) return;
      loadingMoreRef.current = true;
      try {
        await issueStore
          .getState()
          .loadMoreIssues(allKeys, sessionId, repoPathByKey);
      } finally {
        loadingMoreRef.current = false;
      }
    }, [allKeys, sessionId, repoPathByKey, loading, hasMore]);

    const renderFooter = React.useCallback(() => {
      if (!hasMore) return null;
      return (
        <View style={{ paddingVertical: 16, alignItems: "center" }}>
          <ActivityIndicator size="small" color={theme.colors.textLink} />
        </View>
      );
    }, [hasMore, theme.colors.textLink]);

    const handleFilterChange = React.useCallback((state: IssueFilterState) => {
      issueStore.getState().setFilterState(state);
    }, []);

    const handleSortChange = React.useCallback(
      (sort: IssueSortField, direction: IssueSortDirection) => {
        issueStore.getState().setSort(sort, direction);
      },
      [],
    );

    // Use the first project key for creating issues (root repo)
    const primaryKey = allKeys[0] ?? "";
    const primaryRepoPath = repoPathByKey[primaryKey];

    const doCreateIssue = React.useCallback(() => {
      if (!primaryKey) return;
      Modal.show({
        component: IssueCreateSheet,
        props: {
          sessionId,
          projectKey: primaryKey,
          repoPath: primaryRepoPath,
          onCreated: () => {
            issueStore
              .getState()
              .refreshAllIssues(allKeys, sessionId, repoPathByKey);
          },
        },
      });
    }, [primaryKey, sessionId, primaryRepoPath, allKeys, repoPathByKey]);

    const handleIssuePress = React.useCallback(
      (issue: Issue | AggregatedIssue) => {
        if (!("projectKey" in issue)) return;
        const aggIssue = issue as AggregatedIssue;
        const meta = getSessionMeta(sessionId);
        Modal.show({
          component: IssueDetailSheet,
          props: {
            issue: aggIssue,
            sessionId,
            repoPath: repoPathByKey[aggIssue.projectKey],
            machineId: meta?.machineId,
            onSendToChat: (text: string) => {
              const session = storage.getState().sessions[sessionId];
              const currentDraft = session?.draft ?? "";
              const newDraft = currentDraft ? `${currentDraft}\n${text}` : text;
              storage.getState().updateSessionDraft(sessionId, newDraft);
            },
            onLaunchSession: async () => {
              if (!meta) return;
              const result = await launchIssueSession({
                issue: aggIssue,
                machineId: meta.machineId,
                repoPath: meta.path,
              });
              if (result.success && result.newSessionId) {
                router.push(`/session/${result.newSessionId}`);
              } else if (
                result.error?.startsWith("ALREADY_EXISTS:") &&
                result.newSessionId &&
                result.newSessionId !== "pending"
              ) {
                // Issue already has a session — navigate to it
                router.push(`/session/${result.newSessionId}`);
              } else if (result.error) {
                Modal.alert(
                  t("common.error"),
                  t("issues.launchFailed", { error: result.error }),
                );
              }
            },
            onViewSession: (linkedSessionId: string) => {
              router.push(`/session/${linkedSessionId}`);
            },
          },
        });
      },
      [sessionId, repoPathByKey, router],
    );

    const renderItem = React.useCallback(
      ({ item }: { item: AggregatedIssue }) => (
        <IssueCard
          issue={item}
          onPress={handleIssuePress}
          repoLabel={multiRepo ? item.repoLabel : undefined}
        />
      ),
      [handleIssuePress, multiRepo],
    );

    const lastScrollY = React.useRef(0);

    const handleScroll = React.useCallback(
      (e: any) => {
        const y = e.nativeEvent.contentOffset.y;
        if (y < -40 && onPullDown) {
          onPullDown();
        } else if (y > lastScrollY.current + 20 && onScrollUp) {
          onScrollUp();
        }
        lastScrollY.current = y;
      },
      [onPullDown, onScrollUp],
    );

    // No repos with remote URL at all
    if (allKeys.length === 0) {
      return (
        <SharedStateView
          inline
          kind="empty"
          icon={<Octicons name="repo" size={40} color={theme.colors.textSecondary} />}
          title={t("issues.noRepo")}
        />
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <IssueFilterBar
          activeState={filters.state}
          onStateChange={handleFilterChange}
          openCount={openCount}
          closedCount={closedCount}
          loading={loading}
          onRefresh={handleRefresh}
          onCreateIssue={primaryKey ? doCreateIssue : undefined}
          sort={filters.sort}
          direction={filters.direction}
          onSortChange={handleSortChange}
        />

        {issuesState.kind === "loading" && (
          <SharedStateView
            inline
            kind="loading"
            title={t("issues.loading")}
          />
        )}

        {issuesState.kind === "error" && (
          <SharedStateView
            inline
            kind="error"
            title={t("common.error")}
            description={error ?? undefined}
            onAction={handleRefresh}
          />
        )}

        {issuesState.kind === "empty" && (
          <SharedStateView
            inline
            kind="empty"
            icon={
              <Octicons
                name="issue-opened"
                size={40}
                color={theme.colors.textSecondary + "60"}
              />
            }
            title={
              filters.state === "open"
                ? t("issues.noOpenIssues")
                : t("issues.noClosedIssues")
            }
          >
            {filters.state === "open" && (
              <Pressable
                onPress={() => handleFilterChange("closed")}
                style={{ marginTop: 8 }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.textLink,
                    textAlign: "center",
                    ...Typography.default(),
                  }}
                >
                  {t("issues.tryClosedHint")}
                </Text>
              </Pressable>
            )}
            {primaryKey && (
              <Pressable
                onPress={doCreateIssue}
                style={{
                  marginTop: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: theme.colors.button.primary.background,
                }}
              >
                <Octicons
                  name="plus"
                  size={14}
                  color={theme.colors.button.primary.tint}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: theme.colors.button.primary.tint,
                    ...Typography.default(),
                  }}
                >
                  {t("issues.createFirstIssue")}
                </Text>
              </Pressable>
            )}
          </SharedStateView>
        )}

        {issues.length > 0 && (
          <FlatList
            data={issues}
            keyExtractor={(item) => `${item.projectKey}:${item.number}`}
            renderItem={renderItem}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderFooter}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={handleRefresh}
                tintColor={theme.colors.textLink}
              />
            }
          />
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
}));
