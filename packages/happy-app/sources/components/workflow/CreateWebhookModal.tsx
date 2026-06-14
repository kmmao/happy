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
import { getServerUrl } from "@/sync/serverConfig";
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

/**
 * Source presets — clicking a chip fills slug + prompt with sensible
 * defaults for the most common integrations. `custom` is the escape
 * hatch (no defaults, full manual fill). The presets only auto-fill
 * when the field is empty or the user previously tapped a different
 * preset; user edits are never overwritten.
 */
type SourcePresetKey = "github" | "linear" | "zapier" | "custom";

interface SourcePreset {
    key: SourcePresetKey;
    labelKey:
        | "workflows.webhookSourceGithub"
        | "workflows.webhookSourceLinear"
        | "workflows.webhookSourceZapier"
        | "workflows.webhookSourceCustom";
    slugDefault: string;
    promptKey:
        | "workflows.webhookSourceGithubPrompt"
        | "workflows.webhookSourceLinearPrompt"
        | "workflows.webhookSourceZapierPrompt"
        | null;
}

const SOURCE_PRESETS: ReadonlyArray<SourcePreset> = [
    {
        key: "github",
        labelKey: "workflows.webhookSourceGithub",
        slugDefault: "github-event",
        promptKey: "workflows.webhookSourceGithubPrompt",
    },
    {
        key: "linear",
        labelKey: "workflows.webhookSourceLinear",
        slugDefault: "linear-issue",
        promptKey: "workflows.webhookSourceLinearPrompt",
    },
    {
        key: "zapier",
        labelKey: "workflows.webhookSourceZapier",
        slugDefault: "zapier-event",
        promptKey: "workflows.webhookSourceZapierPrompt",
    },
    {
        key: "custom",
        labelKey: "workflows.webhookSourceCustom",
        slugDefault: "",
        promptKey: null,
    },
];

const styles = StyleSheet.create((theme) => ({
    sectionLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
    crossPointer: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: `${theme.colors.textLink}14`,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: `${theme.colors.textLink}33`,
    },
    crossPointerText: {
        flex: 1,
        fontSize: 11,
        color: theme.colors.text,
        lineHeight: 15,
        ...Typography.default(),
    },
    helperText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        lineHeight: 16,
        marginTop: 6,
        ...Typography.default(),
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
    // ── Pre-create flow preview (Section A) ────────────────────────────
    flowToggle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        ...webInteractive,
    },
    flowToggleText: {
        fontSize: 13,
        color: theme.colors.textLink,
        ...Typography.default("semiBold"),
    },
    flowDiagramRow: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 6,
        marginTop: 8,
    },
    flowStage: {
        flex: 1,
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 8,
        padding: 10,
        gap: 4,
    },
    flowStageLabel: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.2,
        ...Typography.default("semiBold"),
    },
    flowStageTitle: {
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    flowStageBody: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        lineHeight: 15,
        ...Typography.default(),
    },
    flowArrow: {
        alignSelf: "center",
    },
    flowResultRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
        paddingHorizontal: 4,
    },
    flowResultText: {
        flex: 1,
        fontSize: 11,
        color: theme.colors.textSecondary,
        lineHeight: 15,
        ...Typography.default(),
    },
    // ── Secret-reveal "how to use" (Section B) ─────────────────────────
    publicUrlBox: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        gap: 6,
    },
    publicUrlValue: {
        fontFamily: "Menlo",
        fontSize: 12,
        color: theme.colors.text,
        flex: 1,
    },
    curlBlock: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 6,
    },
    curlText: {
        fontFamily: "Menlo",
        fontSize: 11,
        color: theme.colors.text,
        lineHeight: 16,
    },
    integrationHint: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
        marginTop: 4,
    },
    integrationHintIcon: {
        marginTop: 2,
    },
    integrationHintText: {
        flex: 1,
        fontSize: 11,
        color: theme.colors.textSecondary,
        lineHeight: 15,
        ...Typography.default(),
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
    // Section A — fold-out flow preview ("what happens after firing?"),
    // closed by default so it doesn't dominate first-time use but is one
    // tap away when users want to understand the lifecycle.
    const [flowOpen, setFlowOpen] = React.useState(false);
    // Source preset selection — purely UI hint; the chip click prefills
    // slug + prompt, but the underlying state stays slug/prompt only so
    // the user is free to keep editing afterwards.
    const [pickedSource, setPickedSource] = React.useState<SourcePresetKey | null>(null);

    // Reset form state only on a fresh open (false → true transition).
    // Without the ref guard, the effect re-fires whenever `machines`
    // changes — which happens every ~60s from machine heartbeats — and
    // wipes everything the user has typed mid-edit. The auto machine-
    // pick below picks up the slack when machines load after the modal
    // is already open.
    const wasVisible = React.useRef(visible);
    React.useEffect(() => {
        if (visible && !wasVisible.current) {
            setPickedMachineId(machines[0]?.id ?? "");
            setSlugRaw("");
            setPrompt("");
            setName("");
            setSubmitting(false);
            setCreatedSecret(null);
            setCreatedSlug(null);
            setFlowOpen(false);
            setPickedSource(null);
        }
        wasVisible.current = visible;
    });

    // Best-effort auto-pick when the modal was opened before the
    // machines list arrived. Only fires when there's no pick yet so it
    // never overrides a user choice.
    React.useEffect(() => {
        if (!visible) return;
        if (pickedMachineId) return;
        if (machines.length > 0) {
            setPickedMachineId(machines[0].id);
        }
    }, [visible, machines, pickedMachineId]);

    const handlePickSource = React.useCallback(
        (preset: SourcePreset) => {
            setPickedSource(preset.key);
            // Only auto-fill if the field is empty OR currently holds the
            // default of a previously-picked preset. Manual edits win.
            const previousPreset = SOURCE_PRESETS.find(
                (p) => p.key === pickedSource,
            );
            const slugIsUntouched =
                slugRaw.length === 0 ||
                (previousPreset && slugRaw === previousPreset.slugDefault);
            if (slugIsUntouched && preset.slugDefault) {
                setSlugRaw(preset.slugDefault);
            }
            const previousPromptPreview = previousPreset?.promptKey
                ? t(previousPreset.promptKey)
                : "";
            const promptIsUntouched =
                prompt.length === 0 || prompt === previousPromptPreview;
            if (promptIsUntouched && preset.promptKey) {
                setPrompt(t(preset.promptKey));
            }
        },
        [pickedSource, slugRaw, prompt],
    );

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
                <SecretReveal
                    slug={createdSlug || slug}
                    secret={createdSecret}
                    machineId={pickedMachineId}
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
                    flowOpen={flowOpen}
                    setFlowOpen={setFlowOpen}
                    pickedSource={pickedSource}
                    onPickSource={handlePickSource}
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
    flowOpen,
    setFlowOpen,
    pickedSource,
    onPickSource,
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

            {/* Cross-pointer to WebhookRoute (the GitHub/Gitea-aware
                webhook in Settings → Git Hosts). Distinct accent color
                from the main info banner so users registering "two
                webhook surfaces" treat them as siblings rather than
                blurring them together. */}
            <View style={styles.crossPointer}>
                <Ionicons
                    name="git-branch-outline"
                    size={14}
                    color={theme.colors.textLink}
                />
                <Text style={styles.crossPointerText}>
                    {t("workflows.webhookModalCrossPointer")}
                </Text>
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

            {/* Source preset picker — clicking a chip prefills slug +
                prompt with sensible defaults for the most common
                integrations. "自定义" is the no-op escape hatch. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.webhookSectionSource")}
                </Text>
                <Text style={styles.helperText}>
                    {t("workflows.webhookSectionSourceHelper")}
                </Text>
                <View style={styles.presetGrid}>
                    {SOURCE_PRESETS.map((preset) => (
                        <PresetChip
                            key={preset.key}
                            label={t(preset.labelKey)}
                            active={pickedSource === preset.key}
                            onPress={() => onPickSource(preset)}
                        />
                    ))}
                </View>
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
                <Text style={styles.helperText}>
                    {t("workflows.webhookSlugHelper")}
                </Text>
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
                <Text style={styles.helperText}>
                    {t("workflows.webhookNameHelper")}
                </Text>
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
                <Text style={styles.helperText}>
                    {t("workflows.webhookPromptHelper")}
                </Text>
            </View>

            <Pressable
                style={styles.flowToggle}
                onPress={() => setFlowOpen((v: boolean) => !v)}
            >
                <Ionicons
                    name={flowOpen ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={theme.colors.textLink}
                />
                <Text style={styles.flowToggleText}>
                    {t("workflows.webhookFlowToggle")}
                </Text>
            </Pressable>

            {flowOpen ? <FlowDiagram theme={theme} /> : null}
        </>
    );
}

/**
 * Three-stage lifecycle preview rendered below the form. Self-contained
 * + theme-aware; no API calls. Keeps the modal portable.
 */
function FlowDiagram({ theme }: { theme: any }) {
    return (
        <>
            <View style={styles.flowDiagramRow}>
                <View style={styles.flowStage}>
                    <Text style={styles.flowStageLabel}>
                        {t("workflows.webhookFlowStageOneLabel")}
                    </Text>
                    <Text style={styles.flowStageTitle}>
                        {t("workflows.webhookFlowStageOneTitle")}
                    </Text>
                    <Text style={styles.flowStageBody}>
                        {t("workflows.webhookFlowStageOneBody")}
                    </Text>
                </View>
                <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={theme.colors.textSecondary}
                    style={styles.flowArrow}
                />
                <View style={styles.flowStage}>
                    <Text style={styles.flowStageLabel}>
                        {t("workflows.webhookFlowStageTwoLabel")}
                    </Text>
                    <Text style={styles.flowStageTitle}>
                        {t("workflows.webhookFlowStageTwoTitle")}
                    </Text>
                    <Text style={styles.flowStageBody}>
                        {t("workflows.webhookFlowStageTwoBody")}
                    </Text>
                </View>
                <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={theme.colors.textSecondary}
                    style={styles.flowArrow}
                />
                <View style={styles.flowStage}>
                    <Text style={styles.flowStageLabel}>
                        {t("workflows.webhookFlowStageThreeLabel")}
                    </Text>
                    <Text style={styles.flowStageTitle}>
                        {t("workflows.webhookFlowStageThreeTitle")}
                    </Text>
                    <Text style={styles.flowStageBody}>
                        {t("workflows.webhookFlowStageThreeBody")}
                    </Text>
                </View>
            </View>
            <View style={styles.flowResultRow}>
                <Ionicons
                    name="checkmark-circle-outline"
                    size={14}
                    color={theme.colors.success}
                />
                <Text style={styles.flowResultText}>
                    {t("workflows.webhookFlowResult")}
                </Text>
            </View>
        </>
    );
}

function SecretReveal({
    slug,
    secret,
    machineId: _machineId,
}: {
    slug: string;
    secret: string;
    machineId: string;
}) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);
    const [urlCopied, setUrlCopied] = React.useState(false);
    const [curlCopied, setCurlCopied] = React.useState(false);

    const publicUrl = `${getServerUrl().replace(/\/$/, "")}/v1/triggers/${slug}`;
    const curlSnippet =
        `curl -X POST ${publicUrl} \\\n` +
        `  -H "Authorization: Bearer ${secret}" \\\n` +
        `  -H "Content-Type: application/json"`;

    const copyUrl = async () => {
        await Clipboard.setStringAsync(publicUrl);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 1500);
    };
    const copyCurl = async () => {
        await Clipboard.setStringAsync(curlSnippet);
        setCurlCopied(true);
        setTimeout(() => setCurlCopied(false), 1500);
    };
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

            {/* Section B — public URL + curl example so the user knows
                what to do with the secret they just copied. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.webhookPublicUrlLabel")}
                </Text>
                <View style={[styles.publicUrlBox, { marginTop: 6 }]}>
                    <Text style={styles.publicUrlValue} selectable numberOfLines={2}>
                        {publicUrl}
                    </Text>
                    <Pressable style={styles.secretCopyButton} onPress={copyUrl}>
                        <Ionicons
                            name={urlCopied ? "checkmark" : "copy-outline"}
                            size={14}
                            color={theme.colors.button.primary.tint}
                        />
                        <Text style={styles.secretCopyText}>
                            {urlCopied ? t("common.copied") : t("common.copy")}
                        </Text>
                    </Pressable>
                </View>
            </View>

            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.webhookHowToUseLabel")}
                </Text>
                <View style={[styles.curlBlock, { marginTop: 6 }]}>
                    <Text style={styles.curlText} selectable>
                        {curlSnippet}
                    </Text>
                    <Pressable style={styles.secretCopyButton} onPress={copyCurl}>
                        <Ionicons
                            name={curlCopied ? "checkmark" : "copy-outline"}
                            size={14}
                            color={theme.colors.button.primary.tint}
                        />
                        <Text style={styles.secretCopyText}>
                            {curlCopied
                                ? t("common.copied")
                                : t("workflows.webhookCopyCurl")}
                        </Text>
                    </Pressable>
                </View>

                <View style={styles.integrationHint}>
                    <Ionicons
                        name="logo-github"
                        size={12}
                        color={theme.colors.textSecondary}
                        style={styles.integrationHintIcon}
                    />
                    <Text style={styles.integrationHintText}>
                        {t("workflows.webhookHintGithub")}
                    </Text>
                </View>
                <View style={styles.integrationHint}>
                    <Ionicons
                        name="flash-outline"
                        size={12}
                        color={theme.colors.textSecondary}
                        style={styles.integrationHintIcon}
                    />
                    <Text style={styles.integrationHintText}>
                        {t("workflows.webhookHintZapier")}
                    </Text>
                </View>
                <View style={styles.integrationHint}>
                    <Ionicons
                        name="terminal-outline"
                        size={12}
                        color={theme.colors.textSecondary}
                        style={styles.integrationHintIcon}
                    />
                    <Text style={styles.integrationHintText}>
                        {t("workflows.webhookHintCron")}
                    </Text>
                </View>
            </View>
        </>
    );
}
