import { storage } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';

/**
 * The id of the first online Machine in storage, or null if none is online.
 * Single owner for the "which Machine do I dispatch this settings action to"
 * question that the plugin / MCP / provision screens all ask. Uses the canonical
 * `isMachineOnline` predicate so the online rule cannot drift per-screen (the
 * former per-screen copies checked only `active`, missing `connected`).
 *
 * Kept out of the pure `machineUtils` module because it binds the storage
 * singleton — `machineUtils` stays import-light and unit-testable.
 */
export function findOnlineMachineId(): string | null {
    const machines = storage.getState().machines;
    const online = Object.values(machines).find((m) => isMachineOnline(m));
    return online?.id ?? null;
}
