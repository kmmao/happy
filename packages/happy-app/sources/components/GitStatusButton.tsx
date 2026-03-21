import { Octicons } from "@expo/vector-icons";
import * as React from "react";
import { Platform, Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { hapticsLight } from "./haptics";
import { GitStatusBadge, useHasMeaningfulGitStatus } from "./GitStatusBadge";

export function GitStatusButton({
    sessionId,
    onPress,
}: {
    sessionId?: string;
    onPress?: () => void;
}) {
    const hasMeaningfulGitStatus = useHasMeaningfulGitStatus(sessionId || "");
    const { theme } = useUnistyles();

    if (!sessionId || !onPress) {
        return null;
    }

    return (
        <Pressable
            style={(p) => ({
                flexDirection: "row",
                alignItems: "center",
                borderRadius: Platform.select({ default: 16, android: 20 }),
                paddingHorizontal: 8,
                paddingVertical: 6,
                height: 32,
                opacity: p.pressed ? 0.7 : 1,
                flex: 1,
                overflow: "hidden",
            })}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            onPress={() => {
                hapticsLight();
                onPress?.();
            }}
        >
            {hasMeaningfulGitStatus ? (
                <GitStatusBadge sessionId={sessionId} />
            ) : (
                <Octicons
                    name="git-branch"
                    size={16}
                    color={theme.colors.button.secondary.tint}
                />
            )}
        </Pressable>
    );
}
