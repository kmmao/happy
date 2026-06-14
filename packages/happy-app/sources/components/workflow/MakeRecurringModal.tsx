/**
 * MakeRecurringModal — Phase 2 promote action of the Workflow IA.
 *
 * "create-similar" semantics: creates a NEW TriggerSchedule carrying the
 * current Session's prompt and directory. Real in-place adoption needs the
 * CLI to support a `happySessionId` hint on the `task-trigger` ephemeral —
 * gated on ADR-0022 phase 3b and a coordinated cli/agent release.
 *
 * Renders via RN's built-in `Modal` so it's portal-mounted at the root and
 * always covers headers / tab bars. Mobile presents a bottom sheet (slide
 * up, rounded only at the top, sticky footer); desktop centers the card.
 * Internal ScrollView keeps the form scrollable; the Cancel/Create footer
 * is sticky outside the ScrollView so it's always reachable.
 *
 * Mobile gestures: the grab handle + header are wrapped in a Pan gesture
 * so the user can swipe down to dismiss — standard bottom-sheet
 * affordance. ScrollView and form inputs deliberately do NOT participate
 * (they'd fight scroll / text-selection), but the visible "drag" surface
 * (handle + title row) covers ~80px which is exactly where users instinct-
 * ively reach. Threshold: drag past 1/3 card height OR fling with velocity
 * > 800 → close; otherwise spring back to 0.
 */

import * as React from "react";
import {
    View,
    Pressable,
    TextInput,
    ActivityIndicator,
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
import { Modal as AlertModal } from "@/modal";
import { useRouter } from "expo-router";
import { TokenStorage } from "@/auth/tokenStorage";
import { createTriggerSchedule } from "@/sync/apiTriggerSchedules";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";
import { t } from "@/text";
import type { Session } from "@/sync/storageTypes";

interface MakeRecurringModalProps {
    session: Session;
    visible: boolean;
    onClose: () => void;
}

// Preset id → cron expression. Labels come from i18n at render time.
const CRON_PRESETS: Array<{ id: string; labelKey: () => string; expr: string }> = [
    { id: "hourly", labelKey: () => t("workflows.recurringCronEveryHour"), expr: "0 * * * *" },
    { id: "daily", labelKey: () => t("workflows.recurringCronDaily02"), expr: "0 2 * * *" },
    { id: "weekday", labelKey: () => t("workflows.recurringCronWeekdays09"), expr: "0 9 * * 1-5" },
    { id: "weekly", labelKey: () => t("workflows.recurringCronWeeklyMon09"), expr: "0 9 * * 1" },
];

const MOBILE_BREAKPOINT = 540;

// Reanimated-wrapped Pressable so the backdrop's opacity can be driven by
// the same translateY shared value that animates the sheet.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create((theme) => ({
    // Full-screen overlay; RN Modal already portals this to root.
    overlay: {
        flex: 1,
    },
    overlayDesktop: {
        // Center the card on wide viewports.
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 16,
    },
    overlayMobile: {
        // Pin to bottom; the dim layer is its own pressable behind the card.
        backgroundColor: "transparent",
        justifyContent: "flex-end",
    },
    // Absolutely-positioned dim layer that intercepts taps to close.
    backdrop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    card: {
        backgroundColor: theme.colors.surface,
        overflow: "hidden",
        flexDirection: "column",
        // Subtle shadow so it lifts off the page.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    cardDesktop: {
        width: "100%",
        maxWidth: 520,
        borderRadius: 14,
    },
    cardMobile: {
        width: "100%",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    // Mobile bottom sheet grab handle (visual cue you can swipe / dismiss).
    grabHandleWrap: {
        alignItems: "center",
        paddingTop: 8,
        paddingBottom: 4,
    },
    grabHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
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
    titleColumn: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
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
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surfaceHigh,
        marginLeft: 12,
        ...webInteractive,
    },
    scrollArea: {
        flexShrink: 1,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 20,
        gap: 16,
    },
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    presetGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    presetChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 0.5,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        ...webInteractive,
    },
    presetChipActive: {
        backgroundColor: `${theme.colors.accentBlue}1A`,
        borderColor: theme.colors.accentBlue,
    },
    presetChipText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
    },
    presetChipTextActive: {
        color: theme.colors.accentBlue,
    },
    input: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.input?.background ?? theme.colors.groupped.background,
        fontFamily: "Menlo",
    },
    promptInput: {
        minHeight: 96,
        textAlignVertical: "top",
        fontFamily: "System",
        fontSize: 14,
    },
    info: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        backgroundColor: `${theme.colors.accentOrange}14`,
        borderRadius: 8,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default(),
        lineHeight: 17,
    },
    footer: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 10,
        paddingHorizontal: 20,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
        minWidth: 88,
        alignItems: "center",
        justifyContent: "center",
        ...webInteractive,
    },
    buttonCancel: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    buttonPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonPrimaryDisabled: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    buttonText: {
        fontSize: 14,
        ...Typography.default("semiBold"),
    },
    buttonTextPrimary: {
        color: theme.colors.button.primary.tint,
    },
    buttonTextCancel: {
        color: theme.colors.textSecondary,
    },
}));

export const MakeRecurringModal = React.memo(function MakeRecurringModal({
    session,
    visible,
    onClose,
}: MakeRecurringModalProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const isMobile = viewportWidth < MOBILE_BREAKPOINT;

    const [presetId, setPresetId] = React.useState<string>("daily");
    const [customCron, setCustomCron] = React.useState<string>("");
    const [prompt, setPrompt] = React.useState<string>("");
    const [submitting, setSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (!visible) return;
        setPresetId("daily");
        setCustomCron("");
        const seed =
            session.latestUserRequestPreview?.text?.trim() ||
            session.metadata?.summary?.text?.trim() ||
            "";
        setPrompt(seed);
        setSubmitting(false);
    }, [visible, session]);

    const cronExpression =
        presetId === "custom"
            ? customCron.trim()
            : CRON_PRESETS.find((p) => p.id === presetId)?.expr ?? "";

    const machineId = session.metadata?.machineId ?? "";
    const valid = cronExpression.length > 0 && prompt.trim().length > 0 && machineId.length > 0;

    const handleConfirm = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error("Not authenticated");

            const trigger = await createTriggerSchedule(credentials, {
                machineId,
                prompt: prompt.trim(),
                cronExpression,
                name: session.metadata?.summary?.text?.trim()?.slice(0, 60),
            });

            // Slide the sheet out first, then navigate. Gives a clear
            // visual "operation complete" beat — the user sees their
            // workflow being created, the sheet bows out, then they land
            // on the new Workflow page.
            const targetUrl = `/workflow/${encodeURIComponent(`scheduled:${trigger.id}`)}`;
            requestClose(() => router.push(targetUrl as any));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AlertModal.alert(t("workflows.recurringErrorTitle"), message);
            setSubmitting(false);
        }
    };

    // Mobile bottom-sheet height cap leaves room for status bar so the card
    // never overlaps OS chrome.
    const mobileMaxHeight = Math.floor(viewportHeight * 0.9);
    const desktopMaxHeight = Math.min(680, Math.floor(viewportHeight * 0.85));
    const cardMaxHeight = isMobile ? mobileMaxHeight : desktopMaxHeight;

    // Bottom inset for the sticky footer so the home-indicator doesn't
    // overlap the Cancel/Create buttons on iOS.
    const footerPaddingBottom = (isMobile ? insets.bottom : 14) || 14;

    // --- Slide-in/out + swipe-to-dismiss (mobile only) --------------------
    // translateY drives ALL mobile motion: open slides from mobileMaxHeight
    // up to 0, close slides from 0 down to mobileMaxHeight, swipe-to-dismiss
    // follows the finger. Backdrop opacity rides along so the dim layer
    // fades in/out in sync with the sheet — without it the dim layer would
    // pop on/off instantly while the sheet animates.
    //
    // RN's built-in slide animation is intentionally disabled (animationType
    // = "none" on mobile) so we own every transition; the previous
    // implementation let RN slide-in then we slide-out, which double-
    // animated entry and snapped on exit.
    const translateY = useSharedValue(mobileMaxHeight);
    const isClosingRef = React.useRef(false);

    // Slide-in whenever the modal becomes visible. translateY resets to
    // the bottom first so the spring/animation has somewhere to start
    // (RN Modal mounts contents immediately on visible=true; without this
    // reset a reopened sheet would flash at translateY=0 for one frame).
    React.useEffect(() => {
        if (visible) {
            isClosingRef.current = false;
            translateY.value = mobileMaxHeight;
            translateY.value = withTiming(0, { duration: 260 });
        }
    }, [visible, mobileMaxHeight, translateY]);

    const cardAnimatedStyle = useAnimatedStyle(() => ({
        // Desktop path skips the translation so the centered card just
        // fades with RN's fade animationType.
        transform: isMobile ? [{ translateY: translateY.value }] : [],
    }));

    // Backdrop opacity tracks 1 - (translateY / mobileMaxHeight) so the
    // dim layer fades together with the sheet. Clamp the result to [0, 1]
    // — withSpring can briefly overshoot translateY, which would otherwise
    // tint the backdrop into negative opacity territory.
    const backdropAnimatedStyle = useAnimatedStyle(() => {
        if (!isMobile) return {};
        const progress = 1 - Math.min(1, Math.max(0, translateY.value / mobileMaxHeight));
        return { opacity: progress };
    });

    // Centralized close path. ALL close routes funnel through this — the X
    // button, Cancel button, backdrop tap, Android back, swipe-to-dismiss,
    // and successful submit. The optional onDone callback fires after the
    // exit animation completes (used by success path to defer router.push
    // until the sheet has visually slid away).
    const closeOnJs = React.useCallback(
        (onDone?: () => void) => {
            onClose();
            onDone?.();
        },
        [onClose],
    );

    const requestClose = React.useCallback(
        (onDone?: () => void) => {
            if (isClosingRef.current) return;
            isClosingRef.current = true;
            if (!isMobile) {
                // Desktop: no slide. RN's fade animationType handles the
                // visual transition; just invoke close.
                onClose();
                onDone?.();
                return;
            }
            translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
                runOnJS(closeOnJs)(onDone);
            });
        },
        [isMobile, mobileMaxHeight, onClose, closeOnJs, translateY],
    );

    // Threshold rules for swipe-to-dismiss: dragged more than 1/3 of the
    // sheet OR a strong downward fling (velocity > 800 px/s) commits
    // dismissal. Otherwise spring back to the resting position.
    const SWIPE_DISMISS_DISTANCE = mobileMaxHeight / 3;
    const SWIPE_DISMISS_VELOCITY = 800;

    const panGesture = React.useMemo(
        () =>
            Gesture.Pan()
                .enabled(isMobile && !submitting)
                .onUpdate((e) => {
                    // Only allow downward drag; upward motion is clamped to 0
                    // so the sheet can't be lifted past its resting position.
                    translateY.value = Math.max(0, e.translationY);
                })
                .onEnd((e) => {
                    const shouldClose =
                        e.translationY > SWIPE_DISMISS_DISTANCE ||
                        e.velocityY > SWIPE_DISMISS_VELOCITY;
                    if (shouldClose) {
                        // Same slide-out as requestClose so the gesture
                        // path and tap paths look identical at the end.
                        isClosingRef.current = true;
                        translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
                            runOnJS(closeOnJs)();
                        });
                    } else {
                        translateY.value = withSpring(0, {
                            damping: 20,
                            stiffness: 220,
                        });
                    }
                }),
        [isMobile, submitting, mobileMaxHeight, SWIPE_DISMISS_DISTANCE, translateY, closeOnJs],
    );

    return (
        <RNModal
            visible={visible}
            transparent
            // We own every transition; RN's slide would double-animate the
            // entry and snap the exit. Desktop still uses fade since it
            // doesn't translate the card.
            animationType={isMobile ? "none" : "fade"}
            onRequestClose={submitting ? undefined : () => requestClose()}
            statusBarTranslucent
        >
            {/* RN Modal portals into a separate native window outside the
                app's GestureHandlerRootView, so the GestureDetector
                wouldn't pick up events without our own root here. */}
            <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardAvoidingView
                style={[
                    styles.overlay,
                    isMobile ? styles.overlayMobile : styles.overlayDesktop,
                ]}
                behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
            >
                {/* Dim layer behind the card — tapping it closes the modal.
                    Mobile uses Animated.View so opacity tracks the sheet
                    position (1 when sheet is up, 0 when fully slid down). */}
                <AnimatedPressable
                    style={[styles.backdrop, isMobile && backdropAnimatedStyle]}
                    onPress={submitting ? undefined : () => requestClose()}
                    accessibilityLabel="Close"
                />

                <Animated.View
                    style={[
                        styles.card,
                        isMobile ? styles.cardMobile : styles.cardDesktop,
                        { maxHeight: cardMaxHeight },
                        isMobile && cardAnimatedStyle,
                    ]}
                >
                    {/* Pan-gesture region: only the handle + header
                        participate. Wrapping the ScrollView would hijack
                        scroll; wrapping the inputs would block keyboard
                        focus and text selection. The handle is the
                        canonical bottom-sheet grab target. */}
                    <GestureDetector gesture={panGesture}>
                        <View>
                            {/* Mobile grab handle (visual + gesture target). */}
                            {isMobile ? (
                                <View style={styles.grabHandleWrap}>
                                    <View style={styles.grabHandle} />
                                </View>
                            ) : null}

                            {/* Header: title + close (X) button. */}
                            <View style={styles.headerRow}>
                                <View style={styles.titleColumn}>
                                    <Text style={styles.title}>{t("workflows.recurringModalTitle")}</Text>
                                    <Text style={styles.subtitle}>{t("workflows.recurringModalSubtitle")}</Text>
                                </View>
                                <Pressable
                                    style={styles.closeButton}
                                    onPress={submitting ? undefined : () => requestClose()}
                                    hitSlop={8}
                                    accessibilityLabel="Close"
                                >
                                    <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                                </Pressable>
                            </View>
                        </View>
                    </GestureDetector>

                    {/* Scrollable form area. */}
                    <ScrollView
                        style={styles.scrollArea}
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                    >
                        <View style={styles.info}>
                            <Ionicons
                                name="information-circle"
                                size={16}
                                color={theme.colors.accentOrange}
                            />
                            <Text style={styles.infoText}>{t("workflows.recurringModalInfo")}</Text>
                        </View>

                        <View>
                            <Text style={styles.sectionLabel}>{t("workflows.recurringScheduleLabel")}</Text>
                            <View style={[styles.presetGrid, { marginTop: 6 }]}>
                                {CRON_PRESETS.map((p) => (
                                    <PresetChip
                                        key={p.id}
                                        label={p.labelKey()}
                                        active={presetId === p.id}
                                        onPress={() => setPresetId(p.id)}
                                    />
                                ))}
                                <PresetChip
                                    label={t("workflows.recurringCronCustom")}
                                    active={presetId === "custom"}
                                    onPress={() => setPresetId("custom")}
                                />
                            </View>
                            {presetId === "custom" ? (
                                <TextInput
                                    style={[styles.input, { marginTop: 8 }]}
                                    value={customCron}
                                    onChangeText={setCustomCron}
                                    placeholder="0 2 * * *"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            ) : null}
                        </View>

                        <View>
                            <Text style={styles.sectionLabel}>{t("workflows.recurringPromptLabel")}</Text>
                            <TextInput
                                style={[styles.input, styles.promptInput, { marginTop: 6 }]}
                                value={prompt}
                                onChangeText={setPrompt}
                                multiline
                                placeholder={t("workflows.recurringPromptPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                            />
                        </View>
                    </ScrollView>

                    {/* Sticky footer — always reachable. */}
                    <View style={[styles.footer, { paddingBottom: footerPaddingBottom }]}>
                        <Pressable
                            style={[styles.button, styles.buttonCancel]}
                            onPress={() => requestClose()}
                            disabled={submitting}
                        >
                            <Text style={[styles.buttonText, styles.buttonTextCancel]}>
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[
                                styles.button,
                                valid && !submitting ? styles.buttonPrimary : styles.buttonPrimaryDisabled,
                            ]}
                            onPress={handleConfirm}
                            disabled={!valid || submitting}
                        >
                            {submitting ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                            ) : (
                                <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                                    {t("workflows.recurringCreate")}
                                </Text>
                            )}
                        </Pressable>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
            </GestureHandlerRootView>
        </RNModal>
    );
});

function PresetChip({
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
                styles.presetChip,
                active && styles.presetChipActive,
                isHovered && !active && { backgroundColor: "rgba(0,0,0,0.04)" },
            ]}
        >
            <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{label}</Text>
        </Pressable>
    );
}
