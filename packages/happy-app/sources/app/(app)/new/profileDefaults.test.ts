import { describe, expect, it } from "vitest";
import {
    resolveProfileDefaultModelMode,
    resolveProfileDefaultPermissionMode,
} from "./profileDefaults";

describe("profileDefaults", () => {
    it("resolves the profile default model mode only when that exact model exists", () => {
        const models = [
            { key: "default", name: "Default" },
            { key: "gpt-5.4-pro", name: "GPT-5.4 Pro" },
        ];

        expect(
            resolveProfileDefaultModelMode(
                { defaultModelMode: "gpt-5.4-pro" } as any,
                models,
            ),
        ).toEqual({ key: "gpt-5.4-pro", name: "GPT-5.4 Pro" });
        expect(
            resolveProfileDefaultModelMode(
                { defaultModelMode: "missing-model" } as any,
                models,
            ),
        ).toBeNull();
    });

    it("resolves the profile default permission mode only when that exact mode exists", () => {
        const modes = [
            { key: "default", name: "Default" },
            { key: "plan", name: "Plan" },
        ];

        expect(
            resolveProfileDefaultPermissionMode(
                { defaultPermissionMode: "plan" } as any,
                modes,
            ),
        ).toEqual({ key: "plan", name: "Plan" });
        expect(
            resolveProfileDefaultPermissionMode(
                { defaultPermissionMode: "missing-mode" } as any,
                modes,
            ),
        ).toBeNull();
    });
});
