import { Platform, StyleSheet } from "react-native";

// Android doesn't support colored shadow/glow — border without glow looks like a thick outline.
// Hide border on Android and compensate with slightly higher background opacity.
const nativeBorderWidth = Platform.select({ web: 1, ios: StyleSheet.hairlineWidth, default: 0 });

export function getFavoriteSlashChipGlassStyle() {
    return {
        container: {
            borderRadius: 18,
            borderWidth: nativeBorderWidth,
            overflow: "hidden" as const,
        },
        blur: {
            borderRadius: 18,
            overflow: "hidden" as const,
        },
        content: {
            flexDirection: "row" as const,
            alignItems: "center" as const,
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
        },
    };
}

export function getFloatingGlassChipStyle() {
    return {
        container: {
            marginHorizontal: 8,
            marginTop: 8,
            marginBottom: 4,
            borderRadius: 14,
            borderWidth: nativeBorderWidth,
            overflow: "hidden" as const,
        },
        blur: {
            borderRadius: 14,
            overflow: "hidden" as const,
        },
        content: {
            flexDirection: "row" as const,
            alignItems: "center" as const,
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
        },
    };
}
