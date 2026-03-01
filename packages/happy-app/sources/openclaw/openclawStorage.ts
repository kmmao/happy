import { MMKV } from 'react-native-mmkv';
import type { OpenClawGatewayConfig } from './openclawTypes';

const STORAGE_KEY = 'openclaw-gateway-config';
const mmkv = new MMKV();

/**
 * Load saved gateway configuration from storage
 */
export function loadOpenClawConfig(): OpenClawGatewayConfig | null {
    const raw = mmkv.getString(STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as OpenClawGatewayConfig;
    } catch {
        return null;
    }
}

/**
 * Save gateway configuration to storage
 */
export function saveOpenClawConfig(config: OpenClawGatewayConfig): void {
    mmkv.set(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Clear gateway configuration from storage
 */
export function clearOpenClawConfig(): void {
    mmkv.delete(STORAGE_KEY);
}

/**
 * Check if a gateway config is saved
 */
export function hasOpenClawConfig(): boolean {
    return mmkv.contains(STORAGE_KEY);
}
