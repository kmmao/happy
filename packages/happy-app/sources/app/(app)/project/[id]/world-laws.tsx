import * as React from "react";
import { View, Text, ScrollView, Switch, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { useProject } from "@/hooks/useProjects";
import { ItemGroup } from "@/components/ItemGroup";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { updateProject } from "@/sync/apiProjects";
import { projectManager } from "@/sync/projectManager";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";

interface Law {
    id: string;
    category: string;
    description: string;
    enabled: boolean;
    severity: string;
}

const LAW_CATEGORIES = ["quality", "security", "architecture", "convention", "custom"] as const;
const LAW_SEVERITIES = ["critical", "high", "medium", "low"] as const;

const CATEGORY_LABELS: Record<string, () => string> = {
    quality: () => t("world.categoryQuality"),
    security: () => t("world.categorySecurity"),
    architecture: () => t("world.categoryArchitecture"),
    convention: () => t("world.categoryConvention"),
    custom: () => t("world.categoryCustom"),
};

const SEVERITY_LABELS: Record<string, () => string> = {
    critical: () => t("world.severityCritical"),
    high: () => t("world.severityHigh"),
    medium: () => t("world.severityMedium"),
    low: () => t("world.severityLow"),
};

const SEVERITY_COLORS: Record<string, string> = {
    critical: "#DC2626",
    high: "#EA580C",
    medium: "#CA8A04",
    low: "#65A30D",
};

function generateId(): string {
    return `law-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseLaws(lawsJson: string | null | undefined): Law[] {
    if (!lawsJson) return [];
    try {
        const parsed = JSON.parse(lawsJson);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

const WorldLawsScreen = React.memo(function WorldLawsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const navigation = useNavigation();
    const project = useProject(id);
    const { theme } = useUnistyles();

    const [narrative, setNarrative] = React.useState("");
    const [laws, setLaws] = React.useState<Law[]>([]);
    const [initialNarrative, setInitialNarrative] = React.useState("");
    const [initialLaws, setInitialLaws] = React.useState<Law[]>([]);
    const [saving, setSaving] = React.useState(false);
    const [editingLaw, setEditingLaw] = React.useState<Law | null>(null);

    React.useEffect(() => {
        navigation.setOptions({ title: t("world.title") });
    }, [navigation]);

    React.useEffect(() => {
        if (project) {
            const n = project.narrative ?? "";
            const l = parseLaws(project.laws);
            setNarrative(n);
            setLaws(l);
            setInitialNarrative(n);
            setInitialLaws(l);
        }
    }, [project?.narrative, project?.laws]);

    const isDirty = React.useMemo(
        () => narrative !== initialNarrative || JSON.stringify(laws) !== JSON.stringify(initialLaws),
        [narrative, initialNarrative, laws, initialLaws],
    );

    const mountedRef = React.useRef(true);
    React.useEffect(() => () => { mountedRef.current = false; }, []);

    const handleSave = React.useCallback(async () => {
        if (!project?.serverId || !isDirty) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const narrativeValue = narrative.trim() || null;
            const lawsValue = laws.length > 0 ? JSON.stringify(laws) : null;
            await updateProject(credentials, project.serverId, {
                narrative: narrativeValue,
                laws: lawsValue,
            });
            const localProject = projectManager.getProject(id);
            if (localProject) {
                localProject.narrative = narrativeValue;
                localProject.laws = lawsValue;
            }
            if (!mountedRef.current) return;
            setInitialNarrative(narrative);
            setInitialLaws(laws);
            Modal.toast(t("world.saved"));
        } catch {
            Modal.toast(t("world.saveError"));
        } finally {
            if (mountedRef.current) setSaving(false);
        }
    }, [project?.serverId, isDirty, narrative, laws, id]);

    const addLaw = React.useCallback(() => {
        setEditingLaw({
            id: generateId(),
            category: "quality",
            description: "",
            enabled: true,
            severity: "medium",
        });
    }, []);

    const saveLaw = React.useCallback((law: Law) => {
        setLaws((prev) => {
            const idx = prev.findIndex((l) => l.id === law.id);
            return idx >= 0
                ? prev.map((l, i) => (i === idx ? law : l))
                : [...prev, law];
        });
        setEditingLaw(null);
    }, []);

    const deleteLaw = React.useCallback(async (lawId: string) => {
        const confirmed = await Modal.confirm(
            t("world.deleteLawConfirmTitle"),
            t("world.deleteLawConfirmBody"),
        );
        if (confirmed) {
            setLaws((prev) => prev.filter((l) => l.id !== lawId));
        }
    }, []);

    const toggleLaw = React.useCallback((lawId: string) => {
        setLaws((prev) => prev.map((l) => (l.id === lawId ? { ...l, enabled: !l.enabled } : l)));
    }, []);

    if (!project) return null;

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
            >
                {/* Narrative */}
                <ItemGroup title={t("world.narrativeLabel")}>
                    <View style={styles.card}>
                        <Text style={styles.desc}>
                            {t("world.narrativeDesc")}
                        </Text>
                        <TextInput
                            style={styles.narrativeInput}
                            value={narrative}
                            onChangeText={setNarrative}
                            placeholder={t("world.narrativePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            multiline
                            numberOfLines={5}
                            textAlignVertical="top"
                            maxLength={5000}
                        />
                        <Text style={styles.charCount}>
                            {narrative.length}/5000
                        </Text>
                    </View>
                </ItemGroup>

                {/* Laws */}
                <ItemGroup title={t("world.lawsLabel")}>
                    {laws.length === 0 ? (
                        <View style={styles.card}>
                            <Text style={styles.emptyText}>
                                {t("world.emptyLaws")}
                            </Text>
                        </View>
                    ) : (
                        laws.map((law) => (
                            <Pressable
                                key={law.id}
                                style={styles.lawRow}
                                onPress={() => setEditingLaw(law)}
                            >
                                <View style={styles.lawContent}>
                                    <View style={styles.lawHeader}>
                                        <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[law.severity] ?? "#888" }]}>
                                            <Text style={styles.severityBadgeText}>
                                                {SEVERITY_LABELS[law.severity]?.() ?? law.severity}
                                            </Text>
                                        </View>
                                        <View style={styles.categoryBadge}>
                                            <Text style={styles.categoryBadgeText}>
                                                {CATEGORY_LABELS[law.category]?.() ?? law.category}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.lawDesc, !law.enabled && styles.lawDescDisabled]}>
                                        {law.description || "(empty)"}
                                    </Text>
                                </View>
                                <Switch
                                    value={law.enabled}
                                    onValueChange={() => toggleLaw(law.id)}
                                />
                            </Pressable>
                        ))
                    )}
                    <Pressable style={styles.addButton} onPress={addLaw}>
                        <Ionicons name="add-circle-outline" size={20} color={theme.colors.accentPurple} />
                        <Text style={styles.addButtonText}>{t("world.addLaw")}</Text>
                    </Pressable>
                </ItemGroup>
            </ScrollView>

            {/* Save Button */}
            <View style={styles.saveContainer}>
                <Pressable
                    style={[styles.saveButton, (!isDirty || saving) && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={!isDirty || saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>{t("world.save")}</Text>
                    )}
                </Pressable>
            </View>

            {/* Edit Law Modal */}
            {editingLaw && (
                <LawEditor
                    law={editingLaw}
                    onSave={saveLaw}
                    onDelete={deleteLaw}
                    onClose={() => setEditingLaw(null)}
                />
            )}
        </View>
    );
});

export default WorldLawsScreen;

// ── Law Editor Modal ──

interface LawEditorProps {
    law: Law;
    onSave: (law: Law) => void;
    onDelete: (lawId: string) => void;
    onClose: () => void;
}

const LawEditor = React.memo(function LawEditor({ law, onSave, onDelete, onClose }: LawEditorProps) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState<Law>(law);
    const isNew = !law.description;

    return (
        <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={onClose} />
            <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>
                    {isNew ? t("world.addLaw") : t("world.editLaw")}
                </Text>

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
        </View>
    );
});

// ── Styles ──

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollContent: {
        paddingBottom: 100,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    card: {
        padding: 16,
        gap: 8,
    },
    desc: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    narrativeInput: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 12,
        minHeight: 120,
        textAlignVertical: "top" as const,
    },
    charCount: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: "right" as const,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
        paddingVertical: 20,
    },
    lawRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    lawContent: {
        flex: 1,
        marginRight: 12,
    },
    lawHeader: {
        flexDirection: "row" as const,
        gap: 6,
        marginBottom: 4,
    },
    severityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    severityBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: "#fff",
    },
    categoryBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: theme.colors.divider,
    },
    categoryBadgeText: {
        ...Typography.default(),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    lawDesc: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },
    lawDescDisabled: {
        opacity: 0.4,
    },
    addButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        padding: 16,
    },
    addButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.accentPurple,
    },
    saveContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    saveButton: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
    saveButtonDisabled: {
        opacity: 0.4,
    },
    saveButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: "#fff",
    },

    // Modal
    modalOverlay: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "center" as const,
        alignItems: "center" as const,
        zIndex: 100,
    },
    modalBackdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
    },
    modalContent: {
        width: "90%" as const,
        maxWidth: 400,
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 20,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
        marginBottom: 16,
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
}));
