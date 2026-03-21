import { Dimensions, Platform } from "react-native";
import { useWindowDimensions } from "react-native";
import { useMemo } from "react";
import {
  calculateDeviceDimensions,
  determineDeviceType,
  calculateHeaderHeight,
} from "./deviceCalculations";
import { isRunningOnMac } from "./platform";

// Re-export calculation functions for use in other components
export {
  calculateDeviceDimensions,
  determineDeviceType,
  calculateHeaderHeight,
};

// Get header height based on platform, device type, and orientation (wrapper for backward compatibility)
export function getHeaderHeight(
  isLandscape: boolean,
  deviceType: "phone" | "tablet",
): number {
  return calculateHeaderHeight({
    platform: Platform.OS,
    isLandscape,
    // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
    isPad: Platform.OS === "ios" ? Platform.isPad : undefined,
    deviceType: Platform.OS === "android" ? deviceType : undefined,
    isMacCatalyst: isRunningOnMac(),
  });
}

// Device type detection based on screen size and aspect ratio
export function getDeviceType(): "phone" | "tablet" {
  const { width, height } = Dimensions.get("screen");

  const dimensions = calculateDeviceDimensions({
    widthPoints: width,
    heightPoints: height,
    pointsPerInch: Platform.OS === "ios" ? 163 : 160,
  });

  return determineDeviceType({
    diagonalInches: dimensions.diagonalInches,
    platform: Platform.OS,
    // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
    isPad: Platform.OS === "ios" ? Platform.isPad : false,
    minWidthPoints: Platform.OS !== "ios" ? Math.min(width, height) : undefined,
  });
}

// Hook to get device type (reactive to dimension changes)
// Uses screen dimensions for foldable min-width check on native Android to prevent
// keyboard open/close from flipping tablet↔phone mode on foldables.
// Window dimensions shrink when keyboard opens (adjustResize mode),
// but a foldable inner screen doesn't stop being one when keyboard is open.
// On web, uses window dimensions instead — web has no keyboard resize issue,
// and screen dimensions don't change on browser resize / split-screen.
export function useDeviceType(): "phone" | "tablet" {
  const { width, height } = useWindowDimensions();
  const screenDimensions = Dimensions.get("screen");

  return useMemo(() => {
    // On web, use max(width, height) for height to prevent keyboard-shrunk
    // viewport from reducing diagonalInches below the tablet threshold.
    const stableHeight =
      Platform.OS === "web" ? Math.max(width, height) : height;
    const dimensions = calculateDeviceDimensions({
      widthPoints: width,
      heightPoints: stableHeight,
      pointsPerInch: Platform.OS === "ios" ? 163 : 160,
    });

    // On web, use the viewport WIDTH for the foldable min-width check.
    // Math.min(width, height) is wrong because virtual keyboards shrink height,
    // making min fall below the foldable threshold and flipping tablet→phone.
    // Width alone is stable — keyboards don't change viewport width.
    // On native Android, use screen dimensions to avoid keyboard-triggered flipping.
    const minWidthPoints =
      Platform.OS === "ios"
        ? undefined
        : Platform.OS === "web"
          ? width
          : Math.min(screenDimensions.width, screenDimensions.height);

    return determineDeviceType({
      diagonalInches: dimensions.diagonalInches,
      platform: Platform.OS,
      // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
      isPad: Platform.OS === "ios" ? Platform.isPad : false,
      minWidthPoints,
    });
  }, [width, height, screenDimensions.width, screenDimensions.height]);
}

// Hook to detect if device is tablet
export function useIsTablet(): boolean {
  const deviceType = useDeviceType();
  return deviceType === "tablet";
}

// Hook to detect landscape orientation
export function useIsLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}

// Hook to get header height based on platform, device type, and orientation
export function useHeaderHeight(): number {
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();

  return useMemo(() => {
    return calculateHeaderHeight({
      platform: Platform.OS,
      isLandscape,
      // @ts-ignore - isPad is not in the type definitions but exists at runtime on iOS
      isPad: Platform.OS === "ios" ? Platform.isPad : undefined,
      deviceType: Platform.OS === "android" ? deviceType : undefined,
      isMacCatalyst: isRunningOnMac(),
    });
  }, [isLandscape, deviceType]);
}
