import React from "react";
import { View, Text } from "react-native";
import { Octicons } from "@expo/vector-icons";
import {
    useSessionGitStatus,
    useSessionProjectGitStatus,
    useSessionProjectSubmodules,
} from "@/sync/storage";
import { aggregateLineChanges } from "@/utils/gitStatusUtils";
import { useUnistyles } from "react-native-unistyles";

// Custom hook to check if git status should be shown (always true if git repo exists)
export function useHasMeaningfulGitStatus(sessionId: string): boolean {
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;
    return gitStatus ? gitStatus.lastUpdatedAt > 0 : false;
}

interface GitStatusBadgeProps {
    sessionId: string;
}

export function GitStatusBadge({ sessionId }: GitStatusBadgeProps) {
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;
    const submodules = useSessionProjectSubmodules(sessionId);
    const { theme } = useUnistyles();

    // Always show if git repository exists, even without changes
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
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flex: 1,
                overflow: "hidden",
            }}
        >
            {/* Git icon - always shown */}
            <Octicons
                name="git-branch"
                size={16}
                color={theme.colors.button.secondary.tint}
            />

            {/* Line changes only */}
            {hasLineChanges && (
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 2,
                        flexShrink: 0,
                    }}
                >
                    {totalAdded > 0 && (
                        <Text
                            style={{
                                fontSize: 12,
                                color: theme.colors.gitAddedText,
                                fontWeight: "600",
                            }}
                            numberOfLines={1}
                        >
                            +{totalAdded}
                        </Text>
                    )}
                    {totalRemoved > 0 && (
                        <Text
                            style={{
                                fontSize: 12,
                                color: theme.colors.gitRemovedText,
                                fontWeight: "600",
                            }}
                            numberOfLines={1}
                        >
                            -{totalRemoved}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}
