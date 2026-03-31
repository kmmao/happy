import * as React from "react";
import { View } from "react-native";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    Easing,
} from "react-native-reanimated";

const flavorColors: Record<string, string> = {
    claude: "#E07C3A",
    codex: "#10A37F",
    gemini: "#4285F4",
    deepseek: "#4D6BFE",
    zai: "#0EA5E9",
    minimax: "#8B5CF6",
    "azure-openai": "#0078D4",
    opencode: "#14B8A6",
    acp: "#14B8A6",
    openai: "#10A37F",
    gpt: "#10A37F",
};

const ACTIVE_COLOR = "#8B5CF6";

interface AgentDotProps {
    flavor: string | null | undefined;
    size?: number;
    animated?: boolean;
}

export const AgentDot = React.memo(({ flavor, size = 12, animated = false }: AgentDotProps) => {
    const effectiveFlavor = (flavor || "claude").toLowerCase();

    if (!animated) {
        const color = flavorColors[effectiveFlavor] || flavorColors.claude;
        return (
            <View
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color,
                    opacity: 0.6,
                }}
            />
        );
    }

    return <AnimatedDot size={size} />;
});

const AnimatedDot = React.memo(({ size = 12 }: { size?: number }) => {
    const opacity = useSharedValue(1);

    React.useEffect(() => {
        opacity.value = withRepeat(
            withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
            -1,
            true,
        );
    }, [opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ACTIVE_COLOR,
        opacity: opacity.value,
    }));

    return <Animated.View style={animatedStyle} />;
});
