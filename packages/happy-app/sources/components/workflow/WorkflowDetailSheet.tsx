import * as React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { BottomSheet, BottomSheetHandle } from "@/components/BottomSheet";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { useHappyAction } from "@/hooks/useHappyAction";
import type { Workflow } from "@/hooks/useWorkflows";
import { TriggerModelEffortSection } from "@/components/workflow/TriggerModelEffortSection";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateTriggerSchedule } from "@/sync/apiTriggerSchedules";
import { updateWebhookTrigger } from "@/sync/apiWebhookTriggers";
import { updateAgentLoop } from "@/sync/apiAgentLoops";
import { notifyWorkflowSourcesChanged } from "@/sync/workflowBus";
import { t } from "@/text";
import { webInteractive } from "@/utils/interactiveSurface";
import { formatLastSeen } from "@/utils/sessionUtils";

interface WorkflowDetailSheetProps {
    visible: boolean;
    workflow: Workflow | null;
    onClose: () => void;
}

function formatDate(timestamp: number | null | undefined): string {
    if (!timestamp || timestamp <= 0) return t("workflows.detailNever");
    return new Date(timestamp).toLocaleString();
}

function workflowEnabled(workflow: Workflow): boolean {
    if (workflow.kind === "loop") return workflow.loop.enabled;
    if (workflow.kind === "scheduled" || workflow.kind === "event") {
        return workflow.trigger.enabled;
    }
    return workflow.status === "active";
}

function workflowLastActivity(workflow: Workflow): number {
    if (workflow.kind !== "loop") return workflow.lastActivityAt;
    return Math.max(
        workflow.lastActivityAt,
        workflow.loop.lastStartedAt ?? 0,
        workflow.loop.lastEnqueuedAt ?? 0,
        workflow.loop.lastTriggerAt ?? 0,
        workflow.loop.updatedAt ?? 0,
        workflow.loop.createdAt ?? 0,
    );
}

function workflowNextRunValue(workflow: Workflow): string {
    if (workflow.kind === "adhoc") return t("workflows.detailNever");
    if (!workflowEnabled(workflow)) return t("workflows.nextRunDisabled");
    if (workflow.kind === "event") return t("workflows.nextRunWaitingEvent");
    const nextRunAt = workflow.kind === "scheduled"
        ? workflow.nextRunAt
        : workflow.loop.nextRunAt;
    const formatted = formatDate(nextRunAt);
    if (formatted !== t("workflows.detailNever")) return formatted;
    if (workflow.kind === "loop" && workflow.status === "active") {
        return t("workflows.nextRunAfterCurrent");
    }
    return t("workflows.nextRunPending");
}

function formatInterval(ms: number | null | undefined): string {
    if (!ms) return t("workflows.detailNever");
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}d`;
}

function kindLabel(workflow: Workflow): string {
    switch (workflow.kind) {
        case "adhoc": return t("workflows.kindAdhocLabel");
        case "scheduled": return t("workflows.kindScheduledLabel");
        case "event": return t("workflows.kindEventLabel");
        case "loop": return t("workflows.kindLoopLabel");
    }
}

function workflowSummary(workflow: Workflow): string {
    switch (workflow.kind) {
        case "scheduled": return t("workflows.summaryScheduled");
        case "event": return t("workflows.summaryEvent");
        case "loop": return t("workflows.summaryLoop");
        case "adhoc": return workflow.displayName;
    }
}

export const WorkflowDetailSheet = React.memo(function WorkflowDetailSheet({
    visible,
    workflow,
    onClose,
}: WorkflowDetailSheetProps) {
    const { theme } = useUnistyles();
    const sheetRef = React.useRef<BottomSheetHandle>(null);
    const navigateToSession = useNavigateToSession();

    if (!workflow) return null;

    const latestSession = workflow.sessions[0];
    const canOpenLatestSession = !!latestSession;
    const lastActivityAt = workflowLastActivity(workflow);

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            title={t("workflows.detailTitle")}
            subtitle={workflow.displayName}
            desktopMaxHeightFraction={0.9}
            footer={
                <>
                    <Pressable
                        style={[styles.button, styles.buttonCancel]}
                        onPress={() => sheetRef.current?.requestClose()}
                    >
                        <Text style={[styles.buttonText, styles.buttonTextCancel]}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                    <Pressable
                        style={[
                            styles.button,
                            canOpenLatestSession ? styles.buttonPrimary : styles.buttonPrimaryDisabled,
                        ]}
                        disabled={!canOpenLatestSession}
                        onPress={() => {
                            if (!latestSession) return;
                            sheetRef.current?.requestClose(() => navigateToSession(latestSession.id));
                        }}
                    >
                        <Text style={[
                            styles.buttonText,
                            canOpenLatestSession
                                ? styles.buttonTextPrimary
                                : styles.buttonTextPrimaryDisabled,
                        ]}>
                            {t("workflows.detailOpenLatestSession")}
                        </Text>
                    </Pressable>
                </>
            }
        >
            <View style={styles.hero}>
                <View style={styles.heroIcon}>
                    <Ionicons
                        name="information-circle-outline"
                        size={22}
                        color={theme.colors.accentBlue}
                    />
                </View>
                <View style={styles.heroTextColumn}>
                    <Text style={styles.heroTitle}>{kindLabel(workflow)}</Text>
                    <Text style={styles.heroSubtitle}>{workflowSummary(workflow)}</Text>
                </View>
            </View>

            <Section title={t("workflows.detailOverview")}>
                <DetailRow label={t("workflows.detailEnabled")} value={workflowEnabled(workflow) ? t("workflows.detailYes") : t("workflows.detailNo")} />
                <DetailRow label={t("workflows.detailMachineId")} value={workflow.machineId || t("workflows.detailNever")} mono />
                <DetailRow label={t("workflows.sessionsHeader", workflow.sessions.length)} value={lastActivityAt > 0 ? t("workflows.detailLastActivity", formatLastSeen(lastActivityAt, false)) : t("workflows.detailNever")} />
            </Section>

            {workflow.kind === "scheduled" ? (
                <Section title={t("workflows.sectionSchedule")}>
                    <DetailRow label={t("workflows.detailCronExpression")} value={workflow.trigger.cronExpression} mono />
                    <DetailRow label={t("workflows.detailNextRun")} value={workflowNextRunValue(workflow)} />
                    <DetailRow label={t("workflows.detailLastRun")} value={formatDate(workflow.trigger.lastRunAt)} />
                    <DetailRow label={t("workflows.detailRuns")} value={String(workflow.runCount)} />
                    <DetailRow label={t("workflows.detailCreated")} value={formatDate(workflow.trigger.createdAt)} />
                    <DetailRow label={t("workflows.detailUpdated")} value={formatDate(workflow.trigger.updatedAt)} />
                    <PromptBlock prompt={workflow.trigger.prompt} />
                </Section>
            ) : null}

            {workflow.kind === "event" ? (
                <Section title={t("workflows.sectionWebhook")}>
                    <DetailRow label={t("workflows.detailSlug")} value={workflow.trigger.slug} mono />
                    <DetailRow label={t("workflows.detailNextRun")} value={workflowNextRunValue(workflow)} />
                    <DetailRow label={t("workflows.detailLastTriggered")} value={formatDate(workflow.trigger.lastTriggeredAt)} />
                    <DetailRow label={t("workflows.detailFires")} value={String(workflow.triggerCount)} />
                    <DetailRow label={t("workflows.detailCreated")} value={formatDate(workflow.trigger.createdAt)} />
                    <DetailRow label={t("workflows.detailUpdated")} value={formatDate(workflow.trigger.updatedAt)} />
                    <PromptBlock prompt={workflow.trigger.prompt} />
                </Section>
            ) : null}

            {workflow.kind === "loop" ? (
                <Section title={t("workflows.sectionLoop")}>
                    <DetailRow label={t("workflows.detailDirectory")} value={workflow.loop.directory} mono />
                    <DetailRow label={t("workflows.detailAgent")} value={workflow.loop.agent} />
                    <DetailRow label={t("workflows.detailIteration")} value={String(workflow.loop.iteration)} />
                    <DetailRow label={t("workflows.detailRuntimeState")} value={workflow.loop.runtimeState} />
                    <DetailRow label={t("workflows.detailPhase")} value={workflow.loop.phase} />
                    <DetailRow label={t("workflows.detailInterval")} value={workflow.loop.cronExpression ?? formatInterval(workflow.loop.intervalMs)} mono={!!workflow.loop.cronExpression} />
                    <DetailRow label={t("workflows.detailNextRun")} value={workflowNextRunValue(workflow)} />
                    <DetailRow label={t("workflows.detailRole")} value={workflow.role} />
                    <DetailRow label={t("workflows.detailProjectId")} value={workflow.projectId ?? t("workflows.detailNever")} mono />
                    {workflow.loop.createdAt ? (
                        <DetailRow label={t("workflows.detailCreated")} value={formatDate(workflow.loop.createdAt)} />
                    ) : null}
                    {workflow.loop.updatedAt ? (
                        <DetailRow label={t("workflows.detailUpdated")} value={formatDate(workflow.loop.updatedAt)} />
                    ) : null}
                    {workflow.loop.lastError ? (
                        <DetailRow label={t("workflows.detailLastError")} value={workflow.loop.lastError} />
                    ) : null}
                    {workflow.loop.prompt ? <PromptBlock prompt={workflow.loop.prompt} /> : null}
                </Section>
            ) : null}

            <WorkflowModelEffortEditor workflow={workflow} />
        </BottomSheet>
    );
});

/** Current model-mode KEY + effort persisted on the workflow, if any. */
function currentModelEffort(
    workflow: Workflow,
): { modelMode: string | null; effort: string | null } | null {
    if (workflow.kind === "scheduled" || workflow.kind === "event") {
        return {
            modelMode: workflow.trigger.modelMode ?? null,
            effort: workflow.trigger.effort ?? null,
        };
    }
    // Loops are only editable when bound to a server project AND running a
    // Claude agent (model/effort overrides are Claude-only).
    if (workflow.kind === "loop" && workflow.projectId && workflow.loop.agent === "claude") {
        return {
            modelMode: workflow.loop.modelMode ?? null,
            effort: workflow.loop.effort ?? null,
        };
    }
    return null;
}

/**
 * Inline editor for a trigger's per-spawn model + reasoning effort. Renders
 * the same picker used by the create modals, initialised from the workflow's
 * stored values, and persists via the kind-appropriate update endpoint.
 * Returns null for kinds that can't carry overrides (ad-hoc, CLI-local loops).
 */
function WorkflowModelEffortEditor({ workflow }: { workflow: Workflow }) {
    const { theme } = useUnistyles();
    const current = currentModelEffort(workflow);

    const [modelModeKey, setModelModeKey] = React.useState<string>(
        current?.modelMode ?? "default",
    );
    const [effortLevel, setEffortLevel] = React.useState<string | null>(
        current?.effort ?? null,
    );

    // Re-seed when the sheet swaps to a different workflow without unmounting.
    React.useEffect(() => {
        setModelModeKey(current?.modelMode ?? "default");
        setEffortLevel(current?.effort ?? null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workflow.id]);

    const dirty =
        modelModeKey !== (current?.modelMode ?? "default") ||
        effortLevel !== (current?.effort ?? null);

    const [loading, save] = useHappyAction(async () => {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) throw new Error(t("errors.authenticationFailed"));
        const modelMode = modelModeKey === "default" ? null : modelModeKey;
        const effort = effortLevel ?? null;
        if (workflow.kind === "scheduled") {
            await updateTriggerSchedule(credentials, workflow.trigger.id, { modelMode, effort });
        } else if (workflow.kind === "event") {
            await updateWebhookTrigger(credentials, workflow.trigger.id, { modelMode, effort });
        } else if (workflow.kind === "loop" && workflow.projectId) {
            await updateAgentLoop(credentials, workflow.projectId, workflow.loop.id, { modelMode, effort });
        }
        notifyWorkflowSourcesChanged();
    });

    if (!current) return null;

    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("workflows.sectionModel")}</Text>
            <View style={styles.editorBody}>
                <TriggerModelEffortSection
                    modelModeKey={modelModeKey}
                    onSelectModel={setModelModeKey}
                    effortLevel={effortLevel}
                    onSelectEffort={setEffortLevel}
                />
                <Pressable
                    style={[
                        styles.button,
                        dirty && !loading ? styles.buttonPrimary : styles.buttonPrimaryDisabled,
                        { alignSelf: "flex-start" },
                    ]}
                    disabled={!dirty || loading}
                    onPress={save}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                    ) : (
                        <Text style={[
                            styles.buttonText,
                            dirty ? styles.buttonTextPrimary : styles.buttonTextPrimaryDisabled,
                        ]}>
                            {t("common.save")}
                        </Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <View style={styles.sectionCard}>{children}</View>
        </View>
    );
}

function DetailRow({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={[styles.detailValue, mono && styles.detailValueMono]} numberOfLines={2}>
                {value}
            </Text>
        </View>
    );
}

function PromptBlock({ prompt }: { prompt: string }) {
    return (
        <View style={styles.promptBlock}>
            <Text style={styles.detailLabel}>{t("workflows.detailPrompt")}</Text>
            <Text style={styles.promptText} numberOfLines={6}>{prompt}</Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    hero: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 12,
        borderRadius: 12,
        backgroundColor: `${theme.colors.accentBlue}14`,
    },
    heroIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${theme.colors.accentBlue}1F`,
    },
    heroTextColumn: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    heroTitle: {
        fontSize: 15,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    heroSubtitle: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    section: {
        gap: 6,
    },
    sectionTitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.1,
        ...Typography.default("semiBold"),
    },
    sectionCard: {
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        overflow: "hidden",
    },
    editorBody: {
        gap: 12,
    },
    detailRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    detailLabel: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    detailValue: {
        flex: 1,
        textAlign: "right",
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
    },
    detailValueMono: {
        fontFamily: "Menlo",
    },
    promptBlock: {
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    promptText: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.text,
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
