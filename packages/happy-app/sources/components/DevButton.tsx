/**
 * Dev services button for the session header.
 *
 * Three states:
 * - idle: ▶ Dev (green play icon)
 * - running: ● N/N (green dot + count)
 * - partial: ● N/M (yellow dot + count)
 *
 * Short press: trigger onPress (start all / show popover)
 * Long press: trigger onLongPress (always show popover)
 */

import * as React from "react";
import { Pressable, View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { hapticsLight } from "@/components/haptics";
import type { DevButtonState } from "@/hooks/useDevButton";

type Props = {
    readonly state: DevButtonState;
    readonly runningCount: number;
    readonly totalCount: number;
    readonly onPress: () => void;
    readonly onLongPress?: () => void;
    readonly tintColor: string;
};

function DevButtonInner({ state, runningCount, totalCount, onPress, onLongPress, tintColor }: Props) {
    const { theme } = useUnistyles();
    const longPressedRef = React.useRef(false);

    if (state === "hidden") return null;

    const handlePress = () => {
        if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
        }
        hapticsLight();
        onPress();
    };

    const handleLongPress = () => {
        longPressedRef.current = true;
        hapticsLight();
        onLongPress?.();
    };

    const dotColor = state === "running" ? "#4CAF50" : state === "partial" ? "#FF9800" : undefined;

    return (
        <Pressable
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={400}
            hitSlop={10}
            style={({ pressed }) => [
                styles.container,
                pressed && { opacity: 0.6 },
            ]}
        >
            {state === "idle" ? (
                <View style={styles.idleRow}>
                    <Ionicons name="play" size={12} color="#4CAF50" />
                    <Text style={[styles.label, { color: tintColor }]}>Dev</Text>
                </View>
            ) : (
                <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    <Text style={[styles.statusText, { color: tintColor }]}>
                        {runningCount}/{totalCount}
                    </Text>
                </View>
            )}
        </Pressable>
    );
}

export const DevButton = React.memo(DevButtonInner);

const styles = StyleSheet.create({
    container: {
        height: 44,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    idleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    label: {
        fontSize: 13,
        fontWeight: "600",
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: "600",
        fontVariant: ["tabular-nums"],
    },
});
