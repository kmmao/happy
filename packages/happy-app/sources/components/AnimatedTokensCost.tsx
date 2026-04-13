import * as React from "react";
import { Text, TextStyle } from "react-native";
import { useElapsedTime } from "@/hooks/useElapsedTime";
import { formatDurationMs, formatTokenCountShort } from "@/utils/formatUsage";

const ANIMATION_DURATION = 800;

function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

export interface AnimatedTokensCostValue {
    tokensLabel: string;
    costLabel: string | null;
    durationLabel: string | null;
}

export function useAnimatedTokensCostValue(props: {
    totalTokens: number;
    totalCostUsd?: number;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    isThinking?: boolean;
    turnStartedAt?: number;
}): AnimatedTokensCostValue | null {
    const {
        totalTokens,
        totalCostUsd,
        totalDurationMs,
        completedTurnsDurationMs,
        isThinking,
        turnStartedAt,
    } = props;

    const currentTurnElapsedSec = useElapsedTime(
        isThinking ? turnStartedAt : undefined,
    );

    const prevTokensRef = React.useRef(0);
    const prevCostRef = React.useRef(0);

    const [displayTokens, setDisplayTokens] = React.useState(totalTokens);
    const [displayCost, setDisplayCost] = React.useState(totalCostUsd ?? 0);

    const rafRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        const fromTokens = prevTokensRef.current;
        const fromCost = prevCostRef.current;
        const toTokens = totalTokens;
        const toCost = totalCostUsd ?? 0;

        prevTokensRef.current = toTokens;
        prevCostRef.current = toCost;

        if (fromTokens === toTokens && fromCost === toCost) return;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        const startTime = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
            const eased = easeOutCubic(progress);

            const currentTokens = Math.round(
                fromTokens + (toTokens - fromTokens) * eased,
            );
            const currentCost = fromCost + (toCost - fromCost) * eased;

            setDisplayTokens(currentTokens);
            setDisplayCost(currentCost);

            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                rafRef.current = null;
            }
        };

        rafRef.current = requestAnimationFrame(tick);

        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [totalTokens, totalCostUsd]);

    if (displayTokens <= 0) return null;

    const currentTurnMs = isThinking ? currentTurnElapsedSec * 1000 : 0;
    const effectiveDurationMs = isThinking
        ? (completedTurnsDurationMs ?? 0) + currentTurnMs
        : (totalDurationMs ?? 0);

    return {
        tokensLabel: `Σ${formatTokenCountShort(displayTokens)}`,
        costLabel:
            displayCost > 0
                ? `$${displayCost < 0.01 ? displayCost.toFixed(4) : displayCost.toFixed(2)}`
                : null,
        durationLabel:
            effectiveDurationMs > 0
                ? formatDurationMs(effectiveDurationMs)
                : null,
    };
}

/**
 * Renders as inline <Text> — safe to nest inside a parent <Text>.
 */
export const AnimatedTokensCost = React.memo(
    (props: {
        totalTokens: number;
        totalCostUsd?: number;
        totalDurationMs?: number;
        completedTurnsDurationMs?: number;
        isThinking?: boolean;
        turnStartedAt?: number;
        style?: TextStyle;
    }) => {
        const value = useAnimatedTokensCostValue(props);

        if (!value) return null;

        return (
            <Text style={props.style}>
                {` · ${value.tokensLabel}${value.costLabel ? ` · ${value.costLabel}` : ""}${value.durationLabel ? ` · ${value.durationLabel}` : ""}`}
            </Text>
        );
    },
);
