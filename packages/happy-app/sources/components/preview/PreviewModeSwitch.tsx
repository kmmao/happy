/**
 * Toggle between Screenshot mode and Live Preview mode.
 * Renders as a segmented control / pill toggle.
 */

import * as React from "react";
import { View, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import type { PreviewMode } from "@/hooks/useRemotePreview";

interface PreviewModeSwitchProps {
    mode: PreviewMode;
    onModeChange: (mode: PreviewMode) => void;
}

const MODES: { key: PreviewMode; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: "live", icon: "globe-outline", label: "Live" },
    { key: "screenshot", icon: "camera-outline", label: "Screenshot" },
];

export const PreviewModeSwitch = React.memo<PreviewModeSwitchProps>(
    function PreviewModeSwitch({ mode, onModeChange }) {
        const { theme } = useUnistyles();

        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surfaceHighest }]}>
                {MODES.map((m) => {
                    const isActive = mode === m.key;
                    return (
                        <Pressable
                            key={m.key}
                            onPress={() => onModeChange(m.key)}
                            style={({ pressed }) => [
                                styles.segment,
                                isActive && {
                                    backgroundColor: theme.colors.surface,
                                },
                                pressed && { opacity: 0.7 },
                            ]}
                        >
                            <Ionicons
                                name={m.icon}
                                size={14}
                                color={isActive ? theme.colors.textLink : theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.label,
                                    {
                                        color: isActive ? theme.colors.text : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {m.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        );
    },
);

const styles = StyleSheet.create((_theme) => ({
    container: {
        flexDirection: "row",
        borderRadius: 10,
        padding: 3,
        gap: 2,
    },
    segment: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingVertical: 6,
        borderRadius: 8,
    },
    label: {
        fontSize: 13,
        fontWeight: "600",
    },
}));
