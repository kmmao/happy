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
import { formSheetStyles as fs } from "@/components/formSheetStyles";

interface GoalCreateSheetProps {
    project: Project;
    onCreated: (goal: GoalSummary) => void;
    onClose: () => void;
}

type PriorityKey = "urgent" | "normal" | "low";
const PRIORITIES: readonly PriorityKey[] = ["urgent", "normal", "low"];

export const GoalCreateSheet = React.memo(function GoalCreateSheet({
    project,
    onCreated,
    onClose,
}: GoalCreateSheetProps) {
    const { theme } = useUnistyles();
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [priority, setPriority] = React.useState<PriorityKey>("normal");
    const [autoDecompose, setAutoDecompose] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [titleFocused, setTitleFocused] = React.useState(false);
    const [descFocused, setDescFocused] = React.useState(false);

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

    const canSave = title.trim().length > 0 && !saving;

    return (
        <View style={local.modalOverlay}>
            <Pressable style={local.modalBackdrop} onPress={onClose} />
            <ScrollView
                style={local.modalScroll}
                contentContainerStyle={local.modalScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={local.modalContent}>
                    {/* ── Header ── */}
                    <View style={fs.header}>
                        <Text style={fs.headerTitle}>{t("goals.createGoal")}</Text>
                        <Pressable style={fs.closeButton} onPress={onClose} hitSlop={8}>
                            <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {/* ── Section 1: Title + Description ── */}
                    <View style={fs.sectionGroup}>
                        <View style={fs.fieldContainer}>
                            <View style={[
                                fs.accentBar,
                                titleFocused && { backgroundColor: theme.colors.accentPurple },
                            ]} />
                            <View style={fs.fieldInner}>
                                <Text style={[
                                    fs.floatingLabel,
                                    titleFocused && { color: theme.colors.accentPurple },
                                ]}>
                                    {t("goals.goalTitle")}
                                </Text>
                                <TextInput
                                    style={fs.textInput}
                                    value={title}
                                    onChangeText={setTitle}
                                    placeholder={t("goals.goalTitlePlaceholder")}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    maxLength={500}
                                    autoFocus
                                    onFocus={() => setTitleFocused(true)}
                                    onBlur={() => setTitleFocused(false)}
                                />
                            </View>
                        </View>

                        <View style={fs.insetDivider} />

                        <View style={fs.fieldContainer}>
                            <View style={[
                                fs.accentBar,
                                descFocused && { backgroundColor: theme.colors.accentPurple },
                            ]} />
                            <View style={fs.fieldInner}>
                                <Text style={[
                                    fs.floatingLabel,
                                    descFocused && { color: theme.colors.accentPurple },
                                ]}>
                                    {t("goals.goalDescription")}
                                </Text>
                                <TextInput
                                    style={[fs.textInput, { minHeight: 72 }]}
                                    value={description}
                                    onChangeText={setDescription}
                                    placeholder={t("goals.goalDescriptionPlaceholder")}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    multiline
                                    textAlignVertical="top"
                                    maxLength={5000}
                                    onFocus={() => setDescFocused(true)}
                                    onBlur={() => setDescFocused(false)}
                                />
                            </View>
                        </View>
                    </View>

                    {/* ── Section 2: Priority + Auto-decompose ── */}
                    <View style={fs.sectionGroup}>
                        <View style={fs.optionRow}>
                            <Text style={fs.optionLabel}>{t("goals.goalPriority")}</Text>
                            <View style={local.segmentedControl}>
                                {PRIORITIES.map((p) => {
                                    const isActive = priority === p;
                                    return (
                                        <Pressable
                                            key={p}
                                            style={[
                                                local.segment,
                                                isActive && {
                                                    backgroundColor: PRIORITY_COLORS[p] + "18",
                                                    borderColor: PRIORITY_COLORS[p] + "40",
                                                },
                                            ]}
                                            onPress={() => setPriority(p)}
                                        >
                                            <View style={[
                                                local.segmentDot,
                                                { backgroundColor: PRIORITY_COLORS[p] },
                                                !isActive && { opacity: 0.3 },
                                            ]} />
                                            <Text style={[
                                                local.segmentText,
                                                isActive && { color: PRIORITY_COLORS[p], fontWeight: "600" },
                                            ]}>
                                                {priorityLabel(p)}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={fs.insetDivider} />

                        <View style={fs.optionRow}>
                            <View style={local.switchLabelGroup}>
                                <Ionicons
                                    name="git-branch-outline"
                                    size={18}
                                    color={theme.colors.textSecondary}
                                />
                                <Text style={fs.optionLabel}>{t("goals.autoDecompose")}</Text>
                            </View>
                            <Switch
                                value={autoDecompose}
                                onValueChange={setAutoDecompose}
                                trackColor={{
                                    false: theme.colors.switch.track.inactive,
                                    true: theme.colors.switch.track.active,
                                }}
                                thumbColor={autoDecompose
                                    ? theme.colors.switch.thumb.active
                                    : theme.colors.switch.thumb.inactive}
                            />
                        </View>
                    </View>

                    {/* ── Actions ── */}
                    <View style={local.actionsSection}>
                        <Pressable
                            style={[fs.primaryButton, !canSave && { opacity: 0.4 }]}
                            disabled={!canSave}
                            onPress={handleSave}
                        >
                            {saving ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={fs.primaryButtonText}>{t("goals.createGoal")}</Text>
                            )}
                        </Pressable>
                        <Pressable style={fs.cancelLink} onPress={onClose} hitSlop={8}>
                            <Text style={fs.cancelLinkText}>{t("common.cancel")}</Text>
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
});

/** Styles specific to GoalCreateSheet (overlay container + priority segments) */
const local = StyleSheet.create((theme) => ({
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
        gap: 20,
    },
    actionsSection: {
        gap: 10,
        alignItems: "center" as const,
    },
    switchLabelGroup: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    segmentedControl: {
        flexDirection: "row" as const,
        gap: 6,
    },
    segment: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "transparent",
    },
    segmentDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    segmentText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
}));
