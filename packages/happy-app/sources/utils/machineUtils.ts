import type { Machine } from '@/sync/storageTypes';

export function isMachineOnline(machine: Machine): boolean {
    // Use the active flag directly, no timeout checks
    return machine.active;
}

export type MachineConnectionState = 'online' | 'connecting' | 'offline';

/**
 * Three-state connection status:
 * - 'online': socket connected AND RPC methods registered (fully operational)
 * - 'connecting': socket connected but RPC not yet ready (transient after server restart)
 * - 'offline': socket disconnected
 */
export function getMachineConnectionState(machine: Machine): MachineConnectionState {
    if (!machine.active) return 'offline';
    return machine.rpcReady ? 'online' : 'connecting';
}