import React from "react";
import { storage, type SessionListItem } from "@/sync/storage";
import {
    AIBackendProfile,
    getProfileEnvironmentVariables,
} from "@/sync/settings";
import type { Metadata, Session } from "@/sync/storageTypes";

// Optimized profile lookup utility
export const useProfileMap = (profiles: AIBackendProfile[]) => {
    return React.useMemo(
        () => new Map(profiles.map((p) => [p.id, p])),
        [profiles],
    );
};

// Environment variable transformation helper
// Returns ALL profile environment variables - daemon will use them as-is
export const transformProfileToEnvironmentVars = (
    profile: AIBackendProfile,
    agentType: "claude" | "codex" | "gemini" = "claude",
) => {
    // getProfileEnvironmentVariables already returns ALL env vars from profile
    // including custom environmentVariables array and provider-specific configs
    return getProfileEnvironmentVariables(profile);
};

// Helper function to get cached metadata from the most recent session for a machine + agentType
// Used to provide accurate model/mode lists when creating new sessions
export const getCachedMetadataForMachine = (
    allSessions: SessionListItem[] | null,
    machineId: string | null,
    agentType: string,
): Metadata | null => {
    if (!machineId || !allSessions) return null;

    const flavorMatches = (sessionFlavor: string | null | undefined): boolean => {
        if (agentType === "claude") {
            return !sessionFlavor || sessionFlavor === "claude";
        }
        return sessionFlavor === agentType;
    };

    let bestSession: Session | null = null;
    for (const item of allSessions) {
        if (typeof item === "string") continue;
        if (
            item.metadata?.machineId === machineId &&
            flavorMatches(item.metadata?.flavor) &&
            item.metadata?.models &&
            item.metadata.models.length > 0
        ) {
            if (!bestSession || item.updatedAt > bestSession.updatedAt) {
                bestSession = item;
            }
        }
    }

    return bestSession?.metadata ?? null;
};

// Helper function to get the most recent path for a machine
// Returns the path from the most recently CREATED session for this machine
// If the most recent session was a worktree, returns the parent repo path instead
export const getRecentPathForMachine = (
    machineId: string | null,
    recentPaths: Array<{ machineId: string; path: string }>,
): string => {
    if (!machineId) return "";

    const machine = storage.getState().machines[machineId];
    const defaultPath = machine?.metadata?.homeDir || "";

    // Get all sessions for this machine, sorted by creation time (most recent first)
    const sessions = Object.values(storage.getState().sessions);
    const pathsWithTimestamps: Array<{
        path: string;
        timestamp: number;
        parentRepoPath?: string;
    }> = [];

    sessions.forEach((session: any) => {
        if (session.metadata?.machineId === machineId && session.metadata?.path) {
            pathsWithTimestamps.push({
                path: session.metadata.path,
                timestamp: session.createdAt, // Use createdAt, not updatedAt
                parentRepoPath: session.metadata.worktree?.isWorktree
                    ? session.metadata.worktree.parentRepoPath
                    : undefined,
            });
        }
    });

    // Sort by creation time (most recently created first)
    pathsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

    const mostRecent = pathsWithTimestamps[0];
    if (!mostRecent) return defaultPath;

    // If the most recent session was a worktree, use the parent repo path
    // so new sessions default to the real project root, not the worktree directory
    return mostRecent.parentRepoPath || mostRecent.path;
};
