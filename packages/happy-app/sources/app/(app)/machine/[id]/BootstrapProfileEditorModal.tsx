import * as React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";
import { Modal } from "@/modal";
import {
    machineCreateAgentLoopBootstrapProfile,
    machineUpdateAgentLoopBootstrapProfile,
    type MachineAgentLoop,
    type MachineAgentLoopBootstrapProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { formatIntervalMs, parseIntervalMs, parsePositiveInteger } from "./loopsUtils";
import { getLoopFormLayoutMode, getLoopModalMetrics } from "./loopsLayout";

export interface BootstrapProfileEditorModalProps {
    visible: boolean;
    onClose: () => void;
    onSaved: () => void;
    machineId: string | undefined;
    editingProfile: MachineAgentLoopBootstrapProfile | null;
}

export const BootstrapProfileEditorModal = React.memo(function BootstrapProfileEditorModal({
    visible,
    onClose,
    onSaved,
    machineId,
    editingProfile,
}: BootstrapProfileEditorModalProps) {
    const { theme } = useUnistyles();
    const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
    const modalMetrics = getLoopModalMetrics({
        viewportWidth,
        viewportHeight,
        isWeb: Platform.OS === "web",
    });
    const formLayout = getLoopFormLayoutMode({
        viewportWidth,
        isWeb: Platform.OS === "web",
    });

    const [profileName, setProfileName] = React.useState("");
    const [rootDirectory, setRootDirectory] = React.useState("");
    const [interval, setInterval] = React.useState("6h");
    const [maxDepth, setMaxDepth] = React.useState("");
    const [limit, setLimit] = React.useState("");
    const [agent, setAgent] = React.useState<MachineAgentLoop["agent"]>("claude");
    const [projectId, setProjectId] = React.useState("");
    const [profileId, setProfileId] = React.useState("");
    const [autoRunCreated, setAutoRunCreated] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (visible && editingProfile) {
            setProfileName(editingProfile.name ?? "");
            setRootDirectory(editingProfile.rootDirectory);
            setInterval(formatIntervalMs(editingProfile.intervalMs));
            setMaxDepth(editingProfile.maxDepth != null ? String(editingProfile.maxDepth) : "");
            setLimit(editingProfile.limit != null ? String(editingProfile.limit) : "");
            setAgent(editingProfile.agent ?? "claude");
            setProfileId(editingProfile.profileId ?? "");
            setProjectId(editingProfile.projectId ?? "");
            setAutoRunCreated(Boolean(editingProfile.autoRunCreatedLoops));
        } else if (visible && !editingProfile) {
            setProfileName("");
            setRootDirectory("");
            setInterval("6h");
            setMaxDepth("");
            setLimit("");
            setAgent("claude");
            setProjectId("");
            setProfileId("");
            setAutoRunCreated(false);
        }
    }, [visible, editingProfile]);

    const handleClose = React.useCallback(() => {
        setSaving(false);
        onClose();
    }, [onClose]);

    const handleSave = React.useCallback(async () => {
        if (!machineId) return;
        const parsedInterval = parseIntervalMs(interval);
        const parsedMaxDepth = parsePositiveInteger(maxDepth);
        const parsedLimit = parsePositiveInteger(limit);
        if (!rootDirectory.trim()) {
            Modal.alert(t("common.error"), t("machine.agentLoopPathRequired"));
            return;
        }
        if (parsedInterval == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopIntervalInvalid"));
            return;
        }
        if (maxDepth.trim() && parsedMaxDepth == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapDepthInvalid"));
            return;
        }
        if (limit.trim() && parsedLimit == null) {
            Modal.alert(t("common.error"), t("machine.agentLoopBootstrapLimitInvalid"));
            return;
        }
        setSaving(true);
        try {
            const result = editingProfile
                ? await machineUpdateAgentLoopBootstrapProfile(machineId, editingProfile.id, {
                    name: profileName.trim() || null,
                    rootDirectory: rootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? null,
                    limit: parsedLimit ?? null,
                    agent,
                    profileId: profileId.trim() || null,
                    projectId: projectId.trim() || null,
                    autoRunCreatedLoops: autoRunCreated,
                })
                : await machineCreateAgentLoopBootstrapProfile(machineId, {
                    name: profileName.trim() || undefined,
                    rootDirectory: rootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? undefined,
                    limit: parsedLimit ?? undefined,
                    agent,
                    profileId: profileId.trim() || undefined,
                    projectId: projectId.trim() || undefined,
                    autoRunCreatedLoops: autoRunCreated,
                    runNow: false,
                });
            if (!result.success) {
                throw new Error(result.errorMessage || t("common.error"));
            }
            onSaved();
            handleClose();
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setSaving(false);
        }
    }, [agent, autoRunCreated, editingProfile, handleClose, interval, limit, machineId, maxDepth, onSaved, profileId, profileName, projectId, rootDirectory]);

    return (
        <BaseModal visible={visible} onClose={handleClose}>
            <View style={[
                styles.modalCard,
                {
                    backgroundColor: theme.colors.surface,
                    width: modalMetrics.width,
                    maxHeight: modalMetrics.maxHeight,
                    minWidth: modalMetrics.minWidth,
                    borderRadius: modalMetrics.borderRadius,
                },
            ]}>
                {/* Header */}
                <View style={[styles.modalHeader, { borderBottomColor: theme.colors.divider, paddingHorizontal: modalMetrics.horizontalPadding }]}>
                    <View style={styles.modalHeaderTopRow}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]} numberOfLines={1}>
                            {editingProfile ? t("machine.bootstrapProfileEdit") : t("machine.automationCreateBootstrapProfile")}
                        </Text>
                        <Pressable style={[styles.modalDismissButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]} onPress={handleClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>
                    <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                        {editingProfile
                            ? (profileName.trim() || rootDirectory.trim() || t("machine.agentLoopBootstrapHint"))
                            : t("machine.agentLoopBootstrapHint")}
                    </Text>
                </View>

                <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingHorizontal: modalMetrics.horizontalPadding }]}>
                    <View style={styles.formSection}>
                        {/* 名称（可选） */}
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopName")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopNameOptional")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={profileName}
                            onChangeText={setProfileName}
                        />

                        {/* 根目录 */}
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopPath")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPathPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={rootDirectory}
                            onChangeText={setRootDirectory}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintBootstrapRootDir")}</Text>

                        {/* 扫描频率 */}
                        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopInterval")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopIntervalPlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={interval}
                            onChangeText={setInterval}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintBootstrapInterval")}</Text>

                        {/* 高级选项 */}
                        <View style={[styles.advancedSection, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopBootstrapMaxDepth")}</Text>
                            <TextInput
                                style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder="4"
                                placeholderTextColor={theme.colors.textSecondary}
                                value={maxDepth}
                                onChangeText={setMaxDepth}
                                keyboardType="number-pad"
                            />
                            <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintBootstrapMaxDepth")}</Text>

                            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopBootstrapLimit")}</Text>
                            <TextInput
                                style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder="25"
                                placeholderTextColor={theme.colors.textSecondary}
                                value={limit}
                                onChangeText={setLimit}
                                keyboardType="number-pad"
                            />
                            <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintBootstrapLimit")}</Text>

                            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.automationAuditProject")}</Text>
                            <TextInput
                                style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder={t("machine.agentLoopProjectPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={projectId}
                                onChangeText={setProjectId}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />

                            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopProfile")}</Text>
                            <TextInput
                                style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                placeholder={t("machine.agentLoopProfilePlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                value={profileId}
                                onChangeText={setProfileId}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />

                            <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{t("machine.agentLoopBootstrapAutoRunCreated")}</Text>
                            <Pressable
                                style={[styles.inlineSecondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                onPress={() => setAutoRunCreated((current) => !current)}
                            >
                                <Text style={{ color: theme.colors.text }}>{autoRunCreated ? t("common.yes") : t("common.no")}</Text>
                            </Pressable>
                            <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintBootstrapAutoRun")}</Text>
                        </View>

                        <View style={[styles.buttonRow, formLayout.fullWidthButtons ? { flexDirection: "column" } : null]}>
                            <Pressable
                                style={[styles.createButton, { backgroundColor: theme.colors.button.primary.background, opacity: saving ? 0.6 : 1 }]}
                                onPress={() => void handleSave()}
                                disabled={saving}
                            >
                                {saving
                                    ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                                    : <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>{t("common.save")}</Text>
                                }
                            </Pressable>
                            <Pressable
                                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                onPress={handleClose}
                                disabled={saving}
                            >
                                <Text style={{ color: theme.colors.textSecondary }}>{t("common.cancel")}</Text>
                            </Pressable>
                        </View>
                    </View>
                </ScrollView>
            </View>
        </BaseModal>
    );
});

const styles = StyleSheet.create((theme) => ({
    modalCard: {
        overflow: "hidden",
        borderWidth: 1,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 10,
    },
    modalHeader: {
        paddingVertical: 14,
        borderBottomWidth: 1,
        gap: 4,
    },
    modalHeaderTopRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    modalTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: "700",
    },
    modalSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    modalDismissButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    modalScroll: {
        width: "100%",
        flexGrow: 0,
    },
    modalScrollContent: {
        paddingBottom: 24,
    },
    formSection: {
        padding: 16,
        gap: 8,
    },
    advancedSection: {
        gap: 8,
        paddingTop: 4,
        marginTop: 4,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingBottom: 12,
    },
    hintText: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: -2,
    },
    label: {
        fontSize: 13,
        fontWeight: "600",
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    inlineSecondaryButton: {
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
        marginTop: 4,
    },
    buttonRow: {
        marginTop: 8,
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 10,
    },
    createButton: {
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    createButtonText: {
        fontSize: 15,
        fontWeight: "600",
    },
    secondaryButton: {
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
}));
