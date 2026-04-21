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
import { PRFilterBar } from "./PRFilterBar";
import { PRCard } from "./PRCard";
import { PRDetailSheet } from "./PRDetailSheet";
import {
    prStore,
    useAggregatedPRListState,
    useAggregatedPROpenCount,
    useAggregatedPRHasMore,
    usePRFilters,
} from "@/sync/prStore";
import { storage, useSetting } from "@/sync/storage";
import type { GitStatus } from "@/sync/storageTypes";
import type { SubmoduleInfo } from "@/sync/projectManager";
import type {
    PullRequest,
    AggregatedPR,
    PRFilterState,
    PRSortField,
    PRSortDirection,
} from "@/sync/prTypes";
import { usePRPolling } from "@/hooks/usePRPolling";
import { SharedStateView } from "@/components/SharedStateView";

interface GitPRsTabProps {
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

        if (gitStatus?.remoteUrl) {
            const rootKey = `${meta.machineId}:${meta.path}`;
            keys.push(rootKey);
            pathMap[rootKey] = undefined;
        }

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

export const GitPRsTab = React.memo<GitPRsTabProps>(
    function GitPRsTab({
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

        const {
            prs,
            loading,
            error,
            state: prsState,
        } = useAggregatedPRListState(allKeys);
        const filters = usePRFilters();
        const openCount = useAggregatedPROpenCount(allKeys);
        const hasMore = useAggregatedPRHasMore(allKeys);

        // Count closed (including merged) PRs from loaded data
        const closedCount = prStore((s) =>
            allKeys.reduce(
                (sum, k) =>
                    sum +
                    (s.prsByProject[k] ?? []).filter(
                        (pr) => pr.state === "closed" || pr.state === "merged",
                    ).length,
                0,
            ),
        );

        // Detect repo info for all projects
        const gitHostsRef = React.useRef(gitHosts);
        gitHostsRef.current = gitHosts;

        React.useEffect(() => {
            const meta = getSessionMeta(sessionId);
            if (!meta) return;
            const hosts = gitHostsRef.current;

            if (gitStatus?.remoteUrl) {
                const rootKey = `${meta.machineId}:${meta.path}`;
                prStore
                    .getState()
                    .detectRepoInfo(rootKey, gitStatus.remoteUrl, hosts);
            }

            if (submodules) {
                for (const sub of submodules) {
                    if (!sub.gitStatus?.remoteUrl) continue;
                    const subKey = `${meta.machineId}:${meta.path}|${sub.path}`;
                    prStore
                        .getState()
                        .detectRepoInfo(subKey, sub.gitStatus.remoteUrl, hosts);
                }
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [allKeys, sessionId]);

        // Re-detect when gitHosts settings change
        React.useEffect(() => {
            if (allKeys.length === 0) return;
            const meta = getSessionMeta(sessionId);
            if (!meta) return;

            if (gitStatus?.remoteUrl) {
                const rootKey = `${meta.machineId}:${meta.path}`;
                prStore
                    .getState()
                    .detectRepoInfo(rootKey, gitStatus.remoteUrl, gitHosts);
            }
            if (submodules) {
                for (const sub of submodules) {
                    if (!sub.gitStatus?.remoteUrl) continue;
                    const subKey = `${meta.machineId}:${meta.path}|${sub.path}`;
                    prStore
                        .getState()
                        .detectRepoInfo(subKey, sub.gitStatus.remoteUrl, gitHosts);
                }
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [gitHosts]);

        // Load PRs for all projects
        React.useEffect(() => {
            for (const key of allKeys) {
                const repoInfo = prStore.getState().repoInfoByProject[key];
                if (!repoInfo || repoInfo.provider === "unknown") continue;
                prStore.getState().loadPRs(key, sessionId, 1, repoPathByKey[key]);
            }
        }, [
            allKeys,
            sessionId,
            repoPathByKey,
            filters.state,
            filters.sort,
            filters.direction,
        ]);

        // Auto-poll PRs every 60s while mounted & app is active
        usePRPolling(allKeys, sessionId, repoPathByKey, prs.length > 0);

        const handleRefresh = React.useCallback(() => {
            prStore.getState().refreshAllPRs(allKeys, sessionId, repoPathByKey);
        }, [allKeys, sessionId, repoPathByKey]);

        const loadingMoreRef = React.useRef(false);
        const handleLoadMore = React.useCallback(async () => {
            if (loadingMoreRef.current || loading || !hasMore) return;
            loadingMoreRef.current = true;
            try {
                await prStore
                    .getState()
                    .loadMorePRs(allKeys, sessionId, repoPathByKey);
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

        const handleFilterChange = React.useCallback((state: PRFilterState) => {
            prStore.getState().setFilterState(state);
        }, []);

        const handleSortChange = React.useCallback(
            (sort: PRSortField, direction: PRSortDirection) => {
                prStore.getState().setSort(sort, direction);
            },
            [],
        );

        const handlePRPress = React.useCallback(
            (pr: PullRequest | AggregatedPR) => {
                if (!("projectKey" in pr)) return;
                const aggPR = pr as AggregatedPR;
                Modal.show({
                    component: PRDetailSheet,
                    props: {
                        pr: aggPR,
                        sessionId,
                        repoPath: repoPathByKey[aggPR.projectKey],
                    },
                });
            },
            [sessionId, repoPathByKey],
        );

        const renderItem = React.useCallback(
            ({ item }: { item: AggregatedPR }) => (
                <PRCard
                    pr={item}
                    onPress={handlePRPress}
                    repoLabel={multiRepo ? item.repoLabel : undefined}
                />
            ),
            [handlePRPress, multiRepo],
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

        // No repos with remote URL
        if (allKeys.length === 0) {
            return (
                <SharedStateView
                    inline
                    kind="empty"
                    icon={<Octicons name="repo" size={40} color={theme.colors.textSecondary} />}
                    title={t("prs.noRepo")}
                />
            );
        }

        return (
            <View style={{ flex: 1 }}>
                <PRFilterBar
                    activeState={filters.state}
                    onStateChange={handleFilterChange}
                    openCount={openCount}
                    closedCount={closedCount}
                    loading={loading}
                    onRefresh={handleRefresh}
                    sort={filters.sort}
                    direction={filters.direction}
                    onSortChange={handleSortChange}
                />

                {prsState.kind === "loading" && (
                    <SharedStateView
                        inline
                        kind="loading"
                        title={t("prs.loading")}
                    />
                )}

                {prsState.kind === "error" && (
                    <SharedStateView
                        inline
                        kind="error"
                        title={t("common.error")}
                        description={error ?? undefined}
                        onAction={handleRefresh}
                    />
                )}

                {prsState.kind === "empty" && (
                    <SharedStateView
                        inline
                        kind="empty"
                        icon={
                            <Octicons
                                name="git-pull-request"
                                size={40}
                                color={theme.colors.textSecondary + "60"}
                            />
                        }
                        title={
                            filters.state === "open"
                                ? t("prs.noOpenPRs")
                                : filters.state === "closed"
                                  ? t("prs.noClosedPRs")
                                  : t("prs.noPRs")
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
                                    {t("prs.tryClosedHint")}
                                </Text>
                            </Pressable>
                        )}
                    </SharedStateView>
                )}

                {prs.length > 0 && (
                    <FlatList
                        data={prs}
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
