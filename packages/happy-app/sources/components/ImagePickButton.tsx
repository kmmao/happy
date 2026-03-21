import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { View, Text, ActivityIndicator, Platform, Pressable } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { hapticsLight } from "./haptics";
import { MAX_IMAGES } from "@/utils/imageUpload";

export const ImagePickButton = React.memo(function ImagePickButton({
    onPress,
    isPickingImage,
    imagePaths,
}: {
    onPress: () => void;
    isPickingImage?: boolean;
    imagePaths?: string[];
}) {
    const { theme } = useUnistyles();
    const hasImages = (imagePaths?.length ?? 0) > 0;
    const atMax = (imagePaths?.length ?? 0) >= MAX_IMAGES;
    const isDisabled = isPickingImage || atMax;

    return (
        <Pressable
            onPress={() => {
                hapticsLight();
                onPress();
            }}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel="Attach image"
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
                        name={hasImages ? "image" : "image-outline"}
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
