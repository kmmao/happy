import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, Switch, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { Project } from "@/sync/projectManager";
import { createGoal, type GoalSummary } from "@/sync/apiProjects";
import { PRIORITY_COLORS, priorityLabel } from "./worldGoalConstants";

interface GoalCreateSheetProps {
    project: Project;
    onCreated: (goal: GoalSummary) => void;
    onClose: () => void;
}

export const GoalCreateSheet = React.memo(function GoalCreateSheet({
    project,
    onCreated,
    onClose,
}: GoalCreateSheetProps) {
    const { theme } = useUnistyles();
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [priority, setPriority] = React.useState("normal");
    const [autoDecompose, setAutoDecompose] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    const handleSave = React.useCallback(async () => {
        if (!title.trim() || !project.serverId) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const goal = await createGoal(credentials, project.serverId, {
                title: title.trim(),
                description: description.trim() || undefined,
                priority,
                machineId: project.key.machineId,
                autoDecompose,
            });
            onCreated(goal);
        } catch {
            Modal.toast(t("goals.createError"));
        } finally {
            setSaving(false);
        }
    }, [title, description, priority, autoDecompose, project.serverId, project.key.machineId, onCreated]);

    return (
        <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={onClose} />
            <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>{t("goals.createGoal")}</Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    <Text style={styles.fieldLabel}>{t("goals.goalTitle")}</Text>
                    <TextInput
                        style={styles.textInput}
                        value={title}
                        onChangeText={setTitle}
                        placeholder={t("goals.goalTitlePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        maxLength={500}
                        autoFocus
                    />

                    <Text style={styles.fieldLabel}>{t("goals.goalDescription")}</Text>
                    <TextInput
                        style={[styles.textInput, { minHeight: 80 }]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder={t("goals.goalDescriptionPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        textAlignVertical="top"
                        maxLength={5000}
                    />

                    <Text style={styles.fieldLabel}>{t("goals.goalPriority")}</Text>
                    <View style={styles.chipRow}>
                        {(["urgent", "normal", "low"] as const).map((p) => (
                            <Pressable
                                key={p}
                                style={[
                                    styles.chip,
                                    priority === p && { backgroundColor: PRIORITY_COLORS[p] },
                                ]}
                                onPress={() => setPriority(p)}
                            >
                                <Text style={[styles.chipText, priority === p && { color: "#fff" }]}>
                                    {priorityLabel(p)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>{t("goals.autoDecompose")}</Text>
                        <Switch value={autoDecompose} onValueChange={setAutoDecompose} />
                    </View>

                    <View style={styles.modalActions}>
                        <View style={{ flex: 1 }} />
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.confirmButton, (!title.trim() || saving) && { opacity: 0.4 }]}
                            disabled={!title.trim() || saving}
                            onPress={handleSave}
                        >
                            {saving ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.confirmButtonText}>{t("common.save")}</Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    modalOverlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "flex-start" as const,
        alignItems: "center" as const,
        zIndex: 100,
    },
    modalBackdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "transparent",
    },
    modalScroll: {
        width: "90%" as const,
        maxWidth: 440,
        maxHeight: "100%" as const,
    },
    modalScrollContent: {
        flexGrow: 1,
        justifyContent: "flex-start" as const,
        paddingTop: 16,
        paddingBottom: 16,
    },
    modalContent: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 20,
    },
    modalHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginBottom: 4,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
    },
    closeButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: theme.colors.groupped.background,
    },
    fieldLabel: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 6,
        marginTop: 12,
    },
    textInput: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
    },
    chipRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.groupped.background,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    switchRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        marginTop: 16,
    },
    switchLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    modalActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 20,
        gap: 10,
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.groupped.background,
    },
    cancelButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    confirmButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    confirmButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#fff",
    },
}));
