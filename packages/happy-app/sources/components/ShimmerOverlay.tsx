import * as React from "react";
import { View, LayoutChangeEvent } from "react-native";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    interpolate,
    Easing,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

interface ShimmerOverlayProps {
    duration?: number;
}

const COMET_COLOR = "#8B5CF6";

/**
 * Comet shimmer along the bottom border.
 * Trail is in a clipped container; head/glow are in an unclipped container
 * so the breathing circle is never cut off.
 */
export const ShimmerOverlay = React.memo<ShimmerOverlayProps>(
    ({ duration = 10000 }) => {
        const [containerWidth, setContainerWidth] = React.useState(0);
        const progress = useSharedValue(0);
        const breathe = useSharedValue(0);

        React.useEffect(() => {
            progress.value = withRepeat(
                withTiming(1, { duration, easing: Easing.linear }),
                -1,
                false,
            );
            breathe.value = withRepeat(
                withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
                -1,
                true,
            );
        }, [duration]);

        const onLayout = React.useCallback((e: LayoutChangeEvent) => {
            setContainerWidth(e.nativeEvent.layout.width);
        }, []);

        const trailStyle = useAnimatedStyle(() => ({
            width: containerWidth > 0 ? progress.value * containerWidth : 0,
        }));

        const headStyle = useAnimatedStyle(() => {
            const x = containerWidth > 0 ? progress.value * containerWidth : 0;
            const scale = interpolate(breathe.value, [0, 1], [0.8, 1.2]);
            const opacity = interpolate(breathe.value, [0, 1], [0.6, 1]);
            return {
                transform: [{ translateX: x - 3 }, { scale }],
                opacity,
            };
        });

        const glowStyle = useAnimatedStyle(() => {
            const x = containerWidth > 0 ? progress.value * containerWidth : 0;
            const scale = interpolate(breathe.value, [0, 1], [1, 2]);
            const opacity = interpolate(breathe.value, [0, 1], [0.15, 0.4]);
            return {
                transform: [{ translateX: x - 5 }, { scale }],
                opacity,
            };
        });

        return (
            <>
                {/* Trail: clipped to option bounds */}
                <View
                    style={styles.trailWrapper}
                    pointerEvents="none"
                    onLayout={onLayout}
                >
                    {containerWidth > 0 && (
                        <Animated.View style={[styles.trail, trailStyle]} />
                    )}
                </View>

                {/* Head + glow: NOT clipped, renders fully */}
                {containerWidth > 0 && (
                    <View style={styles.headWrapper} pointerEvents="none">
                        <Animated.View style={[styles.glow, glowStyle]} />
                        <Animated.View style={[styles.head, headStyle]} />
                    </View>
                )}
            </>
        );
    },
);

const styles = StyleSheet.create({
    trailWrapper: {
        position: "absolute" as const,
        left: -1,
        right: -1,
        bottom: -1,
        height: 2,
        overflow: "hidden" as const,
        zIndex: 20,
        elevation: 20,
    },
    trail: {
        position: "absolute" as const,
        left: 0,
        top: 0,
        height: 2,
        backgroundColor: COMET_COLOR,
        opacity: 0.8,
    },
    headWrapper: {
        position: "absolute" as const,
        left: -1,
        right: -1,
        bottom: -1,
        height: 0,
        overflow: "visible" as const,
        zIndex: 21,
        elevation: 21,
    },
    head: {
        position: "absolute" as const,
        bottom: -3,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: COMET_COLOR,
    },
    glow: {
        position: "absolute" as const,
        bottom: -5,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: COMET_COLOR + "40",
    },
});
