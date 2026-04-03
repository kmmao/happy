import * as React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BaseModal } from "@/modal/components/BaseModal";
import { Modal } from "@/modal";
import {
    machineCreateAutoDreamProfile,
    machineUpdateAutoDreamProfile,
    type MachineAutoDreamProfile,
} from "@/sync/ops";
import { t } from "@/text";
import { formatIntervalMs, parseIntervalMs, parsePositiveInteger } from "./loopsUtils";
import { getLoopFormLayoutMode, getLoopModalMetrics } from "./loopsLayout";

export interface AutoDreamProfileEditorModalProps {
    visible: boolean;
    onClose: () => void;
    onSaved: () => void;
    machineId: string | undefined;
    editingProfile: MachineAutoDreamProfile | null;
}

export const AutoDreamProfileEditorModal = React.memo(function AutoDreamProfileEditorModal({
    visible,
    onClose,
    onSaved,
    machineId,
    editingProfile,
}: AutoDreamProfileEditorModalProps) {
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

    const [name, setName] = React.useState("");
    const [rootDirectory, setRootDirectory] = React.useState("");
    const [interval, setInterval] = React.useState("12h");
    const [maxDepth, setMaxDepth] = React.useState("");
    const [limit, setLimit] = React.useState("");
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (visible && editingProfile) {
            setName(editingProfile.name ?? "");
            setRootDirectory(editingProfile.rootDirectory);
            setInterval(formatIntervalMs(editingProfile.intervalMs));
            setMaxDepth(editingProfile.maxDepth != null ? String(editingProfile.maxDepth) : "");
            setLimit(editingProfile.limit != null ? String(editingProfile.limit) : "");
        } else if (visible && !editingProfile) {
            setName("");
            setRootDirectory("");
            setInterval("12h");
            setMaxDepth("");
            setLimit("");
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
                ? await machineUpdateAutoDreamProfile(machineId, editingProfile.id, {
                    name: name.trim() || null,
                    rootDirectory: rootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? null,
                    limit: parsedLimit ?? null,
                })
                : await machineCreateAutoDreamProfile(machineId, {
                    name: name.trim() || undefined,
                    rootDirectory: rootDirectory.trim(),
                    intervalMs: parsedInterval,
                    maxDepth: parsedMaxDepth ?? undefined,
                    limit: parsedLimit ?? undefined,
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
    }, [editingProfile, handleClose, interval, limit, machineId, maxDepth, name, onSaved, rootDirectory]);

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
                <View style={[
                    styles.modalHeader,
                    formLayout.modalHeaderStacked ? styles.modalHeaderStacked : null,
                    { borderBottomColor: theme.colors.divider, paddingHorizontal: modalMetrics.horizontalPadding },
                ]}>
                    <View style={styles.modalHeaderTextWrap}>
                        <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{editingProfile ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>
                        <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>{t("machine.autoDreamHint")}</Text>
                    </View>
                    <Pressable style={[styles.modalDismissButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]} onPress={handleClose}>
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
                <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingHorizontal: modalMetrics.horizontalPadding }]}>
                    <View style={styles.formSection}>
                        <View style={[styles.modalInfoBanner, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                            <Text style={[styles.modalInfoTitle, { color: theme.colors.text }]}>{t("machine.autoDreamProfiles")}</Text>
                            <Text style={[styles.modalInfoText, { color: theme.colors.textSecondary }]}>{t("machine.autoDreamHint")}</Text>
                        </View>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopNameOptional")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={name}
                            onChangeText={setName}
                        />
                        <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintLoopName")}</Text>
                        <TextInput
                            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                            placeholder={t("machine.agentLoopPath")}
                            placeholderTextColor={theme.colors.textSecondary}
                            value={rootDirectory}
                            onChangeText={setRootDirectory}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintDreamRootDir")}</Text>
                        <View style={styles.row}>
                            <View style={styles.rowInput}>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopInterval")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={interval}
                                    onChangeText={setInterval}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintDreamInterval")}</Text>
                            </View>
                            <View style={styles.rowInput}>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopBootstrapMaxDepth")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={maxDepth}
                                    onChangeText={setMaxDepth}
                                    keyboardType="number-pad"
                                />
                                <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintDreamMaxDepth")}</Text>
                            </View>
                            <View style={styles.rowInput}>
                                <TextInput
                                    style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                    placeholder={t("machine.agentLoopBootstrapLimit")}
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={limit}
                                    onChangeText={setLimit}
                                    keyboardType="number-pad"
                                />
                                <Text style={[styles.hintText, { color: theme.colors.textSecondary }]}>{t("machine.hintDreamLimit")}</Text>
                            </View>
                        </View>
                        <View style={styles.actionsRow}>
                            <Pressable
                                style={[styles.primaryButton, { backgroundColor: theme.colors.button.primary.background, opacity: saving ? 0.7 : 1 }]}
                                onPress={() => void handleSave()}
                                disabled={saving}
                            >
                                {saving ? <ActivityIndicator size="small" color={theme.colors.button.primary.tint} /> : <Text style={[styles.createButtonText, { color: theme.colors.button.primary.tint }]}>{editingProfile ? t("machine.agentLoopEdit") : t("machine.agentLoopCreate")}</Text>}
                            </Pressable>
                            <Pressable
                                style={[styles.secondaryButton, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}
                                onPress={handleClose}
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
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 16,
        borderBottomWidth: 1,
        gap: 16,
    },
    modalHeaderStacked: {
        alignItems: "flex-start",
        flexDirection: "column",
    },
    modalHeaderTextWrap: {
        flex: 1,
        gap: 4,
    },
    modalTitle: {
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
        alignSelf: Platform.OS === "web" ? "auto" : "flex-end",
    },
    modalScroll: {
        width: "100%",
        flexGrow: 0,
    },
    modalScrollContent: {
        paddingBottom: 24,
    },
    modalInfoBanner: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 4,
        marginBottom: 4,
    },
    modalInfoTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    modalInfoText: {
        fontSize: 13,
        lineHeight: 18,
    },
    formSection: {
        padding: 16,
        gap: 8,
    },
    hintText: {
        fontSize: 12,
        lineHeight: 16,
        marginTop: -2,
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    row: {
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 8,
    },
    rowInput: {
        flex: 1,
    },
    actionsRow: {
        flexDirection: Platform.OS === "web" ? "row" : "column",
        gap: 10,
    },
    primaryButton: {
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
