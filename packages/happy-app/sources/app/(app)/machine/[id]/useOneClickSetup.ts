import * as React from "react";
import {
    machineCreateAgentLoop,
    machineCreateAgentLoopBootstrapProfile,
    machineCreateAutoDreamProfile,
    machineListGitRepos,
    machineSuggestAgentLoops,
    type GitRepoEntry,
    type MachineAgentLoopSuggestion,
} from "@/sync/ops";

function findCommonParentDir(paths: string[]): string {
    if (paths.length === 0) return "/";
    if (paths.length === 1) {
        const parts = paths[0].split("/");
        return parts.slice(0, -1).join("/") || "/";
    }
    const segments = paths.map((p) => p.split("/"));
    const common: string[] = [];
    for (let i = 0; i < segments[0].length; i++) {
        const seg = segments[0][i];
        if (segments.every((s) => s[i] === seg)) {
            common.push(seg);
        } else {
            break;
        }
    }
    return common.join("/") || "/";
}

export type OneClickSetupPhase = "idle" | "scanning" | "suggesting" | "confirming" | "creating" | "done" | "error";

export interface OneClickSetupRepo {
    repo: GitRepoEntry;
    suggestions: MachineAgentLoopSuggestion[];
    selected: boolean;
}

export interface OneClickSetupState {
    phase: OneClickSetupPhase;
    repos: OneClickSetupRepo[];
    totalSuggestions: number;
    creatableCount: number;
    createdCount: number;
    errorMessage: string | undefined;
}

export interface UseOneClickSetupReturn {
    state: OneClickSetupState;
    start: () => void;
    confirm: () => void;
    toggleRepo: (repoPath: string) => void;
    selectAll: (selected: boolean) => void;
    reset: () => void;
}

const INITIAL_STATE: OneClickSetupState = {
    phase: "idle",
    repos: [],
    totalSuggestions: 0,
    creatableCount: 0,
    createdCount: 0,
    errorMessage: undefined,
};

export function useOneClickSetup(machineId: string | undefined, onComplete?: () => void): UseOneClickSetupReturn {
    const [state, setState] = React.useState<OneClickSetupState>(INITIAL_STATE);
    const abortRef = React.useRef(false);

    const reset = React.useCallback(() => {
        abortRef.current = true;
        setState(INITIAL_STATE);
    }, []);

    const toggleRepo = React.useCallback((repoPath: string) => {
        setState((prev) => ({
            ...prev,
            repos: prev.repos.map((entry) =>
                entry.repo.repoPath === repoPath
                    ? { ...entry, selected: !entry.selected }
                    : entry,
            ),
        }));
    }, []);

    const selectAll = React.useCallback((selected: boolean) => {
        setState((prev) => ({
            ...prev,
            repos: prev.repos.map((entry) => ({ ...entry, selected })),
        }));
    }, []);

    const start = React.useCallback(async () => {
        if (!machineId) return;
        abortRef.current = false;

        // Phase 1: Scan repos
        setState({ ...INITIAL_STATE, phase: "scanning" });
        try {
            const allRepos = await machineListGitRepos(machineId);
            const limitedRepos = allRepos.slice(0, 20);

            if (abortRef.current) return;

            // Phase 2: Get suggestions for each repo
            setState((prev) => ({ ...prev, phase: "suggesting" }));

            const entries: OneClickSetupRepo[] = [];
            for (const repo of limitedRepos) {
                if (abortRef.current) return;
                const result = await machineSuggestAgentLoops(machineId, {
                    directory: repo.repoPath,
                    agent: "claude",
                });
                const creatableSuggestions = (result.suggestions ?? []).filter((s) => !s.alreadyConfigured);
                if (creatableSuggestions.length > 0) {
                    entries.push({
                        repo,
                        suggestions: creatableSuggestions,
                        selected: false,
                    });
                }
            }

            if (abortRef.current) return;

            const totalSuggestions = entries.reduce((sum, e) => sum + e.suggestions.length, 0);

            if (entries.length === 0) {
                setState({
                    phase: "done",
                    repos: [],
                    totalSuggestions: 0,
                    creatableCount: 0,
                    createdCount: 0,
                    errorMessage: undefined,
                });
                return;
            }

            // Phase 3: Show confirmation
            setState({
                phase: "confirming",
                repos: entries,
                totalSuggestions,
                creatableCount: totalSuggestions,
                createdCount: 0,
                errorMessage: undefined,
            });
        } catch (error) {
            if (abortRef.current) return;
            setState((prev) => ({
                ...prev,
                phase: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [machineId]);

    const confirm = React.useCallback(async () => {
        if (!machineId) return;
        abortRef.current = false;

        const selectedRepos = state.repos.filter((entry) => entry.selected);
        const allSuggestions = selectedRepos.flatMap((entry) => entry.suggestions);

        if (allSuggestions.length === 0) {
            setState((prev) => ({ ...prev, phase: "done", createdCount: 0 }));
            return;
        }

        setState((prev) => ({ ...prev, phase: "creating", creatableCount: allSuggestions.length }));

        let created = 0;
        try {
            for (const suggestion of allSuggestions) {
                if (abortRef.current) return;
                const result = await machineCreateAgentLoop(machineId, {
                    name: suggestion.name,
                    directory: suggestion.directory,
                    prompt: suggestion.prompt,
                    intervalMs: suggestion.intervalMs,
                    agent: suggestion.agent,
                    fileWatchEnabled: suggestion.fileWatchEnabled,
                    githubBridgeEnabled: suggestion.githubBridgeEnabled,
                    ciBridgeEnabled: suggestion.ciBridgeEnabled,
                    maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
                    retryBackoffMs: suggestion.retryBackoffMs,
                    cooldownMs: suggestion.cooldownMs,
                    quietHoursStart: suggestion.quietHoursStart,
                    quietHoursEnd: suggestion.quietHoursEnd,
                    maxAutoRunsPerDay: suggestion.maxAutoRunsPerDay,
                    eventSourceAllowlist: suggestion.eventSourceAllowlist,
                    eventKeywordFilters: suggestion.eventKeywordFilters,
                    goal: suggestion.goal,
                    currentFocus: suggestion.currentFocus,
                    workingMemory: suggestion.workingMemory,
                    lastReflectionSummary: suggestion.lastReflectionSummary,
                    runNow: false,
                });
                if (result.success) {
                    created++;
                    setState((prev) => ({ ...prev, createdCount: created }));
                }
            }

            // Create Bootstrap profile + Auto-Dream profile for the root scan directory
            if (created > 0 && selectedRepos.length > 0) {
                const rootDir = findCommonParentDir(selectedRepos.map((r) => r.repo.repoPath));
                await Promise.allSettled([
                    machineCreateAgentLoopBootstrapProfile(machineId, {
                        name: "Auto Bootstrap",
                        rootDirectory: rootDir,
                        intervalMs: 6 * 3_600_000,
                        agent: "claude",
                        autoRunCreatedLoops: false,
                        runNow: false,
                    }),
                    machineCreateAutoDreamProfile(machineId, {
                        name: "Auto Dream",
                        rootDirectory: rootDir,
                        intervalMs: 12 * 3_600_000,
                        runNow: false,
                    }),
                ]);
            }

            setState((prev) => ({ ...prev, phase: "done" }));
            if (created > 0) {
                setTimeout(() => onComplete?.(), 300);
            }
        } catch (error) {
            if (abortRef.current) return;
            setState((prev) => ({
                ...prev,
                phase: "error",
                createdCount: created,
                errorMessage: error instanceof Error ? error.message : String(error),
            }));
            if (created > 0) {
                setTimeout(() => onComplete?.(), 300);
            }
        }
    }, [machineId, onComplete, state.repos]);

    return {
        state,
        start: () => void start(),
        confirm: () => void confirm(),
        toggleRepo,
        selectAll,
        reset,
    };
}
