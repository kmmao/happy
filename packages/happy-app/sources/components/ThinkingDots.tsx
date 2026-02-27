import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

const DOT_COUNT = 3;
const DOT_SIZE = 4;
const DOT_GAP = 4;
const STAGGER_DELAY = 200;
const FADE_DURATION = 400;

interface ThinkingDotsProps {
  color?: string;
}

export const ThinkingDots = React.memo(
  ({ color = "#fff" }: ThinkingDotsProps) => {
    const animations = useRef<Animated.Value[]>(
      Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3)),
    ).current;

    useEffect(() => {
      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const runningAnimations: Animated.CompositeAnimation[] = [];

      animations.forEach((anim, i) => {
        const timer = setTimeout(() => {
          if (cancelled) return;
          const animation = Animated.loop(
            Animated.sequence([
              Animated.timing(anim, {
                toValue: 1,
                duration: FADE_DURATION,
                useNativeDriver: true,
              }),
              Animated.timing(anim, {
                toValue: 0.3,
                duration: FADE_DURATION,
                useNativeDriver: true,
              }),
            ]),
          );
          runningAnimations.push(animation);
          animation.start();
        }, i * STAGGER_DELAY);
        timers.push(timer);
      });

      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        runningAnimations.forEach((a) => a.stop());
        animations.forEach((anim) => anim.setValue(0.3));
      };
    }, [animations]);

    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: DOT_GAP,
          height: DOT_SIZE,
        }}
      >
        {animations.map((anim, i) => (
          <Animated.View
            key={i}
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: color,
              opacity: anim,
            }}
          />
        ))}
      </View>
    );
  },
);
