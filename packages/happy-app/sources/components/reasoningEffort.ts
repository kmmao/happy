import type { Metadata } from "@/sync/storageTypes";
import type { ReasoningProps } from "./AgentInputTypes";

const CLAUDE_EFFORT_LEVELS = ["high", "max", "medium", "low"] as const;
const CODEX_EFFORT_LEVELS = ["xhigh", "high", "medium", "low"] as const;
const ALL_EFFORT_LEVELS = [
    "xhigh",
    "high",
    "max",
    "medium",
    "low",
] as const;

type EffortLevel = (typeof ALL_EFFORT_LEVELS)[number];

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

    if (!supported || supported.length === 0) {
        return params.isCodex
            ? [...CODEX_EFFORT_LEVELS]
            : [...CLAUDE_EFFORT_LEVELS];
    }

    return ALL_EFFORT_LEVELS.filter((level) => supported.includes(level));
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
