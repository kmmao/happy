/**
 * BottomSheet — shared modal shell extracted from the three workflow
 * sheets (MakeRecurringModal / CreateWebhookModal / CreateLoopModal).
 * Owns every concern those three duplicated:
 *
 *   - RN <Modal> portal so it covers headers / tab bars
 *   - KeyboardAvoidingView shell (iOS padding, Android height resize)
 *   - Mobile bottom-sheet vs desktop centered-card presentation
 *   - Slide-in / slide-out animation (reanimated useSharedValue +
 *     withTiming, default 260ms in / 220ms out)
 *   - Backdrop dim opacity that rides along with the sheet
 *   - Pan-gesture swipe-down-to-dismiss (only when isMobile && !busy),
 *     attached to the grab handle + header so it doesn't fight the
 *     internal ScrollView or TextInputs
 *   - Sticky footer outside the scroll area with safe-area bottom inset
 *   - Re-entrant close guard (isClosingRef) so mid-animation taps don't
 *     stack animations
 *   - Imperative requestClose(cb?) ref API so success paths can play the
 *     exit animation before navigating
 *
 * Callers provide: title / subtitle / form body (children) / footer.
 * Everything else is owned here.
 */

import * as React from "react";
import {
    View,
    Pressable,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Modal as RNModal,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
} from "react-native-reanimated";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";

const MOBILE_BREAKPOINT = 540;
const SLIDE_IN_DURATION = 260;
const SLIDE_OUT_DURATION = 220;
const SWIPE_VELOCITY_THRESHOLD = 800;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface BottomSheetHandle {
    /**
     * Plays the exit animation, then invokes `onClose` (passed as a
     * prop). Optional `afterClose` callback fires after onClose — use
     * this for success paths that want to navigate AFTER the sheet has
     * visually slid away (`router.push(...)`).
     */
    requestClose: (afterClose?: () => void) => void;
}

export interface BottomSheetProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    /** When true, all dismissal paths (X / Cancel / backdrop / swipe /
     *  Android back) are blocked so an in-flight API call can't be
     *  ripped away mid-submit. */
    busy?: boolean;
    /** Body of the sheet — rendered inside an internal ScrollView. */
    children: React.ReactNode;
    /** Sticky footer rendered outside the ScrollView. Caller is fully
     *  in charge of which buttons to show. */
    footer?: React.ReactNode;
    /** Override the desktop card width cap (default 520). */
    desktopMaxWidth?: number;
    /** Override the mobile card height cap (default 0.9 * viewport). */
    mobileMaxHeightFraction?: number;
    /** Override the desktop card height cap (default min(680, 0.85 * viewport)). */
    desktopMaxHeightFraction?: number;
}

const styles = StyleSheet.create((theme) => ({
    overlay: { flex: 1 },
    overlayDesktop: {
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 16,
    },
    overlayMobile: {
        backgroundColor: "transparent",
        justifyContent: "flex-end",
    },
    backdrop: {
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    card: {
        backgroundColor: theme.colors.surface,
        overflow: "hidden",
        flexDirection: "column",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    cardDesktop: {
        width: "100%",
        borderRadius: 14,
    },
    cardMobile: {
        width: "100%",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    grabHandleWrap: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
    grabHandle: {
        width: 36, height: 4, borderRadius: 2,
        backgroundColor: theme.colors.divider,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    titleColumn: { flex: 1, minWidth: 0, gap: 4 },
    title: {
        fontSize: 18,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    subtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 18,
    },
    closeButton: {
        width: 32, height: 32, borderRadius: 16,
        alignItems: "center", justifyContent: "center",
        backgroundColor: theme.colors.surfaceHigh,
        marginLeft: 12,
        ...webInteractive,
    },
    scrollArea: { flexShrink: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 16 },
    footer: {
        flexDirection: "row", justifyContent: "flex-end", gap: 10,
        paddingHorizontal: 20, paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
}));

export const BottomSheet = React.memo(
    React.forwardRef<BottomSheetHandle, BottomSheetProps>(function BottomSheet(
        {
            visible,
            onClose,
            title,
            subtitle,
            busy,
            children,
            footer,
            desktopMaxWidth = 520,
            mobileMaxHeightFraction = 0.9,
            desktopMaxHeightFraction = 0.85,
        },
        ref,
    ) {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
        const isMobile = viewportWidth < MOBILE_BREAKPOINT;

        const mobileMaxHeight = Math.floor(viewportHeight * mobileMaxHeightFraction);
        const desktopMaxHeight = Math.min(680, Math.floor(viewportHeight * desktopMaxHeightFraction));
        const cardMaxHeight = isMobile ? mobileMaxHeight : desktopMaxHeight;
        const footerPaddingBottom = (isMobile ? insets.bottom : 14) || 14;

        // --- Animation state ----------------------------------------------
        const translateY = useSharedValue(mobileMaxHeight);
        const isClosingRef = React.useRef(false);

        // Slide-in on open. Reset translateY to bottom first so a reopened
        // sheet doesn't flash at translateY=0 for one frame before the
        // animation kicks in.
        React.useEffect(() => {
            if (visible) {
                isClosingRef.current = false;
                translateY.value = mobileMaxHeight;
                translateY.value = withTiming(0, { duration: SLIDE_IN_DURATION });
            }
        }, [visible, mobileMaxHeight, translateY]);

        const cardAnimatedStyle = useAnimatedStyle(() => ({
            // Desktop fade has no translate — the card stays centered while
            // RN Modal handles the fade.
            transform: isMobile ? [{ translateY: translateY.value }] : [],
        }));

        const backdropAnimatedStyle = useAnimatedStyle(() => {
            if (!isMobile) return {};
            const progress = 1 - Math.min(1, Math.max(0, translateY.value / mobileMaxHeight));
            return { opacity: progress };
        });

        // --- Close routing -----------------------------------------------
        // Every dismissal funnels here. The optional afterClose callback
        // fires after onClose (after the exit animation finishes) so
        // success paths can defer navigation.
        const closeOnJs = React.useCallback(
            (afterClose?: () => void) => {
                onClose();
                afterClose?.();
            },
            [onClose],
        );

        const requestClose = React.useCallback(
            (afterClose?: () => void) => {
                if (isClosingRef.current) return;
                isClosingRef.current = true;
                if (!isMobile) {
                    onClose();
                    afterClose?.();
                    return;
                }
                translateY.value = withTiming(
                    mobileMaxHeight,
                    { duration: SLIDE_OUT_DURATION },
                    () => {
                        runOnJS(closeOnJs)(afterClose);
                    },
                );
            },
            [isMobile, mobileMaxHeight, onClose, closeOnJs, translateY],
        );

        // Expose requestClose to callers via ref.
        React.useImperativeHandle(ref, () => ({ requestClose }), [requestClose]);

        const safeRequestClose = React.useCallback(() => {
            if (busy) return;
            requestClose();
        }, [busy, requestClose]);

        // --- Swipe-to-dismiss --------------------------------------------
        const SWIPE_DISMISS_DISTANCE = mobileMaxHeight / 3;
        const panGesture = React.useMemo(
            () =>
                Gesture.Pan()
                    .enabled(isMobile && !busy)
                    .onUpdate((e) => {
                        // Clamp to >= 0 so the sheet can't be lifted past
                        // its resting position.
                        translateY.value = Math.max(0, e.translationY);
                    })
                    .onEnd((e) => {
                        const shouldClose =
                            e.translationY > SWIPE_DISMISS_DISTANCE ||
                            e.velocityY > SWIPE_VELOCITY_THRESHOLD;
                        if (shouldClose) {
                            isClosingRef.current = true;
                            translateY.value = withTiming(
                                mobileMaxHeight,
                                { duration: SLIDE_OUT_DURATION },
                                () => {
                                    runOnJS(closeOnJs)();
                                },
                            );
                        } else {
                            translateY.value = withSpring(0, {
                                damping: 20,
                                stiffness: 220,
                            });
                        }
                    }),
            [isMobile, busy, mobileMaxHeight, SWIPE_DISMISS_DISTANCE, translateY, closeOnJs],
        );

        return (
            <RNModal
                visible={visible}
                transparent
                animationType={isMobile ? "none" : "fade"}
                onRequestClose={busy ? undefined : safeRequestClose}
                statusBarTranslucent
            >
                {/* RN Modal portals into a separate native window outside
                    the app's GestureHandlerRootView, so the GestureDetector
                    needs its own root here. */}
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <KeyboardAvoidingView
                        style={[
                            styles.overlay,
                            isMobile ? styles.overlayMobile : styles.overlayDesktop,
                        ]}
                        behavior={
                            Platform.OS === "ios"
                                ? "padding"
                                : Platform.OS === "android"
                                    ? "height"
                                    : undefined
                        }
                    >
                        <AnimatedPressable
                            style={[styles.backdrop, isMobile && backdropAnimatedStyle]}
                            onPress={safeRequestClose}
                            accessibilityLabel="Close"
                        />
                        <Animated.View
                            style={[
                                styles.card,
                                isMobile ? styles.cardMobile : styles.cardDesktop,
                                { maxHeight: cardMaxHeight },
                                !isMobile && { maxWidth: desktopMaxWidth },
                                isMobile && cardAnimatedStyle,
                            ]}
                        >
                            <GestureDetector gesture={panGesture}>
                                <View>
                                    {isMobile ? (
                                        <View style={styles.grabHandleWrap}>
                                            <View style={styles.grabHandle} />
                                        </View>
                                    ) : null}
                                    <View style={styles.headerRow}>
                                        <View style={styles.titleColumn}>
                                            <Text style={styles.title}>{title}</Text>
                                            {subtitle ? (
                                                <Text style={styles.subtitle}>{subtitle}</Text>
                                            ) : null}
                                        </View>
                                        <Pressable
                                            style={styles.closeButton}
                                            onPress={safeRequestClose}
                                            hitSlop={8}
                                            accessibilityLabel="Close"
                                        >
                                            <Ionicons
                                                name="close"
                                                size={18}
                                                color={theme.colors.textSecondary}
                                            />
                                        </Pressable>
                                    </View>
                                </View>
                            </GestureDetector>

                            <ScrollView
                                style={styles.scrollArea}
                                contentContainerStyle={styles.scrollContent}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator
                            >
                                {children}
                            </ScrollView>

                            {footer ? (
                                <View
                                    style={[
                                        styles.footer,
                                        { paddingBottom: footerPaddingBottom },
                                    ]}
                                >
                                    {footer}
                                </View>
                            ) : null}
                        </Animated.View>
                    </KeyboardAvoidingView>
                </GestureHandlerRootView>
            </RNModal>
        );
    }),
);

// --- Helpers / shared chip ------------------------------------------------

const chipStyles = StyleSheet.create((theme) => ({
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 0.5,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        ...webInteractive,
    },
    chipActive: {
        backgroundColor: `${theme.colors.accentBlue}1A`,
        borderColor: theme.colors.accentBlue,
    },
    chipHovered: {
        backgroundColor: "rgba(0,0,0,0.04)",
    },
    chipText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
    },
    chipTextActive: {
        color: theme.colors.accentBlue,
    },
}));

/**
 * Pill-shaped multi-choice chip used across the workflow sheets for
 * cron presets, machine pickers, etc. Lives next to BottomSheet so the
 * three modal callers can stop importing it from their own files.
 */
export const PresetChip = React.memo(function PresetChip({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    const { isHovered, hoverProps } = useWebHoverProps();
    return (
        <Pressable
            {...hoverProps}
            onPress={onPress}
            style={[
                chipStyles.chip,
                active && chipStyles.chipActive,
                isHovered && !active && chipStyles.chipHovered,
            ]}
        >
            <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>
                {label}
            </Text>
        </Pressable>
    );
});
