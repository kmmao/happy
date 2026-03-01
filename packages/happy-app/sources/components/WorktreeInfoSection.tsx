/**
 * Worktree info section for the session info page.
 * Shows worktree metadata, diff stats, and merge/cleanup actions.
 */

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import { t } from "@/text";
import type { Metadata } from "@/sync/storageTypes";
import {
  createPullRequest,
  directMerge,
  removeWorktree,
  deleteBranch,
  getWorktreeDiff,
  getWorktreeCommits,
  type DiffStats,
  type CommitInfo,
} from "@/sync/gitWorktreeOps";
import { sessionKill } from "@/sync/ops";

interface WorktreeInfoSectionProps {
  readonly sessionId: string;
  readonly machineId: string;
  readonly worktree: NonNullable<Metadata["worktree"]>;
}

type WorktreeState = NonNullable<Metadata["worktree"]>["state"];

const STATE_COLORS: Record<WorktreeState, string> = {
  creating: "#f59e0b",
  active: "#22c55e",
  merging: "#3b82f6",
  merged: "#8b5cf6",
  cleaning: "#f59e0b",
  cleaned: "#6b7280",
  error: "#ef4444",
};

function getStateLabel(state: WorktreeState): string {
  const labels: Record<WorktreeState, string> = {
    creating: t("worktreeInfo.state.creating"),
    active: t("worktreeInfo.state.active"),
    merging: t("worktreeInfo.state.merging"),
    merged: t("worktreeInfo.state.merged"),
    cleaning: t("worktreeInfo.state.cleaning"),
    cleaned: t("worktreeInfo.state.cleaned"),
    error: t("worktreeInfo.state.error"),
  };
  return labels[state] || state;
}

function formatMergePreview(
  stats: DiffStats,
  commits: readonly CommitInfo[],
): string {
  const lines: string[] = [];

  lines.push(
    `${stats.filesChanged} ${t("worktreeInfo.merge.filesChanged")}  +${stats.insertions}  -${stats.deletions}`,
  );
  lines.push("");

  if (commits.length === 0) {
    lines.push(t("worktreeInfo.merge.noCommits"));
  } else {
    lines.push(
      `${t("worktreeInfo.merge.commits", { count: commits.length })}:`,
    );
    for (const commit of commits.slice(0, 10)) {
      lines.push(`  ${commit.hash}  ${commit.message}`);
    }
    if (commits.length > 10) {
      lines.push(`  ... +${commits.length - 10} more`);
    }
  }

  return lines.join("\n");
}

export const WorktreeInfoSection = React.memo(function WorktreeInfoSection({
  sessionId,
  machineId,
  worktree,
}: WorktreeInfoSectionProps) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const [merging, setMerging] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [localState, setLocalState] = useState<WorktreeState | null>(null);

  // Reset local override when server-side state updates
  useEffect(() => {
    setLocalState(null);
  }, [worktree.state]);

  const effectiveState = localState ?? worktree.state;

  const handleCreatePR = useCallback(async () => {
    setMerging(true);
    const result = await createPullRequest(
      sessionId,
      worktree.branchName,
      worktree.parentBranch,
      `Merge ${worktree.branchName}`,
      `Automated PR from Happy worktree '${worktree.name}'`,
    );
    setMerging(false);

    if (result.success && result.prUrl) {
      setLocalState("merged");
      Modal.alert(
        t("common.success"),
        t("worktreeInfo.merge.prSuccess", { url: result.prUrl }),
        [
          { text: t("common.ok") },
          {
            text: t("worktreeInfo.merge.openPr"),
            onPress: () => {
              Linking.openURL(result.prUrl!);
            },
          },
        ],
      );
    } else {
      Modal.alert(
        t("common.error"),
        t("worktreeInfo.merge.failed", { error: result.error || "" }),
      );
    }
  }, [sessionId, worktree]);

  const handleDirectMerge = useCallback(async () => {
    setMerging(true);
    const result = await directMerge(
      machineId,
      worktree.branchName,
      worktree.parentBranch,
      worktree.parentRepoPath,
    );
    setMerging(false);

    if (result.success) {
      setLocalState("merged");
      Modal.alert(
        t("common.success"),
        t("worktreeInfo.merge.directSuccessDeleteBranch", {
          branchName: worktree.branchName,
        }),
        [
          { text: t("worktreeInfo.merge.keepBranch"), style: "cancel" },
          {
            text: t("worktreeInfo.merge.deleteBranch"),
            style: "destructive",
            onPress: async () => {
              await deleteBranch(
                machineId,
                worktree.branchName,
                worktree.parentRepoPath,
              );
            },
          },
        ],
      );
    } else {
      Modal.alert(
        t("common.error"),
        t("worktreeInfo.merge.failed", { error: result.error || "" }),
      );
    }
  }, [machineId, worktree]);

  const handleMerge = useCallback(async () => {
    setMerging(true);

    // Load diff stats and commits for preview
    const [diffResult, commitsResult] = await Promise.all([
      getWorktreeDiff(sessionId, worktree.parentBranch),
      getWorktreeCommits(sessionId, worktree.parentBranch),
    ]);

    setMerging(false);

    const stats: DiffStats = diffResult.success
      ? diffResult.stats
      : { filesChanged: 0, insertions: 0, deletions: 0 };
    const commits = commitsResult.success ? commitsResult.commits : [];

    const preview = formatMergePreview(stats, commits);

    Modal.alert(
      t("worktreeInfo.merge.preview"),
      `${t("worktreeInfo.merge.description", { parentBranch: worktree.parentBranch })}\n\n${preview}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("worktreeInfo.merge.createPr"),
          onPress: handleCreatePR,
        },
        {
          text: t("worktreeInfo.merge.directMerge"),
          onPress: handleDirectMerge,
        },
      ],
    );
  }, [sessionId, worktree, handleCreatePR, handleDirectMerge]);

  const handleCleanup = useCallback(() => {
    const isUnmerged = effectiveState !== "merged";
    const message = isUnmerged
      ? t("worktreeInfo.cleanup.notMerged")
      : t("worktreeInfo.cleanup.confirm");

    Modal.alert(t("worktreeInfo.cleanup.title"), message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("worktreeInfo.cleanup.remove"),
        style: "destructive",
        onPress: async () => {
          setCleaning(true);
          const result = await removeWorktree(
            machineId,
            worktree.name,
            worktree.parentRepoPath,
            true,
          );
          setCleaning(false);

          if (result.success) {
            setLocalState("cleaned");
            // Auto-archive session since worktree no longer exists
            try {
              await sessionKill(sessionId);
            } catch {
              // Silently handle - worktree is already removed
            }

            Modal.alert(
              t("common.success"),
              t("worktreeInfo.cleanup.successAndArchived"),
            );

            // Navigate back since session is now archived
            if (router.canGoBack()) {
              router.back();
            }
          } else {
            Modal.alert(
              t("common.error"),
              t("worktreeInfo.cleanup.failed", {
                error: result.error || "",
              }),
            );
          }
        },
      },
    ]);
  }, [machineId, worktree, sessionId, router]);

  const stateColor = STATE_COLORS[effectiveState] || theme.colors.textSecondary;
  const isTerminal = effectiveState === "cleaned" || effectiveState === "error";

  return (
    <ItemGroup title={t("worktreeInfo.title")}>
      <Item
        title={t("worktreeInfo.branch")}
        detail={worktree.branchName}
        showChevron={false}
      />
      <Item
        title={t("worktreeInfo.parentBranch")}
        detail={worktree.parentBranch}
        showChevron={false}
      />
      <Item
        title={t("worktreeInfo.status")}
        rightElement={
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: stateColor,
                marginRight: 6,
              }}
            />
            <Text
              style={{
                color: stateColor,
                fontSize: 15,
                ...Typography.default("semiBold"),
              }}
            >
              {getStateLabel(effectiveState)}
            </Text>
          </View>
        }
        showChevron={false}
      />
      {worktree.error && (
        <Item
          title={t("worktreeInfo.errorLabel")}
          subtitle={worktree.error}
          showChevron={false}
        />
      )}
      {worktree.prUrl && (
        <Item
          title="PR"
          subtitle={worktree.prUrl}
          onPress={() => Linking.openURL(worktree.prUrl!)}
          showChevron={false}
        />
      )}
      {!isTerminal && (
        <>
          <Item
            title={t("worktreeInfo.merge.action")}
            onPress={handleMerge}
            icon={
              merging ? (
                <ActivityIndicator size="small" />
              ) : (
                <Ionicons
                  name="git-merge-outline"
                  size={20}
                  color={theme.colors.textLink}
                />
              )
            }
            disabled={merging || cleaning}
          />
          <Item
            title={t("worktreeInfo.cleanup.action")}
            onPress={handleCleanup}
            icon={
              cleaning ? (
                <ActivityIndicator size="small" />
              ) : (
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={theme.colors.deleteAction}
                />
              )
            }
            disabled={merging || cleaning}
          />
        </>
      )}
    </ItemGroup>
  );
});
