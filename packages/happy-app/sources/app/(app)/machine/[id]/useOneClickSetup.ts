import * as React from "react";
import {
    machineCreateAgentLoop,
    machineListGitRepos,
    machineSuggestAgentLoops,
    type GitRepoEntry,
    type MachineAgentLoopBootstrapProfile,
    type MachineAgentLoopSuggestion,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { loadOneClickIgnoredRepos, saveOneClickIgnoredRepos } from "@/sync/persistence";
import { ensureMachineAutomationProfiles, type MachineAutomationOutcome } from "./machineAutomationQuickSetup";
import { commonDirectoryPrefix } from "./loopsUtils";

export type OneClickSetupPhase = "idle" | "scanning" | "suggesting" | "confirming" | "creating" | "done" | "error";

export interface OneClickSetupRepo {
    repo: GitRepoEntry;
    suggestions: MachineAgentLoopSuggestion[];
    selected: boolean;
}

export interface OneClickAutomationProfilesRef {
    bootstrap: MachineAgentLoopBootstrapProfile[];
    autoDream: MachineAutoDreamProfile[];
}

export interface OneClickSetupState {
    phase: OneClickSetupPhase;
    repos: OneClickSetupRepo[];
    totalSuggestions: number;
    creatableCount: number;
    createdCount: number;
    errorMessage: string | undefined;
    /** When true, after creating loops also ensure Auto-Dream profile for inferred root (not Bootstrap — one-click already scans repos). */
    includeAutomationProfiles: boolean;
    automationOutcome: MachineAutomationOutcome | "none";
}

export interface UseOneClickSetupReturn {
    state: OneClickSetupState;
    ignoredRepoPaths: readonly string[];
    start: () => void;
    startAdvanced: () => void;
    confirm: () => void;
    toggleRepo: (repoPath: string) => void;
    selectAll: (selected: boolean) => void;
    setIncludeAutomationProfiles: (value: boolean) => void;
    ignoreRepo: (repoPath: string) => void;
    unignoreRepo: (repoPath: string) => void;
    /** After creating a single loop from the confirm list, drop that suggestion (and empty repos). */
    removeSuggestionAfterAdopt: (repoPath: string, suggestionKey: string) => void;
    reset: () => void;
}

const INITIAL_STATE: OneClickSetupState = {
    phase: "idle",
    repos: [],
    totalSuggestions: 0,
    creatableCount: 0,
    createdCount: 0,
    errorMessage: undefined,
    includeAutomationProfiles: true,
    automationOutcome: "none",
};

export function useOneClickSetup(
    machineId: string | undefined,
    automationProfilesRef: React.MutableRefObject<OneClickAutomationProfilesRef>,
    onComplete: (() => void) | undefined,
    /** Same optional scope as manual / Bootstrap loop creation on this screen (trimmed when sent). */
    projectId: string,
    profileId: string,
): UseOneClickSetupReturn {
    const [state, setState] = React.useState<OneClickSetupState>(INITIAL_STATE);
    const [ignoredRepoPaths, setIgnoredRepoPaths] = React.useState<string[]>(() =>
        machineId ? [...loadOneClickIgnoredRepos(machineId)] : [],
    );
    const abortRef = React.useRef(false);
    const includeAutomationRef = React.useRef(false);

    React.useEffect(() => {
        if (machineId) {
            setIgnoredRepoPaths([...loadOneClickIgnoredRepos(machineId)]);
        } else {
            setIgnoredRepoPaths([]);
        }
    }, [machineId]);

    const reset = React.useCallback(() => {
        abortRef.current = true;
        includeAutomationRef.current = false;
        setState(INITIAL_STATE);
    }, []);

    const setIncludeAutomationProfiles = React.useCallback((value: boolean) => {
        includeAutomationRef.current = value;
        setState((prev) => ({ ...prev, includeAutomationProfiles: value }));
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

    const ignoreRepo = React.useCallback((repoPath: string) => {
        if (!machineId) return;
        setIgnoredRepoPaths((prev) => {
            if (prev.includes(repoPath)) return prev;
            const next = [...prev, repoPath];
            saveOneClickIgnoredRepos(machineId, next);
            return next;
        });
        setState((prev) => {
            if (prev.phase !== "confirming") return prev;
            const repos = prev.repos.filter((e) => e.repo.repoPath !== repoPath);
            const totalSuggestions = repos.reduce((sum, e) => sum + e.suggestions.length, 0);
            if (repos.length === 0) {
                return {
                    ...prev,
                    phase: "done",
                    repos: [],
                    totalSuggestions: 0,
                    creatableCount: 0,
                    createdCount: 0,
                    automationOutcome: "none",
                };
            }
            return { ...prev, repos, totalSuggestions, creatableCount: totalSuggestions };
        });
    }, [machineId]);

    const unignoreRepo = React.useCallback((repoPath: string) => {
        if (!machineId) return;
        setIgnoredRepoPaths((prev) => {
            const next = prev.filter((p) => p !== repoPath);
            saveOneClickIgnoredRepos(machineId, next);
            return next;
        });
    }, [machineId]);

    const removeSuggestionAfterAdopt = React.useCallback((repoPath: string, suggestionKey: string) => {
        setState((prev) => {
            if (prev.phase !== "confirming") {
                return prev;
            }
            const repos = prev.repos
                .map((entry) => {
                    if (entry.repo.repoPath !== repoPath) {
                        return entry;
                    }
                    const nextSuggestions = entry.suggestions.filter((s) => s.key !== suggestionKey);
                    return { ...entry, suggestions: nextSuggestions };
                })
                .filter((entry) => entry.suggestions.length > 0);
            const totalSuggestions = repos.reduce((sum, e) => sum + e.suggestions.length, 0);
            const nextCreated = prev.createdCount + 1;
            if (repos.length === 0) {
                return {
                    ...prev,
                    phase: "done",
                    repos: [],
                    totalSuggestions: 0,
                    creatableCount: 0,
                    createdCount: nextCreated,
                    automationOutcome: "none",
                };
            }
            return {
                ...prev,
                repos,
                totalSuggestions,
                creatableCount: totalSuggestions,
                createdCount: nextCreated,
            };
        });
    }, []);

    /** Scan repos and collect entries (shared by start and startAdvanced). */
    const scanAndCollect = React.useCallback(async (): Promise<OneClickSetupRepo[] | null> => {
        if (!machineId) return null;

        const ignored = new Set(loadOneClickIgnoredRepos(machineId));

        const allRepos = await machineListGitRepos(machineId);
        const visibleRepos = allRepos.filter((r) => !ignored.has(r.repoPath));
        const limitedRepos = visibleRepos.slice(0, 20);

        if (abortRef.current) return null;

        setState((prev) => ({ ...prev, phase: "suggesting" }));

        const entries: OneClickSetupRepo[] = [];
        for (const repo of limitedRepos) {
            if (abortRef.current) return null;
            const result = await machineSuggestAgentLoops(machineId, {
                directory: repo.repoPath,
                agent: "claude",
                projectId: projectId.trim() || undefined,
                profileId: profileId.trim() || undefined,
            });
            const creatableSuggestions = (result.suggestions ?? []).filter((s) => !s.alreadyConfigured);
            if (creatableSuggestions.length > 0) {
                entries.push({
                    repo,
                    suggestions: creatableSuggestions,
                    selected: true,
                });
            }
        }

        if (abortRef.current) return null;
        return entries;
    }, [machineId, profileId, projectId]);

    /** One-click mode: scan → confirming with all repos selected by default. */
    const start = React.useCallback(async () => {
        if (!machineId) return;
        abortRef.current = false;
        includeAutomationRef.current = true;

        setState({ ...INITIAL_STATE, phase: "scanning" });
        try {
            const entries = await scanAndCollect();
            if (!entries) return;

            const totalSuggestions = entries.reduce((sum, e) => sum + e.suggestions.length, 0);

            if (entries.length === 0) {
                setState({
                    phase: "done",
                    repos: [],
                    totalSuggestions: 0,
                    creatableCount: 0,
                    createdCount: 0,
                    errorMessage: undefined,
                    includeAutomationProfiles: true,
                    automationOutcome: "none",
                });
                return;
            }

            setState({
                phase: "confirming",
                repos: entries,
                totalSuggestions,
                creatableCount: totalSuggestions,
                createdCount: 0,
                errorMessage: undefined,
                includeAutomationProfiles: true,
                automationOutcome: "none",
            });
        } catch (error) {
            if (abortRef.current) return;
            setState((prev) => ({
                ...prev,
                phase: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [machineId, scanAndCollect]);

    /** Advanced mode: scan → show confirming step for manual selection. */
    const startAdvanced = React.useCallback(async () => {
        if (!machineId) return;
        abortRef.current = false;
        includeAutomationRef.current = false;

        setState({ ...INITIAL_STATE, phase: "scanning" });
        try {
            const entries = await scanAndCollect();
            if (!entries) return;

            const totalSuggestions = entries.reduce((sum, e) => sum + e.suggestions.length, 0);

            if (entries.length === 0) {
                setState({
                    phase: "done",
                    repos: [],
                    totalSuggestions: 0,
                    creatableCount: 0,
                    createdCount: 0,
                    errorMessage: undefined,
                    includeAutomationProfiles: false,
                    automationOutcome: "none",
                });
                return;
            }

            setState({
                phase: "confirming",
                repos: entries.map((e) => ({ ...e, selected: false })),
                totalSuggestions,
                creatableCount: totalSuggestions,
                createdCount: 0,
                errorMessage: undefined,
                includeAutomationProfiles: false,
                automationOutcome: "none",
            });
            includeAutomationRef.current = false;
        } catch (error) {
            if (abortRef.current) return;
            setState((prev) => ({
                ...prev,
                phase: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [machineId, scanAndCollect]);

    const confirm = React.useCallback(async () => {
        if (!machineId) return;
        abortRef.current = false;

        const selectedRepos = state.repos.filter((entry) => entry.selected);
        const allSuggestions = selectedRepos.flatMap((entry) => entry.suggestions);
        const wantAutomation = includeAutomationRef.current;

        if (allSuggestions.length === 0) {
            setState((prev) => ({ ...prev, phase: "done", createdCount: 0, automationOutcome: "none" }));
            return;
        }

        setState((prev) => ({ ...prev, phase: "creating", creatableCount: allSuggestions.length }));

        let created = 0;
        let automationOutcome: MachineAutomationOutcome | "none" = "none";
        try {
            for (const suggestion of allSuggestions) {
                if (abortRef.current) return;
                const result = await machineCreateAgentLoop(machineId, {
                    name: suggestion.name,
                    directory: suggestion.directory,
                    prompt: suggestion.prompt,
                    intervalMs: suggestion.intervalMs,
                    agent: suggestion.agent,
                    projectId: projectId.trim() || undefined,
                    profileId: profileId.trim() || undefined,
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

            if (wantAutomation && !abortRef.current) {
                const roots = selectedRepos.map((e) => e.repo.repoPath);
                const inferredRoot = commonDirectoryPrefix(roots);
                const snapshot = automationProfilesRef.current;
                const ensured = await ensureMachineAutomationProfiles(
                    machineId,
                    inferredRoot,
                    snapshot.bootstrap,
                    snapshot.autoDream,
                    { createBootstrap: false, createAutoDream: true },
                );
                automationOutcome = ensured.outcome;
            }

            setState((prev) => ({
                ...prev,
                phase: "done",
                automationOutcome,
            }));
            if (created > 0 || automationOutcome === "created") {
                setTimeout(() => onComplete?.(), 300);
            }
        } catch (error) {
            if (abortRef.current) return;
            setState((prev) => ({
                ...prev,
                phase: "error",
                createdCount: created,
                automationOutcome,
                errorMessage: error instanceof Error ? error.message : String(error),
            }));
            if (created > 0 || automationOutcome === "created") {
                setTimeout(() => onComplete?.(), 300);
            }
        }
    }, [automationProfilesRef, machineId, onComplete, profileId, projectId, state.repos]);

    return {
        state,
        ignoredRepoPaths,
        start: () => void start(),
        startAdvanced: () => void startAdvanced(),
        confirm: () => void confirm(),
        toggleRepo,
        selectAll,
        setIncludeAutomationProfiles,
        ignoreRepo,
        unignoreRepo,
        removeSuggestionAfterAdopt,
        reset,
    };
}
