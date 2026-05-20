/**
 * StreamingTextView — typewriter-style text renderer for in-progress streaming messages.
 *
 * Instead of rendering the full accumulated text on every delta (which appears "chunky"),
 * this component maintains a `displayedLength` that advances smoothly via
 * requestAnimationFrame, revealing characters at an adaptive speed:
 *   - Small buffer → slow typing (2 chars/frame ≈ 120 chars/sec @60fps)
 *   - Large buffer → fast catch-up (up to 15 chars/frame ≈ 900 chars/sec)
 *
 * Once streaming finishes the parent switches to MarkdownView for full formatting.
 * At that point displayedLength === text.length so the visual transition is seamless.
 */
import * as React from "react";
import { Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";

type Props = {
  text: string;
};

export const StreamingTextView = React.memo(({ text }: Props) => {
  const { theme } = useUnistyles();

  // displayedLength is how many characters have been "typed out" so far.
  const [displayedLength, setDisplayedLength] = React.useState(0);

  // Refs let the rAF callback read the latest values without stale closures.
  const rafRef = React.useRef<number | null>(null);
  const textRef = React.useRef(text);
  const displayedLengthRef = React.useRef(0);

  // Keep refs in sync on every render.
  textRef.current = text;

  React.useEffect(() => {
    const target = text.length;

    // Text shrank (message replaced / cleared) → snap immediately, stop loop.
    if (displayedLengthRef.current > target) {
      displayedLengthRef.current = target;
      setDisplayedLength(target);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Already fully revealed — nothing to do.
    if (displayedLengthRef.current >= target) {
      return;
    }

    // Loop is already running — it will pick up the new target automatically.
    if (rafRef.current != null) {
      return;
    }

    // Start the animation loop.
    const tick = () => {
      const current = displayedLengthRef.current;
      const tgt = textRef.current.length;

      if (current >= tgt) {
        // Fully caught up — stop.
        rafRef.current = null;
        return;
      }

      // Adaptive speed: small buffer → slow type, large buffer → fast catch-up.
      const buffered = tgt - current;
      const charsThisFrame = Math.min(Math.max(Math.ceil(buffered / 8), 2), 15);
      const next = Math.min(current + charsThisFrame, tgt);

      displayedLengthRef.current = next;
      setDisplayedLength(next);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  // Re-run only when new text arrives (length increased) or text fully changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <Text
      style={[styles.text, { color: theme.colors.text }]}
      selectable={false}
    >
      {text.slice(0, displayedLength)}
    </Text>
  );
});

const styles = StyleSheet.create(() => ({
  text: {
    ...Typography.default(),
    fontSize: 15,
    lineHeight: 23,
    marginTop: 6,
    marginBottom: 6,
    fontWeight: "400",
  },
}));
