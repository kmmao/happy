import * as React from "react";
import { View, Animated } from "react-native";

const BAR_COUNT = 4;
const BAR_WIDTH = 3;
const BAR_MAX_HEIGHT = 14;
const BAR_MIN_SCALE = 0.25;
const BAR_DURATION = 350;
const STAGGER_DELAY = 150;

export const SttWaveIndicator = React.memo(function SttWaveIndicator() {
    const animations = React.useRef<Animated.Value[]>(
        Array.from({ length: BAR_COUNT }, () => new Animated.Value(BAR_MIN_SCALE)),
    ).current;

    React.useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        const runningAnimations: Animated.CompositeAnimation[] = [];

        animations.forEach((anim, i) => {
            const timer = setTimeout(() => {
                const animation = Animated.loop(
                    Animated.sequence([
                        Animated.timing(anim, {
                            toValue: 1,
                            duration: BAR_DURATION,
                            useNativeDriver: false,
                        }),
                        Animated.timing(anim, {
                            toValue: BAR_MIN_SCALE,
                            duration: BAR_DURATION,
                            useNativeDriver: false,
                        }),
                    ]),
                );
                runningAnimations.push(animation);
                animation.start();
            }, i * STAGGER_DELAY);
            timers.push(timer);
        });

        return () => {
            timers.forEach(clearTimeout);
            runningAnimations.forEach((a) => a.stop());
            animations.forEach((anim) => anim.setValue(BAR_MIN_SCALE));
        };
    }, [animations]);

    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                height: BAR_MAX_HEIGHT,
                width: BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * 3,
            }}
        >
            {animations.map((anim, i) => (
                <Animated.View
                    key={i}
                    style={{
                        width: BAR_WIDTH,
                        height: BAR_MAX_HEIGHT,
                        borderRadius: BAR_WIDTH / 2,
                        backgroundColor: "#fff",
                        transform: [{ scaleY: anim }],
                    }}
                />
            ))}
        </View>
    );
});
