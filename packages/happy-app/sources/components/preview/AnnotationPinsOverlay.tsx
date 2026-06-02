/**
 * Renders numbered pins on top of the live preview iframe/WebView.
 *
 * Each pin is anchored to a DOM element in the proxied page. Position updates
 * come from the injected annotation runtime via postMessage (ANCHOR_UPDATE).
 */

import * as React from "react";
import { View, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";

export interface AnnotationPin {
    /** Stable id (matches the TRACK anchor id). */
    readonly id: string;
    /** User's comment text. */
    readonly comment: string;
    /** Display ordinal (1-based). */
    readonly index: number;
    /** Current position from injected script — null if untracked yet. */
    readonly rect: { x: number; y: number; width: number; height: number } | null;
    /** True if the script couldn't resolve the anchor in the current DOM. */
    readonly lost: boolean;
}

interface AnnotationPinsOverlayProps {
    readonly pins: readonly AnnotationPin[];
    /** Container size (the LivePreviewView inner container). */
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    /** Scale factor (zoom / 100). Pins must counter-scale so they stay readable. */
    readonly scale: number;
    /** Pan offset from hand mode — pins shift by this amount. */
    readonly panOffset?: { x: number; y: number };
    /** Called when user clicks a pin — shows the comment text. */
    readonly onPinPress: (pin: AnnotationPin) => void;
}

export const AnnotationPinsOverlay = React.memo<AnnotationPinsOverlayProps>(
    function AnnotationPinsOverlay({ pins, viewportWidth, viewportHeight, scale, panOffset, onPinPress }) {
        const { theme } = useUnistyles();
        const panX = panOffset?.x ?? 0;
        const panY = panOffset?.y ?? 0;
        return (
            <View
                pointerEvents="box-none"
                style={[
                    styles.overlay,
                    { width: viewportWidth * scale, height: viewportHeight * scale },
                ]}
            >
                {pins.map((pin) => {
                    if (!pin.rect) return null;
                    // Convert page-space rect to screen-space via scale + pan offset
                    const left = pin.rect.x * scale + panX;
                    const top = pin.rect.y * scale + panY;
                    return (
                        <Pressable
                            key={pin.id}
                            onPress={() => onPinPress(pin)}
                            style={[
                                styles.pin,
                                {
                                    left: left - 12,
                                    top: top - 12,
                                    backgroundColor: pin.lost
                                        ? theme.colors.textDestructive
                                        : theme.colors.textLink,
                                    opacity: pin.lost ? 0.6 : 1,
                                },
                            ]}
                        >
                            <Text style={styles.pinNumber}>{pin.index}</Text>
                        </Pressable>
                    );
                })}
            </View>
        );
    },
);

const styles = StyleSheet.create((_theme) => ({
    overlay: {
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 50,
    },
    pin: {
        position: "absolute",
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    pinNumber: {
        color: "#fff",
        fontSize: 12,
        fontWeight: "700",
    },
}));
