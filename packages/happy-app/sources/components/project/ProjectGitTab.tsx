import * as React from "react";
import { View, Text, Linking } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ItemList } from "@/components/ItemList";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { useSetting, storage } from "@/sync/storage";
import { useRouter } from "expo-router";
import { t } from "@/text";
import { Modal } from "@/modal";
import { fetchGitBranches } from "@/sync/gitBranches";
import { BranchPickerModal } from "./BranchPickerModal";
import type { GitHost } from "@/components/settings/git-hosts/types";
import { SharedStateView } from "@/components/SharedStateView";
import { fetchCiRuns, type CiRun } from "@/sync/apiWebhook";
import { TokenStorage } from "@/auth/tokenStorage";

interface ProjectGitTabProps {
    project: Project;
}

/**
 * Extract hostname from a git remote URL.
 * Handles SSH (git@host:...), HTTPS (https://host/...), HTTP+port (http://host:port/...)
 */
function extractHostFromRemoteUrl(
    remoteUrl: string | null | undefined,
): string | null {
    if (!remoteUrl) return null;

    // SSH format: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/^[\w-]+@([^:]+):/);
    if (sshMatch) return sshMatch[1];

    // HTTPS/HTTP format
    try {
        const url = new URL(remoteUrl);
        // For non-standard ports, return scheme + host + port (matches GitHost.host format)
        if (
            url.port &&
            url.port !== "443" &&
            url.port !== "80"
        ) {
            return `${url.protocol}//${url.host}`;
        }
        return url.hostname;
    } catch {
        return null;
    }
}

/**
 * Extract owner/repo from a git remote URL for display.
 */
function extractRepoName(
    remoteUrl: string | null | undefined,
): string | null {
    if (!remoteUrl) return null;

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];

    // HTTPS: https://github.com/owner/repo.git
    try {
        const url = new URL(remoteUrl);
        const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
        return path || null;
    } catch {
        return null;
    }
}

/**
 * Convert a git remote URL to a browser-openable HTTPS URL.
 */
function toBrowserUrl(remoteUrl: string | null | undefined): string | null {
    if (!remoteUrl) return null;

    // SSH: git@github.com:owner/repo.git -> https://github.com/owner/repo
    const sshMatch = remoteUrl.match(/^[\w-]+@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;

    // Already HTTPS/HTTP
    try {
        const url = new URL(remoteUrl);
        const path = url.pathname.replace(/\.git$/, "");
        return `${url.protocol}//${url.host}${path}`;
    } catch {
        return null;
    }
}

function findMatchingGitHost(
    remoteUrl: string | null | undefined,
    gitHosts: readonly GitHost[],
): GitHost | null {
    const host = extractHostFromRemoteUrl(remoteUrl);
    if (!host) return null;

    return (
        gitHosts.find(
            (gh) =>
                gh.host.toLowerCase() === host.toLowerCase() ||
                host.toLowerCase().includes(gh.host.toLowerCase()),
        ) ?? null
    );
}

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function getCiRunIcon(run: CiRun): {
    name: React.ComponentProps<typeof Ionicons>["name"];
    color: string;
} {
    if (run.status === "queued") {
        return { name: "time-outline", color: "#8E8E93" };
    }
    if (run.status === "in_progress") {
        return { name: "refresh-outline", color: "#007AFF" };
    }
    switch (run.conclusion) {
        case "success":
            return { name: "checkmark-circle-outline", color: "#34C759" };
        case "failure":
            return { name: "close-circle-outline", color: "#FF3B30" };
        case "timed_out":
            return { name: "alert-circle-outline", color: "#FF9500" };
        case "cancelled":
        case "skipped":
        case "action_required":
            return { name: "ellipsis-horizontal-circle-outline", color: "#8E8E93" };
        default:
            return { name: "help-circle-outline", color: "#8E8E93" };
    }
}

const CiStatusSection = React.memo(({ projectId }: { projectId: string }) => {
    const { theme } = useUnistyles();
    const [runs, setRuns] = React.useState<CiRun[]>([]);
    const [loaded, setLoaded] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const result = await fetchCiRuns(credentials, { projectId });
                if (!cancelled) {
                    setRuns(result.runs.slice(0, 5));
                    setLoaded(true);
                }
            } catch {
                if (!cancelled) setLoaded(true);
            }
        })();

        return () => { cancelled = true; };
    }, [projectId]);

    if (!loaded || runs.length === 0) return null;

    return (
        <ItemGroup title={t("projects.ciStatus")}>
            {runs.map((run) => {
                const icon = getCiRunIcon(run);
                return (
                    <Item
                        key={run.runId}
                        title={run.name}
                        subtitle={`${run.branch} · ${formatTimeAgo(new Date(run.updatedAt).getTime())}`}
                        icon={
                            <Ionicons
                                name={icon.name}
                                size={20}
                                color={icon.color}
                            />
                        }
                        onPress={run.url ? () => Linking.openURL(run.url) : undefined}
                        showChevron={!!run.url}
                    />
                );
            })}
        </ItemGroup>
    );
});

const LineChangeDetail = React.memo(
    ({ added, removed }: { added: number; removed: number }) => {
        const { theme } = useUnistyles();
        if (added === 0 && removed === 0) {
            return (
                <Text style={{ color: theme.colors.textSecondary, ...Typography.default(), fontSize: 15 }}>
                    0
                </Text>
            );
        }
        return (
            <Text style={{ ...Typography.default(), fontSize: 15 }}>
                {added > 0 && (
                    <Text style={{ color: "#34C759" }}>+{added}</Text>
                )}
                {added > 0 && removed > 0 && (
                    <Text style={{ color: theme.colors.textSecondary }}> / </Text>
                )}
                {removed > 0 && (
                    <Text style={{ color: "#FF3B30" }}>-{removed}</Text>
                )}
            </Text>
        );
    },
);

function findActiveSessionId(project: Project): string | null {
    const sessions = storage.getState().sessions;
    return (
        project.sessionIds.find((id) => sessions[id]?.active) ??
        (project.sessionIds.length > 0 ? project.sessionIds[0] : null)
    );
}

export const ProjectGitTab = React.memo(({ project }: ProjectGitTabProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const gitStatus = project.gitStatus;
    const gitHosts = useSetting("gitHosts");
    const [loadingBranches, setLoadingBranches] = React.useState(false);
    const loadingRef = React.useRef(false);

    const handleBranchPress = React.useCallback(async () => {
        const sessionId = findActiveSessionId(project);
        if (!sessionId || loadingRef.current) return;

        loadingRef.current = true;
        setLoadingBranches(true);
        try {
            const branches = await fetchGitBranches(sessionId);
            if (
                branches.local.length === 0 &&
                branches.remote.length === 0
            ) {
                Modal.alert(t("git.noBranches"));
                return;
            }

            Modal.show({
                component: BranchPickerModal,
                props: {
                    sessionId,
                    localBranches: branches.local,
                    remoteBranches: branches.remote,
                    currentBranch: gitStatus?.branch ?? null,
                },
            });
        } catch {
            Modal.alert(t("common.error"), t("git.branchSwitchFailed"));
        } finally {
            loadingRef.current = false;
            setLoadingBranches(false);
        }
    }, [project, gitStatus?.branch]);

    if (!gitStatus) {
        return (
            <SharedStateView
                kind="empty"
                icon={
                    <Ionicons
                        name="git-branch-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                }
                title={t("projects.noGitInfo")}
            />
        );
    }

    const matchedHost = findMatchingGitHost(gitStatus.remoteUrl, gitHosts);
    const repoName = extractRepoName(gitStatus.remoteUrl);
    const browserUrl = toBrowserUrl(gitStatus.remoteUrl);

    return (
        <ItemList>
            {/* CI Status */}
            {project.serverId && (
                <CiStatusSection projectId={project.serverId} />
            )}

            {/* Branch & Remote */}
            <ItemGroup title={t("projects.branchAndRemote")}>
                <Item
                    title={t("projects.branch")}
                    detail={gitStatus.branch ?? "-"}
                    icon={
                        <Ionicons
                            name="git-branch-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    onPress={handleBranchPress}
                    loading={loadingBranches}
                    showChevron
                />
                {gitStatus.upstreamBranch && (
                    <Item
                        title={t("projects.upstreamBranch")}
                        detail={gitStatus.upstreamBranch}
                        icon={
                            <Ionicons
                                name="cloud-outline"
                                size={20}
                                color={theme.colors.text}
                            />
                        }
                        showChevron={false}
                    />
                )}
                {gitStatus.aheadCount !== undefined && (
                    <Item
                        title={t("projects.ahead")}
                        rightElement={
                            <Text
                                style={{
                                    ...Typography.default("semiBold"),
                                    fontSize: 15,
                                    color:
                                        gitStatus.aheadCount > 0
                                            ? "#34C759"
                                            : theme.colors.textSecondary,
                                }}
                            >
                                {gitStatus.aheadCount}
                            </Text>
                        }
                        showChevron={false}
                    />
                )}
                {gitStatus.behindCount !== undefined && (
                    <Item
                        title={t("projects.behind")}
                        rightElement={
                            <Text
                                style={{
                                    ...Typography.default("semiBold"),
                                    fontSize: 15,
                                    color:
                                        gitStatus.behindCount > 0
                                            ? "#FF9500"
                                            : theme.colors.textSecondary,
                                }}
                            >
                                {gitStatus.behindCount}
                            </Text>
                        }
                        showChevron={false}
                    />
                )}
                {repoName && (
                    <Item
                        title={t("projects.remoteUrl")}
                        detail={repoName}
                        subtitle={gitStatus.remoteUrl ?? undefined}
                        icon={
                            <Ionicons
                                name="link-outline"
                                size={20}
                                color={theme.colors.text}
                            />
                        }
                        onPress={
                            browserUrl
                                ? () => Linking.openURL(browserUrl)
                                : undefined
                        }
                        showChevron={!!browserUrl}
                    />
                )}
            </ItemGroup>

            {/* File Changes */}
            <ItemGroup title={t("projects.fileChanges")}>
                <Item
                    title={t("projects.dirty")}
                    detail={
                        gitStatus.isDirty
                            ? t("common.yes")
                            : t("common.no")
                    }
                    icon={
                        <Ionicons
                            name={
                                gitStatus.isDirty
                                    ? "alert-circle-outline"
                                    : "checkmark-circle-outline"
                            }
                            size={20}
                            color={
                                gitStatus.isDirty
                                    ? "#FF9500"
                                    : "#34C759"
                            }
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t("projects.modifiedCount")}
                    detail={String(gitStatus.modifiedCount)}
                    icon={
                        <Ionicons
                            name="document-text-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t("projects.untrackedCount")}
                    detail={String(gitStatus.untrackedCount)}
                    icon={
                        <Ionicons
                            name="help-circle-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t("projects.stagedCount")}
                    detail={String(gitStatus.stagedCount)}
                    icon={
                        <Ionicons
                            name="checkmark-circle-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Line Changes */}
            <ItemGroup title={t("projects.lineChanges")}>
                <Item
                    title={t("projects.stagedLines")}
                    rightElement={
                        <LineChangeDetail
                            added={gitStatus.stagedLinesAdded}
                            removed={gitStatus.stagedLinesRemoved}
                        />
                    }
                    icon={
                        <Ionicons
                            name="checkmark-done-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t("projects.unstagedLines")}
                    rightElement={
                        <LineChangeDetail
                            added={gitStatus.unstagedLinesAdded}
                            removed={gitStatus.unstagedLinesRemoved}
                        />
                    }
                    icon={
                        <Ionicons
                            name="create-outline"
                            size={20}
                            color={theme.colors.text}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Stash (only show if data available) */}
            {gitStatus.stashCount !== undefined && (
                <ItemGroup title={t("projects.stash")}>
                    <Item
                        title={t("projects.stashCount")}
                        detail={String(gitStatus.stashCount)}
                        icon={
                            <Ionicons
                                name="layers-outline"
                                size={20}
                                color={theme.colors.text}
                            />
                        }
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Git Host */}
            <ItemGroup title={t("projects.gitHost")}>
                {matchedHost ? (
                    <Item
                        title={matchedHost.host}
                        subtitle={
                            matchedHost.provider === "github"
                                ? "GitHub"
                                : "Gitea"
                        }
                        icon={
                            <Ionicons
                                name={
                                    matchedHost.provider === "github"
                                        ? "logo-github"
                                        : "server-outline"
                                }
                                size={20}
                                color={theme.colors.text}
                            />
                        }
                        onPress={() =>
                            router.push("/settings/git-hosts")
                        }
                    />
                ) : gitStatus.remoteUrl ? (
                    <Item
                        title={t("projects.addGitHost")}
                        icon={
                            <Ionicons
                                name="add-circle-outline"
                                size={20}
                                color={theme.colors.header.tint}
                            />
                        }
                        titleStyle={{
                            color: theme.colors.header.tint,
                        }}
                        onPress={() =>
                            router.push("/settings/git-hosts")
                        }
                    />
                ) : (
                    <Item
                        title={t("projects.noRemoteUrl")}
                        icon={
                            <Ionicons
                                name="unlink-outline"
                                size={20}
                                color={theme.colors.textSecondary}
                            />
                        }
                        titleStyle={{
                            color: theme.colors.textSecondary,
                        }}
                        showChevron={false}
                    />
                )}
            </ItemGroup>

            {/* Last updated */}
            <View style={styles.lastUpdatedContainer}>
                <Text style={styles.lastUpdatedText}>
                    {t("projects.lastUpdated")}:{" "}
                    {formatTimeAgo(gitStatus.lastUpdatedAt)}
                </Text>
            </View>
        </ItemList>
    );
});

const styles = StyleSheet.create((theme) => ({
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 12,
        textAlign: "center",
    },
    lastUpdatedContainer: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignItems: "center",
    },
    lastUpdatedText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
}));
