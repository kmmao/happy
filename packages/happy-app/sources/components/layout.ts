import { Dimensions, Platform, useWindowDimensions } from 'react-native';
import { useMemo } from 'react';
import { getDeviceType, useDeviceType } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';

function isDesktopWeb(): boolean {
    return Platform.OS === 'web' && typeof window !== 'undefined' &&
        (window as any).__TAURI_INTERNALS__ !== undefined;
}

function computeMaxWidth(deviceType: 'phone' | 'tablet', width: number, height: number): number {
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        return Math.max(width, height);
    }
    if (isRunningOnMac() || isDesktopWeb() || Platform.OS === 'web') {
        return Number.POSITIVE_INFINITY;
    }
    return 800;
}

function computeMaxLayoutWidth(deviceType: 'phone' | 'tablet', width: number, height: number): number {
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        return Math.max(width, height);
    }
    if (isRunningOnMac() || isDesktopWeb() || Platform.OS === 'web') {
        return 1000;
    }
    return 800;
}

export function useLayout() {
    const deviceType = useDeviceType();
    const { width, height } = useWindowDimensions();

    return useMemo(() => ({
        maxWidth: computeMaxLayoutWidth(deviceType, width, height),
        headerMaxWidth: computeMaxWidth(deviceType, width, height),
    }), [deviceType, width, height]);
}

function deviceTypeFromScreenDims(w: number, h: number): 'phone' | 'tablet' {
    if (Platform.OS === 'ios') {
        // @ts-ignore - isPad is not in the type definitions but exists at runtime
        if ((Platform as any).isPad) {
            const diag = Math.sqrt((w / 163) ** 2 + (h / 163) ** 2);
            return diag > 9 ? 'tablet' : 'phone';
        }
        return 'phone';
    }
    return Math.min(w, h) >= 500 ? 'tablet' : 'phone';
}

// For use inside Unistyles StyleSheet.create factories with runtime parameter.
// These react to foldable screen switches via rt.screen dimension changes.
export function screenLayoutMaxWidth(screenWidth: number, screenHeight: number): number {
    return computeMaxLayoutWidth(deviceTypeFromScreenDims(screenWidth, screenHeight), screenWidth, screenHeight);
}

export function screenHeaderMaxWidth(screenWidth: number, screenHeight: number): number {
    return computeMaxWidth(deviceTypeFromScreenDims(screenWidth, screenHeight), screenWidth, screenHeight);
}

// Static fallback for non-component contexts (e.g. StyleSheet.create outside React tree).
// Does NOT update on foldable screen switches — use useLayout() in components instead.
const _staticDeviceType = getDeviceType();
const _staticDims = Dimensions.get('window');

export const layout = {
    maxWidth: computeMaxLayoutWidth(_staticDeviceType, _staticDims.width, _staticDims.height),
    headerMaxWidth: computeMaxWidth(_staticDeviceType, _staticDims.width, _staticDims.height),
}
