import * as React from "react";
import { View } from "react-native";
import { useRoute } from "@react-navigation/native";
import { GitTabBar, GitTabId } from "@/components/git/GitTabBar";
import { GitChangesTab } from "@/components/git/GitChangesTab";
import { GitHistoryTab } from "@/components/git/GitHistoryTab";
import { GitBranchesTab } from "@/components/git/GitBranchesTab";
import { GitStashTab } from "@/components/git/GitStashTab";
import { GitRepoSelector } from "@/components/git/GitRepoSelector";
import { GitBranchHeader } from "@/components/git/GitBranchHeader";
import {
  useSessionGitStatus,
  useSessionProjectGitStatus,
  useSessionProjectSubmodules,
} from "@/sync/storage";
import { storage } from "@/sync/storage";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { layout } from "@/components/layout";

export default React.memo(function GitScreen() {
  const route = useRoute();
  const sessionId = (route.params! as any).id as string;
  const [activeTab, setActiveTab] = React.useState<GitTabId>("changes");
  const [selectedRepoPath, setSelectedRepoPath] = React.useState<string | null>(
    null,
  );
  const { theme } = useUnistyles();

  const projectGitStatus = useSessionProjectGitStatus(sessionId);
  const sessionGitStatus = useSessionGitStatus(sessionId);
  const gitStatus = projectGitStatus || sessionGitStatus;
  const submodules = useSessionProjectSubmodules(sessionId);

  const sessionPath =
    storage.getState().sessions[sessionId]?.metadata?.path ?? "";

  const hasSubmodules = submodules !== undefined && submodules.length > 0;

  // Resolve git status for selected repo (root or submodule)
  const activeGitStatus = React.useMemo(() => {
    if (!selectedRepoPath) return gitStatus;
    const sub = submodules?.find((s) => s.path === selectedRepoPath);
    return sub?.gitStatus ?? null;
  }, [selectedRepoPath, gitStatus, submodules]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {hasSubmodules && (
        <GitRepoSelector
          sessionPath={sessionPath}
          submodules={submodules}
          selectedRepoPath={selectedRepoPath}
          onSelect={setSelectedRepoPath}
        />
      )}
      <GitBranchHeader
        sessionId={sessionId}
        repoPath={selectedRepoPath ?? undefined}
        gitStatus={activeGitStatus}
      />
      <GitTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        stashCount={gitStatus?.stashCount}
      />
      <View
        style={{
          flex: 1,
          display: activeTab === "changes" ? "flex" : "none",
        }}
      >
        <GitChangesTab sessionId={sessionId} />
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
        />
      </View>
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
}));
