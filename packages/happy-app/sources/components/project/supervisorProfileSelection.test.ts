import { describe, expect, it } from "vitest";
import {
    createSupervisorProfileSelectionState,
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
