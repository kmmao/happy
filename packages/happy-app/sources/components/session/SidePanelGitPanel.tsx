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
import { CommitDiffView } from "@/components/git/CommitDiffView";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
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
        // Lazy-mount strategy: a sub-tab is only mounted once the user has
        // actually visited it. Tabs that stay unvisited never subscribe to
        // the git/issue/PR stores, so the once-per-mutable-tool gitStatus
        // refresh no longer fans out into 5 hidden re-renders. Already-mounted
        // tabs are kept around (hidden via display:none) so scroll position
        // and any loaded pages persist when the user comes back.
        const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<GitTabId>>(
            () => new Set<GitTabId>(["changes"]),
        );
        const [selectedRepoPath, setSelectedRepoPath] = React.useState<string | null>(null);
        const [isRepoSelectorExpanded, setIsRepoSelectorExpanded] = React.useState(false);
        const [isRefreshing, setIsRefreshing] = React.useState(false);
        // Commit-file diff overlay inside this panel — when set, the panel
        // replaces its tabs with an in-panel CommitDiffView.
        const [viewedCommitFile, setViewedCommitFile] = React.useState<{
            fullPath: string;
            commitHash: string;
            repoBasePath: string;
        } | null>(null);
        // Nonce passed to CommitDiffView so the user-visible refresh button in
        // this panel's custom commit-diff header can force a re-fetch without
        // remounting the diff view.
        const [commitDiffReloadNonce, setCommitDiffReloadNonce] = React.useState(0);
        const handleRefreshCommitDiff = React.useCallback(() => {
            setCommitDiffReloadNonce((n) => n + 1);
        }, []);
        const { theme } = useUnistyles();

        const [refreshTrigger, setRefreshTrigger] = React.useState(0);

        const handleRefresh = React.useCallback(async () => {
            if (isRefreshing) return;
            setIsRefreshing(true);
            try {
                await gitStatusSync.invalidateAndAwait(sessionId);
                setRefreshTrigger((n) => n + 1);
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
            setVisitedTabs((prev) => {
                if (prev.has(tab)) return prev;
                const next = new Set(prev);
                next.add(tab);
                return next;
            });
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

        // Resolve the active repo's working-tree path so `git show` runs in the
        // correct cwd (submodule vs. root). `fullPath` from history is already
        // repo-relative; we keep it as the path the diff header displays.
        const handleHistoryFilePress = React.useCallback(
            (fullPath: string, commitHash: string) => {
                const repoBase = selectedRepoPath
                    ? `${sessionPath}/${selectedRepoPath}`
                    : sessionPath;
                setViewedCommitFile({
                    fullPath,
                    commitHash,
                    repoBasePath: repoBase,
                });
            },
            [sessionPath, selectedRepoPath],
        );

        const handleCloseCommitDiff = React.useCallback(() => {
            setViewedCommitFile(null);
        }, []);

        // Clear the diff overlay when the user switches repos so we never
        // render a stale commit/file pair from a different repo.
        React.useEffect(() => {
            setViewedCommitFile(null);
        }, [selectedRepoPath, sessionId]);

        if (viewedCommitFile) {
            const shortHash = viewedCommitFile.commitHash.slice(0, 7);
            const fileName =
                viewedCommitFile.fullPath.split("/").pop() ||
                viewedCommitFile.fullPath;
            return (
                <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 8,
                            paddingVertical: 8,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                            backgroundColor: theme.colors.surface,
                        }}
                    >
                        <Pressable
                            onPress={handleCloseCommitDiff}
                            style={(p) => ({
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                opacity: p.pressed ? 0.5 : 1,
                            })}
                            accessibilityRole="button"
                            accessibilityLabel={t("common.back")}
                        >
                            <Ionicons
                                name="arrow-back"
                                size={20}
                                color={theme.colors.text}
                            />
                        </Pressable>
                        <View style={{ flex: 1, marginLeft: 4 }}>
                            <Text
                                numberOfLines={1}
                                style={{
                                    fontSize: 13,
                                    color: theme.colors.text,
                                    fontWeight: "600",
                                    ...Typography.default(),
                                }}
                            >
                                {fileName}
                            </Text>
                            <Text
                                numberOfLines={1}
                                style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    ...Typography.mono(),
                                }}
                            >
                                {shortHash}
                            </Text>
                        </View>
                        <Pressable
                            onPress={handleRefreshCommitDiff}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={t("files.refresh")}
                            style={(p) => ({
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                opacity: p.pressed ? 0.5 : 1,
                            })}
                        >
                            <Ionicons
                                name="refresh"
                                size={18}
                                color={theme.colors.textLink}
                            />
                        </Pressable>
                    </View>
                    <CommitDiffView
                        sessionId={sessionId}
                        sessionPath={viewedCommitFile.repoBasePath}
                        fullPath={viewedCommitFile.fullPath}
                        commitHash={viewedCommitFile.commitHash}
                        showHeader={false}
                        reloadNonce={commitDiffReloadNonce}
                    />
                </View>
            );
        }

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

                {visitedTabs.has("changes") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "changes" ? "flex" : "none",
                        }}
                    >
                        <GitChangesTab
                            key={`changes-${refreshTrigger}`}
                            sessionId={sessionId}
                            repoPath={selectedRepoPath ?? undefined}
                            compact
                            onFilePress={onFilePress ? handleChangesFilePress : undefined}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                        />
                    </View>
                )}
                {visitedTabs.has("history") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "history" ? "flex" : "none",
                        }}
                    >
                        <GitHistoryTab
                            key={`history-${refreshTrigger}`}
                            sessionId={sessionId}
                            repoPath={selectedRepoPath ?? undefined}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                            onCommitFilePress={handleHistoryFilePress}
                        />
                    </View>
                )}
                {visitedTabs.has("branches") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "branches" ? "flex" : "none",
                        }}
                    >
                        <GitBranchesTab
                            key={`branches-${refreshTrigger}`}
                            sessionId={sessionId}
                            repoPath={selectedRepoPath ?? undefined}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                        />
                    </View>
                )}
                {visitedTabs.has("stash") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "stash" ? "flex" : "none",
                        }}
                    >
                        <GitStashTab
                            key={`stash-${refreshTrigger}`}
                            sessionId={sessionId}
                            repoPath={selectedRepoPath ?? undefined}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                        />
                    </View>
                )}
                {visitedTabs.has("issues") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "issues" ? "flex" : "none",
                        }}
                    >
                        <GitIssuesTab
                            key={`issues-${refreshTrigger}`}
                            sessionId={sessionId}
                            gitStatus={gitStatus}
                            submodules={submodules}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                        />
                    </View>
                )}
                {visitedTabs.has("prs") && (
                    <View
                        style={{
                            flex: 1,
                            display: activeTab === "prs" ? "flex" : "none",
                        }}
                    >
                        <GitPRsTab
                            key={`prs-${refreshTrigger}`}
                            sessionId={sessionId}
                            gitStatus={gitStatus}
                            submodules={submodules}
                            onPullDown={hasSubmodules ? handlePullDown : undefined}
                            onScrollUp={hasSubmodules ? handleScrollUp : undefined}
                        />
                    </View>
                )}
            </View>
        );
    },
);
