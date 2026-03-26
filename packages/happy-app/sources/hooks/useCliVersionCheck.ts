import { useState, useEffect, useCallback, useRef } from "react";
import { compareVersions } from "@/utils/versionUtils";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/@kmmao/happy-coder/latest";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes cache
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

interface CliVersionCheckResult {
    readonly latestVersion: string | null;
    readonly hasUpdate: boolean;
    readonly isChecking: boolean;
    readonly recheck: () => void;
}

/**
 * Check npm registry for the latest @kmmao/happy-coder version
 * and compare with the current daemon CLI version.
 * Caches result for 5 minutes to avoid excessive requests.
 */
export function useCliVersionCheck(currentVersion: string | undefined): CliVersionCheckResult {
    const [latestVersion, setLatestVersion] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const lastCheckRef = useRef<number>(0);
    const abortRef = useRef<AbortController | null>(null);

    const fetchLatestVersion = useCallback(async (force = false) => {
        if (!currentVersion) return;

        const now = Date.now();
        if (!force && now - lastCheckRef.current < CHECK_INTERVAL_MS) return;

        // Abort any in-flight request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setIsChecking(true);
        try {
            const response = await fetch(NPM_REGISTRY_URL, {
                signal: controller.signal,
                headers: { Accept: "application/json" },
            });
            if (!response.ok) return;

            const data = await response.json();
            if (data.version && typeof data.version === "string" && VERSION_RE.test(data.version)) {
                setLatestVersion(data.version);
                lastCheckRef.current = Date.now();
            }
        } catch {
            // Silently ignore — network issues, aborts, etc.
        } finally {
            if (!controller.signal.aborted) {
                setIsChecking(false);
            }
        }
    }, [currentVersion]);

    useEffect(() => {
        // Reset cached version when currentVersion changes (e.g. daemon restarted)
        setLatestVersion(null);
        lastCheckRef.current = 0;
        fetchLatestVersion();
        return () => {
            abortRef.current?.abort();
        };
    }, [fetchLatestVersion]);

    const recheck = useCallback(() => {
        fetchLatestVersion(true);
    }, [fetchLatestVersion]);

    // Use semver comparison: only show update if latest > current
    const hasUpdate = !!(
        currentVersion &&
        latestVersion &&
        compareVersions(latestVersion, currentVersion) > 0
    );

    return { latestVersion, hasUpdate, isChecking, recheck };
}
