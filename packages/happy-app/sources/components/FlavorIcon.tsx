import * as React from "react";
import { Image } from "expo-image";
import { useUnistyles } from "react-native-unistyles";

const flavorIcons = {
    claude: require("@/assets/images/icon-claude.png"),
    codex: require("@/assets/images/icon-gpt.png"),
    gemini: require("@/assets/images/icon-gemini.png"),
};

interface FlavorIconProps {
    flavor: string | null | undefined;
    size?: number;
}

export const FlavorIcon = React.memo(
    ({ flavor, size = 24 }: FlavorIconProps) => {
        const { theme } = useUnistyles();
        const effectiveFlavor = flavor || "claude";
        const icon =
            flavorIcons[effectiveFlavor as keyof typeof flavorIcons] ||
            flavorIcons.claude;

        return (
            <Image
                source={icon}
                style={{ width: size, height: size }}
                contentFit="contain"
                tintColor={
                    effectiveFlavor === "codex" ? theme.colors.text : undefined
                }
            />
        );
    },
);
