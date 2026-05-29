import { describe, expect, it } from "vitest";
import {
    getReasoningSummaryLabels,
    getVisibleEffortLevels,
    shouldShowEffortSelector,
} from "./reasoningEffort";

const translate = (key: string) => key;

describe("reasoningEffort", () => {
    it("uses the current Codex model when the picker is on default", () => {
        const levels = getVisibleEffortLevels({
            isCodex: true,
            modelModeKey: "default",
            currentModelCode: "gpt-5.4",
            metadata: {
                currentModelCode: "gpt-5.4",
                models: [
                    {
                        code: "gpt-5.4",
                        value: "GPT-5.4",
                        supportedEffortLevels: ["low", "high", "xhigh"],
                    },
                ],
            } as any,
        });

        expect(levels).toEqual(["xhigh", "high", "low"]);
    });

    it("uses provider-specific fallback effort levels when metadata is absent", () => {
        expect(
            getVisibleEffortLevels({
                isCodex: true,
                modelModeKey: "default",
                currentModelCode: null,
                metadata: null,
            }),
        ).toEqual(["xhigh", "high", "medium", "low"]);

        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "default",
                currentModelCode: null,
                metadata: null,
            }),
        ).toEqual(["max", "high", "medium", "low"]);
    });

    it("forces xhigh into visible list for Opus 4.7 when SDK omits it", () => {
        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "opus-4-7",
                currentModelCode: null,
                metadata: null,
            }),
        ).toEqual(["max", "xhigh", "high", "medium", "low"]);

        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "default",
                currentModelCode: "claude-opus-4-7[1m]",
                metadata: {
                    currentModelCode: "claude-opus-4-7[1m]",
                    models: [
                        {
                            code: "claude-opus-4-7[1m]",
                            value: "Opus 4.7",
                            supportedEffortLevels: ["max", "high", "medium", "low"],
                        },
                    ],
                } as any,
            }),
        ).toEqual(["max", "xhigh", "high", "medium", "low"]);
    });

    it("forces xhigh into visible list for Opus 4.8 when SDK omits it", () => {
        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "opus-4-8",
                currentModelCode: null,
                metadata: null,
            }),
        ).toEqual(["max", "xhigh", "high", "medium", "low"]);

        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "default",
                currentModelCode: "claude-opus-4-8[1m]",
                metadata: {
                    currentModelCode: "claude-opus-4-8[1m]",
                    models: [
                        {
                            code: "claude-opus-4-8[1m]",
                            value: "Opus 4.8",
                            supportedEffortLevels: ["max", "high", "medium", "low"],
                        },
                    ],
                } as any,
            }),
        ).toEqual(["max", "xhigh", "high", "medium", "low"]);
    });

    it("does not force xhigh for non-Opus-4.7/4.8 Claude models", () => {
        expect(
            getVisibleEffortLevels({
                isCodex: false,
                modelModeKey: "sonnet",
                currentModelCode: null,
                metadata: null,
            }),
        ).toEqual(["max", "high", "medium", "low"]);
    });

    it("shows the effort selector for Codex when the active model supports it", () => {
        expect(
            shouldShowEffortSelector({
                isCodex: true,
                isGemini: false,
                hasEffortHandler: true,
                modelModeKey: "default",
                currentModelCode: "gpt-5.4",
                metadata: {
                    currentModelCode: "gpt-5.4",
                    models: [
                        {
                            code: "gpt-5.4",
                            value: "GPT-5.4",
                            supportsEffort: true,
                        },
                    ],
                } as any,
            }),
        ).toBe(true);
    });

    it("only shows an explicit Codex effort badge after the user picked one", () => {
        expect(
            getReasoningSummaryLabels({
                isCodex: true,
                isGemini: false,
                reasoning: {
                    effortLevel: "xhigh",
                    thinkingMode: "disabled",
                },
                translate,
            }),
        ).toEqual(["agentInput.effort.xhigh"]);

        expect(
            getReasoningSummaryLabels({
                isCodex: true,
                isGemini: false,
                reasoning: {
                    effortLevel: null,
                    thinkingMode: "disabled",
                },
                translate,
            }),
        ).toEqual([]);
    });
});
