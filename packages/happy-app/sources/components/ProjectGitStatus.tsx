import React from "react";
import { View, Text } from "react-native";
import { Octicons } from "@expo/vector-icons";
import {
    useSessionProjectGitStatus,
    useSessionProjectSubmodules,
} from "@/sync/storage";
import { aggregateLineChanges } from "@/utils/gitStatusUtils";
import { StyleSheet } from "react-native-unistyles";

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        maxWidth: 150,
    },
    branchContainer: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 1,
        minWidth: 0,
    },
    branchIcon: {
        marginRight: 4,
        flexShrink: 0,
    },
    branchText: {
        fontSize: 13,
        fontWeight: "500",
        color: theme.colors.groupped.sectionTitle,
        flexShrink: 1,
        minWidth: 0,
    },
    changesContainer: {
        flexDirection: "row",
        alignItems: "center",
        marginLeft: 6,
        flexShrink: 0,
    },
    filesText: {
        fontSize: 11,
        fontWeight: "500",
        color: theme.colors.textSecondary,
        marginRight: 4,
    },
    lineChanges: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    addedText: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.gitAddedText,
    },
    removedText: {
        fontSize: 11,
        fontWeight: "600",
        color: theme.colors.gitRemovedText,
    },
}));

interface ProjectGitStatusProps {
    /** Any session ID from the project (used to find the project git status) */
    sessionId: string;
}

export function ProjectGitStatus({ sessionId }: ProjectGitStatusProps) {
    const styles = stylesheet;
    const gitStatus = useSessionProjectGitStatus(sessionId);
    const submodules = useSessionProjectSubmodules(sessionId);

    // Don't render if no git status (not a git repository)
    if (!gitStatus || gitStatus.lastUpdatedAt === 0) {
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
            {/* Show line changes only */}
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
