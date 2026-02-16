import React from "react";
import { View, Text } from "react-native";
import {
    useSessionGitStatus,
    useSessionProjectGitStatus,
    useSessionProjectSubmodules,
} from "@/sync/storage";
import {
    aggregateLineChanges,
    hasMeaningfulLineChanges,
} from "@/utils/gitStatusUtils";
import { StyleSheet } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 6,
        height: 16,
        borderRadius: 4,
    },
    fileCountText: {
        fontSize: 10,
        fontWeight: "500",
        color: theme.colors.textSecondary,
    },
    lineChanges: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    addedText: {
        fontSize: 10,
        fontWeight: "600",
        color: theme.colors.gitAddedText,
    },
    removedText: {
        fontSize: 10,
        fontWeight: "600",
        color: theme.colors.gitRemovedText,
    },
}));

interface CompactGitStatusProps {
    sessionId: string;
}

export function CompactGitStatus({ sessionId }: CompactGitStatusProps) {
    const styles = stylesheet;
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;
    const submodules = useSessionProjectSubmodules(sessionId);

    // Don't render if no git status or no meaningful changes (including submodules)
    if (!gitStatus || !hasMeaningfulLineChanges(gitStatus, submodules)) {
        return null;
    }

    // Aggregate line changes from main repo + submodules
    const { totalAdded, totalRemoved } = aggregateLineChanges(
        gitStatus,
        submodules,
    );
    const hasLineChanges = totalAdded > 0 || totalRemoved > 0;

    return (
        <View style={styles.container}>
            <Ionicons
                name="git-branch-outline"
                size={10}
                color={styles.fileCountText.color}
                style={{ marginRight: 2 }}
            />

            {/* Show line changes in compact format */}
            {hasLineChanges && (
                <View style={styles.lineChanges}>
                    {totalAdded > 0 && (
                        <Text style={styles.addedText}>+{totalAdded}</Text>
                    )}
                    {totalRemoved > 0 && (
                        <Text style={styles.removedText}>-{totalRemoved}</Text>
                    )}
                </View>
            )}
        </View>
    );
}
