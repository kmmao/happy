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
            modelModeKey: "default",
            currentModelCode: "gpt-5.4",
            metadata: {
                currentModelCode: "gpt-5.4",
                models: [
                    {
                        code: "gpt-5.4",
                        value: "GPT-5.4",
                        supportedEffortLevels: ["low", "high"],
                    },
                ],
            } as any,
        });

        expect(levels).toEqual(["high", "low"]);
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
                    effortLevel: "high",
                    thinkingMode: "disabled",
                },
                translate,
            }),
        ).toEqual(["agentInput.effort.high"]);

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
