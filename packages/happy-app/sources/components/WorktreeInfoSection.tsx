/**
 * Worktree info section for the session info page.
 * Shows worktree metadata, diff stats, and merge/cleanup actions.
 */

import React, { useCallback, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
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
} from "@/sync/gitWorktreeOps";

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

export const WorktreeInfoSection = React.memo(function WorktreeInfoSection({
    sessionId,
    machineId,
    worktree,
}: WorktreeInfoSectionProps) {
    const { theme } = useUnistyles();
    const [merging, setMerging] = useState(false);
    const [cleaning, setCleaning] = useState(false);

    const handleMerge = useCallback(() => {
        Modal.alert(
            t("worktreeInfo.merge.title"),
            t("worktreeInfo.merge.description", {
                parentBranch: worktree.parentBranch,
            }),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("worktreeInfo.merge.createPr"),
                    onPress: async () => {
                        setMerging(true);
                        const result = await createPullRequest(
                            sessionId,
                            worktree.branchName,
                            worktree.parentBranch,
                            `Merge ${worktree.branchName}`,
                            `Automated PR from Happy worktree '${worktree.name}'`,
                        );
                        setMerging(false);

                        if (result.success) {
                            Modal.alert(
                                t("common.success"),
                                t("worktreeInfo.merge.prSuccess", {
                                    url: result.prUrl || "",
                                }),
                            );
                        } else {
                            Modal.alert(
                                t("common.error"),
                                t("worktreeInfo.merge.failed", {
                                    error: result.error || "",
                                }),
                            );
                        }
                    },
                },
                {
                    text: t("worktreeInfo.merge.directMerge"),
                    onPress: async () => {
                        setMerging(true);
                        const result = await directMerge(
                            machineId,
                            worktree.branchName,
                            worktree.parentBranch,
                            worktree.parentRepoPath,
                        );
                        setMerging(false);

                        if (result.success) {
                            Modal.alert(
                                t("common.success"),
                                t("worktreeInfo.merge.directSuccess"),
                            );
                        } else {
                            Modal.alert(
                                t("common.error"),
                                t("worktreeInfo.merge.failed", {
                                    error: result.error || "",
                                }),
                            );
                        }
                    },
                },
            ],
        );
    }, [sessionId, machineId, worktree]);

    const handleCleanup = useCallback(() => {
        const isUnmerged = worktree.state !== "merged";
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
                        Modal.alert(
                            t("common.success"),
                            t("worktreeInfo.cleanup.success"),
                        );
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
    }, [machineId, worktree]);

    const stateColor =
        STATE_COLORS[worktree.state] || theme.colors.textSecondary;
    const isTerminal =
        worktree.state === "cleaned" || worktree.state === "error";

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
                            {getStateLabel(worktree.state)}
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
