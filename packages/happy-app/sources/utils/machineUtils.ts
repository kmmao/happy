import type { Machine } from '@/sync/storageTypes';

export function isMachineOnline(machine: Machine): boolean {
    return machine.active === true || machine.connected === true;
}

/** Minimal shape shared by machine RPC results that can carry an error. */
export interface MachineErrorResult {
    stderr?: string;
    error?: string;
}

/**
 * Turn a machine command/RPC result into a user-facing error string. Single
 * owner for the `stderr → error → "Unknown error"` fallback the settings screens
 * repeated inline. Pass `maxLength` to cap a noisy stderr (screens that surface
 * the error in a toast truncate to 100; dialogs pass no cap for the full text).
 */
export function extractMachineError(
    result: MachineErrorResult,
    opts?: { maxLength?: number },
): string {
    const stderr = result.stderr;
    const clipped =
        stderr && opts?.maxLength ? stderr.slice(0, opts.maxLength) : stderr;
    return clipped || result.error || 'Unknown error';
}
