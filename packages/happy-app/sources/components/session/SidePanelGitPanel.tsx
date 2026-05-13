/**
 * Full git panel for the session side panel (desktop).
 * Mirrors the git.tsx page but accepts sessionId as a prop instead of route params.
 */

import * as React from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GitTabBar, GitTabId } from "@/components/git/GitTabBar";
import { GitChangesTab } from "@/components/git/GitChangesTab";
import { GitHistoryTab } from "@/components/git/GitHistoryTab";
import { GitBranchesTab } from "@/components/git/GitBranchesTab";
import { GitStashTab } from "@/components/git/GitStashTab";
import { GitIssuesTab } from "@/components/git/issues/GitIssuesTab";
import { GitPRsTab } from "@/components/git/prs/GitPRsTab";
import { GitRepoSelector } from "@/components/git/GitRepoSelector";
import { GitBranchHeader } from "@/components/git/GitBranchHeader";
import {
    useSessionGitStatus,
    useSessionProjectGitStatus,
    useSessionProjectSubmodules,
} from "@/sync/storage";
import { storage } from "@/sync/storage";
import { issueStore } from "@/sync/issueStore";
import { prStore } from "@/sync/prStore";
import { gitStatusSync } from "@/sync/gitStatusSync";
import { useUnistyles } from "react-native-unistyles";

interface SidePanelGitPanelProps {
    sessionId: string;
    onFilePress?: (fullPath: string, repoPath?: string) => void;
}

export const SidePanelGitPanel = React.memo<SidePanelGitPanelProps>(
    function SidePanelGitPanel({ sessionId, onFilePress }) {
        const [activeTab, setActiveTab] = React.useState<GitTabId>("changes");
        const [selectedRepoPath, setSelectedRepoPath] = React.useState<string | null>(null);
        const [isRepoSelectorExpanded, setIsRepoSelectorExpanded] = React.useState(false);
        const [isRefreshing, setIsRefreshing] = React.useState(false);
        const { theme } = useUnistyles();

        const handleRefresh = React.useCallback(async () => {
            if (isRefreshing) return;
            setIsRefreshing(true);
            try {
                await gitStatusSync.invalidateAndAwait(sessionId);
            } finally {
                setIsRefreshing(false);
            }
        }, [sessionId, isRefreshing]);

        const projectGitStatus = useSessionProjectGitStatus(sessionId);
        const sessionGitStatus = useSessionGitStatus(sessionId);
        const gitStatus = projectGitStatus || sessionGitStatus;
        const submodules = useSessionProjectSubmodules(sessionId);

        const sessionPath =
            storage.getState().sessions[sessionId]?.metadata?.path ?? "";

        const hasSubmodules = submodules !== undefined && submodules.length > 0;

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

        const activeGitStatus = React.useMemo(() => {
            if (!selectedRepoPath) return gitStatus;
            const sub = submodules?.find((s) => s.path === selectedRepoPath);
            return sub?.gitStatus ?? null;
        }, [selectedRepoPath, gitStatus, submodules]);

        const handleTabChange = React.useCallback((tab: GitTabId) => {
            setActiveTab(tab);
        }, []);

        // Convert git-relative path to absolute path for file preview
        // submodulePath is passed when clicking files inside a submodule/child repo
        const handleChangesFilePress = React.useCallback(
            (gitRelativePath: string, submodulePath?: string) => {
                const repoBase = submodulePath ?? selectedRepoPath;
                const basePath = repoBase
                    ? `${sessionPath}/${repoBase}`
                    : sessionPath;
                onFilePress?.(`${basePath}/${gitRelativePath}`, basePath);
            },
            [sessionPath, selectedRepoPath, onFilePress],
        );

        const handleRepoSelect = React.useCallback((repoPath: string | null) => {
            setSelectedRepoPath(repoPath);
        }, []);

        const handleRepoSelectorToggle = React.useCallback(() => {
            setIsRepoSelectorExpanded((v) => !v);
        }, []);

        const handleScrollUp = React.useCallback(() => {
            setIsRepoSelectorExpanded(false);
        }, []);

        const handlePullDown = React.useCallback(() => {
            setIsRepoSelectorExpanded(true);
        }, []);

        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
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
                    compact
                />
                <View style={{ flexDirection: "row", alignItems: "stretch" }}>
                    <View style={{ flex: 1 }}>
                        <GitTabBar
                            activeTab={activeTab}
                            onTabChange={handleTabChange}
                            compact
                            stashCount={gitStatus?.stashCount}
                            issueCount={issueCount}
                            prCount={prCount}
                        />
                    </View>
                    <Pressable
                        onPress={handleRefresh}
                        disabled={isRefreshing}
                        style={(p) => ({
                            paddingHorizontal: 10,
                            alignItems: "center",
                            justifyContent: "center",
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                            opacity: p.pressed ? 0.5 : 1,
                        })}
                    >
                        {isRefreshing ? (
                            <ActivityIndicator size={14} color={theme.colors.textSecondary} />
                        ) : (
                            <Ionicons name="refresh-outline" size={16} color={theme.colors.textSecondary} />
                        )}
                    </Pressable>
                </View>

                <View
                    style={{
                        flex: 1,
                        display: activeTab === "changes" ? "flex" : "none",
                    }}
                >
                    <GitChangesTab
                        sessionId={sessionId}
                        repoPath={selectedRepoPath ?? undefined}
                        compact
                        onFilePress={onFilePress ? handleChangesFilePress : undefined}
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
    },
);
