/**
 * Pure builders for the web interactive surface fragments. Lives in a
 * standalone file so vitest can import them under Node without pulling in
 * the `react-native` entry point (whose Flow-typed source rolldown can't
 * parse). `interactiveSurface.ts` re-evaluates these once at import time
 * with the actual Platform.OS.
 */

/** Returns the web-only cursor + transition style fragment, or null on native. */
export function buildWebInteractive(
    platformOS: string,
): Record<string, unknown> | null {
    if (platformOS !== "web") return null;
    return {
        cursor: "pointer",
        transitionProperty: "background-color, transform",
        transitionDuration: "120ms",
        transitionTimingFunction: "ease-out",
    };
}

/** Returns a web-only `transform: scale(...)` style, or null on native. */
export function buildPressScale(
    platformOS: string,
    scale: number,
): { transform: [{ scale: number }] } | null {
    if (platformOS !== "web") return null;
    return { transform: [{ scale }] };
}
