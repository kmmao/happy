import * as React from "react";
import { Text, TextStyle } from "react-native";
import { formatTokenCountShort } from "@/utils/formatUsage";

const ANIMATION_DURATION = 800;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Animates token count and cost from previous value to current value
 * using requestAnimationFrame for smooth cross-platform transitions.
 * Renders as inline <Text> — safe to nest inside a parent <Text>.
 */
export const AnimatedTokensCost = React.memo(
  (props: {
    totalTokens: number;
    totalCostUsd?: number;
    totalDurationMs?: number;
    style?: TextStyle;
  }) => {
    const { totalTokens, totalCostUsd, totalDurationMs } = props;

    // Track previous target values
    const prevTokensRef = React.useRef(0);
    const prevCostRef = React.useRef(0);

    // Displayed (animated) values
    const [displayTokens, setDisplayTokens] = React.useState(totalTokens);
    const [displayCost, setDisplayCost] = React.useState(totalCostUsd ?? 0);

    // Animation frame ref for cleanup
    const rafRef = React.useRef<number | null>(null);

    React.useEffect(() => {
      const fromTokens = prevTokensRef.current;
      const fromCost = prevCostRef.current;
      const toTokens = totalTokens;
      const toCost = totalCostUsd ?? 0;

      // Update refs to new targets
      prevTokensRef.current = toTokens;
      prevCostRef.current = toCost;

      // Skip animation if values haven't changed or it's the first render (from 0)
      if (fromTokens === toTokens && fromCost === toCost) return;

      // Cancel any in-progress animation
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

    const costStr =
      displayCost > 0
        ? ` · $${displayCost < 0.01 ? displayCost.toFixed(4) : displayCost.toFixed(2)}`
        : "";

    const durationStr =
      totalDurationMs && totalDurationMs > 0
        ? ` · ${formatDurationMs(totalDurationMs)}`
        : "";

    return (
      <Text style={props.style}>
        {` · Σ${formatTokenCountShort(displayTokens)}${costStr}${durationStr}`}
      </Text>
    );
  },
);
