import type { Metadata } from "@/sync/storageTypes";
import type { ReasoningProps } from "./AgentInputTypes";

// Effort ordering: max > xhigh > high > medium > low
// xhigh is Opus 4.7/4.8 only (SDK 0.2.111+). When CLI reports
// supportedEffortLevels on a model (e.g. Opus 4.7/4.8), xhigh is surfaced via
// the dynamic path below. The static fallback deliberately omits xhigh so
// other models don't expose an option the SDK will reject.
const CLAUDE_EFFORT_LEVELS = ["max", "high", "medium", "low"] as const;
const CODEX_EFFORT_LEVELS = ["xhigh", "high", "medium", "low"] as const;
const ALL_EFFORT_LEVELS = [
    "max",
    "xhigh",
    "high",
    "medium",
    "low",
] as const;

type EffortLevel = (typeof ALL_EFFORT_LEVELS)[number];

// Opus 4.7/4.8 and Fable 5 support xhigh natively (SDK 0.2.112+ for Opus, 1M
// context Fable 5 inherits the same effort surface). When the SDK omits xhigh
// from supportedEffortLevels for these models, surface it anyway so users
// aren't forced back to max.
const XHIGH_CAPABLE_MODEL_CODES = new Set([
    "opus-4-7",
    "opus-4-7-1m",
    "claude-opus-4-7",
    "claude-opus-4-7[1m]",
    "opus-4-8",
    "opus-4-8-1m",
    "claude-opus-4-8",
    "claude-opus-4-8[1m]",
    "fable-5",
    "fable-5-1m",
    "claude-fable-5",
    "claude-fable-5[1m]",
]);

function isXhighCapableModelCode(code: string | null | undefined): boolean {
    if (!code) return false;
    return (
        XHIGH_CAPABLE_MODEL_CODES.has(code) ||
        code.startsWith("claude-opus-4-7") ||
        code.startsWith("claude-opus-4-8") ||
        code.startsWith("claude-fable-5")
    );
}

function resolveCurrentModelInfo(params: {
    metadata?: Metadata | null;
    modelModeKey?: string | null;
    currentModelCode?: string | null;
}) {
    const selectedModelCode =
        params.modelModeKey && params.modelModeKey !== "default"
            ? params.modelModeKey
            : params.currentModelCode ?? params.metadata?.currentModelCode;

    if (!selectedModelCode) {
        return null;
    }

    return (
        params.metadata?.models?.find((model) => model.code === selectedModelCode) ??
        null
    );
}

export function shouldShowEffortSelector(params: {
    isCodex: boolean;
    isGemini: boolean;
    hasEffortHandler: boolean;
    metadata?: Metadata | null;
    modelModeKey?: string | null;
    currentModelCode?: string | null;
}): boolean {
    if (!params.hasEffortHandler || params.isGemini) {
        return false;
    }

    const currentModelInfo = resolveCurrentModelInfo(params);
    if (currentModelInfo?.supportsEffort === false) {
        return false;
    }

    return true;
}

export function getVisibleEffortLevels(params: {
    isCodex?: boolean;
    metadata?: Metadata | null;
    modelModeKey?: string | null;
    currentModelCode?: string | null;
}): EffortLevel[] {
    const supported =
        resolveCurrentModelInfo(params)?.supportedEffortLevels ?? null;

    const baseLevels: EffortLevel[] =
        !supported || supported.length === 0
            ? params.isCodex
                ? [...CODEX_EFFORT_LEVELS]
                : [...CLAUDE_EFFORT_LEVELS]
            : ALL_EFFORT_LEVELS.filter((level) => supported.includes(level));

    if (params.isCodex || baseLevels.includes("xhigh")) {
        return baseLevels;
    }

    const selectedModelCode =
        params.modelModeKey && params.modelModeKey !== "default"
            ? params.modelModeKey
            : params.currentModelCode ?? params.metadata?.currentModelCode ?? null;

    if (!isXhighCapableModelCode(selectedModelCode)) {
        return baseLevels;
    }

    const maxIndex = baseLevels.indexOf("max");
    if (maxIndex === -1) {
        return ["xhigh", ...baseLevels];
    }
    return [
        ...baseLevels.slice(0, maxIndex + 1),
        "xhigh",
        ...baseLevels.slice(maxIndex + 1),
    ];
}

export function getReasoningSummaryLabels(params: {
    isCodex: boolean;
    isGemini: boolean;
    reasoning?: ReasoningProps;
    translate: (key: any) => string;
}): string[] {
    if (params.isGemini) {
        return [];
    }

    if (params.isCodex) {
        return params.reasoning?.effortLevel
            ? [params.translate(`agentInput.effort.${params.reasoning.effortLevel}`)]
            : [];
    }

    const effortLevel = params.reasoning?.effortLevel ?? "medium";
    const thinkingMode = params.reasoning?.thinkingMode ?? "adaptive";

    return [
        params.translate(`agentInput.effort.${effortLevel}`),
        params.translate(`agentInput.thinking.${thinkingMode}`),
    ];
}
