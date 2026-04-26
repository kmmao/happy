import * as React from "react";
import {
    machineCreateAgentLoop,
    machineSuggestAgentLoops,
    machineAISuggestAgentLoops,
    type GitRepoEntry,
    type MachineAgentLoop,
    type MachineAgentLoopSuggestion,
} from "@/sync/ops";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";

export interface RepoBootstrapEntry {
    readonly repo: GitRepoEntry;
    readonly suggestions: readonly MachineAgentLoopSuggestion[];
}

interface UseLoopSuggestionsParams {
    machineId: string | undefined;
    profileId: string;
    projectId: string;
    load: (kind: "initial" | "refresh") => Promise<void>;
    /** AiBackendProfile key to use for the AI-powered bootstrap scan. null = server env fallback. */
    aiProfileId?: string | null;
    /** Existing loops — bootstrap scan only checks directories already being monitored. */
    loops: readonly MachineAgentLoop[];
}

interface UseLoopSuggestionsResult {
    readonly suggestions: readonly MachineAgentLoopSuggestion[];
    readonly suggesting: boolean;
    readonly creatingSuggestionKey: string | null;
    readonly adoptingAllSuggestions: boolean;
    readonly bootstrapEntries: readonly RepoBootstrapEntry[];
    readonly bootstrapScanning: boolean;
    readonly bootstrappingRepoPath: string | null;

    readonly loadSuggestions: (targetDirectory: string) => Promise<void>;
    readonly adoptSuggestion: (suggestion: MachineAgentLoopSuggestion) => Promise<void>;
    readonly adoptAllSuggestions: () => Promise<void>;
    readonly scanBootstrapRepos: () => Promise<void>;
    readonly adoptRepoSuggestions: (entry: RepoBootstrapEntry, runNow: boolean) => Promise<void>;
}

export function useLoopSuggestions({
    machineId,
    profileId,
    projectId,
    load,
    aiProfileId,
    loops,
}: UseLoopSuggestionsParams): UseLoopSuggestionsResult {
    const [suggestions, setSuggestions] = React.useState<MachineAgentLoopSuggestion[]>([]);
    const [suggesting, setSuggesting] = React.useState(false);
    const [creatingSuggestionKey, setCreatingSuggestionKey] = React.useState<string | null>(null);
    const [adoptingAllSuggestions, setAdoptingAllSuggestions] = React.useState(false);
    const [bootstrapEntries, setBootstrapEntries] = React.useState<RepoBootstrapEntry[]>([]);
    const [bootstrapScanning, setBootstrapScanning] = React.useState(false);
    const [bootstrappingRepoPath, setBootstrappingRepoPath] = React.useState<string | null>(null);

    const fetchSuggestionsForDirectory = React.useCallback(
        async (targetDir: string): Promise<MachineAgentLoopSuggestion[]> => {
            if (!machineId) {
                return [];
            }
            const result = await machineSuggestAgentLoops(machineId, {
                directory: targetDir.trim(),
                agent: "claude",
                projectId: projectId.trim() || undefined,
                profileId: profileId.trim() || undefined,
            });
            return result.suggestions ?? [];
        },
        [machineId, profileId, projectId],
    );

    const loadSuggestions = React.useCallback(
        async (targetDirectory: string) => {
            if (!machineId) {
                return;
            }
            if (!targetDirectory.trim()) {
                Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
                return;
            }
            setSuggesting(true);
            try {
                const list = await fetchSuggestionsForDirectory(targetDirectory);
                setSuggestions(list);
            } catch (error) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            } finally {
                setSuggesting(false);
            }
        },
        [fetchSuggestionsForDirectory, machineId],
    );

    /** Refresh suggestion list from one or more repo paths (e.g. after adopt -- form `directory` may be empty). */
    const reloadSuggestionsAfterAdopts = React.useCallback(
        async (touched: readonly MachineAgentLoopSuggestion[]) => {
            if (!machineId) {
                return;
            }
            const dirs = [
                ...new Set(
                    touched
                        .map((s) => s.directory.replace(/\/+$/, "").trim())
                        .filter((d) => d.length > 0),
                ),
            ].sort();
            if (dirs.length === 0) {
                setSuggestions([]);
                return;
            }
            setSuggesting(true);
            try {
                if (dirs.length === 1) {
                    setSuggestions(await fetchSuggestionsForDirectory(dirs[0]!));
                    return;
                }
                const merged: MachineAgentLoopSuggestion[] = [];
                const seen = new Set<string>();
                for (const dir of dirs) {
                    const list = await fetchSuggestionsForDirectory(dir);
                    for (const s of list) {
                        if (!seen.has(s.key)) {
                            seen.add(s.key);
                            merged.push(s);
                        }
                    }
                }
                setSuggestions(merged);
            } catch (error) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            } finally {
                setSuggesting(false);
            }
        },
        [fetchSuggestionsForDirectory, machineId],
    );

    const createLoopFromSuggestion = React.useCallback(async (suggestion: MachineAgentLoopSuggestion) => {
        if (!machineId || suggestion.alreadyConfigured) {
            return { success: true } as const;
        }
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
        if (!result.success) {
            throw new Error(result.errorMessage || t("machine.agentLoopCreateFailed"));
        }
        return result;
    }, [machineId, profileId, projectId]);

    const adoptSuggestion = React.useCallback(async (suggestion: MachineAgentLoopSuggestion) => {
        if (!machineId || suggestion.alreadyConfigured) {
            return;
        }
        setCreatingSuggestionKey(suggestion.key);
        try {
            await createLoopFromSuggestion(suggestion);
            await load("refresh");
            await reloadSuggestionsAfterAdopts(suggestions.length > 0 ? suggestions : [suggestion]);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setCreatingSuggestionKey(null);
        }
    }, [createLoopFromSuggestion, load, machineId, reloadSuggestionsAfterAdopts, suggestions]);

    const adoptAllSuggestions = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        const pendingSuggestions = suggestions.filter((entry) => !entry.alreadyConfigured);
        if (pendingSuggestions.length === 0) {
            Modal.toast(t("machine.agentLoopSuggestionConfigured"));
            return;
        }
        setAdoptingAllSuggestions(true);
        try {
            for (const suggestion of pendingSuggestions) {
                await createLoopFromSuggestion(suggestion);
            }
            await load("refresh");
            await reloadSuggestionsAfterAdopts(pendingSuggestions);
            Modal.toast(t("machine.agentLoopSuggestionAdoptAllSummary", { count: pendingSuggestions.length }));
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setAdoptingAllSuggestions(false);
        }
    }, [createLoopFromSuggestion, load, machineId, reloadSuggestionsAfterAdopts, suggestions]);

    const scanBootstrapRepos = React.useCallback(async () => {
        if (!machineId) {
            return;
        }
        // Derive unique directories from existing loops — only check what's already monitored
        const dirs = [...new Set(
            loops
                .map((l) => l.directory.replace(/\/+$/, "").trim())
                .filter((d) => d.length > 0),
        )].sort();

        if (dirs.length === 0) {
            setBootstrapEntries([]);
            return;
        }

        setBootstrapScanning(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                Modal.alert(t("common.error"), t("errors.unknownError"));
                return;
            }
            // Sequential — each directory needs an RPC + server AI call
            const entries: RepoBootstrapEntry[] = [];
            for (const dir of dirs) {
                try {
                    const suggestions = await machineAISuggestAgentLoops(
                        machineId,
                        dir,
                        credentials.token,
                        aiProfileId ?? undefined,
                    );
                    if (suggestions.length > 0) {
                        const name = dir.split("/").filter(Boolean).at(-1) ?? dir;
                        // Construct a minimal GitRepoEntry — UI only needs repoPath + name
                        const repo: GitRepoEntry = { repoPath: dir, name, remoteUrl: "" };
                        entries.push({ repo, suggestions });
                    }
                } catch {
                    // One directory failing shouldn't abort the rest
                }
            }
            setBootstrapEntries(entries);
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setBootstrapScanning(false);
        }
    }, [machineId, loops, aiProfileId]);

    const adoptRepoSuggestions = React.useCallback(async (entry: RepoBootstrapEntry, runNow: boolean) => {
        if (!machineId) {
            return;
        }
        setBootstrappingRepoPath(entry.repo.repoPath);
        try {
            for (const suggestion of entry.suggestions) {
                if (suggestion.alreadyConfigured) {
                    continue;
                }
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
                    eventSourceAllowlist: suggestion.eventSourceAllowlist,
                    eventKeywordFilters: suggestion.eventKeywordFilters,
                    goal: suggestion.goal,
                    currentFocus: suggestion.currentFocus,
                    workingMemory: suggestion.workingMemory,
                    lastReflectionSummary: suggestion.lastReflectionSummary,
                    runNow,
                });
                if (!result.success) {
                    throw new Error(result.errorMessage || t("machine.agentLoopCreateFailed"));
                }
            }
            await load("refresh");
            await scanBootstrapRepos();
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setBootstrappingRepoPath(null);
        }
    }, [load, machineId, profileId, projectId, scanBootstrapRepos]);

    return {
        suggestions,
        suggesting,
        creatingSuggestionKey,
        adoptingAllSuggestions,
        bootstrapEntries,
        bootstrapScanning,
        bootstrappingRepoPath,
        loadSuggestions,
        adoptSuggestion,
        adoptAllSuggestions,
        scanBootstrapRepos,
        adoptRepoSuggestions,
    };
}
