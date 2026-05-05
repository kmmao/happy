import type { Machine } from '@/sync/storageTypes';

export function isMachineOnline(machine: Machine): boolean {
    return machine.active === true || machine.connected === true;
}
