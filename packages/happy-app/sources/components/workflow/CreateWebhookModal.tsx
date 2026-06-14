/**
 * CreateWebhookModal — standalone creator for Event-driven Workflows
 * (WebhookTrigger). Shell, animation, gestures owned by <BottomSheet>;
 * this file only owns the slug/secret form and the two-phase
 * create → secret-reveal flow.
 */

import * as React from "react";
import { View, TextInput, ActivityIndicator, Pressable } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Modal as AlertModal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { createWebhookTrigger } from "@/sync/apiWebhookTriggers";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines } from "@/sync/storage";
import { BottomSheet, BottomSheetHandle, PresetChip } from "@/components/BottomSheet";

interface CreateWebhookModalProps {
    visible: boolean;
    onClose: () => void;
}

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

const styles = StyleSheet.create((theme) => ({
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
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
    secretBox: {
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        gap: 8,
    },
    secretValue: {
        fontFamily: "Menlo",
        fontSize: 12,
        color: theme.colors.text,
        flex: 1,
    },
    secretCopyButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.button.primary.background,
        ...webInteractive,
    },
    secretCopyText: {
        fontSize: 12,
        color: theme.colors.button.primary.tint,
        ...Typography.default("semiBold"),
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
    buttonCancel: { backgroundColor: theme.colors.surfaceHigh },
    buttonPrimary: { backgroundColor: theme.colors.button.primary.background },
    buttonPrimaryDisabled: { backgroundColor: theme.colors.surfaceHigh },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
    buttonTextCancel: { color: theme.colors.textSecondary },
}));

export const CreateWebhookModal = React.memo(function CreateWebhookModal({
    visible,
    onClose,
}: CreateWebhookModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);

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
    const valid =
        pickedMachineId.length > 0 && slug.length > 0 && prompt.trim().length > 0;

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

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            busy={submitting}
            title={
                createdSecret
                    ? t("workflows.webhookCreatedTitle")
                    : t("workflows.webhookModalTitle")
            }
            subtitle={
                createdSecret
                    ? t("workflows.webhookCreatedSubtitle")
                    : t("workflows.webhookModalSubtitle")
            }
            desktopMaxHeightFraction={0.85}
            footer={
                createdSecret ? (
                    <Pressable
                        style={[styles.button, styles.buttonPrimary]}
                        onPress={() => sheetRef.current?.requestClose()}
                    >
                        <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                            {t("workflows.webhookDoneButton")}
                        </Text>
                    </Pressable>
                ) : (
                    <>
                        <Pressable
                            style={[styles.button, styles.buttonCancel]}
                            onPress={() => sheetRef.current?.requestClose()}
                            disabled={submitting}
                        >
                            <Text style={[styles.buttonText, styles.buttonTextCancel]}>
                                {t("common.cancel")}
                            </Text>
                        </Pressable>
                        <Pressable
                            style={[
                                styles.button,
                                valid && !submitting
                                    ? styles.buttonPrimary
                                    : styles.buttonPrimaryDisabled,
                            ]}
                            onPress={handleConfirm}
                            disabled={!valid || submitting}
                        >
                            {submitting ? (
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.button.primary.tint}
                                />
                            ) : (
                                <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                                    {t("workflows.recurringCreate")}
                                </Text>
                            )}
                        </Pressable>
                    </>
                )
            }
        >
            {createdSecret ? (
                <SecretReveal slug={createdSlug || slug} secret={createdSecret} />
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
        </BottomSheet>
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
                <Ionicons
                    name="information-circle"
                    size={16}
                    color={theme.colors.accentOrange}
                />
                <Text style={styles.infoText}>{t("workflows.webhookModalInfo")}</Text>
            </View>

            <View>
                <Text style={styles.sectionLabel}>{t("workflows.sectionMachine")}</Text>
                {machines.length === 0 ? (
                    <Text
                        style={[
                            styles.infoText,
                            { color: theme.colors.warning, marginTop: 6 },
                        ]}
                    >
                        {t("workflows.standaloneNoMachine")}
                    </Text>
                ) : (
                    <View style={styles.presetGrid}>
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
                    <Text style={styles.secretValue} selectable numberOfLines={2}>
                        {secret}
                    </Text>
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
