/**
 * CreateLoopModal — real Create-a-Loop form (ADR-0022 Phase 3b).
 *
 * The form POSTs to /v1/projects/:projectId/agent-loops (apiAgentLoops.ts).
 * Required fields: machine → project, prompt, schedule (interval or cron),
 * agent. The existing CLI-version readiness panel is preserved as a
 * collapsible "Advanced" section so users can still inspect daemon support
 * without it dominating the modal.
 *
 * Shell, animation, gestures owned by <BottomSheet>; this file owns the
 * form state, submit, and the readiness fold-out.
 */

import * as React from "react";
import { View, Pressable, Linking, TextInput, ActivityIndicator } from "react-native";
import { Text } from "@/components/StyledText";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { webInteractive } from "@/utils/interactiveSurface";
import { t } from "@/text";
import { useAllMachines, useProjects } from "@/sync/storage";
import type { Machine } from "@/sync/storageTypes";
import { isMachineOnline } from "@/utils/machineUtils";
import { BottomSheet, BottomSheetHandle, PresetChip } from "@/components/BottomSheet";
import { TriggerModelEffortSection } from "@/components/workflow/TriggerModelEffortSection";
import { Modal as AlertModal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { createAgentLoop } from "@/sync/apiAgentLoops";
import { sessionAdopt } from "@/sync/apiSessionAdopt";
import { notifyWorkflowSourcesChanged } from "@/sync/workflowBus";
import type { CreateGenericAgentLoopBody } from "@kmmao/happy-wire";
import type { Session } from "@/sync/storageTypes";

interface CreateLoopModalProps {
    visible: boolean;
    onClose: () => void;
    /**
     * Optional callback the parent can use to refresh the workflow list
     * after a successful create. The hook re-fetches when this fires.
     */
    onCreated?: () => void;
    /**
     * Adopt mode (Phase 2 sessionAdopt — new-loop target). When given,
     * the modal creates a new loop AND binds this Session to it in a
     * single round-trip, so the conversation jumps under the new loop
     * card in the workflow list. Machine/project/agent pickers are hidden
     * (inherited from the Session); prompt is prefilled from the latest
     * user message; directory comes from session.metadata.path.
     */
    session?: Session;
}

type AgentChoice = "claude" | "codex" | "gemini";
type ScheduleChoice = "5m" | "1h" | "6h" | "24h" | "cron";

const SCHEDULE_INTERVALS_MS: Record<Exclude<ScheduleChoice, "cron">, number> = {
    "5m": 5 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
};

/**
 * Common cron templates shown as one-tap chips above the cron input.
 *
 * Picked so the "round-number" intent — every-30min / hourly / 9am-daily /
 * midnight / weekdays / Mondays / first-of-month — is reachable without
 * typing a single asterisk. Each chip just rewrites the text box, so the
 * user can still tweak the expression before submitting.
 *
 * The `labelKey` resolves through `t()`, the `cron` is the literal cron
 * string the input becomes, and `humanKind` is a hint passed to
 * `humanizeCron()` so the preview line below matches the chip exactly
 * (no risk of the parser misreading the very expression we just wrote).
 */
const CRON_PRESETS: Array<{
    labelKey:
        | "workflows.loopCronPresetEvery30m"
        | "workflows.loopCronPresetHourly"
        | "workflows.loopCronPresetDaily9"
        | "workflows.loopCronPresetMidnight"
        | "workflows.loopCronPresetWorkdays9"
        | "workflows.loopCronPresetMonday9"
        | "workflows.loopCronPresetMonthly1st";
    cron: string;
}> = [
    { labelKey: "workflows.loopCronPresetEvery30m", cron: "*/30 * * * *" },
    { labelKey: "workflows.loopCronPresetHourly", cron: "0 * * * *" },
    { labelKey: "workflows.loopCronPresetDaily9", cron: "0 9 * * *" },
    { labelKey: "workflows.loopCronPresetMidnight", cron: "0 0 * * *" },
    { labelKey: "workflows.loopCronPresetWorkdays9", cron: "0 9 * * 1-5" },
    { labelKey: "workflows.loopCronPresetMonday9", cron: "0 9 * * 1" },
    { labelKey: "workflows.loopCronPresetMonthly1st", cron: "0 0 1 * *" },
];

// Two-char zero-pad for HH:MM strings inside the humanized preview.
function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

type CronPattern =
    | { kind: "minutely" }
    | { kind: "hourly" }
    | { kind: "everyNMin"; n: number }
    | { kind: "everyNHour"; n: number }
    | { kind: "dailyAt"; hm: string }
    | { kind: "weekdaysAt"; hm: string }
    | { kind: "weekendAt"; hm: string }
    | { kind: "weeklyAt"; hm: string; dow: number }
    | { kind: "monthlyAt"; hm: string; dom: number }
    | { kind: "custom" }
    | null;

// Conservative field validator — accepts only the syntax we humanize so
// the preview can confidently say "invalid" instead of misleading users.
const CRON_FIELD_RE = /^(\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)*)$/;

/**
 * Parse a cron expression into one of the patterns our preview knows
 * how to describe. Anything we recognize syntactically but can't shape
 * into a known phrase falls into `custom` (we show "custom expression"
 * rather than "invalid"). Anything malformed returns `null`.
 */
function parseCron(expr: string): CronPattern {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [m, h, dom, mon, dow] = parts;
    if (![m, h, dom, mon, dow].every((p) => CRON_FIELD_RE.test(p))) return null;

    const everyDate = dom === "*" && mon === "*" && dow === "*";

    if (m === "*" && h === "*" && everyDate) return { kind: "minutely" };

    if (h === "*" && everyDate) {
        if (m === "0") return { kind: "hourly" };
        const everyN = m.match(/^\*\/(\d+)$/);
        if (everyN) return { kind: "everyNMin", n: parseInt(everyN[1], 10) };
    }

    if (m === "0" && everyDate) {
        const everyN = h.match(/^\*\/(\d+)$/);
        if (everyN) return { kind: "everyNHour", n: parseInt(everyN[1], 10) };
    }

    const mNum = /^\d+$/.test(m) ? parseInt(m, 10) : null;
    const hNum = /^\d+$/.test(h) ? parseInt(h, 10) : null;
    if (mNum !== null && hNum !== null) {
        const hm = `${pad2(hNum)}:${pad2(mNum)}`;
        if (everyDate) return { kind: "dailyAt", hm };
        if (dom === "*" && mon === "*" && dow === "1-5") {
            return { kind: "weekdaysAt", hm };
        }
        if (dom === "*" && mon === "*" && (dow === "0,6" || dow === "6,0")) {
            return { kind: "weekendAt", hm };
        }
        if (dom === "*" && mon === "*" && /^\d+$/.test(dow)) {
            return { kind: "weeklyAt", hm, dow: parseInt(dow, 10) };
        }
        if (/^\d+$/.test(dom) && mon === "*" && dow === "*") {
            return { kind: "monthlyAt", hm, dom: parseInt(dom, 10) };
        }
    }

    return { kind: "custom" };
}

// Cron uses 0–6 for Sun–Sat (and 7 also = Sun). Translation keys are
// stable string literals so the type system catches typos.
const DOW_LABEL_KEYS = [
    "workflows.loopCronDaySun",
    "workflows.loopCronDayMon",
    "workflows.loopCronDayTue",
    "workflows.loopCronDayWed",
    "workflows.loopCronDayThu",
    "workflows.loopCronDayFri",
    "workflows.loopCronDaySat",
] as const;

function dowName(dow: number): string {
    const idx = dow === 7 ? 0 : dow;
    if (idx < 0 || idx > 6) return String(dow);
    return t(DOW_LABEL_KEYS[idx]);
}

/**
 * Translate a cron string into a single human-readable line. Returns
 * the localized "invalid expression" message when parsing fails so the
 * user immediately sees the typo instead of a frozen-looking preview.
 */
function humanizeCron(expr: string): string {
    const parsed = parseCron(expr);
    if (!parsed) return t("workflows.loopCronHumanInvalid");
    switch (parsed.kind) {
        case "minutely":
            return t("workflows.loopCronHumanMinutely");
        case "hourly":
            return t("workflows.loopCronHumanHourly");
        case "everyNMin":
            return t("workflows.loopCronHumanEveryNMin", parsed.n);
        case "everyNHour":
            return t("workflows.loopCronHumanEveryNHour", parsed.n);
        case "dailyAt":
            return t("workflows.loopCronHumanDailyAt", parsed.hm);
        case "weekdaysAt":
            return t("workflows.loopCronHumanWeekdaysAt", parsed.hm);
        case "weekendAt":
            return t("workflows.loopCronHumanWeekendAt", parsed.hm);
        case "weeklyAt":
            return t("workflows.loopCronHumanWeeklyAt", {
                day: dowName(parsed.dow),
                hm: parsed.hm,
            });
        case "monthlyAt":
            return t("workflows.loopCronHumanMonthlyAt", {
                dom: parsed.dom,
                hm: parsed.hm,
            });
        case "custom":
            return t("workflows.loopCronHumanCustom");
    }
}

/**
 * Minimum CLI version that ships the daemon endpoints required for
 * server-driven Loop creation. The form is enabled regardless — the
 * server scheduler will queue triggers and only emit them to daemons
 * that connect with a compatible version. The readiness panel just
 * gives users an at-a-glance map.
 */
const MIN_CLI_VERSION_FOR_LOOPS = "0.97.0";

const LEARN_MORE_URL =
    "https://github.com/kmmao/happy/blob/main/docs/adr/0022-agent-loop-absorbs-supervisor-loop.md";

// Semver compare — same helper the old guidance-only view used.
function compareSemver(a: string | undefined | null, b: string): number | null {
    if (!a) return null;
    const parse = (s: string): number[] | null => {
        const parts = s.split(".").slice(0, 3).map((p) => parseInt(p, 10));
        if (parts.some((n) => Number.isNaN(n))) return null;
        while (parts.length < 3) parts.push(0);
        return parts;
    };
    const av = parse(a);
    const bv = parse(b);
    if (!av || !bv) return null;
    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
    }
    return 0;
}

type MachineSupport = {
    machine: Machine;
    version: string | null;
    online: boolean;
    meetsRequirement: boolean | undefined;
};

function classifyMachines(machines: Machine[]): MachineSupport[] {
    return machines.map((machine) => {
        const version = (machine.daemonState as any)?.startedWithCliVersion ?? null;
        const cmp = compareSemver(version, MIN_CLI_VERSION_FOR_LOOPS);
        return {
            machine,
            version,
            online: isMachineOnline(machine),
            meetsRequirement: cmp === null ? undefined : cmp >= 0,
        };
    });
}

const styles = StyleSheet.create((theme) => ({
    info: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 10,
        borderRadius: 8,
        backgroundColor: `${theme.colors.accentOrange}14`,
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
    infoBullet: {
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
        marginTop: 2,
    },
    cronPresetsLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        marginTop: 10,
    },
    cronPreviewRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
        paddingHorizontal: 2,
    },
    cronPreviewText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        lineHeight: 17,
    },
    cronPreviewTextInvalid: {
        color: theme.colors.warning,
    },
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
    },
    promptInput: {
        minHeight: 96,
        textAlignVertical: "top",
        fontSize: 14,
    },
    cronInput: {
        fontFamily: "Menlo",
    },
    advancedToggle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        ...webInteractive,
    },
    advancedToggleText: {
        fontSize: 13,
        color: theme.colors.textLink,
        ...Typography.default("semiBold"),
    },
    machineRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        gap: 10,
        marginBottom: 6,
    },
    machineLabelColumn: { flex: 1, minWidth: 0, gap: 2 },
    machineName: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    machineMeta: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
        fontFamily: "Menlo",
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    statusBadgeText: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    learnMoreRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 4,
        ...webInteractive,
    },
    learnMoreText: {
        fontSize: 13,
        color: theme.colors.textLink,
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

export const CreateLoopModal = React.memo(function CreateLoopModal({
    visible,
    onClose,
    onCreated,
    session,
}: CreateLoopModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);

    const machines = useAllMachines();
    const projects = useProjects();

    // Adopt mode flag — set once on open and pinned for the modal's
    // lifetime. The machine/project pickers are slaved to the Session in
    // this mode and the picker UI is hidden entirely.
    const isAdoptMode = !!session;

    const [pickedMachineId, setPickedMachineId] = React.useState<string>("");
    const [pickedProjectServerId, setPickedProjectServerId] = React.useState<string>("");
    const [prompt, setPrompt] = React.useState("");
    const [name, setName] = React.useState("");
    const [bootstrapSlashCommand, setBootstrapSlashCommand] = React.useState("");
    const [schedule, setSchedule] = React.useState<ScheduleChoice>("1h");
    const [cronExpression, setCronExpression] = React.useState("*/30 * * * *");
    const [agent, setAgent] = React.useState<AgentChoice>("claude");
    // Per-loop model + reasoning effort (Claude only). "default"/null = no override.
    const [modelModeKey, setModelModeKey] = React.useState<string>("default");
    const [effortLevel, setEffortLevel] = React.useState<string | null>(null);
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);

    // Reset form state only on a fresh open (false → true transition).
    // Without the ref guard, the effect re-fires whenever `machines`
    // changes — which happens every ~60s from machine heartbeats — and
    // wipes everything the user has typed mid-edit. The auto machine-
    // pick below picks up the slack when machines load after the modal
    // is already open.
    const wasVisible = React.useRef(visible);
    React.useEffect(() => {
        if (visible && !wasVisible.current) {
            // Adopt mode seeds from the Session; create-from-scratch
            // mode falls back to the historical defaults.
            if (session) {
                setPickedMachineId(session.metadata?.machineId ?? "");
                // pickedProjectServerId is filled by the machineProjects
                // effect below once projects are filtered. Leave blank
                // here so the auto-pick fires.
                setPickedProjectServerId("");
                setPrompt(
                    session.latestUserRequestPreview?.text?.trim() ||
                        session.metadata?.summary?.text?.trim() ||
                        "",
                );
                setName(session.metadata?.summary?.text?.trim()?.slice(0, 60) ?? "");
                // Inherit the source Session's model + effort picks so the
                // adopted loop keeps running on whatever the user was using
                // before promotion. Without this default, every adopted
                // loop fell back to the CLI baseline (Sonnet 4.6 + medium)
                // regardless of how the user had configured the chat.
                setModelModeKey(session.modelMode ?? "default");
                setEffortLevel(session.effortLevel ?? null);
            } else {
                setPickedMachineId(machines[0]?.id ?? "");
                setPickedProjectServerId("");
                setPrompt("");
                setName("");
                setModelModeKey("default");
                setEffortLevel(null);
            }
            setSchedule("1h");
            setCronExpression("*/30 * * * *");
            setAgent("claude");
            setAdvancedOpen(false);
            setSubmitting(false);
        }
        wasVisible.current = visible;
    });

    // Best-effort auto-pick when the modal was opened before machines
    // arrived. Only fires when there's no pick yet.
    React.useEffect(() => {
        if (!visible) return;
        if (pickedMachineId) return;
        if (machines.length > 0) {
            setPickedMachineId(machines[0].id);
        }
    }, [visible, machines, pickedMachineId]);

    // Projects on this machine that have been synced to the server.
    // We can only create loops against `serverId`-known projects — local-
    // only project rows are filtered out here so the user can't pick one
    // that the server doesn't know about.
    const machineProjects = React.useMemo(() => {
        if (!pickedMachineId) return [];
        return projects.filter(
            (p) => p.key.machineId === pickedMachineId && p.serverId,
        );
    }, [projects, pickedMachineId]);

    // Auto-pick the first project when the machine changes. Without
    // this, the user would land on an empty project pick with the
    // submit button greyed out for no obvious reason.
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

    const pickedProject = React.useMemo(
        () => machineProjects.find((p) => p.serverId === pickedProjectServerId),
        [machineProjects, pickedProjectServerId],
    );

    // Form validity: project + prompt mandatory. If cron is the chosen
    // schedule, we also require a non-empty cron string.
    const valid =
        pickedProjectServerId.length > 0 &&
        prompt.trim().length > 0 &&
        (schedule !== "cron" || cronExpression.trim().length > 0);

    const handleConfirm = async () => {
        if (!valid || submitting || !pickedProject?.serverId) return;
        setSubmitting(true);
        try {
            const trimmedPrompt = prompt.trim();
            const trimmedName = name.trim();
            const trimmedBootstrap = bootstrapSlashCommand.trim();
            const intervalMs =
                schedule === "cron" ? undefined : SCHEDULE_INTERVALS_MS[schedule];
            const cron =
                schedule === "cron" ? cronExpression.trim() : undefined;

            if (isAdoptMode && session) {
                // Phase 2 sessionAdopt — server creates the loop AND
                // binds this Session to it (single round-trip; daemon
                // ephemeral updates GuardianSessionRegistry so next
                // trigger reuses this Session). Carrying modelMode + effort
                // through requires wire 0.35.0+; on older servers the
                // fields are silently ignored (zod schema allows unknown
                // input gracefully when transmitted).
                const result = await sessionAdopt({
                    sessionId: session.id,
                    target: {
                        kind: "new-loop",
                        prompt: trimmedPrompt,
                        directory: pickedProject.key.path,
                        intervalMs,
                        cronExpression: cron,
                        name: trimmedName || undefined,
                        bootstrapSlashCommand: trimmedBootstrap || undefined,
                        // Only override defaults when the user picked
                        // something explicit — sending "default" / null
                        // would shadow the loop's own fallback on the
                        // server side.
                        ...(modelModeKey !== "default" ? { modelMode: modelModeKey } : {}),
                        ...(effortLevel ? { effort: effortLevel } : {}),
                    },
                });
                if (!result.success) {
                    throw new Error(result.errorMessage);
                }
            } else {
                // Standalone "create loop" path — no Session to adopt.
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) throw new Error("Not authenticated");

                const body: CreateGenericAgentLoopBody = {
                    prompt: trimmedPrompt,
                    directory: pickedProject.key.path,
                    agent,
                    enabled: true,
                };
                if (cron) body.cronExpression = cron;
                if (intervalMs !== undefined) body.intervalMs = intervalMs;
                // Model + effort are Claude-only overrides. Persisted on the
                // loop row; CLI injects them onto the first-turn EnhancedMode.
                if (agent === "claude" && modelModeKey !== "default") {
                    body.modelMode = modelModeKey;
                }
                if (agent === "claude" && effortLevel) {
                    body.effort = effortLevel;
                }
                // Stash optional name + bootstrap slash command in the
                // generic-config bag (same path the daemon promotes from).
                if (trimmedName || trimmedBootstrap) {
                    body.genericConfig = {
                        ...(trimmedName ? { name: trimmedName } : {}),
                        ...(trimmedBootstrap
                            ? { bootstrapSlashCommand: trimmedBootstrap }
                            : {}),
                    };
                }

                await createAgentLoop(credentials, pickedProject.serverId, body);
            }

            // Fire the global bus first (so every useWorkflows hook in the
            // app refetches in lockstep), then the caller-supplied callback.
            notifyWorkflowSourcesChanged();
            onCreated?.();
            sheetRef.current?.requestClose();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            AlertModal.alert(t("workflows.loopFormErrorTitle"), message);
            setSubmitting(false);
        }
    };

    const support = React.useMemo(() => classifyMachines(machines), [machines]);

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            busy={submitting}
            title={t("workflows.loopModalTitle")}
            subtitle={t("workflows.loopModalSubtitle")}
            desktopMaxHeightFraction={0.9}
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
                            <Text style={[
                                styles.buttonText,
                                valid && !submitting
                                    ? styles.buttonTextPrimary
                                    : styles.buttonTextPrimaryDisabled,
                            ]}>
                                {t("workflows.loopFormSubmit")}
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
                    {isAdoptMode ? (
                        <Text style={styles.infoText}>
                            {t("workflows.loopFormAdoptInfo")}
                        </Text>
                    ) : (
                        <>
                            <Text style={styles.infoText}>
                                {t("workflows.loopFormInfoIntro")}
                            </Text>
                            <Text style={styles.infoBullet}>
                                • {t("workflows.loopFormInfoStep1")}
                            </Text>
                            <Text style={styles.infoBullet}>
                                • {t("workflows.loopFormInfoStep2")}
                            </Text>
                            <Text style={styles.infoBullet}>
                                • {t("workflows.loopFormInfoStep3")}
                            </Text>
                            <Text style={styles.infoHint}>
                                {t("workflows.loopFormInfoHint")}
                            </Text>
                            <Text style={styles.infoHint}>
                                {t("workflows.loopDifferentiator")}
                            </Text>
                        </>
                    )}
                </View>
            </View>

            {/* Machine + Project pickers — only visible in standalone
                ("create from scratch") mode. Adopt mode inherits both
                from the source Session, so the pickers would just be
                noise and a foot-gun. The pickedMachineId / pickedProjectServerId
                state still gets auto-set from session metadata via the
                open-effect, so handleConfirm has everything it needs. */}
            {isAdoptMode ? null : (
                <>
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

                    <View>
                        <Text style={styles.sectionLabel}>
                            {t("workflows.loopSectionProject")}
                        </Text>
                        {!pickedMachineId ? (
                            <Text
                                style={[styles.infoText, { marginTop: 6 }]}
                            >
                                {t("workflows.loopProjectNone")}
                            </Text>
                        ) : machineProjects.length === 0 ? (
                            <Text
                                style={[
                                    styles.infoText,
                                    { color: theme.colors.warning, marginTop: 6 },
                                ]}
                            >
                                {t("workflows.loopProjectEmpty")}
                            </Text>
                        ) : (
                            <View style={styles.presetGrid}>
                                {machineProjects.map((p) => (
                                    <PresetChip
                                        key={p.id}
                                        label={p.key.path.split("/").filter(Boolean).pop() || p.key.path}
                                        active={p.serverId === pickedProjectServerId}
                                        onPress={() => setPickedProjectServerId(p.serverId ?? "")}
                                    />
                                ))}
                            </View>
                        )}
                    </View>
                </>
            )}

            {/* Schedule — interval chips OR a custom cron expression. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopSectionSchedule")}
                </Text>
                <Text style={[styles.infoHint, { marginTop: 4 }]}>
                    {t("workflows.loopScheduleHint")}
                </Text>
                <View style={styles.presetGrid}>
                    <PresetChip
                        label={t("workflows.loopInterval5m")}
                        active={schedule === "5m"}
                        onPress={() => setSchedule("5m")}
                    />
                    <PresetChip
                        label={t("workflows.loopInterval1h")}
                        active={schedule === "1h"}
                        onPress={() => setSchedule("1h")}
                    />
                    <PresetChip
                        label={t("workflows.loopInterval6h")}
                        active={schedule === "6h"}
                        onPress={() => setSchedule("6h")}
                    />
                    <PresetChip
                        label={t("workflows.loopInterval24h")}
                        active={schedule === "24h"}
                        onPress={() => setSchedule("24h")}
                    />
                    <PresetChip
                        label={t("workflows.loopIntervalCron")}
                        active={schedule === "cron"}
                        onPress={() => setSchedule("cron")}
                    />
                </View>
                {schedule === "cron" ? (
                    <>
                        {/* Quick templates — one tap rewrites the cron
                            input below. We don't track "which preset is
                            active" because hand-edits would make the
                            chip lie; users see the actual schedule via
                            the preview line instead. */}
                        <Text style={styles.cronPresetsLabel}>
                            {t("workflows.loopCronPresetsLabel")}
                        </Text>
                        <View style={styles.presetGrid}>
                            {CRON_PRESETS.map((preset) => (
                                <PresetChip
                                    key={preset.cron}
                                    label={t(preset.labelKey)}
                                    active={
                                        cronExpression.trim() === preset.cron
                                    }
                                    onPress={() =>
                                        setCronExpression(preset.cron)
                                    }
                                />
                            ))}
                        </View>
                        <TextInput
                            style={[
                                styles.input,
                                styles.cronInput,
                                { marginTop: 8 },
                            ]}
                            value={cronExpression}
                            onChangeText={setCronExpression}
                            placeholder={t("workflows.loopCronPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        {/* Schedule preview — translates the current
                            cron string into a one-line description so
                            users don't have to mentally parse asterisks
                            before tapping Submit. */}
                        {(() => {
                            const valid = parseCron(cronExpression) !== null;
                            return (
                                <View style={styles.cronPreviewRow}>
                                    <Ionicons
                                        name={
                                            valid
                                                ? "time-outline"
                                                : "alert-circle-outline"
                                        }
                                        size={14}
                                        color={
                                            valid
                                                ? theme.colors.textSecondary
                                                : theme.colors.warning
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.cronPreviewText,
                                            !valid &&
                                                styles.cronPreviewTextInvalid,
                                        ]}
                                    >
                                        {humanizeCron(cronExpression)}
                                    </Text>
                                </View>
                            );
                        })()}
                    </>
                ) : null}
            </View>

            {/* Agent picker — hidden in adopt mode. Phase 2's
                SessionAdoptTarget.new-loop schema doesn't carry an
                `agent` field today (server hard-codes claude); to keep
                the UI honest we hide the picker so the user can't pick
                codex/gemini and expect it to stick. */}
            {isAdoptMode ? null : (
                <View>
                    <Text style={styles.sectionLabel}>{t("workflows.loopSectionAgent")}</Text>
                    <View style={styles.presetGrid}>
                        <PresetChip
                            label={t("workflows.loopAgentClaude")}
                            active={agent === "claude"}
                            onPress={() => setAgent("claude")}
                        />
                        <PresetChip
                            label={t("workflows.loopAgentCodex")}
                            active={agent === "codex"}
                            onPress={() => setAgent("codex")}
                        />
                        <PresetChip
                            label={t("workflows.loopAgentGemini")}
                            active={agent === "gemini"}
                            onPress={() => setAgent("gemini")}
                        />
                    </View>
                </View>
            )}

            {/* Model + reasoning effort — Claude-only. As of wire 0.35.0
                the sessionAdopt new-loop target also carries modelMode +
                effort, and CreateLoopModal pre-fills both from the source
                Session's current picks (see the visibility effect above).
                Standalone create keeps its historical defaults. */}
            {agent === "claude" ? (
                <TriggerModelEffortSection
                    modelModeKey={modelModeKey}
                    onSelectModel={setModelModeKey}
                    effortLevel={effortLevel}
                    onSelectEffort={setEffortLevel}
                />
            ) : null}

            {/* Prompt textarea. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopSectionPrompt")}
                </Text>
                <TextInput
                    style={[styles.input, styles.promptInput, { marginTop: 6 }]}
                    value={prompt}
                    onChangeText={setPrompt}
                    multiline
                    placeholder={t("workflows.loopPromptPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
                {/* Hint: how to close the feedback loop via `happy issue`.
                    Just a UX nudge — we don't auto-inject anything into
                    the prompt. The Agent reads this in the prompt
                    context once the user includes it. */}
                <Text style={styles.infoHint}>
                    {t("workflows.loopIssueHint")}
                </Text>
            </View>

            {/* Optional name. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopOptionalName")}
                </Text>
                <TextInput
                    style={[styles.input, { marginTop: 6 }]}
                    value={name}
                    onChangeText={setName}
                    placeholder={t("workflows.loopOptionalNamePlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
            </View>

            {/* Optional bootstrap slash command (e.g. /caveman) — pushed
                into the session as the first user message every iteration
                so a Skill activates before the prompt runs. Daemon reads
                this from genericConfig.bootstrapSlashCommand. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopBootstrapSlashCommand")}
                </Text>
                <TextInput
                    style={[styles.input, { marginTop: 6 }]}
                    value={bootstrapSlashCommand}
                    onChangeText={setBootstrapSlashCommand}
                    placeholder={t("workflows.loopBootstrapSlashCommandPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                <Text style={styles.infoHint}>
                    {t("workflows.loopBootstrapSlashCommandHint")}
                </Text>
            </View>

            {/* Advanced fold-out — CLI readiness panel from the old
                guidance modal. Hidden by default so it doesn't clutter
                the form, but available for users debugging machine
                version drift. */}
            <Pressable
                style={styles.advancedToggle}
                onPress={() => setAdvancedOpen((v) => !v)}
            >
                <Ionicons
                    name={advancedOpen ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={theme.colors.textLink}
                />
                <Text style={styles.advancedToggleText}>
                    {t("workflows.loopAdvancedToggle")}
                </Text>
            </Pressable>

            {advancedOpen ? (
                <CLIReadinessPanel support={support} theme={theme} />
            ) : null}
        </BottomSheet>
    );
});

function CLIReadinessPanel({
    support,
    theme,
}: {
    support: MachineSupport[];
    theme: any;
}) {
    return (
        <>
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopRequirementLabel")}
                </Text>
                <Text
                    style={[
                        styles.machineMeta,
                        { marginTop: 6, color: theme.colors.text },
                    ]}
                >
                    @kmmao/happy-coder ≥ {MIN_CLI_VERSION_FOR_LOOPS}
                </Text>
            </View>
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopMachinesLabel", support.length)}
                </Text>
                <View style={{ marginTop: 8 }}>
                    {support.map((s) => (
                        <MachineSupportRow key={s.machine.id} support={s} theme={theme} />
                    ))}
                </View>
            </View>
            <Pressable
                style={styles.learnMoreRow}
                onPress={() => Linking.openURL(LEARN_MORE_URL).catch(() => {})}
            >
                <Ionicons name="open-outline" size={14} color={theme.colors.textLink} />
                <Text style={styles.learnMoreText}>{t("workflows.loopLearnMore")}</Text>
            </Pressable>
        </>
    );
}

function MachineSupportRow({
    support,
    theme,
}: {
    support: MachineSupport;
    theme: any;
}) {
    const { machine, version, online, meetsRequirement } = support;
    const label = machine.metadata?.displayName || machine.metadata?.host || machine.id;

    const { badge, badgeBg, badgeColor, icon } = React.useMemo(() => {
        if (!online) {
            return {
                badge: t("workflows.loopMachineOffline"),
                badgeBg: theme.colors.surfaceHigh,
                badgeColor: theme.colors.textSecondary,
                icon: "cloud-offline-outline" as const,
            };
        }
        if (meetsRequirement === true) {
            return {
                badge: t("workflows.loopMachineReady"),
                badgeBg: `${theme.colors.success}24`,
                badgeColor: theme.colors.success,
                icon: "checkmark-circle" as const,
            };
        }
        if (meetsRequirement === false) {
            return {
                badge: t("workflows.loopMachineNeedsUpgrade"),
                badgeBg: `${theme.colors.warning}24`,
                badgeColor: theme.colors.warning,
                icon: "arrow-up-circle" as const,
            };
        }
        return {
            badge: t("workflows.loopMachineUnknownVersion"),
            badgeBg: theme.colors.surfaceHigh,
            badgeColor: theme.colors.textSecondary,
            icon: "help-circle-outline" as const,
        };
    }, [online, meetsRequirement, theme]);

    return (
        <View style={styles.machineRow}>
            <Ionicons
                name="desktop-outline"
                size={16}
                color={theme.colors.textSecondary}
            />
            <View style={styles.machineLabelColumn}>
                <Text style={styles.machineName} numberOfLines={1}>
                    {label}
                </Text>
                <Text style={styles.machineMeta}>{version ? `v${version}` : "—"}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
                <Ionicons name={icon} size={12} color={badgeColor} />
                <Text style={[styles.statusBadgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
        </View>
    );
}
