import * as React from "react";
import { View } from "react-native";
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

interface WorkflowEnabledGlowProps {
    enabled: boolean;
    active?: boolean;
    color: string;
    size?: number;
    children: React.ReactNode;
}

export const WorkflowEnabledGlow = React.memo(function WorkflowEnabledGlow({
    enabled,
    active = false,
    color,
    size = 36,
    children,
}: WorkflowEnabledGlowProps) {
    const pulse = useSharedValue(0);

    React.useEffect(() => {
        if (!enabled) {
            pulse.value = withTiming(0, { duration: 180 });
            return;
        }
        pulse.value = withRepeat(
            withTiming(1, {
                duration: active ? 1400 : 2200,
                easing: Easing.inOut(Easing.ease),
            }),
            -1,
            true,
        );
    }, [active, enabled, pulse]);

    const ringStyle = useAnimatedStyle(() => {
        const maxOpacity = active ? 0.42 : 0.26;
        return {
            opacity: enabled
                ? interpolate(pulse.value, [0, 1], [0.14, maxOpacity])
                : 0,
            transform: [
                {
                    scale: enabled
                        ? interpolate(pulse.value, [0, 1], [0.94, active ? 1.18 : 1.1])
                        : 0.94,
                },
            ],
        };
    });

    const haloStyle = useAnimatedStyle(() => ({
        opacity: enabled
            ? interpolate(pulse.value, [0, 1], [0.06, active ? 0.22 : 0.14])
            : 0,
        transform: [
            {
                scale: enabled
                    ? interpolate(pulse.value, [0, 1], [1.05, active ? 1.45 : 1.28])
                    : 1,
            },
        ],
    }));

    return (
        <View style={[styles.container, { width: size, height: size }]}>
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.halo,
                    {
                        borderRadius: size / 2,
                        backgroundColor: color,
                    },
                    haloStyle,
                ]}
            />
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.ring,
                    {
                        borderRadius: size / 2,
                        borderColor: color,
                    },
                    ringStyle,
                ]}
            />
            <View style={styles.content}>{children}</View>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
    },
    halo: {
        position: "absolute",
        top: -2,
        right: -2,
        bottom: -2,
        left: -2,
    },
    ring: {
        position: "absolute",
        top: -1,
        right: -1,
        bottom: -1,
        left: -1,
        borderWidth: 1,
    },
    content: {
        alignItems: "center",
        justifyContent: "center",
    },
});
