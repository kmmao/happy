/**
 * MakeRecurringModal — Phase 2 promote action of the Workflow IA.
 *
 * When invoked with a Session it now runs the Phase 2 `sessionAdopt` flow
 * (target.kind = "new-schedule"): the server creates the TriggerSchedule
 * AND binds the current Session to it via `automationContext`, so the
 * Session jumps under the new Scheduled Workflow card immediately. The
 * standalone "create from scratch" mode (no Session) keeps its old
 * `createTriggerSchedule` behaviour because there's no Session to adopt.
 *
 * Two modes:
 *   - session given → "promote this conversation" (machineId + prompt
 *     prefilled from the Session, adopted via sessionAdopt)
 *   - no session → "create from scratch" (machine picker, empty prompt,
 *     plain createTriggerSchedule)
 *
 * Shell, animation, swipe-to-dismiss, scroll layout, sticky footer, and
 * close routing all live in <BottomSheet>. This file only owns the form
 * + submit logic + label strings.
 */

import * as React from "react";
import { View, TextInput, ActivityIndicator, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { Modal as AlertModal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { createTriggerSchedule } from "@/sync/apiTriggerSchedules";
import { sessionAdopt } from "@/sync/apiSessionAdopt";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines, useProjects } from "@/sync/storage";
import { BottomSheet, BottomSheetHandle, PresetChip } from "@/components/BottomSheet";
import { TriggerModelEffortSection } from "@/components/workflow/TriggerModelEffortSection";
import type { Session } from "@/sync/storageTypes";

interface MakeRecurringModalProps {
    visible: boolean;
    onClose: () => void;
    /** When provided, the modal prefills prompt/directory/machineId from
     *  this Session ("promote this conversation"). Omit for a standalone
     *  "create new schedule" flow with a machine picker. */
    session?: Session;
}

const CRON_PRESETS: Array<{ id: string; labelKey: () => string; expr: string }> = [
    { id: "hourly", labelKey: () => t("workflows.recurringCronEveryHour"), expr: "0 * * * *" },
    { id: "daily", labelKey: () => t("workflows.recurringCronDaily02"), expr: "0 2 * * *" },
    { id: "weekday", labelKey: () => t("workflows.recurringCronWeekdays09"), expr: "0 9 * * 1-5" },
    { id: "weekly", labelKey: () => t("workflows.recurringCronWeeklyMon09"), expr: "0 9 * * 1" },
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
    infoBody: {
        flex: 1,
        gap: 4,
    },
    infoText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default(),
        lineHeight: 17,
    },
    infoHint: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 16,
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
    buttonPrimaryDisabled: {
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
    buttonTextPrimaryDisabled: { color: theme.colors.textSecondary },
    buttonTextCancel: { color: theme.colors.textSecondary },
}));

export const MakeRecurringModal = React.memo(function MakeRecurringModal({
    visible,
    onClose,
    session,
}: MakeRecurringModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);

    const isStandalone = !session;
    const machines = useAllMachines();
    const projects = useProjects();
    const [pickedMachineId, setPickedMachineId] = React.useState<string>("");
    // Standalone-only: project picker is gated on the machine pick so the
    // chip list always shows projects from the right host. Server stores
    // null when omitted (legacy path); we now force a value in the App so
    // the cron runner never falls back to its default directory.
    const [pickedProjectServerId, setPickedProjectServerId] = React.useState<string>("");

    const [presetId, setPresetId] = React.useState<string>("daily");
    const [customCron, setCustomCron] = React.useState<string>("");
    const [prompt, setPrompt] = React.useState<string>("");
    // Optional user-chosen name shown only in standalone mode. Session
    // mode auto-derives the name from the source session's summary
    // text inside handleConfirm (see sessionAdopt(... name: ...) below),
    // so an input here would just duplicate that logic.
    const [name, setName] = React.useState<string>("");
    // Per-trigger model + reasoning effort. "default" / null = no override.
    const [modelModeKey, setModelModeKey] = React.useState<string>("default");
    const [effortLevel, setEffortLevel] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (!visible) return;
        setPresetId("daily");
        setCustomCron("");
        setModelModeKey("default");
        setEffortLevel(null);
        const seed = session
            ? session.latestUserRequestPreview?.text?.trim() ||
              session.metadata?.summary?.text?.trim() ||
              ""
            : "";
        setPrompt(seed);
        setName("");
        setSubmitting(false);
        if (isStandalone) {
            setPickedMachineId(machines[0]?.id ?? "");
            setPickedProjectServerId("");
        }
    }, [visible, session, isStandalone, machines]);

    // Filter projects to those on the currently-picked machine that are
    // already synced to the server (we send the serverId, not the local
    // id, so unsynced projects can't be selected). Mirrors
    // CreateLoopModal.tsx so behaviour stays consistent between the two
    // standalone create flows.
    const machineProjects = React.useMemo(() => {
        if (!pickedMachineId) return [];
        return projects.filter(
            (p) => p.key.machineId === pickedMachineId && p.serverId,
        );
    }, [projects, pickedMachineId]);

    // Auto-select the first project whenever the machine changes (or the
    // current pick is no longer valid for the new list). Clears to "" when
    // the machine has no projects so the warning state below renders and
    // `valid` blocks submit.
    React.useEffect(() => {
        if (machineProjects.length === 0) {
            setPickedProjectServerId("");
            return;
        }
        const stillValid = machineProjects.some(
            (p) => p.serverId === pickedProjectServerId,
        );
        if (!stillValid) {
            setPickedProjectServerId(machineProjects[0].serverId ?? "");
        }
    }, [machineProjects, pickedProjectServerId]);

    const cronExpression =
        presetId === "custom"
            ? customCron.trim()
            : CRON_PRESETS.find((p) => p.id === presetId)?.expr ?? "";

    const machineId = session?.metadata?.machineId ?? pickedMachineId;
    // Standalone mode now requires a project — the server's cron runner
    // falls back to the user's home directory when projectId is null,
    // which is almost never what people want. Session-adopt mode skips
    // this check because the server binds projectId from the source
    // session automatically.
    const valid =
        cronExpression.length > 0 &&
        prompt.trim().length > 0 &&
        machineId.length > 0 &&
        (!isStandalone || pickedProjectServerId.length > 0);

    const handleConfirm = async () => {
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
            if (session) {
                // Promote-in-place via Phase 2 sessionAdopt: server creates
                // the schedule AND binds this Session to it, so the row
                // jumps under the new Scheduled Workflow without a
                // refetch race.
                const result = await sessionAdopt({
                    sessionId: session.id,
                    target: {
                        kind: "new-schedule",
                        cronExpression,
                        prompt: prompt.trim(),
                        name: session.metadata?.summary?.text?.trim()?.slice(0, 60),
                    },
                });
                if (!result.success) {
                    throw new Error(result.errorMessage);
                }
            } else {
                // Standalone "create from scratch" — no Session to adopt,
                // just plain TriggerSchedule create. Pass the optional
                // name through (server treats undefined as "unnamed", so
                // empty input is just dropped).
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) throw new Error("Not authenticated");
                const trimmedName = name.trim();
                await createTriggerSchedule(credentials, {
                    machineId,
                    projectId: pickedProjectServerId,
                    prompt: prompt.trim(),
                    cronExpression,
                    ...(trimmedName ? { name: trimmedName } : {}),
                    ...(modelModeKey !== "default" ? { modelMode: modelModeKey } : {}),
                    ...(effortLevel ? { effort: effortLevel } : {}),
                });
            }

            // Slide the sheet out — the new Scheduled Workflow auto-
            // surfaces in the WorkflowList on the next task-status tick.
            sheetRef.current?.requestClose();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AlertModal.alert(t("workflows.recurringErrorTitle"), message);
            setSubmitting(false);
        }
    };

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            busy={submitting}
            title={t("workflows.recurringModalTitle")}
            subtitle={t("workflows.recurringModalSubtitle")}
            footer={
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
                            valid && !submitting ? styles.buttonPrimary : styles.buttonPrimaryDisabled,
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
                            <Text style={[
                                styles.buttonText,
                                valid && !submitting
                                    ? styles.buttonTextPrimary
                                    : styles.buttonTextPrimaryDisabled,
                            ]}>
                                {t("workflows.recurringCreate")}
                            </Text>
                        )}
                    </Pressable>
                </>
            }
        >
            <View style={styles.info}>
                <Ionicons
                    name="information-circle"
                    size={16}
                    color={theme.colors.accentOrange}
                />
                <View style={styles.infoBody}>
                    <Text style={styles.infoText}>{t("workflows.recurringModalInfo")}</Text>
                    <Text style={styles.infoHint}>{t("workflows.recurringDifferentiator")}</Text>
                </View>
            </View>

            {isStandalone ? (
                <View>
                    <Text style={styles.sectionLabel}>{t("workflows.sectionMachine")}</Text>
                    {machines.length === 0 ? (
                        <Text
                            style={[styles.infoText, { color: theme.colors.warning, marginTop: 6 }]}
                        >
                            {t("workflows.standaloneNoMachine")}
                        </Text>
                    ) : (
                        <View style={styles.presetGrid}>
                            {machines.map((m) => (
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
            ) : null}

            {isStandalone ? (
                <View>
                    <Text style={styles.sectionLabel}>
                        {t("workflows.recurringSectionProject")}
                    </Text>
                    {!pickedMachineId ? (
                        <Text style={[styles.infoText, { marginTop: 6 }]}>
                            {t("workflows.recurringProjectNone")}
                        </Text>
                    ) : machineProjects.length === 0 ? (
                        <Text
                            style={[
                                styles.infoText,
                                { color: theme.colors.warning, marginTop: 6 },
                            ]}
                        >
                            {t("workflows.recurringProjectEmpty")}
                        </Text>
                    ) : (
                        <View style={styles.presetGrid}>
                            {machineProjects.map((p) => (
                                <PresetChip
                                    key={p.id}
                                    label={
                                        p.key.path.split("/").filter(Boolean).pop() ||
                                        p.key.path
                                    }
                                    active={p.serverId === pickedProjectServerId}
                                    onPress={() =>
                                        setPickedProjectServerId(p.serverId ?? "")
                                    }
                                />
                            ))}
                        </View>
                    )}
                </View>
            ) : null}

            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.recurringScheduleLabel")}
                </Text>
                <View style={styles.presetGrid}>
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
                    <>
                        <TextInput
                            style={[styles.input, { marginTop: 8 }]}
                            value={customCron}
                            onChangeText={setCustomCron}
                            placeholder="0 2 * * *"
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.infoHint, { marginTop: 6 }]}>
                            {t("workflows.recurringCustomCronHint")}
                        </Text>
                    </>
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

            {/* Optional name — standalone only. Session mode derives it
                from the source session's summary text. Reuses the
                loopOptionalName i18n keys so we don't proliferate
                near-identical strings; the wording reads correctly for
                schedules too ("e.g. nightly cleanup"). */}
            {isStandalone ? (
                <View>
                    <Text style={styles.sectionLabel}>
                        {t("workflows.loopOptionalName")}
                    </Text>
                    <TextInput
                        style={[styles.input, { marginTop: 6, fontFamily: "System" }]}
                        value={name}
                        onChangeText={setName}
                        placeholder={t("workflows.loopOptionalNamePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        maxLength={200}
                    />
                </View>
            ) : null}

            {/* Model + reasoning effort — standalone only. Session-adopt
                creates the schedule through a different server path that
                doesn't carry these overrides yet. */}
            {isStandalone ? (
                <TriggerModelEffortSection
                    modelModeKey={modelModeKey}
                    onSelectModel={setModelModeKey}
                    effortLevel={effortLevel}
                    onSelectEffort={setEffortLevel}
                />
            ) : null}
        </BottomSheet>
    );
});
