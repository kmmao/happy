import * as React from "react";
import { View, Pressable, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { GitTabBar, GitTabId } from "@/components/git/GitTabBar";
import { GitChangesTab } from "@/components/git/GitChangesTab";
import { GitBrowseTab } from "@/components/git/GitBrowseTab";
import { GitHistoryTab } from "@/components/git/GitHistoryTab";
import { GitBranchesTab } from "@/components/git/GitBranchesTab";
import { GitStashTab } from "@/components/git/GitStashTab";
import { GitIssuesTab } from "@/components/git/issues/GitIssuesTab";
import { GitPRsTab } from "@/components/git/prs/GitPRsTab";
import { GitRepoSelector } from "@/components/git/GitRepoSelector";
import { GitBranchHeader } from "@/components/git/GitBranchHeader";
import { SidePanelFilePreview } from "@/components/session/SidePanelFilePreview";
import {
  useSessionGitStatus,
  useSessionProjectGitStatus,
  useSessionProjectSubmodules,
} from "@/sync/storage";
import { storage } from "@/sync/storage";
import { issueStore } from "@/sync/issueStore";
import { prStore } from "@/sync/prStore";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { screenLayoutMaxWidth } from "@/components/layout";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

export default React.memo(function GitScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const [activeTab, setActiveTab] = React.useState<GitTabId>("changes");
  const [browseMode, setBrowseMode] = React.useState(false);
  const [selectedRepoPath, setSelectedRepoPath] = React.useState<string | null>(
    null,
  );
  const [isRepoSelectorExpanded, setIsRepoSelectorExpanded] =
    React.useState(false);
  const [previewingFile, setPreviewingFile] = React.useState<string | null>(null);
  const [previewingRepoPath, setPreviewingRepoPath] = React.useState<string | null>(null);
  const { theme } = useUnistyles();

  const projectGitStatus = useSessionProjectGitStatus(sessionId);
  const sessionGitStatus = useSessionGitStatus(sessionId);
  const gitStatus = projectGitStatus || sessionGitStatus;
  const submodules = useSessionProjectSubmodules(sessionId);

  const sessionPath =
    storage.getState().sessions[sessionId]?.metadata?.path ?? "";

  const hasSubmodules = submodules !== undefined && submodules.length > 0;

  // Issue count for tab badge — aggregate all repos
  const computedIssueKeys = React.useMemo(() => {
    const session = storage.getState().sessions[sessionId];
    if (!session?.metadata?.machineId || !session?.metadata?.path) return [];
    const mid = session.metadata.machineId;
    const path = session.metadata.path;
    const keys: string[] = [];
    if (gitStatus?.remoteUrl) {
      keys.push(`${mid}:${path}`);
    }
    if (submodules) {
      for (const sub of submodules) {
        if (!sub.gitStatus?.remoteUrl) continue;
        keys.push(`${mid}:${path}|${sub.path}`);
      }
    }
    return keys;
  }, [sessionId, gitStatus?.remoteUrl, submodules]);

  // Stabilize reference to avoid unnecessary selector re-subscriptions
  const issueKeysStr = computedIssueKeys.join("\n");
  const stableIssueKeysRef = React.useRef<readonly string[]>([]);
  if (stableIssueKeysRef.current.join("\n") !== issueKeysStr) {
    stableIssueKeysRef.current = computedIssueKeys;
  }
  const allIssueKeys = stableIssueKeysRef.current;

  const issueCount = issueStore((s) =>
    allIssueKeys.reduce(
      (sum, k) =>
        sum +
        (s.issuesByProject[k] ?? []).filter((i) => i.state === "open").length,
      0,
    ),
  );

  const prCount = prStore((s) =>
    allIssueKeys.reduce(
      (sum, k) =>
        sum +
        (s.prsByProject[k] ?? []).filter((pr) => pr.state === "open").length,
      0,
    ),
  );

  // Resolve git status for selected repo (root or submodule)
  const activeGitStatus = React.useMemo(() => {
    if (!selectedRepoPath) return gitStatus;
    const sub = submodules?.find((s) => s.path === selectedRepoPath);
    return sub?.gitStatus ?? null;
  }, [selectedRepoPath, gitStatus, submodules]);

  const handleTabChange = React.useCallback((tab: GitTabId) => {
    setActiveTab(tab);
    if (tab !== "changes") setBrowseMode(false);
  }, []);

  const handleRepoSelect = React.useCallback((repoPath: string | null) => {
    setSelectedRepoPath(repoPath);
  }, []);

  const handleRepoSelectorToggle = React.useCallback(() => {
    setIsRepoSelectorExpanded((v) => !v);
  }, []);

  // Tab content scrolled up → collapse repo list
  const handleScrollUp = React.useCallback(() => {
    setIsRepoSelectorExpanded(false);
  }, []);

  // Tab content pulled down at top → expand repo list
  const handlePullDown = React.useCallback(() => {
    setIsRepoSelectorExpanded(true);
  }, []);

  // Convert git-relative path to absolute path for file preview (with diff)
  const handleFilePress = React.useCallback(
    (gitRelativePath: string, submodulePath?: string) => {
      const repoBase = submodulePath ?? selectedRepoPath;
      const basePath = repoBase
        ? `${sessionPath}/${repoBase}`
        : sessionPath;
      setPreviewingFile(`${basePath}/${gitRelativePath}`);
      setPreviewingRepoPath(basePath);
    },
    [sessionPath, selectedRepoPath],
  );

  if (previewingFile) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
        <SidePanelFilePreview
          sessionId={sessionId}
          filePath={previewingFile}
          repoPath={previewingRepoPath ?? undefined}
          onClose={() => {
            setPreviewingFile(null);
            setPreviewingRepoPath(null);
          }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {hasSubmodules && (
        <GitRepoSelector
          sessionPath={sessionPath}
          submodules={submodules}
          selectedRepoPath={selectedRepoPath}
          onSelect={handleRepoSelect}
          isExpanded={isRepoSelectorExpanded}
          onToggle={handleRepoSelectorToggle}
        />
      )}
      <GitBranchHeader
        sessionId={sessionId}
        repoPath={selectedRepoPath ?? undefined}
        gitStatus={activeGitStatus}
      />
      <GitTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        stashCount={gitStatus?.stashCount}
        issueCount={issueCount}
        prCount={prCount}
      />

      {/* Changes / Browse sub-toggle — only visible on the Changes tab */}
      {activeTab === "changes" && (
        <View
          style={{
            flexDirection: "row",
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surfaceHigh,
          }}
        >
          {(["changes", "browse"] as const).map((mode) => {
            const isActive = browseMode === (mode === "browse");
            return (
              <Pressable
                key={mode}
                onPress={() => setBrowseMode(mode === "browse")}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 8,
                  borderBottomWidth: isActive ? 2 : 0,
                  borderBottomColor: isActive
                    ? theme.colors.textLink
                    : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? "600" : "400",
                    color: isActive
                      ? theme.colors.textLink
                      : theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  {mode === "changes"
                    ? t("files.changesTab")
                    : t("files.browseTab")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View
        style={{
          flex: 1,
          display: activeTab === "changes" && !browseMode ? "flex" : "none",
        }}
      >
        <GitChangesTab
          sessionId={sessionId}
          repoPath={selectedRepoPath ?? undefined}
          onFilePress={handleFilePress}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "changes" && browseMode ? "flex" : "none",
        }}
      >
        <GitBrowseTab
          sessionId={sessionId}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "history" ? "flex" : "none",
        }}
      >
        <GitHistoryTab
          sessionId={sessionId}
          repoPath={selectedRepoPath ?? undefined}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "branches" ? "flex" : "none",
        }}
      >
        <GitBranchesTab
          sessionId={sessionId}
          repoPath={selectedRepoPath ?? undefined}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "stash" ? "flex" : "none",
        }}
      >
        <GitStashTab
          sessionId={sessionId}
          repoPath={selectedRepoPath ?? undefined}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "issues" ? "flex" : "none",
        }}
      >
        <GitIssuesTab
          sessionId={sessionId}
          gitStatus={gitStatus}
          submodules={submodules}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
      <View
        style={{
          flex: 1,
          display: activeTab === "prs" ? "flex" : "none",
        }}
      >
        <GitPRsTab
          sessionId={sessionId}
          gitStatus={gitStatus}
          submodules={submodules}
          onPullDown={hasSubmodules ? handlePullDown : undefined}
          onScrollUp={hasSubmodules ? handleScrollUp : undefined}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
    alignSelf: "center",
    width: "100%",
  },
}));
