import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { View, Text, ActivityIndicator, Platform, Pressable, Alert } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Modal } from "@/modal";
import { hapticsLight } from "./haptics";
import { MAX_IMAGES } from "@/utils/imageUpload";
import { t } from "@/text";

export type AttachAction = "gallery" | "camera" | "file";

/** Detect whether the device has a camera. Cached after first check. */
function useHasCamera(): boolean {
    const [hasCamera, setHasCamera] = React.useState(
        // Native always has camera; web checks async
        Platform.OS !== "web",
    );

    React.useEffect(() => {
        if (Platform.OS !== "web") return;
        let cancelled = false;
        (async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (!cancelled) {
                    setHasCamera(devices.some((d) => d.kind === "videoinput"));
                }
            } catch {
                // mediaDevices not available — no camera
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return hasCamera;
}

export const AttachButton = React.memo(function AttachButton({
    onAction,
    isPickingImage,
    imagePaths,
}: {
    onAction: (action: AttachAction) => void;
    isPickingImage?: boolean;
    imagePaths?: string[];
}) {
    const { theme } = useUnistyles();
    const hasImages = (imagePaths?.length ?? 0) > 0;
    const atMax = (imagePaths?.length ?? 0) >= MAX_IMAGES;
    const isDisabled = isPickingImage || atMax;
    const hasCamera = useHasCamera();

    const handlePress = React.useCallback(() => {
        hapticsLight();
        if (Platform.OS === "web") {
            const buttons = [
                ...(hasCamera
                    ? [{ text: t("session.takePhoto"), onPress: () => onAction("camera") }]
                    : []),
                {
                    text: t("session.chooseFromLibrary"),
                    onPress: () => onAction("gallery"),
                },
                {
                    text: t("session.chooseFile"),
                    onPress: () => onAction("file"),
                },
                {
                    text: t("common.cancel"),
                    style: "cancel" as const,
                },
            ];
            Modal.alert(t("session.attachOptions"), undefined, buttons);
            return;
        }
        // Alert.alert is used intentionally here for native ActionSheet behavior.
        // Modal from @/modal does not support ActionSheet-style multi-option menus.
        // Web is handled above (direct gallery).
        Alert.alert(
            t("session.attachOptions"),
            undefined,
            [
                {
                    text: t("session.takePhoto"),
                    onPress: () => onAction("camera"),
                },
                {
                    text: t("session.chooseFromLibrary"),
                    onPress: () => onAction("gallery"),
                },
                {
                    text: t("session.chooseFile"),
                    onPress: () => onAction("file"),
                },
                {
                    text: t("common.cancel"),
                    style: "cancel",
                },
            ],
            { cancelable: true },
        );
    }, [onAction, hasCamera]);

    return (
        <Pressable
            onPress={handlePress}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={t("session.attachOptions")}
            accessibilityState={{
                disabled: isDisabled,
                busy: isPickingImage,
            }}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            style={(p) => ({
                flexDirection: "row",
                alignItems: "center",
                borderRadius: Platform.select({ default: 16, android: 20 }),
                paddingHorizontal: 8,
                paddingVertical: 6,
                justifyContent: "center",
                height: 32,
                opacity: isDisabled ? 0.4 : p.pressed ? 0.6 : 1,
                backgroundColor: hasImages
                    ? `${theme.colors.success}14`
                    : "transparent",
            })}
        >
            {isPickingImage ? (
                <ActivityIndicator size="small" color={theme.colors.success} />
            ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons
                        name={hasImages ? "attach" : "attach-outline"}
                        size={18}
                        color={
                            hasImages
                                ? theme.colors.success
                                : theme.colors.button.secondary.tint
                        }
                    />
                    {hasImages && (
                        <Text
                            style={{
                                fontSize: 11,
                                fontWeight: "700",
                                color: theme.colors.success,
                                ...Typography.default("semiBold"),
                            }}
                        >
                            {imagePaths?.length}
                        </Text>
                    )}
                </View>
            )}
        </Pressable>
    );
});
