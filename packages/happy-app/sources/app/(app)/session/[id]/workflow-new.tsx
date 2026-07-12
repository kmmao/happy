/**
 * Create & run a Dynamic Workflow from the app (Phase 5).
 *
 * Builds a workflow spec (goal + role steps) and triggers it on the session's
 * machine via the `workflowRun` RPC — no CLI command needed. On success it
 * returns to the Workflows screen, which polls the live run-state.
 *
 * Route: /session/{id}/workflow-new
 */
import * as React from "react";
import {
    View,
    Text,
    TextInput,
    ScrollView,
    Pressable,
    Switch,
    ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { sessionRunWorkflow } from "@/sync/ops";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { t } from "@/text";

interface StepDraft {
    role: string;
    prompt: string;
    model: string;
    order: string;
}

const emptyStep = (): StepDraft => ({ role: "", prompt: "", model: "", order: "0" });

export default React.memo(function WorkflowNewPage() {
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const [goal, setGoal] = React.useState("");
    const [dryRun, setDryRun] = React.useState(true);
    const [steps, setSteps] = React.useState<StepDraft[]>([emptyStep()]);

    const updateStep = (i: number, patch: Partial<StepDraft>) =>
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const removeStep = (i: number) =>
        setSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

    const [running, run] = useHappyAction(async () => {
        const cleaned = steps
            .map((s, i) => ({
                id: `s${i}`,
                role: s.role.trim(),
                prompt: s.prompt.trim(),
                model: s.model.trim() || undefined,
                order: Number.parseInt(s.order, 10) || 0,
            }))
            .filter((s) => s.role && s.prompt);
        if (!goal.trim() || cleaned.length === 0) {
            Modal.alert(t("common.error"), t("dynamicWorkflows.validationError"));
            return;
        }
        const res = await sessionRunWorkflow(sessionId, { goal: goal.trim(), steps: cleaned }, dryRun);
        if (!res.success) {
            Modal.alert(t("common.error"), res.error ?? "Failed to start workflow");
            return;
        }
        router.back();
    });

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 12, gap: 12 }}>
            <TextInput
                style={styles.goalInput}
                placeholder={t("dynamicWorkflows.goalPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={goal}
                onChangeText={setGoal}
                multiline
            />

            {steps.map((step, i) => (
                <View key={i} style={styles.stepCard}>
                    <View style={styles.stepTop}>
                        <TextInput
                            style={styles.roleInput}
                            placeholder={t("dynamicWorkflows.rolePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={step.role}
                            onChangeText={(v) => updateStep(i, { role: v })}
                        />
                        <Pressable onPress={() => removeStep(i)} hitSlop={8} style={styles.remove}>
                            <Ionicons name="close-circle" size={20} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <TextInput
                        style={styles.promptInput}
                        placeholder={t("dynamicWorkflows.promptPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={step.prompt}
                        onChangeText={(v) => updateStep(i, { prompt: v })}
                        multiline
                    />
                    <View style={styles.stepMetaRow}>
                        <TextInput
                            style={styles.modelInput}
                            placeholder={t("dynamicWorkflows.modelPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={step.model}
                            onChangeText={(v) => updateStep(i, { model: v })}
                            autoCapitalize="none"
                        />
                        <View style={styles.orderBox}>
                            <Text style={styles.orderLabel}>{t("dynamicWorkflows.orderLabel")}</Text>
                            <TextInput
                                style={styles.orderInput}
                                value={step.order}
                                onChangeText={(v) => updateStep(i, { order: v.replace(/[^0-9]/g, "") })}
                                keyboardType="number-pad"
                            />
                        </View>
                    </View>
                </View>
            ))}

            <Pressable style={styles.addStep} onPress={() => setSteps((p) => [...p, emptyStep()])}>
                <Ionicons name="add" size={18} color={theme.colors.text} />
                <Text style={styles.addStepText}>{t("dynamicWorkflows.addStep")}</Text>
            </Pressable>

            <View style={styles.dryRunRow}>
                <Text style={styles.dryRunLabel}>{t("dynamicWorkflows.dryRun")}</Text>
                <Switch value={dryRun} onValueChange={setDryRun} />
            </View>

            <Pressable
                style={({ pressed }) => [styles.runButton, pressed && { opacity: 0.8 }]}
                onPress={() => run()}
                disabled={running}
            >
                {running ? (
                    <ActivityIndicator color={theme.colors.groupped.background} />
                ) : (
                    <Text style={styles.runButtonText}>{t("dynamicWorkflows.run")}</Text>
                )}
            </Pressable>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.groupped.background },
    goalInput: {
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 12,
        fontSize: 15,
        color: theme.colors.text,
        minHeight: 52,
    },
    stepCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        padding: 10,
        gap: 8,
    },
    stepTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    roleInput: {
        flex: 1,
        fontSize: 14,
        fontWeight: "600",
        color: theme.colors.text,
        paddingVertical: 4,
    },
    remove: { padding: 2 },
    promptInput: {
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        padding: 8,
        fontSize: 13,
        color: theme.colors.text,
        minHeight: 44,
    },
    stepMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    modelInput: {
        flex: 1,
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        fontSize: 12,
        color: theme.colors.text,
    },
    orderBox: { flexDirection: "row", alignItems: "center", gap: 4 },
    orderLabel: { color: theme.colors.textSecondary, fontSize: 12 },
    orderInput: {
        backgroundColor: theme.colors.surfacePressed,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 13,
        color: theme.colors.text,
        minWidth: 44,
        textAlign: "center",
    },
    addStep: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        borderStyle: "dashed",
    },
    addStepText: { color: theme.colors.text, fontWeight: "600" },
    dryRunRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 4,
    },
    dryRunLabel: { color: theme.colors.text, fontSize: 14 },
    runButton: {
        backgroundColor: theme.colors.text,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center",
        marginTop: 4,
    },
    runButtonText: { color: theme.colors.groupped.background, fontSize: 16, fontWeight: "700" },
}));
