import { describe, expect, it } from "vitest";
import {
    buildPressScale,
    buildWebInteractive,
} from "./interactiveSurfaceBuilders";

// These tests exercise the pure builders only. Live in their own file so
// neither the builders nor the tests touch `react-native` — that module
// uses Flow syntax that rolldown (the vitest transformer) can't parse.
// The module-level constants in `interactiveSurface.ts`
// (webInteractive / interactiveWebPressScale / interactiveWebPressScaleSubtle)
// are thin one-liners over these builders, so covering the builders
// covers every platform branch.
//
// useWebHoverProps is intentionally not covered here: testing it requires
// either renderHook (no renderer is set up) or mocking React.useState,
// which would pollute other suites' module caches. It's a ~10-line wrapper
// over React.useState + Platform.OS, and every branch is exercised
// indirectly by the consuming components (chip / GridCard / SessionItem).

describe("buildWebInteractive", () => {
    it("web 上返回 cursor + 双属性 transition", () => {
        expect(buildWebInteractive("web")).toEqual({
            cursor: "pointer",
            transitionProperty: "background-color, transform",
            transitionDuration: "120ms",
            transitionTimingFunction: "ease-out",
        });
    });

    it("ios 上返回 null", () => {
        expect(buildWebInteractive("ios")).toBeNull();
    });

    it("android 上返回 null", () => {
        expect(buildWebInteractive("android")).toBeNull();
    });

    it("任何非 web 字符串都走 native 分支", () => {
        expect(buildWebInteractive("macos")).toBeNull();
        expect(buildWebInteractive("windows")).toBeNull();
        expect(buildWebInteractive("")).toBeNull();
    });
});

describe("buildPressScale", () => {
    it("web 上返回 transform: scale(N)", () => {
        expect(buildPressScale("web", 0.97)).toEqual({
            transform: [{ scale: 0.97 }],
        });
        expect(buildPressScale("web", 0.98)).toEqual({
            transform: [{ scale: 0.98 }],
        });
    });

    it("native 上无论 scale 多少都返回 null", () => {
        expect(buildPressScale("ios", 0.97)).toBeNull();
        expect(buildPressScale("android", 0.98)).toBeNull();
        expect(buildPressScale("macos", 0.5)).toBeNull();
    });

    it("接受任意 scale 数值（不预设值域）", () => {
        // Builder doesn't validate scale — callers (chip / header / card)
        // own the design tokens. This guards against accidental coupling.
        expect(buildPressScale("web", 1.05)).toEqual({
            transform: [{ scale: 1.05 }],
        });
        expect(buildPressScale("web", 0)).toEqual({
            transform: [{ scale: 0 }],
        });
    });
});
