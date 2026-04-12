import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import {
    type Law,
    LAW_CATEGORIES,
    LAW_SEVERITIES,
    CATEGORY_LABELS,
    SEVERITY_LABELS,
    SEVERITY_COLORS,
} from "./worldLawConstants";

interface LawEditorProps {
    law: Law;
    onSave: (law: Law) => void;
    onDelete: (lawId: string) => void;
    onClose: () => void;
}

export const LawEditor = React.memo(function LawEditor({ law, onSave, onDelete, onClose }: LawEditorProps) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState<Law>(law);
    const isNew = !law.description;

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
                        <Text style={styles.modalTitle}>
                            {isNew ? t("world.addLaw") : t("world.editLaw")}
                        </Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {/* Description */}
                    <Text style={styles.fieldLabel}>{t("world.lawDescription")}</Text>
                    <TextInput
                        style={styles.modalInput}
                        value={draft.description}
                        onChangeText={(text) => setDraft((d) => ({ ...d, description: text }))}
                        placeholder={t("world.narrativePlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        maxLength={500}
                        autoFocus
                    />

                    {/* Category */}
                    <Text style={styles.fieldLabel}>{t("world.lawCategory")}</Text>
                    <View style={styles.chipRow}>
                        {LAW_CATEGORIES.map((cat) => (
                            <Pressable
                                key={cat}
                                style={[
                                    styles.chip,
                                    draft.category === cat && styles.chipSelected,
                                ]}
                                onPress={() => setDraft((d) => ({ ...d, category: cat }))}
                            >
                                <Text style={[
                                    styles.chipText,
                                    draft.category === cat && styles.chipTextSelected,
                                ]}>
                                    {CATEGORY_LABELS[cat]?.() ?? cat}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Severity */}
                    <Text style={styles.fieldLabel}>{t("world.lawSeverity")}</Text>
                    <View style={styles.chipRow}>
                        {LAW_SEVERITIES.map((sev) => (
                            <Pressable
                                key={sev}
                                style={[
                                    styles.chip,
                                    draft.severity === sev && { backgroundColor: SEVERITY_COLORS[sev] },
                                ]}
                                onPress={() => setDraft((d) => ({ ...d, severity: sev }))}
                            >
                                <Text style={[
                                    styles.chipText,
                                    draft.severity === sev && { color: "#fff" },
                                ]}>
                                    {SEVERITY_LABELS[sev]?.() ?? sev}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Actions */}
                    <View style={styles.modalActions}>
                        {!isNew && (
                            <Pressable
                                style={styles.deleteButton}
                                onPress={() => { onDelete(draft.id); onClose(); }}
                            >
                                <Text style={styles.deleteButtonText}>{t("world.deleteLaw")}</Text>
                            </Pressable>
                        )}
                        <View style={{ flex: 1 }} />
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.confirmButton, !draft.description.trim() && styles.saveButtonDisabled]}
                            disabled={!draft.description.trim()}
                            onPress={() => onSave(draft)}
                        >
                            <Text style={styles.confirmButtonText}>{t("world.save")}</Text>
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
    modalInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        padding: 12,
        minHeight: 80,
        textAlignVertical: "top" as const,
    },
    chipRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.divider,
    },
    chipSelected: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    chipTextSelected: {
        color: "#fff",
    },
    modalActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginTop: 20,
        gap: 10,
    },
    deleteButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    deleteButtonText: {
        ...Typography.default(),
        fontSize: 14,
        color: "#DC2626",
    },
    cancelButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: theme.colors.divider,
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
    saveButtonDisabled: {
        opacity: 0.4,
    },
}));
