import { describe, expect, it } from "vitest";
import {
    createSupervisorProfileSelectionState,
    getMissingSupervisorProfileName,
    getSupervisorAvailableProfiles,
    getSupervisorDefaultProfileId,
    selectSupervisorProfile,
    syncSupervisorProfileSelectionState,
} from "./supervisorProfileSelection";

describe("getSupervisorDefaultProfileId", () => {
    it("returns defaultProfileId from supervisor config json", () => {
        expect(getSupervisorDefaultProfileId(JSON.stringify({ defaultProfileId: "openai" }))).toBe("openai");
    });

    it("returns null when supervisor config is invalid", () => {
        expect(getSupervisorDefaultProfileId("{invalid json")).toBeNull();
    });

    it("returns null when supervisor config does not contain defaultProfileId", () => {
        expect(getSupervisorDefaultProfileId(JSON.stringify({ mode: "suggest" }))).toBeNull();
    });
});

describe("syncSupervisorProfileSelectionState", () => {
    it("tracks refreshed default profile when user has not overridden selection", () => {
        const initialState = createSupervisorProfileSelectionState("anthropic");

        expect(syncSupervisorProfileSelectionState(initialState, "openai")).toEqual({
            selectedProfileId: "openai",
            syncedDefaultProfileId: "openai",
        });
    });

    it("preserves manual selection when refreshed default profile changes", () => {
        const initialState = createSupervisorProfileSelectionState("anthropic");
        const userSelectedState = selectSupervisorProfile(initialState, "deepseek");

        expect(syncSupervisorProfileSelectionState(userSelectedState, "openai")).toEqual({
            selectedProfileId: "deepseek",
            syncedDefaultProfileId: "openai",
        });
    });

    it("resets back to refreshed default after user selects default option", () => {
        const initialState = createSupervisorProfileSelectionState("anthropic");
        const userSelectedState = selectSupervisorProfile(initialState, null);

        expect(syncSupervisorProfileSelectionState(userSelectedState, "openai")).toEqual({
            selectedProfileId: "openai",
            syncedDefaultProfileId: "openai",
        });
    });
});

describe("getMissingSupervisorProfileName", () => {
    const availableProfiles = [
        { id: "anthropic", name: "Anthropic (Default)" },
        { id: "gpt2claude", name: "gpt2claude" },
    ] as const;

    it("returns null when no profile is selected", () => {
        expect(getMissingSupervisorProfileName(null, availableProfiles)).toBeNull();
    });

    it("returns null for built-in profiles that are still available", () => {
        expect(getMissingSupervisorProfileName("anthropic", availableProfiles)).toBeNull();
    });

    it("returns null for custom profiles that still exist", () => {
        expect(getMissingSupervisorProfileName("gpt2claude", availableProfiles)).toBeNull();
    });

    it("returns the profile id when the selected profile is missing", () => {
        expect(getMissingSupervisorProfileName("missing-profile", availableProfiles)).toBe("missing-profile");
    });
});

describe("getSupervisorAvailableProfiles", () => {
    it("deduplicates built-in profiles when local overrides share the same id", () => {
        expect(getSupervisorAvailableProfiles(
            [
                { id: "anthropic", name: "Anthropic (Default)", isBuiltIn: true },
                { id: "minimax", name: "MiniMax (M2.7)", isBuiltIn: true },
                { id: "kimi", name: "Kimi (K2.5)", isBuiltIn: true },
            ],
            [
                { id: "minimax", name: "MiniMax (M2.7)" },
                { id: "kimi", name: "Kimi (K2.5)" },
                { id: "gpt2claude", name: "gpt2claude" },
            ],
        )).toEqual([
            { id: "anthropic", name: "Anthropic (Default)", isBuiltIn: true },
            { id: "minimax", name: "MiniMax (M2.7)", isBuiltIn: true },
            { id: "kimi", name: "Kimi (K2.5)", isBuiltIn: true },
            { id: "gpt2claude", name: "gpt2claude", isBuiltIn: false },
        ]);
    });

    it("prefers override names for built-in profile ids while keeping built-in ordering", () => {
        expect(getSupervisorAvailableProfiles(
            [
                { id: "openai", name: "OpenAI (GPT-5.4)", isBuiltIn: true },
                { id: "minimax", name: "MiniMax (M2.7)", isBuiltIn: true },
            ],
            [
                { id: "minimax", name: "MiniMax Team Override" },
                { id: "custom-profile", name: "Custom Profile" },
            ],
        )).toEqual([
            { id: "openai", name: "OpenAI (GPT-5.4)", isBuiltIn: true },
            { id: "minimax", name: "MiniMax Team Override", isBuiltIn: true },
            { id: "custom-profile", name: "Custom Profile", isBuiltIn: false },
        ]);
    });
});
