/**
 * Dynamic Workflows viewer (Phase 5).
 *
 * Browses the project-local `<cwd>/.happy/workflows/*.js` replay scripts the CLI
 * `happy workflow run` command persists, and renders each workflow's roles,
 * models, and wave order for on-device review.
 *
 * Route: /session/{id}/workflows
 */
import * as React from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import type { WorkflowDefinition, WorkflowStep } from "@kmmao/happy-wire";
import { storage } from "@/sync/storage";
import { sessionListDirectory, sessionReadFile } from "@/sync/ops";
import { decodeBase64 } from "@/encryption/base64";
import { decodeUTF8 } from "@/encryption/text";
import { parseWorkflowJs } from "@/utils/parseWorkflowJs";
import { useHappyAction } from "@/hooks/useHappyAction";
import { t } from "@/text";
import { log } from "@/log";

function groupWaves(steps: WorkflowStep[]): WorkflowStep[][] {
    const byOrder = new Map<number, WorkflowStep[]>();
    for (const s of steps) {
        const w = byOrder.get(s.order) ?? [];
        w.push(s);
        byOrder.set(s.order, w);
    }
    return [...byOrder.keys()].sort((a, b) => a - b).map((o) => byOrder.get(o)!);
}

export default React.memo(function WorkflowsPage() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const [workflows, setWorkflows] = React.useState<WorkflowDefinition[] | null>(null);

    const [loading, load] = useHappyAction(async () => {
        const cwd = storage.getState().sessions[sessionId]?.metadata?.path;
        if (!cwd) {
            setWorkflows([]);
            return;
        }
        const dir = `${cwd}/.happy/workflows`;
        const listed = await sessionListDirectory(sessionId, dir);
        const jsFiles = (listed.entries ?? [])
            .filter((e) => e.type === "file" && e.name.endsWith(".js"))
            .map((e) => e.name);

        const parsed: WorkflowDefinition[] = [];
        for (const name of jsFiles) {
            try {
                const res = await sessionReadFile(sessionId, `${dir}/${name}`);
                if (!res.success || !res.content) continue;
                const wf = parseWorkflowJs(decodeUTF8(decodeBase64(res.content)));
                if (wf) parsed.push(wf);
            } catch (e) {
                log.error("Failed to read workflow file:", e);
            }
        }
        parsed.sort((a, b) => b.createdAt - a.createdAt);
        setWorkflows(parsed);
    });

    React.useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    if (loading && workflows === null) {
        return (
            <View style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!workflows || workflows.length === 0) {
        return (
            <View style={styles.center}>
                <Text style={styles.empty}>{t("dynamicWorkflows.empty")}</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, gap: 12 }}>
            {workflows.map((wf) => (
                <View key={wf.id} style={styles.card}>
                    <Text style={styles.goal} numberOfLines={2}>
                        {wf.goal}
                    </Text>
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
                                        <Text style={styles.role}>{step.role}</Text>
                                        <Text style={styles.model}>{step.model ?? "default"}</Text>
                                    </View>
                                    <Text style={styles.prompt} numberOfLines={3}>
                                        {step.prompt}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            ))}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.groupped.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    empty: { color: theme.colors.textSecondary, textAlign: "center" },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 12,
        gap: 8,
    },
    goal: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    meta: { color: theme.colors.textSecondary, fontSize: 12 },
    wave: {
        gap: 6,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.divider,
        paddingLeft: 10,
    },
    waveLabel: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    step: {
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        padding: 8,
        gap: 2,
    },
    stepHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    role: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
    model: { color: theme.colors.textSecondary, fontSize: 11, fontFamily: "Menlo" },
    prompt: { color: theme.colors.textSecondary, fontSize: 12 },
}));
