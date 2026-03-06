import * as React from "react";
import {
  View,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { Modal } from "@/modal";
import { useHappyAction } from "@/hooks/useHappyAction";
import { IssueFilterBar } from "./IssueFilterBar";
import { IssueCard } from "./IssueCard";
import { IssueDetailSheet } from "./IssueDetailSheet";
import {
  issueStore,
  useAggregatedIssues,
  useAggregatedLoading,
  useAggregatedError,
  useAggregatedOpenCount,
  useAggregatedClosedCount,
  useIssueFilters,
} from "@/sync/issueStore";
import { storage, useSetting } from "@/sync/storage";
import type { GitStatus } from "@/sync/storageTypes";
import type { SubmoduleInfo } from "@/sync/projectManager";
import type { AggregatedIssue, IssueFilterState } from "@/sync/issueTypes";

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
    const gitHosts = useSetting("gitHosts");
    const { allKeys, repoPathByKey } = useProjectKeys(
      sessionId,
      gitStatus,
      submodules,
    );
    const multiRepo = allKeys.length > 1;

    const issues = useAggregatedIssues(allKeys);
    const loading = useAggregatedLoading(allKeys);
    const error = useAggregatedError(allKeys);
    const filters = useIssueFilters();
    const openCount = useAggregatedOpenCount(allKeys);
    const closedCount = useAggregatedClosedCount(allKeys);

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
    }, [allKeys, sessionId, repoPathByKey, filters.state]);

    const handleRefresh = React.useCallback(() => {
      issueStore.getState().refreshAllIssues(allKeys, sessionId, repoPathByKey);
    }, [allKeys, sessionId, repoPathByKey]);

    const handleFilterChange = React.useCallback((state: IssueFilterState) => {
      issueStore.getState().setFilterState(state);
    }, []);

    // Use the first project key for creating issues (root repo)
    const primaryKey = allKeys[0] ?? "";
    const primaryRepoPath = repoPathByKey[primaryKey];

    const [, doCreateIssue] = useHappyAction(
      React.useCallback(async () => {
        const title = await Modal.prompt(t("issues.newIssue"), "", {
          placeholder: t("issues.newIssueTitlePlaceholder"),
        });
        if (!title || title.trim() === "") return;

        const body = await Modal.prompt(t("issues.newIssueBody"), "", {
          placeholder: t("issues.newIssueBodyPlaceholder"),
        });

        await issueStore
          .getState()
          .createIssue(
            primaryKey,
            title.trim(),
            body?.trim() ?? "",
            sessionId,
            primaryRepoPath,
          );
      }, [primaryKey, sessionId, primaryRepoPath]),
    );

    const handleIssuePress = React.useCallback(
      (issue: AggregatedIssue) => {
        Modal.show({
          component: IssueDetailSheet,
          props: {
            issue,
            sessionId,
            repoPath: repoPathByKey[issue.projectKey],
            onSendToChat: (text: string) => {
              const session = storage.getState().sessions[sessionId];
              const currentDraft = session?.draft ?? "";
              const newDraft = currentDraft ? `${currentDraft}\n${text}` : text;
              storage.getState().updateSessionDraft(sessionId, newDraft);
            },
          },
        });
      },
      [sessionId, repoPathByKey],
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
        <View style={styles.emptyContainer}>
          <Text
            style={{
              fontSize: 15,
              color: theme.colors.textSecondary,
              textAlign: "center",
              ...Typography.default(),
            }}
          >
            {t("issues.noRepo")}
          </Text>
        </View>
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
        />

        {loading && issues.length === 0 && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.textLink} />
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                marginTop: 8,
                ...Typography.default(),
              }}
            >
              {t("issues.loading")}
            </Text>
          </View>
        )}

        {error !== "" && issues.length === 0 && !loading && (
          <View style={styles.emptyContainer}>
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.box.warning.text,
                textAlign: "center",
                ...Typography.default(),
              }}
            >
              {error}
            </Text>
          </View>
        )}

        {!loading && error === "" && issues.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text
              style={{
                fontSize: 15,
                color: theme.colors.textSecondary,
                textAlign: "center",
                ...Typography.default(),
              }}
            >
              {t("issues.noIssues")}
            </Text>
          </View>
        )}

        {issues.length > 0 && (
          <FlatList
            data={issues}
            keyExtractor={(item) => `${item.projectKey}:${item.number}`}
            renderItem={renderItem}
            onScroll={handleScroll}
            scrollEventThrottle={16}
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
