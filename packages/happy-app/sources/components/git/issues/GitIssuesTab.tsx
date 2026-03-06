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
import { IssueFilterBar } from "./IssueFilterBar";
import { IssueCard } from "./IssueCard";
import { IssueDetailSheet } from "./IssueDetailSheet";
import { IssuePagination } from "./IssuePagination";
import {
  issueStore,
  useIssues,
  useIssueRepoInfo,
  useIssueLoading,
  useIssuePage,
  useIssueHasMore,
  useIssueError,
  useIssueFilters,
  useIssueOpenCount,
  useIssueClosedCount,
} from "@/sync/issueStore";
import { storage, useSetting } from "@/sync/storage";
import type { GitStatus } from "@/sync/storageTypes";
import type { Issue, IssueFilterState } from "@/sync/issueTypes";

interface GitIssuesTabProps {
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly gitStatus: GitStatus | null;
  readonly onPullDown?: () => void;
  readonly onScrollUp?: () => void;
}

function getProjectKey(sessionId: string): string {
  const session = storage.getState().sessions[sessionId];
  if (!session?.metadata?.machineId || !session?.metadata?.path) return "";
  return `${session.metadata.machineId}:${session.metadata.path}`;
}

export const GitIssuesTab = React.memo<GitIssuesTabProps>(
  function GitIssuesTab({
    sessionId,
    repoPath,
    gitStatus,
    onPullDown,
    onScrollUp,
  }) {
    const { theme } = useUnistyles();
    const gitHosts = useSetting("gitHosts");
    const projectKey = React.useMemo(
      () => getProjectKey(sessionId),
      [sessionId],
    );
    const issues = useIssues(projectKey);
    const repoInfo = useIssueRepoInfo(projectKey);
    const loading = useIssueLoading(projectKey);
    const currentPage = useIssuePage(projectKey);
    const hasMore = useIssueHasMore(projectKey);
    const error = useIssueError(projectKey);
    const filters = useIssueFilters();

    // Detect repo info from git status remote URL
    React.useEffect(() => {
      if (!projectKey || !gitStatus?.remoteUrl) return;
      issueStore
        .getState()
        .detectRepoInfo(projectKey, gitStatus.remoteUrl, gitHosts);
    }, [projectKey, gitStatus?.remoteUrl, gitHosts]);

    // Load issues when repo info is available
    React.useEffect(() => {
      if (!projectKey || !repoInfo || repoInfo.provider === "unknown") return;
      issueStore.getState().loadIssues(projectKey, sessionId, 1, repoPath);
    }, [projectKey, repoInfo, sessionId, repoPath, filters.state]);

    const handleRefresh = React.useCallback(() => {
      if (!projectKey) return;
      issueStore.getState().refreshIssues(projectKey, sessionId, repoPath);
    }, [projectKey, sessionId, repoPath]);

    const handleFilterChange = React.useCallback((state: IssueFilterState) => {
      issueStore.getState().setFilterState(state);
    }, []);

    const handlePageChange = React.useCallback(
      (page: number) => {
        if (!projectKey) return;
        issueStore.getState().goToPage(projectKey, sessionId, page, repoPath);
      },
      [projectKey, sessionId, repoPath],
    );

    const handleIssuePress = React.useCallback(
      (issue: Issue) => {
        Modal.show({
          component: IssueDetailSheet,
          props: {
            issue,
            onSendToChat: (text: string) => {
              const session = storage.getState().sessions[sessionId];
              const currentDraft = session?.draft ?? "";
              const newDraft = currentDraft ? `${currentDraft}\n${text}` : text;
              storage.getState().updateSessionDraft(sessionId, newDraft);
            },
          },
        });
      },
      [sessionId],
    );

    const openCount = useIssueOpenCount(projectKey);
    const closedCount = useIssueClosedCount(projectKey);

    const renderItem = React.useCallback(
      ({ item }: { item: Issue }) => (
        <IssueCard issue={item} onPress={handleIssuePress} />
      ),
      [handleIssuePress],
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

    // No repo info detected
    if (!repoInfo || repoInfo.provider === "unknown") {
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
            keyExtractor={(item) => String(item.number)}
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

        <IssuePagination
          currentPage={currentPage}
          hasMore={hasMore}
          loading={loading}
          onPageChange={handlePageChange}
        />
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
