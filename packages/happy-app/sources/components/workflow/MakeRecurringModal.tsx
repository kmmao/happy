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
 * UX:
 *  - Preset cron buttons (Hourly / Daily 02:00 / Weekly Mon 09:00) + Custom
 *  - Prompt prefilled from the Session's latest user message or summary
 *  - Confirm → call createTriggerSchedule → navigate to the new Workflow
 */

import * as React from "react";
import { View, Pressable, TextInput, ActivityIndicator } from "react-native";
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
import type { Session } from "@/sync/storageTypes";

interface MakeRecurringModalProps {
    session: Session;
    visible: boolean;
    onClose: () => void;
}

const CRON_PRESETS: Array<{ id: string; label: string; expr: string }> = [
    { id: "hourly", label: "Every hour", expr: "0 * * * *" },
    { id: "daily", label: "Every day at 02:00", expr: "0 2 * * *" },
    { id: "weekday", label: "Weekdays 09:00", expr: "0 9 * * 1-5" },
    { id: "weekly", label: "Weekly Monday 09:00", expr: "0 9 * * 1" },
];

const styles = StyleSheet.create((theme) => ({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 16,
    },
    card: {
        width: "100%",
        maxWidth: 520,
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
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
    actionsRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4,
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

export const MakeRecurringModal = React.memo(function MakeRecurringModal({
    session,
    visible,
    onClose,
}: MakeRecurringModalProps) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [presetId, setPresetId] = React.useState<string>("daily");
    const [customCron, setCustomCron] = React.useState<string>("");
    const [prompt, setPrompt] = React.useState<string>("");
    const [submitting, setSubmitting] = React.useState(false);

    // Reset state every time the modal is shown — closing leaves the inputs
    // for a moment during the animation, but reopening should always pick
    // up the freshest Session prefill.
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
            // Navigate to the newly-created Workflow page so the user
            // immediately sees their handiwork.
            router.push(`/workflow/${encodeURIComponent(`scheduled:${trigger.id}`)}` as any);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Modal.alert("Couldn't create schedule", message);
            setSubmitting(false);
        }
    };

    return (
        <View style={styles.backdrop}>
            <View style={styles.card}>
                <Text style={styles.title}>Make this recurring</Text>
                <Text style={styles.subtitle}>
                    Create a scheduled workflow that runs this conversation's prompt on a cron.
                </Text>

                <View style={styles.info}>
                    <Ionicons name="information-circle" size={16} color={theme.colors.accentOrange} />
                    <Text style={styles.infoText}>
                        This creates a new Scheduled Workflow with the same prompt and
                        directory. The current Session stays as-is; each fire starts a
                        fresh Session (true in-place adoption requires a CLI update).
                    </Text>
                </View>

                <View>
                    <Text style={styles.sectionLabel}>Schedule</Text>
                    <View style={[styles.presetGrid, { marginTop: 6 }]}>
                        {CRON_PRESETS.map((p) => (
                            <PresetChip
                                key={p.id}
                                label={p.label}
                                active={presetId === p.id}
                                onPress={() => setPresetId(p.id)}
                            />
                        ))}
                        <PresetChip
                            label="Custom cron…"
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
                    <Text style={styles.sectionLabel}>Prompt</Text>
                    <TextInput
                        style={[styles.input, styles.promptInput, { marginTop: 6 }]}
                        value={prompt}
                        onChangeText={setPrompt}
                        multiline
                        placeholder="What should run each time?"
                        placeholderTextColor={theme.colors.textSecondary}
                    />
                </View>

                <View style={styles.actionsRow}>
                    <Pressable
                        style={[styles.button, styles.buttonCancel]}
                        onPress={onClose}
                        disabled={submitting}
                    >
                        <Text style={[styles.buttonText, styles.buttonTextCancel]}>Cancel</Text>
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
                            <Text style={[styles.buttonText, styles.buttonTextPrimary]}>Create</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </View>
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
