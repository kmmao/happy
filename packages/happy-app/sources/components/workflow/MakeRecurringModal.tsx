/**
 * MakeRecurringModal — Phase 2 promote action of the Workflow IA.
 *
 * "create-similar" semantics: this modal creates a NEW TriggerSchedule
 * carrying the current Session's prompt and directory. It does NOT
 * server-side bind the existing Session — true adoption (next fire reuses
 * this Session via the GuardianSessionRegistry) requires the CLI to
 * support a `happySessionId` hint on the `task-trigger` ephemeral, which
 * is gated on a coordinated cli/agent release. Once that lands, this
 * modal can flip to the real adopt path with no UI change.
 *
 * Mobile-friendly layout: backdrop pins the card to the bottom on small
 * viewports so the on-screen keyboard doesn't cover it; card content is
 * scrollable so the Cancel/Create row stays reachable when prompt + cron
 * presets push the layout taller than the viewport. The Cancel/Create
 * footer is sticky outside the ScrollView so it's always tappable.
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
    useWindowDimensions,
} from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Modal } from "@/modal";
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

const styles = StyleSheet.create((theme) => ({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
    },
    backdropMobile: {
        // On narrow viewports, pin the card to the bottom (like a bottom
        // sheet) so it never gets covered by a tiny keyboard pop.
        justifyContent: "flex-end",
        alignItems: "stretch",
    },
    card: {
        width: "100%",
        maxWidth: 520,
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        overflow: "hidden",
        flexDirection: "column",
    },
    cardMobile: {
        // Full width on mobile, rounded only at the top.
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
    },
    scrollArea: {
        // Internal scroll area takes the rest of the card after the footer
        // is laid out. Caps at the viewport so the footer is always visible.
        flexShrink: 1,
    },
    scrollContent: {
        padding: 20,
        gap: 16,
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
        fontSize: 12,
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
        paddingVertical: 8,
        fontSize: 13,
        color: theme.colors.text,
        backgroundColor: theme.colors.input?.background ?? theme.colors.groupped.background,
        fontFamily: "Menlo",
    },
    promptInput: {
        minHeight: 96,
        textAlignVertical: "top",
        fontFamily: "System",
        fontSize: 13,
    },
    footer: {
        // Sticky footer outside the ScrollView so Cancel/Create stays
        // reachable however tall the form gets.
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 8,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    button: {
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 8,
        ...webInteractive,
    },
    buttonCancel: {
        backgroundColor: "transparent",
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
}));

const MOBILE_BREAKPOINT = 540;

export const MakeRecurringModal = React.memo(function MakeRecurringModal({
    session,
    visible,
    onClose,
}: MakeRecurringModalProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
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

    if (!visible) return null;

    const cronExpression =
        presetId === "custom"
            ? customCron.trim()
            : CRON_PRESETS.find((p) => p.id === presetId)?.expr ?? "";

    const machineId = session.metadata?.machineId ?? "";
    const directory = session.metadata?.path ?? "";

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
            Modal.alert(t("workflows.recurringErrorTitle"), message);
            setSubmitting(false);
        }
    };

    // Cap card height to leave room for OS status bar / keyboard.
    const cardMaxHeight = Math.floor(viewportHeight * (isMobile ? 0.9 : 0.85));

    return (
        <KeyboardAvoidingView
            style={[styles.backdrop, isMobile && styles.backdropMobile]}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            pointerEvents="box-none"
        >
            {/* Tapping the dim backdrop dismisses the modal. */}
            <Pressable
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                onPress={submitting ? undefined : onClose}
            />
            <View
                style={[
                    styles.card,
                    isMobile && styles.cardMobile,
                    { maxHeight: cardMaxHeight },
                ]}
            >
                <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text style={styles.title}>{t("workflows.recurringModalTitle")}</Text>
                    <Text style={styles.subtitle}>{t("workflows.recurringModalSubtitle")}</Text>

                    <View style={styles.info}>
                        <Ionicons name="information-circle" size={16} color={theme.colors.accentOrange} />
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

                <View style={styles.footer}>
                    <Pressable
                        style={[styles.button, styles.buttonCancel]}
                        onPress={onClose}
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
                            <Text style={[styles.buttonText, styles.buttonTextPrimary]}>{t("workflows.recurringCreate")}</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </KeyboardAvoidingView>
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
