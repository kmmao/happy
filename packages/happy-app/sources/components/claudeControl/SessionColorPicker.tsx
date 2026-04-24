import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { setSessionColor } from "@/sync/apiClaudeControl";
import { useHappyAction } from "@/hooks/useHappyAction";

/** Preset palette mirrors Avatar.tsx colors; "default" resets CLI accent. */
const PRESET_COLORS: ReadonlyArray<{ key: string; hex: string }> = [
    { key: "default", hex: "#8B8B8B" },
    { key: "red", hex: "#E53935" },
    { key: "orange", hex: "#FB8C00" },
    { key: "yellow", hex: "#FDD835" },
    { key: "green", hex: "#43A047" },
    { key: "teal", hex: "#00897B" },
    { key: "blue", hex: "#1E88E5" },
    { key: "purple", hex: "#8E24AA" },
    { key: "pink", hex: "#D81B60" },
];

interface SessionColorPickerProps {
    sessionId: string;
    currentColor?: string;
    /** Fires after CLI acknowledges the color change. App persists via KV. */
    onChange: (color: string) => void;
}

/**
 * Swatch-grid picker. Taps optimistically update local `selected` state
 * then fire `set_color` RPC via useHappyAction (auto error handling). App
 * owns the canonical stored color — this component only notifies CLI.
 */
export const SessionColorPicker = React.memo(function SessionColorPicker({
    sessionId,
    currentColor,
    onChange,
}: SessionColorPickerProps) {
    const [selected, setSelected] = React.useState<string>(
        currentColor ?? "default",
    );

    const [loading, commit] = useHappyAction(async () => {
        const target = selected;
        const res = await setSessionColor(sessionId, target);
        onChange(res.color);
    });

    return (
        <View style={styles.container}>
            <Text style={styles.title}>{t("claudeControl.color.title")}</Text>
            <View style={styles.grid}>
                {PRESET_COLORS.map((c) => {
                    const isSelected = c.key === selected;
                    return (
                        <Pressable
                            key={c.key}
                            onPress={() => setSelected(c.key)}
                            disabled={loading}
                            accessibilityLabel={
                                c.key === "default"
                                    ? t("claudeControl.color.default")
                                    : c.key
                            }
                            style={[
                                styles.swatch,
                                { backgroundColor: c.hex },
                                isSelected && styles.swatchSelected,
                            ]}
                        />
                    );
                })}
            </View>
            <Pressable
                onPress={commit}
                disabled={loading}
                style={({ pressed }) => [
                    styles.applyButton,
                    pressed && styles.applyButtonPressed,
                    loading && styles.applyButtonDisabled,
                ]}
            >
                <Text style={styles.applyText}>
                    {t("claudeControl.color.apply")}
                </Text>
            </Pressable>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    title: {
        fontSize: 15,
        fontWeight: "600",
        color: theme.colors.text,
    },
    grid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    swatch: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: "transparent",
    },
    swatchSelected: {
        borderColor: theme.colors.text,
    },
    applyButton: {
        alignSelf: "flex-start",
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.primary,
    },
    applyButtonPressed: {
        opacity: 0.75,
    },
    applyButtonDisabled: {
        opacity: 0.45,
    },
    applyText: {
        fontSize: 14,
        fontWeight: "600",
        color: "#FFFFFF",
    },
}));
