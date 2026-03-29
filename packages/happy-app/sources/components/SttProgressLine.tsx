import * as React from "react";
import { Animated, View, useWindowDimensions } from "react-native";

const SHIMMER_WIDTH_RATIO = 0.45;
const SHIMMER_DURATION = 800;
const LINE_HEIGHT = 2;

const LISTENING_LINE_BG = "rgba(255, 59, 48, 0.15)";
const LISTENING_SHIMMER = "rgba(255, 59, 48, 0.8)";

/**
 * A thin progress shimmer that sweeps from left to right
 * whenever the display text changes while STT is listening.
 */
export const SttProgressLine = React.memo(function SttProgressLine({
    active,
    value,
}: {
    active: boolean;
    /** Pass the current display text — a shimmer triggers whenever it changes. */
    value: string;
}) {
    const { width: screenWidth } = useWindowDimensions();
    const shimmer = React.useRef(new Animated.Value(0)).current;
    const prevValueRef = React.useRef(value);
    const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

    // Single sweep per value change
    React.useEffect(() => {
        if (!active) {
            animRef.current?.stop();
            animRef.current = null;
            shimmer.setValue(0);
            return;
        }

        // Only sweep on actual value changes (skip initial mount)
        if (value === prevValueRef.current) return;
        prevValueRef.current = value;

        // Stop any in-flight sweep, then start a fresh one
        animRef.current?.stop();
        shimmer.setValue(0);

        const anim = Animated.timing(shimmer, {
            toValue: 1,
            duration: SHIMMER_DURATION,
            useNativeDriver: true,
        });
        animRef.current = anim;
        anim.start(({ finished }) => {
            if (finished) animRef.current = null;
        });
    }, [active, value, shimmer]);

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            animRef.current?.stop();
        };
    }, []);

    const shimmerWidth = screenWidth * SHIMMER_WIDTH_RATIO;
    const translateX = shimmer.interpolate({
        inputRange: [0, 1],
        outputRange: [-shimmerWidth, screenWidth],
    });

    if (!active) return null;

    return (
        <View
            style={{
                width: "100%",
                height: LINE_HEIGHT,
                backgroundColor: LISTENING_LINE_BG,
                overflow: "hidden",
                borderBottomLeftRadius: 16,
                borderBottomRightRadius: 16,
            }}
        >
            <Animated.View
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: shimmerWidth,
                    height: LINE_HEIGHT,
                    backgroundColor: LISTENING_SHIMMER,
                    borderRadius: LINE_HEIGHT / 2,
                    transform: [{ translateX }],
                }}
            />
        </View>
    );
});
