/**
 * CreateWebhookModal — standalone creator for Event-driven Workflows
 * (WebhookTrigger). Mirrors MakeRecurringModal's shape: same bottom-
 * sheet / swipe-down / portal architecture, same machine picker pattern,
 * but the form swaps the cron presets for a slug input + secret display.
 *
 * Flow:
 *   1. User enters slug (URL-safe ID; we apply a friendly sanitizer)
 *   2. Picks target Machine (default: first online)
 *   3. Writes the prompt
 *   4. Submit → createWebhookTrigger → server returns secret ONCE
 *   5. Show the secret in a copyable confirmation view inside the same
 *      sheet (user must record it; the secret hash on the server can be
 *      regenerated but the plaintext is never re-shown).
 *   6. "Done" closes; the new Event Workflow appears in the list.
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
import * as Clipboard from "expo-clipboard";
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
import { TokenStorage } from "@/auth/tokenStorage";
import { createWebhookTrigger } from "@/sync/apiWebhookTriggers";
import {
    useWebHoverProps,
    webInteractive,
} from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines } from "@/sync/storage";

interface CreateWebhookModalProps {
    visible: boolean;
    onClose: () => void;
}

const MOBILE_BREAKPOINT = 540;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
        maxWidth: 520,
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
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    presetChip: {
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
        borderWidth: 0.5, borderColor: theme.colors.divider,
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
    presetChipTextActive: { color: theme.colors.accentBlue },
    input: {
        borderWidth: 1, borderColor: theme.colors.divider,
        borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10,
        fontSize: 14, color: theme.colors.text,
        backgroundColor: theme.colors.input?.background ?? theme.colors.groupped.background,
        fontFamily: "Menlo",
    },
    promptInput: {
        minHeight: 96, textAlignVertical: "top",
        fontFamily: "System", fontSize: 14,
    },
    info: {
        flexDirection: "row", alignItems: "flex-start", gap: 8,
        padding: 10, backgroundColor: `${theme.colors.accentOrange}14`,
        borderRadius: 8,
    },
    infoText: {
        flex: 1, fontSize: 12, color: theme.colors.text,
        ...Typography.default(), lineHeight: 17,
    },
    secretBox: {
        padding: 12, borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        gap: 8,
    },
    secretValue: {
        fontFamily: "Menlo", fontSize: 12,
        color: theme.colors.text,
        flex: 1,
    },
    secretRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    secretCopyButton: {
        flexDirection: "row", alignItems: "center", gap: 4,
        paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6,
        backgroundColor: theme.colors.button.primary.background,
        ...webInteractive,
    },
    secretCopyText: {
        fontSize: 12, color: theme.colors.button.primary.tint,
        ...Typography.default("semiBold"),
    },
    footer: {
        flexDirection: "row", justifyContent: "flex-end", gap: 10,
        paddingHorizontal: 20, paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    button: {
        paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
        minWidth: 88, alignItems: "center", justifyContent: "center",
        ...webInteractive,
    },
    buttonCancel: { backgroundColor: theme.colors.surfaceHigh },
    buttonPrimary: { backgroundColor: theme.colors.button.primary.background },
    buttonPrimaryDisabled: { backgroundColor: theme.colors.surfaceHigh },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
    buttonTextCancel: { color: theme.colors.textSecondary },
}));

// URL-safe slug: lowercase, alphanumeric + dash, no consecutive dashes
// or leading/trailing dashes. Server still validates so this is a
// friendliness layer, not security.
function sanitizeSlug(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "");
}

export const CreateWebhookModal = React.memo(function CreateWebhookModal({
    visible,
    onClose,
}: CreateWebhookModalProps) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const isMobile = viewportWidth < MOBILE_BREAKPOINT;

    const machines = useAllMachines();
    const [pickedMachineId, setPickedMachineId] = React.useState<string>("");
    const [slugRaw, setSlugRaw] = React.useState("");
    const [prompt, setPrompt] = React.useState("");
    const [name, setName] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);
    // After successful creation we transition the same sheet into a
    // "secret reveal" view rather than closing immediately.
    const [createdSecret, setCreatedSecret] = React.useState<string | null>(null);
    const [createdSlug, setCreatedSlug] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!visible) return;
        setPickedMachineId(machines[0]?.id ?? "");
        setSlugRaw("");
        setPrompt("");
        setName("");
        setSubmitting(false);
        setCreatedSecret(null);
        setCreatedSlug(null);
    }, [visible, machines]);

    const slug = sanitizeSlug(slugRaw);
    const valid = pickedMachineId.length > 0 && slug.length > 0 && prompt.trim().length > 0;

    const handleConfirm = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error("Not authenticated");
            const result = await createWebhookTrigger(credentials, {
                machineId: pickedMachineId,
                slug,
                prompt: prompt.trim(),
                name: name.trim() || undefined,
            });
            setCreatedSecret(result.secret);
            setCreatedSlug(result.webhookTrigger.slug);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AlertModal.alert(t("workflows.webhookErrorTitle"), message);
            setSubmitting(false);
        }
    };

    // --- Sheet animation (same shape as MakeRecurringModal) ---
    const mobileMaxHeight = Math.floor(viewportHeight * 0.9);
    const desktopMaxHeight = Math.min(700, Math.floor(viewportHeight * 0.85));
    const cardMaxHeight = isMobile ? mobileMaxHeight : desktopMaxHeight;
    const footerPaddingBottom = (isMobile ? insets.bottom : 14) || 14;

    const translateY = useSharedValue(mobileMaxHeight);
    const isClosingRef = React.useRef(false);

    React.useEffect(() => {
        if (visible) {
            isClosingRef.current = false;
            translateY.value = mobileMaxHeight;
            translateY.value = withTiming(0, { duration: 260 });
        }
    }, [visible, mobileMaxHeight, translateY]);

    const cardAnimatedStyle = useAnimatedStyle(() => ({
        transform: isMobile ? [{ translateY: translateY.value }] : [],
    }));
    const backdropAnimatedStyle = useAnimatedStyle(() => {
        if (!isMobile) return {};
        const progress = 1 - Math.min(1, Math.max(0, translateY.value / mobileMaxHeight));
        return { opacity: progress };
    });

    const closeOnJs = React.useCallback(() => onClose(), [onClose]);
    const requestClose = React.useCallback(() => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;
        if (!isMobile) {
            onClose();
            return;
        }
        translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
            runOnJS(closeOnJs)();
        });
    }, [isMobile, mobileMaxHeight, onClose, closeOnJs, translateY]);

    const SWIPE_DISTANCE = mobileMaxHeight / 3;
    const panGesture = React.useMemo(
        () =>
            Gesture.Pan()
                .enabled(isMobile && !submitting)
                .onUpdate((e) => { translateY.value = Math.max(0, e.translationY); })
                .onEnd((e) => {
                    if (e.translationY > SWIPE_DISTANCE || e.velocityY > 800) {
                        isClosingRef.current = true;
                        translateY.value = withTiming(mobileMaxHeight, { duration: 220 }, () => {
                            runOnJS(closeOnJs)();
                        });
                    } else {
                        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
                    }
                }),
        [isMobile, submitting, mobileMaxHeight, SWIPE_DISTANCE, translateY, closeOnJs],
    );

    return (
        <RNModal
            visible={visible}
            transparent
            animationType={isMobile ? "none" : "fade"}
            onRequestClose={submitting ? undefined : () => requestClose()}
            statusBarTranslucent
        >
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardAvoidingView
                    style={[styles.overlay, isMobile ? styles.overlayMobile : styles.overlayDesktop]}
                    behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
                >
                    <AnimatedPressable
                        style={[styles.backdrop, isMobile && backdropAnimatedStyle]}
                        onPress={submitting ? undefined : () => requestClose()}
                    />
                    <Animated.View
                        style={[
                            styles.card,
                            isMobile ? styles.cardMobile : styles.cardDesktop,
                            { maxHeight: cardMaxHeight },
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
                                        <Text style={styles.title}>
                                            {createdSecret ? t("workflows.webhookCreatedTitle") : t("workflows.webhookModalTitle")}
                                        </Text>
                                        <Text style={styles.subtitle}>
                                            {createdSecret ? t("workflows.webhookCreatedSubtitle") : t("workflows.webhookModalSubtitle")}
                                        </Text>
                                    </View>
                                    <Pressable
                                        style={styles.closeButton}
                                        onPress={submitting ? undefined : () => requestClose()}
                                        hitSlop={8}
                                    >
                                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                                    </Pressable>
                                </View>
                            </View>
                        </GestureDetector>

                        <ScrollView
                            style={styles.scrollArea}
                            contentContainerStyle={styles.scrollContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            {createdSecret ? (
                                <SecretReveal
                                    slug={createdSlug || slug}
                                    secret={createdSecret}
                                />
                            ) : (
                                <CreateForm
                                    machines={machines}
                                    pickedMachineId={pickedMachineId}
                                    setPickedMachineId={setPickedMachineId}
                                    slugRaw={slugRaw}
                                    setSlugRaw={setSlugRaw}
                                    slug={slug}
                                    name={name}
                                    setName={setName}
                                    prompt={prompt}
                                    setPrompt={setPrompt}
                                />
                            )}
                        </ScrollView>

                        <View style={[styles.footer, { paddingBottom: footerPaddingBottom }]}>
                            {createdSecret ? (
                                <Pressable
                                    style={[styles.button, styles.buttonPrimary]}
                                    onPress={() => requestClose()}
                                >
                                    <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                                        {t("workflows.webhookDoneButton")}
                                    </Text>
                                </Pressable>
                            ) : (
                                <>
                                    <Pressable
                                        style={[styles.button, styles.buttonCancel]}
                                        onPress={() => requestClose()}
                                        disabled={submitting}
                                    >
                                        <Text style={[styles.buttonText, styles.buttonTextCancel]}>{t("common.cancel")}</Text>
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
                                </>
                            )}
                        </View>
                    </Animated.View>
                </KeyboardAvoidingView>
            </GestureHandlerRootView>
        </RNModal>
    );
});

function CreateForm({
    machines,
    pickedMachineId,
    setPickedMachineId,
    slugRaw,
    setSlugRaw,
    slug,
    name,
    setName,
    prompt,
    setPrompt,
}: any) {
    const { theme } = useUnistyles();
    return (
        <>
            <View style={styles.info}>
                <Ionicons name="information-circle" size={16} color={theme.colors.accentOrange} />
                <Text style={styles.infoText}>{t("workflows.webhookModalInfo")}</Text>
            </View>

            <View>
                <Text style={styles.sectionLabel}>{t("workflows.sectionMachine")}</Text>
                {machines.length === 0 ? (
                    <Text style={[styles.infoText, { color: theme.colors.warning, marginTop: 6 }]}>
                        {t("workflows.standaloneNoMachine")}
                    </Text>
                ) : (
                    <View style={[styles.presetGrid, { marginTop: 6 }]}>
                        {machines.map((m: any) => (
                            <PresetChip
                                key={m.id}
                                label={m.metadata?.displayName || m.metadata?.host || m.id}
                                active={pickedMachineId === m.id}
                                onPress={() => setPickedMachineId(m.id)}
                            />
                        ))}
                    </View>
                )}
            </View>

            <View>
                <Text style={styles.sectionLabel}>{t("workflows.webhookSlugLabel")}</Text>
                <TextInput
                    style={[styles.input, { marginTop: 6 }]}
                    value={slugRaw}
                    onChangeText={setSlugRaw}
                    placeholder={t("workflows.webhookSlugPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {slugRaw !== slug && slug ? (
                    <Text style={[styles.infoText, { marginTop: 4 }]}>
                        {t("workflows.webhookSlugSanitized", slug)}
                    </Text>
                ) : null}
            </View>

            <View>
                <Text style={styles.sectionLabel}>{t("workflows.webhookNameLabel")}</Text>
                <TextInput
                    style={[styles.input, { marginTop: 6, fontFamily: "System" }]}
                    value={name}
                    onChangeText={setName}
                    placeholder={t("workflows.webhookNamePlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
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
        </>
    );
}

function SecretReveal({ slug, secret }: { slug: string; secret: string }) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);
    const copyAll = async () => {
        await Clipboard.setStringAsync(secret);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <>
            <View style={styles.info}>
                <Ionicons name="warning" size={16} color={theme.colors.warning} />
                <Text style={styles.infoText}>{t("workflows.webhookSecretWarning")}</Text>
            </View>
            <View>
                <Text style={styles.sectionLabel}>{t("workflows.webhookSlugLabel")}</Text>
                <Text style={[styles.secretValue, { marginTop: 6 }]}>{slug}</Text>
            </View>
            <View>
                <Text style={styles.sectionLabel}>{t("workflows.webhookSecretLabel")}</Text>
                <View style={[styles.secretBox, { marginTop: 6 }]}>
                    <View style={styles.secretRow}>
                        <Text style={styles.secretValue} selectable numberOfLines={2}>
                            {secret}
                        </Text>
                    </View>
                    <Pressable style={styles.secretCopyButton} onPress={copyAll}>
                        <Ionicons
                            name={copied ? "checkmark" : "copy-outline"}
                            size={14}
                            color={theme.colors.button.primary.tint}
                        />
                        <Text style={styles.secretCopyText}>
                            {copied ? t("common.copied") : t("common.copy")}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </>
    );
}

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
