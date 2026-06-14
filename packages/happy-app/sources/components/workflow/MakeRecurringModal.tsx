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

            onClose();
            router.push(`/workflow/${encodeURIComponent(`scheduled:${trigger.id}`)}` as any);
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

    // --- Swipe-to-dismiss (mobile only) -----------------------------------
    // We track translateY on the card so the user can drag it down with
    // their finger. Release triggers either a spring-back-to-zero (cancel)
    // or a slide-out-and-close (commit). The pan gesture is attached only
    // to the grab handle + header — the form's ScrollView and inputs
    // deliberately don't participate to avoid hijacking scroll / text
    // selection.
    const translateY = useSharedValue(0);

    // Reset translateY whenever the modal re-opens (otherwise a closed-and-
    // reopened sheet would briefly render in its previous dragged-down
    // position before RN's slide animation kicks in).
    React.useEffect(() => {
        if (visible) {
            translateY.value = 0;
        }
    }, [visible, translateY]);

    const cardAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    const closeOnJs = React.useCallback(() => {
        onClose();
    }, [onClose]);

    // Threshold rules: dragged more than 1/3 of the sheet OR a strong
    // downward fling (velocity > 800 px/s) commits dismissal. Otherwise
    // spring back to the resting position.
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
                        // Slide the sheet off-screen then trigger close on JS
                        // thread (RN Modal's own animationType=slide will
                        // hide the rest; we just need to make sure the user
                        // sees a smooth exit instead of a snap-back-then-
                        // disappear).
                        translateY.value = withTiming(mobileMaxHeight, { duration: 180 }, () => {
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
            animationType={isMobile ? "slide" : "fade"}
            onRequestClose={submitting ? undefined : onClose}
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
                {/* Dim layer behind the card — tapping it closes the modal. */}
                <Pressable
                    style={styles.backdrop}
                    onPress={submitting ? undefined : onClose}
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
                                    onPress={submitting ? undefined : onClose}
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
                            onPress={onClose}
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
