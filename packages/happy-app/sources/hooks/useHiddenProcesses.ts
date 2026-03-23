/**
 * Hook for managing user-hidden processes per machine.
 *
 * Persists hidden process names to MMKV, scoped by machineId.
 * Provides filtering, hide/unhide, and a toggle to view hidden items.
 */

import * as React from "react";
import {
    loadHiddenProcesses,
    saveHiddenProcesses,
} from "@/sync/persistence";
import type { DetectedPort } from "@/hooks/portDetection";

export interface UseHiddenProcessesResult {
    /** Currently hidden process names */
    readonly hiddenNames: readonly string[];
    /** Whether the "show hidden" view is active */
    readonly showHidden: boolean;
    /** Toggle between active/hidden views */
    readonly toggleShowHidden: () => void;
    /** Add a process name to the hidden list */
    readonly hideProcess: (processName: string) => void;
    /** Remove a process name from the hidden list */
    readonly unhideProcess: (processName: string) => void;
    /** Check if a process name is hidden */
    readonly isHidden: (processName: string) => boolean;
    /** Filter processes based on current showHidden state */
    readonly filterProcesses: (
        processes: readonly DetectedPort[],
    ) => readonly DetectedPort[];
}

export function useHiddenProcesses(
    machineId: string | undefined,
): UseHiddenProcessesResult {
    const [hiddenNames, setHiddenNames] = React.useState<readonly string[]>(
        () => (machineId ? loadHiddenProcesses(machineId) : []),
    );
    const [showHidden, setShowHidden] = React.useState(false);

    // Keep a ref to machineId so callbacks always target the current machine
    const machineIdRef = React.useRef(machineId);
    React.useEffect(() => {
        machineIdRef.current = machineId;
    }, [machineId]);

    // Track whether the initial load has completed to avoid persisting on mount
    const initializedRef = React.useRef(false);

    // Reload when machineId changes
    React.useEffect(() => {
        if (machineId) {
            setHiddenNames(loadHiddenProcesses(machineId));
        } else {
            setHiddenNames([]);
        }
        setShowHidden(false);
        initializedRef.current = true;
    }, [machineId]);

    // Persist hiddenNames to MMKV whenever they change (after initial load)
    React.useEffect(() => {
        if (!initializedRef.current) return;
        const id = machineIdRef.current;
        if (id) saveHiddenProcesses(id, hiddenNames);
    }, [hiddenNames]);

    const hiddenSet = React.useMemo(
        () => new Set(hiddenNames),
        [hiddenNames],
    );

    const hideProcess = React.useCallback((processName: string) => {
        setHiddenNames((prev) => {
            if (prev.includes(processName)) return prev;
            return [...prev, processName];
        });
    }, []);

    const unhideProcess = React.useCallback((processName: string) => {
        setHiddenNames((prev) => {
            const next = prev.filter((n) => n !== processName);
            if (next.length === prev.length) return prev;
            return next;
        });
    }, []);

    const isHidden = React.useCallback(
        (processName: string) => hiddenSet.has(processName),
        [hiddenSet],
    );

    const toggleShowHidden = React.useCallback(() => {
        setShowHidden((prev) => !prev);
    }, []);

    const filterProcesses = React.useCallback(
        (processes: readonly DetectedPort[]): readonly DetectedPort[] => {
            if (showHidden) {
                return processes.filter((p) => hiddenSet.has(p.process));
            }
            return processes.filter((p) => !hiddenSet.has(p.process));
        },
        [showHidden, hiddenSet],
    );

    return React.useMemo(() => ({
        hiddenNames,
        showHidden,
        toggleShowHidden,
        hideProcess,
        unhideProcess,
        isHidden,
        filterProcesses,
    }), [hiddenNames, showHidden, toggleShowHidden, hideProcess, unhideProcess, isHidden, filterProcesses]);
}
