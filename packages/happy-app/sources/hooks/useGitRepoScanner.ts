import { useState, useCallback, useMemo } from "react";
import { machineListGitRepos } from "@/sync/ops";
import type { GitRepoEntry } from "@/sync/ops";
import { t } from "@/text";

export type { GitRepoEntry };

interface UseGitRepoScannerResult {
    readonly scanning: boolean;
    readonly scanResults: readonly GitRepoEntry[];
    readonly scanError: string | null;
    readonly showResults: boolean;
    readonly searchQuery: string;
    readonly setSearchQuery: (q: string) => void;
    readonly filteredResults: readonly GitRepoEntry[];
    readonly handleScan: () => Promise<void>;
    readonly reset: () => void;
}

/**
 * Shared hook for scanning git repositories on a machine.
 * Used by both RepoScanner (webhook settings) and path picker (new session).
 */
export function useGitRepoScanner(
    machineId: string | undefined,
): UseGitRepoScannerResult {
    const [scanning, setScanning] = useState(false);
    const [scanResults, setScanResults] = useState<readonly GitRepoEntry[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const handleScan = useCallback(async () => {
        if (!machineId || scanning) return;
        setScanning(true);
        setScanError(null);
        setScanResults([]);
        setSearchQuery("");
        setShowResults(true);
        try {
            const repos = await machineListGitRepos(machineId);
            setScanResults(repos);
            if (repos.length === 0) {
                setScanError(t("gitHosts.scanEmpty"));
            }
        } catch {
            setScanError(t("gitHosts.scanError"));
        } finally {
            setScanning(false);
        }
    }, [machineId, scanning]);

    const filteredResults = useMemo(() => {
        if (!showResults) return [];
        if (!searchQuery) return scanResults;
        const q = searchQuery.toLowerCase();
        return scanResults.filter(
            (entry) =>
                entry.name.toLowerCase().includes(q) ||
                entry.repoPath.toLowerCase().includes(q) ||
                entry.remoteUrl.toLowerCase().includes(q),
        );
    }, [showResults, searchQuery, scanResults]);

    const reset = useCallback(() => {
        setShowResults(false);
        setScanResults([]);
        setScanError(null);
        setSearchQuery("");
    }, []);

    return {
        scanning,
        scanResults,
        scanError,
        showResults,
        searchQuery,
        setSearchQuery,
        filteredResults,
        handleScan,
        reset,
    };
}
