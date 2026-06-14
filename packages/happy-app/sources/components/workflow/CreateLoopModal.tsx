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
import { Modal as AlertModal } from "@/modal";
import { TokenStorage } from "@/auth/tokenStorage";
import { createAgentLoop, notifyAgentLoopsChanged } from "@/sync/apiAgentLoops";
import type { CreateGenericAgentLoopBody } from "@kmmao/happy-wire";

interface CreateLoopModalProps {
    visible: boolean;
    onClose: () => void;
    /**
     * Optional callback the parent can use to refresh the workflow list
     * after a successful create. The hook re-fetches when this fires.
     */
    onCreated?: () => void;
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
    infoText: {
        flex: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default(),
        lineHeight: 17,
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
    buttonPrimaryDisabled: { backgroundColor: theme.colors.surfaceHigh },
    buttonText: { fontSize: 14, ...Typography.default("semiBold") },
    buttonTextPrimary: { color: theme.colors.button.primary.tint },
    buttonTextCancel: { color: theme.colors.textSecondary },
}));

export const CreateLoopModal = React.memo(function CreateLoopModal({
    visible,
    onClose,
    onCreated,
}: CreateLoopModalProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);

    const machines = useAllMachines();
    const projects = useProjects();

    const [pickedMachineId, setPickedMachineId] = React.useState<string>("");
    const [pickedProjectServerId, setPickedProjectServerId] = React.useState<string>("");
    const [prompt, setPrompt] = React.useState("");
    const [name, setName] = React.useState("");
    const [schedule, setSchedule] = React.useState<ScheduleChoice>("1h");
    const [cronExpression, setCronExpression] = React.useState("*/30 * * * *");
    const [agent, setAgent] = React.useState<AgentChoice>("claude");
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
            setPickedMachineId(machines[0]?.id ?? "");
            setPickedProjectServerId("");
            setPrompt("");
            setName("");
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
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error("Not authenticated");

            const body: CreateGenericAgentLoopBody = {
                prompt: prompt.trim(),
                directory: pickedProject.key.path,
                agent,
                enabled: true,
            };
            if (schedule === "cron") {
                body.cronExpression = cronExpression.trim();
            } else {
                body.intervalMs = SCHEDULE_INTERVALS_MS[schedule];
            }
            // The trimmed name is folded into genericConfig so the
            // server preserves it for round-tripping back to the App.
            const trimmedName = name.trim();
            if (trimmedName) {
                body.genericConfig = { name: trimmedName };
            }

            await createAgentLoop(credentials, pickedProject.serverId, body);

            // Fire the global bus first (so every useWorkflows hook in the
            // app refetches in lockstep), then the caller-supplied callback.
            notifyAgentLoopsChanged();
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
                            <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
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
                <Text style={styles.infoText}>{t("workflows.loopFormInfo")}</Text>
            </View>

            {/* Machine picker — only machines that already exist on this
                account. Loop creation needs a machine + a known project. */}
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

            {/* Project picker — filtered to projects on the selected
                machine that have a server id. */}
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

            {/* Schedule — interval chips OR a custom cron expression. */}
            <View>
                <Text style={styles.sectionLabel}>
                    {t("workflows.loopSectionSchedule")}
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
                    <TextInput
                        style={[styles.input, styles.cronInput, { marginTop: 8 }]}
                        value={cronExpression}
                        onChangeText={setCronExpression}
                        placeholder={t("workflows.loopCronPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                ) : null}
            </View>

            {/* Agent picker. */}
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
