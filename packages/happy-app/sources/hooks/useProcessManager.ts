/**
 * Hook for managing background processes on a machine.
 *
 * Uses machineBash (machine-level RPC, no session required) to detect
 * listening ports and their processes, and machineKillProcess to terminate them.
 * Automatically refreshes every 15 seconds.
 */

import * as React from "react";
import { machineBash, machineKillProcess } from "@/sync/ops";
import { detectAllPorts, type DetectedPort, type BashFn } from "@/hooks/portDetection";

export interface UseProcessManagerResult {
    /** Currently detected processes */
    readonly processes: readonly DetectedPort[];
    /** Whether a scan is in progress */
    readonly isScanning: boolean;
    /** Trigger a manual scan */
    readonly scan: () => void;
    /** Kill a single process by PID */
    readonly killProcess: (pid: number) => Promise<boolean>;
    /** Kill all detected processes */
    readonly killAll: () => Promise<number>;
}

/** Auto-refresh interval in milliseconds */
const REFRESH_INTERVAL_MS = 15000;

export function useProcessManager(machineId: string | undefined): UseProcessManagerResult {
    const [processes, setProcesses] = React.useState<readonly DetectedPort[]>([]);
    const [isScanning, setIsScanning] = React.useState(false);
    const scanningRef = React.useRef(false);

    // Create a machine-level bash executor (no session binding)
    const bashRef = React.useRef<BashFn | null>(null);
    React.useEffect(() => {
        if (!machineId) {
            bashRef.current = null;
            return;
        }
        bashRef.current = (req) => machineBash(machineId, req.command, "/");
    }, [machineId]);

    const scan = React.useCallback(async (silent = false) => {
        if (!machineId || !bashRef.current || scanningRef.current) return;
        scanningRef.current = true;
        if (!silent) setIsScanning(true);

        try {
            const result = await detectAllPorts(bashRef.current, {
                filterByCwd: false,
            });
            setProcesses(result);
        } finally {
            scanningRef.current = false;
            if (!silent) setIsScanning(false);
        }
    }, [machineId]);

    // Initial scan on mount
    React.useEffect(() => {
        if (machineId) scan();
    }, [machineId, scan]);

    // Auto-refresh
    React.useEffect(() => {
        if (!machineId) return;
        const interval = setInterval(() => scan(true), REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [machineId, scan]);

    const killProcess = React.useCallback(async (pid: number): Promise<boolean> => {
        if (!machineId) return false;
        const result = await machineKillProcess(machineId, pid);
        if (result.success) {
            // Remove from local state immediately, next scan will confirm
            setProcesses((prev) => prev.filter((p) => p.pid !== pid));
        }
        return result.success;
    }, [machineId]);

    const killAll = React.useCallback(async (): Promise<number> => {
        if (!machineId) return 0;
        const pids = processes
            .filter((p) => p.pid && p.pid > 1)
            .map((p) => p.pid!);

        let killed = 0;
        for (const pid of pids) {
            const result = await machineKillProcess(machineId, pid);
            if (result.success) killed++;
        }
        // Refresh after kill
        await scan(true);
        return killed;
    }, [machineId, processes, scan]);

    return {
        processes,
        isScanning,
        scan: () => scan(),
        killProcess,
        killAll,
    };
}
