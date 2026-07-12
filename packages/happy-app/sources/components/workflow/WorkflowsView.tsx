/**
 * Dynamic Workflows viewer (Phase 5) with live progress — reusable across the
 * session route and the project detail tab.
 *
 * Browses `<cwd>/.happy/workflows/*.json` run-state files (written by the CLI
 * `happy workflow run` / `workflowRun` RPC), renders each workflow's goal,
 * waves, roles, models, per-step status, and isolation branches. Polls while
 * any workflow is still running.
 */
import * as React from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { WorkflowRun, WorkflowStep, WorkflowStepStatus } from "@kmmao/happy-wire";
import { storage } from "@/sync/storage";
import {
    sessionListDirectory,
    sessionReadFile,
    sessionCancelWorkflow,
    sessionDeleteWorkflow,
    sessionRunWorkflow,
    sessionWorkflowBranchAction,
    sessionWorkflowBranchDiff,
} from "@/sync/ops";
import { decodeBase64 } from "@/encryption/base64";
import { decodeUTF8 } from "@/encryption/text";
import { parseWorkflowRunJson } from "@/utils/parseWorkflowRunJson";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { t } from "@/text";
import { log } from "@/log";

const POLL_MS = 2500;

function groupWaves(steps: WorkflowStep[]): WorkflowStep[][] {
    const byOrder = new Map<number, WorkflowStep[]>();
    for (const s of steps) {
        const w = byOrder.get(s.order) ?? [];
        w.push(s);
        byOrder.set(s.order, w);
    }
    return [...byOrder.keys()].sort((a, b) => a - b).map((o) => byOrder.get(o)!);
}

function StepStatusIcon({ status }: { status: WorkflowStepStatus | undefined }) {
    const { theme } = useUnistyles();
    if (status === "running") return <ActivityIndicator size="small" />;
    if (status === "succeeded")
        return <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />;
    if (status === "failed")
        return (
            <Ionicons
                name="close-circle"
                size={16}
                color={theme.colors.permissionButton.deny.background}
            />
        );
    return <Ionicons name="ellipse-outline" size={14} color={theme.colors.textSecondary} />;
}

export const WorkflowsView = React.memo<{ sessionId: string }>(({ sessionId }) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const [runs, setRuns] = React.useState<WorkflowRun[] | null>(null);
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    const toggleOutput = (key: string) =>
        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    const [branchDiffs, setBranchDiffs] = React.useState<Record<string, string>>({});

    const notifyError = (res: { success: boolean; error?: string }) => {
        if (!res.success) Modal.alert(t("common.error"), res.error ?? "Failed");
    };

    // Card-level actions: stop (running), re-run, delete.
    const openWorkflowMenu = (run: WorkflowRun) => {
        const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];
        if (run.status === "running") {
            buttons.push({
                text: t("dynamicWorkflows.stop"),
                onPress: async () => {
                    notifyError(await sessionCancelWorkflow(sessionId, run.definition.id));
                    load();
                },
            });
        }
        buttons.push({
            text: t("dynamicWorkflows.rerun"),
            onPress: async () => {
                const res = await sessionRunWorkflow(
                    sessionId,
                    { goal: run.definition.goal, steps: run.definition.steps },
                    { dryRun: false, isolation: !!run.branches },
                );
                notifyError(res);
                load();
            },
        });
        buttons.push({
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
                notifyError(await sessionDeleteWorkflow(sessionId, run.definition.id));
                load();
            },
        });
        buttons.push({ text: t("common.cancel"), style: "cancel" });
        Modal.alert(run.definition.goal, undefined, buttons);
    };

    // Branch-level actions: view diff, merge, discard.
    const openBranchMenu = (key: string, branch: string) => {
        Modal.alert(branch, undefined, [
            {
                text: t("githubPr.title"),
                onPress: async () => {
                    const res = await sessionWorkflowBranchDiff(sessionId, branch);
                    if (!res.success) return notifyError(res);
                    setBranchDiffs((prev) => ({ ...prev, [key]: res.diff ?? "" }));
                },
            },
            {
                text: t("dynamicWorkflows.merge"),
                onPress: async () => {
                    notifyError(await sessionWorkflowBranchAction(sessionId, branch, "merge"));
                    load();
                },
            },
            {
                text: t("dynamicWorkflows.discard"),
                style: "destructive",
                onPress: async () => {
                    notifyError(await sessionWorkflowBranchAction(sessionId, branch, "discard"));
                    load();
                },
            },
            { text: t("common.cancel"), style: "cancel" },
        ]);
    };

    const NewButton = (
        <Pressable
            style={styles.newButton}
            onPress={() => router.push(`/session/${sessionId}/workflow-new` as any)}
        >
            <Ionicons name="add" size={18} color={theme.colors.text} />
            <Text style={styles.newButtonText}>{t("dynamicWorkflows.newTitle")}</Text>
        </Pressable>
    );

    const [loading, load] = useHappyAction(async () => {
        const cwd = storage.getState().sessions[sessionId]?.metadata?.path;
        if (!cwd) {
            setRuns([]);
            return;
        }
        const dir = `${cwd}/.happy/workflows`;
        const listed = await sessionListDirectory(sessionId, dir);
        const jsonFiles = (listed.entries ?? [])
            .filter((e) => e.type === "file" && e.name.endsWith(".json"))
            .map((e) => e.name);

        const parsed: WorkflowRun[] = [];
        for (const name of jsonFiles) {
            try {
                const res = await sessionReadFile(sessionId, `${dir}/${name}`);
                if (!res.success || !res.content) continue;
                const run = parseWorkflowRunJson(decodeUTF8(decodeBase64(res.content)));
                if (run) parsed.push(run);
            } catch (e) {
                log.error("Failed to read workflow run file:", e);
            }
        }
        parsed.sort((a, b) => b.updatedAt - a.updatedAt);
        setRuns(parsed);
    });

    React.useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    const anyRunning = React.useMemo(
        () => (runs ?? []).some((r) => r.status === "running"),
        [runs],
    );
    React.useEffect(() => {
        if (!anyRunning) return;
        const timer = setInterval(() => load(), POLL_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyRunning, sessionId]);

    if (loading && runs === null) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!runs || runs.length === 0) {
        return (
            <View style={styles.center}>
                <Text style={styles.empty}>{t("dynamicWorkflows.empty")}</Text>
                {NewButton}
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, gap: 12 }}>
            {NewButton}
            {runs.map((run) => {
                const wf = run.definition;
                const statusLabel =
                    run.status === "running"
                        ? t("dynamicWorkflows.statusRunning")
                        : run.status === "completed"
                          ? t("dynamicWorkflows.statusCompleted")
                          : run.status === "cancelled"
                            ? t("dynamicWorkflows.statusCancelled")
                            : t("dynamicWorkflows.statusFailed");
                const badgeStyle =
                    run.status === "running"
                        ? styles.badge_running
                        : run.status === "completed"
                          ? styles.badge_completed
                          : run.status === "cancelled"
                            ? styles.badge_running
                            : styles.badge_failed;
                return (
                    <View key={wf.id} style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.goal} numberOfLines={2}>
                                {wf.goal}
                            </Text>
                            <Text style={[styles.badge, badgeStyle]}>{statusLabel}</Text>
                            <Pressable
                                onPress={() => openWorkflowMenu(run)}
                                hitSlop={8}
                                style={styles.menuBtn}
                            >
                                <Ionicons
                                    name="ellipsis-horizontal"
                                    size={18}
                                    color={theme.colors.textSecondary}
                                />
                            </Pressable>
                        </View>
                        <Text style={styles.meta}>
                            {t("dynamicWorkflows.stepCount", { count: wf.steps.length })}
                        </Text>
                        {groupWaves(wf.steps).map((wave, wi) => (
                            <View key={wi} style={styles.wave}>
                                <Text style={styles.waveLabel}>
                                    {t("dynamicWorkflows.wave", { index: wi + 1 })}
                                </Text>
                                {wave.map((step) => (
                                    <View key={step.id} style={styles.step}>
                                        <View style={styles.stepHeader}>
                                            <View style={styles.stepHeaderLeft}>
                                                <StepStatusIcon status={run.steps[step.id]} />
                                                <Text style={styles.role}>{step.role}</Text>
                                            </View>
                                            <Text style={styles.model}>{step.model ?? "default"}</Text>
                                        </View>
                                        <Text style={styles.prompt} numberOfLines={3}>
                                            {step.prompt}
                                        </Text>
                                        {run.branches?.[step.id] ? (
                                            <>
                                                <Pressable
                                                    style={styles.branchRow}
                                                    onPress={() =>
                                                        openBranchMenu(
                                                            `${wf.id}:${step.id}`,
                                                            run.branches![step.id],
                                                        )
                                                    }
                                                >
                                                    <Ionicons
                                                        name="git-branch-outline"
                                                        size={11}
                                                        color={theme.colors.textSecondary}
                                                    />
                                                    <Text style={styles.branch} numberOfLines={1}>
                                                        {run.branches[step.id]}
                                                    </Text>
                                                    <Ionicons
                                                        name="ellipsis-horizontal"
                                                        size={12}
                                                        color={theme.colors.textSecondary}
                                                    />
                                                </Pressable>
                                                {branchDiffs[`${wf.id}:${step.id}`] !== undefined ? (
                                                    <Text style={styles.output} selectable>
                                                        {branchDiffs[`${wf.id}:${step.id}`] ||
                                                            t("dynamicWorkflows.noDiff")}
                                                    </Text>
                                                ) : null}
                                            </>
                                        ) : null}
                                        {run.outputs?.[step.id] ? (
                                            <View>
                                                <Pressable
                                                    style={styles.outputToggle}
                                                    onPress={() => toggleOutput(`${wf.id}:${step.id}`)}
                                                >
                                                    <Ionicons
                                                        name={
                                                            expanded[`${wf.id}:${step.id}`]
                                                                ? "chevron-down"
                                                                : "chevron-forward"
                                                        }
                                                        size={12}
                                                        color={theme.colors.textSecondary}
                                                    />
                                                    <Text style={styles.outputToggleText}>
                                                        {t("dynamicWorkflows.output")}
                                                    </Text>
                                                </Pressable>
                                                {expanded[`${wf.id}:${step.id}`] ? (
                                                    <Text style={styles.output} selectable>
                                                        {run.outputs[step.id]}
                                                    </Text>
                                                ) : null}
                                            </View>
                                        ) : null}
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                );
            })}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.groupped.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
    empty: { color: theme.colors.textSecondary, textAlign: "center" },
    newButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderStyle: "dashed",
    },
    newButtonText: { color: theme.colors.text, fontWeight: "600" },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 12,
        gap: 8,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    menuBtn: { padding: 2 },
    goal: { color: theme.colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
    badge: {
        fontSize: 11,
        fontWeight: "700",
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
        overflow: "hidden",
    },
    badge_running: { color: theme.colors.text, backgroundColor: theme.colors.surfacePressed },
    badge_completed: { color: theme.colors.success, backgroundColor: `${theme.colors.success}1e` },
    badge_failed: {
        color: theme.colors.permissionButton.deny.background,
        backgroundColor: `${theme.colors.permissionButton.deny.background}1e`,
    },
    meta: { color: theme.colors.textSecondary, fontSize: 12 },
    wave: { gap: 6, borderLeftWidth: 2, borderLeftColor: theme.colors.divider, paddingLeft: 10 },
    waveLabel: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        fontWeight: "700",
        textTransform: "uppercase",
    },
    step: { backgroundColor: theme.colors.surfacePressed, borderRadius: 8, padding: 8, gap: 2 },
    stepHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    stepHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    role: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
    model: { color: theme.colors.textSecondary, fontSize: 11 },
    prompt: { color: theme.colors.textSecondary, fontSize: 12 },
    branchRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    branch: { color: theme.colors.textSecondary, fontSize: 11, flexShrink: 1 },
    outputToggle: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
    outputToggleText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "600" },
    output: {
        color: theme.colors.text,
        fontSize: 11,
        fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 6,
        padding: 8,
        marginTop: 4,
    },
}));
