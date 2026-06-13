import * as React from "react";
import { Platform, type Pressable } from "react-native";
import {
    buildPressScale,
    buildWebInteractive,
} from "./interactiveSurfaceBuilders";

/**
 * Web-only interaction primitives shared by Pressable-based surfaces.
 *
 * Goal: every clickable thing in the app speaks the same visual language on
 * web — pointer cursor, 120ms cross-fade between default/hover/pressed
 * states, optional scale-on-press — without each call site re-implementing
 * the same Platform.OS plumbing.
 *
 * Companion theme colors (use in your unistyles StyleSheet factory):
 *   - hovered  → theme.colors.surfaceHigh
 *   - pressed  → theme.colors.surfacePressed
 *
 * On native everything here is either `null` (style spreads no-op) or
 * returns `isHovered: false` with no `onHoverIn/Out` wired, so consumers can
 * use these unconditionally and stay platform-clean.
 *
 * The platform-branching logic lives in ./interactiveSurfaceBuilders so it
 * can be unit-tested under Node without importing the Flow-typed
 * `react-native` module.
 *
 * Full design guide (when to use which scale, hover-vs-selected priority,
 * disabled handling, reference implementations):
 *   docs/web-interactive-surfaces.md  (relative to the happy-app package)
 */

/** Spread into a Pressable's base style on any platform. */
export const webInteractive = buildWebInteractive(Platform.OS) as any;

/**
 * Press-scale intensities for web. Layer onto a Pressable's style array
 * alongside the pressed state:
 *
 *   style={({ pressed }) => [
 *     baseStyle,
 *     pressed && pressedColor,
 *     pressed && interactiveWebPressScale,    // chip-grade (-3%)
 *   ]}
 *
 * Pick based on element size:
 *   - 0.97 for small/dense surfaces (chips, icon buttons, tags)
 *   - 0.98 for larger surfaces (header rows, big buttons) — a -3% nudge on
 *     a wide block reads as jittery; -2% keeps it grounded.
 */
export const interactiveWebPressScale = buildPressScale(Platform.OS, 0.97);
export const interactiveWebPressScaleSubtle = buildPressScale(Platform.OS, 0.98);

/**
 * Tracks hover state for a single Pressable on web. Returns:
 *   - `isHovered`: always false on native; true on web while pointer is in.
 *   - `hoverProps`: spread onto a Pressable; empty on native.
 *
 * Mirrors the CommandPaletteItem hover pattern. Safe to use inside a
 * component that may early-return — the underlying React.useState runs on
 * every render regardless of the platform branch below it.
 */
export function useWebHoverProps(): {
    isHovered: boolean;
    hoverProps: Partial<React.ComponentProps<typeof Pressable>>;
} {
    const [isHovered, setIsHovered] = React.useState(false);
    if (Platform.OS !== "web") {
        return { isHovered: false, hoverProps: {} };
    }
    return {
        isHovered,
        hoverProps: {
            onHoverIn: () => setIsHovered(true),
            onHoverOut: () => setIsHovered(false),
        } as any,
    };
}
