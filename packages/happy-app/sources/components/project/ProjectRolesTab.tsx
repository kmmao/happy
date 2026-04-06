import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, Switch, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import {
    fetchAgentRoles,
    createAgentRole,
    updateAgentRole,
    deleteAgentRole,
    type AgentRoleSummary,
} from "@/sync/apiProjects";

const ROLE_TYPES = ["guardian", "builder", "healer", "chronicler", "planner", "custom"] as const;

const TYPE_LABELS: Record<string, () => string> = {
    guardian: () => t("roles.typeGuardian"),
    builder: () => t("roles.typeBuilder"),
    healer: () => t("roles.typeHealer"),
    chronicler: () => t("roles.typeChronicler"),
    planner: () => t("roles.typePlanner"),
    custom: () => t("roles.typeCustom"),
};

const TYPE_ICONS: Record<string, string> = {
    guardian: "shield-checkmark",
    builder: "hammer",
    healer: "medkit",
    chronicler: "book",
    planner: "map",
    custom: "person",
};

const TYPE_COLORS: Record<string, string> = {
    guardian: "#3B82F6",
    builder: "#F59E0B",
    healer: "#10B981",
    chronicler: "#8B5CF6",
    planner: "#EC4899",
    custom: "#6B7280",
};
const TEMPLATE_TYPES = ROLE_TYPES.filter((type) => type !== "custom");
const ROLE_TEMPLATE_DEFAULTS: Record<string, { description: string; duties: string[] }> = {
    guardian: {
        description: "You are the Guardian of this project. Your mission is to protect code quality, security, and compliance with project laws.",
        duties: [
            "Scan for security vulnerabilities",
            "Check dependency updates and known CVEs",
            "Verify compliance with project laws",
            "Report violations with evidence",
        ],
    },
    builder: {
        description: "You are the Builder. Your mission is to implement features and write code according to specifications.",
        duties: [
            "Implement assigned tasks and features",
            "Write tests for new code",
            "Follow project conventions and style guides",
            "Update documentation when needed",
        ],
    },
    healer: {
        description: "You are the Healer. Your mission is to diagnose and fix issues, monitor health, and optimize performance.",
        duties: [
            "Monitor build health and CI status",
            "Fix failing tests and broken builds",
            "Diagnose and fix performance issues",
            "Fix reported bugs with minimal changes",
        ],
    },
    chronicler: {
        description: "You are the Chronicler. Your mission is to maintain the project's knowledge base and documentation.",
        duties: [
            "Update knowledge base entries after significant changes",
            "Write changelog entries for releases",
            "Summarize session outcomes into knowledge",
            "Archive stale or superseded knowledge",
        ],
    },
    planner: {
        description: "You are the Planner. Your mission is to analyze goals, break them into tasks, and create execution plans.",
        duties: [
            "Analyze high-level project goals",
            "Break goals into actionable tasks with estimates",
            "Assess risks and dependencies",
            "Prioritize task execution order",
        ],
    },
};

interface ProjectRolesTabProps {
    project: Project;
    isActive: boolean;
}

export const ProjectRolesTab = React.memo(
    ({ project, isActive }: ProjectRolesTabProps) => {
        const { theme } = useUnistyles();
        const [roles, setRoles] = React.useState<AgentRoleSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [editingRole, setEditingRole] = React.useState<AgentRoleSummary | "new" | null>(null);

        const loadRoles = React.useCallback(async () => {
            if (!project.serverId) return;
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const fetched = await fetchAgentRoles(credentials, project.serverId);
                setRoles(fetched);
            } catch {
                // best effort
            } finally {
                setLoading(false);
            }
        }, [project.serverId]);

        React.useEffect(() => {
            if (isActive) {
                loadRoles();
            }
        }, [isActive, loadRoles]);

        const handleDelete = React.useCallback(async (role: AgentRoleSummary) => {
            const confirmed = await Modal.confirm(
                t("roles.deleteConfirmTitle"),
                t("roles.deleteConfirmBody"),
            );
            if (!confirmed) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await deleteAgentRole(credentials, role.id);
                setRoles((prev) => prev.filter((r) => r.id !== role.id));
                Modal.toast(t("roles.deleted"));
            } catch {
                Modal.toast(t("roles.saveError"));
            }
        }, []);

        const handleToggle = React.useCallback(async (role: AgentRoleSummary) => {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const updated = await updateAgentRole(credentials, role.id, { enabled: !role.enabled });
                setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            } catch {
                Modal.toast(t("roles.saveError"));
            }
        }, []);

        const handleSaved = React.useCallback((role: AgentRoleSummary) => {
            setRoles((prev) => {
                const idx = prev.findIndex((r) => r.id === role.id);
                return idx >= 0
                    ? prev.map((r, i) => (i === idx ? role : r))
                    : [role, ...prev];
            });
            setEditingRole(null);
        }, []);

        return (
            <View style={styles.container}>
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>{t("roles.title")}</Text>
                        <Pressable style={styles.createButton} onPress={() => setEditingRole("new")}>
                            <Ionicons name="add-circle" size={22} color={theme.colors.accentPurple} />
                            <Text style={styles.createButtonText}>{t("roles.create")}</Text>
                        </Pressable>
                    </View>

                    {loading && roles.length === 0 ? (
                        <ActivityIndicator style={{ marginTop: 40 }} />
                    ) : roles.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="people-outline" size={48} color={theme.colors.textSecondary} />
                            <Text style={styles.emptyText}>{t("roles.emptyState")}</Text>
                        </View>
                    ) : (
                        roles.map((role) => (
                            <Pressable
                                key={role.id}
                                style={styles.roleCard}
                                onPress={() => setEditingRole(role)}
                            >
                                <View style={styles.roleCardHeader}>
                                    <View style={[styles.roleIcon, { backgroundColor: TYPE_COLORS[role.type] ?? "#6B7280" }]}>
                                        <Ionicons
                                            name={(TYPE_ICONS[role.type] ?? "person") as any}
                                            size={18}
                                            color="#fff"
                                        />
                                    </View>
                                    <View style={styles.roleCardInfo}>
                                        <Text style={styles.roleName}>{role.name}</Text>
                                        <Text style={styles.roleType}>
                                            {TYPE_LABELS[role.type]?.() ?? role.type}
                                            {role.duties.length > 0 ? ` \u00B7 ${role.duties.length} duties` : ""}
                                            {role.skillIds.length > 0 ? ` \u00B7 ${role.skillIds.length} skills` : ""}
                                        </Text>
                                    </View>
                                    <Switch
                                        value={role.enabled}
                                        onValueChange={() => handleToggle(role)}
                                    />
                                </View>
                                {role.description && (
                                    <Text style={styles.roleDescription} numberOfLines={2}>
                                        {role.description}
                                    </Text>
                                )}
                            </Pressable>
                        ))
                    )}
                </ScrollView>

                {editingRole && (
                    <RoleFormSheet
                        role={editingRole === "new" ? undefined : editingRole}
                        projectId={project.serverId ?? ""}
                        onSave={handleSaved}
                        onDelete={handleDelete}
                        onClose={() => setEditingRole(null)}
                    />
                )}
            </View>
        );
    },
);

// --- Role Form Sheet ---

interface RoleFormSheetProps {
    role?: AgentRoleSummary;
    projectId: string;
    onSave: (role: AgentRoleSummary) => void;
    onDelete: (role: AgentRoleSummary) => void;
    onClose: () => void;
}

const RoleFormSheet = React.memo(function RoleFormSheet({
    role,
    projectId,
    onSave,
    onDelete,
    onClose,
}: RoleFormSheetProps) {
    const { theme } = useUnistyles();
    const isNew = !role;
    const [name, setName] = React.useState(role?.name ?? "");
    const [type, setType] = React.useState(role?.type ?? "custom");
    const [description, setDescription] = React.useState(role?.description ?? "");
    const [duties, setDuties] = React.useState<string[]>(role?.duties ?? []);
    const [newDuty, setNewDuty] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [templateType, setTemplateType] = React.useState<string | undefined>(
        role?.type && role.type !== "custom" ? role.type : undefined,
    );

    const handleSave = React.useCallback(async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const body = {
                name: name.trim(),
                type,
                description: description.trim() || undefined,
                duties: duties.filter((d) => d.trim()),
            };
            const saved = isNew
                ? await createAgentRole(credentials, {
                    ...body,
                    projectId,
                    ...(templateType ? { templateType } : {}),
                })
                : await updateAgentRole(credentials, role!.id, body);
            onSave(saved);
            Modal.toast(t("roles.saved"));
        } catch {
            Modal.toast(t("roles.saveError"));
        } finally {
            setSaving(false);
        }
    }, [name, type, description, duties, isNew, projectId, role, onSave, templateType]);

    const addDuty = React.useCallback(() => {
        if (newDuty.trim() && duties.length < 10) {
            setDuties((prev) => [...prev, newDuty.trim()]);
            setNewDuty("");
        }
    }, [newDuty, duties.length]);

    const removeDuty = React.useCallback((idx: number) => {
        setDuties((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const applyTemplate = React.useCallback((nextType: string) => {
        setType(nextType);
        setTemplateType(nextType);
        const template = ROLE_TEMPLATE_DEFAULTS[nextType];
        if (template) {
            setDescription(template.description);
            setDuties(template.duties);
        }
        if (!name.trim()) {
            setName(TYPE_LABELS[nextType]?.() ?? nextType);
        }
    }, [name]);

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
                            {isNew ? t("roles.create") : t("roles.edit")}
                        </Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {isNew && (
                        <>
                            <Text style={styles.fieldLabel}>{t("roles.templateLabel")}</Text>
                            <View style={styles.templateGrid}>
                                {TEMPLATE_TYPES.map((tplType) => {
                                    const selected = templateType === tplType;
                                    return (
                                        <Pressable
                                            key={tplType}
                                            style={[
                                                styles.templateButton,
                                                selected && styles.templateButtonSelected,
                                            ]}
                                            onPress={() => applyTemplate(tplType)}
                                        >
                                            <View style={[styles.templateIcon, { backgroundColor: TYPE_COLORS[tplType] ?? "#6B7280" }]}>
                                                <Ionicons
                                                    name={(TYPE_ICONS[tplType] ?? "person") as any}
                                                    size={18}
                                                    color="#fff"
                                                />
                                            </View>
                                            <Text style={[
                                                styles.templateLabel,
                                                selected && styles.templateLabelSelected,
                                            ]}>
                                                {TYPE_LABELS[tplType]?.() ?? tplType}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {/* Name */}
                    <Text style={styles.fieldLabel}>{t("roles.nameLabel")}</Text>
                    <TextInput
                        style={styles.textInput}
                        value={name}
                        onChangeText={setName}
                        maxLength={200}
                        autoFocus={isNew}
                        placeholderTextColor={theme.colors.textSecondary}
                    />

                    {/* Type */}
                    <Text style={styles.fieldLabel}>{t("roles.typeLabel")}</Text>
                    <View style={styles.chipRow}>
                        {ROLE_TYPES.map((t) => (
                            <Pressable
                                key={t}
                                style={[
                                    styles.chip,
                                    type === t && { backgroundColor: TYPE_COLORS[t] },
                                ]}
                                onPress={() => {
                                    setType(t);
                                    setTemplateType(t === "custom" ? undefined : t);
                                }}
                            >
                                <Ionicons
                                    name={(TYPE_ICONS[t] ?? "person") as any}
                                    size={14}
                                    color={type === t ? "#fff" : theme.colors.text}
                                />
                                <Text style={[styles.chipText, type === t && { color: "#fff" }]}>
                                    {TYPE_LABELS[t]?.() ?? t}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Description */}
                    <Text style={styles.fieldLabel}>{t("roles.descriptionLabel")}</Text>
                    <TextInput
                        style={[styles.textInput, { minHeight: 80 }]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder={t("roles.descriptionPlaceholder")}
                        placeholderTextColor={theme.colors.textSecondary}
                        multiline
                        textAlignVertical="top"
                        maxLength={5000}
                    />

                    {/* Duties */}
                    <Text style={styles.fieldLabel}>{t("roles.dutiesLabel")}</Text>
                    {duties.map((duty, idx) => (
                        <View key={idx} style={styles.dutyRow}>
                            <Text style={styles.dutyText}>{duty}</Text>
                            <Pressable onPress={() => removeDuty(idx)}>
                                <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    ))}
                    {duties.length < 10 && (
                        <View style={styles.addDutyRow}>
                            <TextInput
                                style={[styles.textInput, { flex: 1 }]}
                                value={newDuty}
                                onChangeText={setNewDuty}
                                placeholder={t("roles.dutiesPlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                maxLength={200}
                                onSubmitEditing={addDuty}
                            />
                            <Pressable style={styles.addDutyButton} onPress={addDuty}>
                                <Ionicons name="add" size={20} color={theme.colors.accentPurple} />
                            </Pressable>
                        </View>
                    )}

                    {/* Actions */}
                    <View style={styles.modalActions}>
                        {!isNew && (
                            <Pressable
                                style={styles.deleteButton}
                                onPress={() => { onDelete(role!); onClose(); }}
                            >
                                <Text style={styles.deleteButtonText}>{t("roles.delete")}</Text>
                            </Pressable>
                        )}
                        <View style={{ flex: 1 }} />
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.confirmButton, (!name.trim() || saving) && { opacity: 0.4 }]}
                            disabled={!name.trim() || saving}
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

// --- Styles ---

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center" as const,
        width: "100%" as const,
    },
    header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 17,
        color: theme.colors.text,
    },
    createButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
    },
    createButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.accentPurple,
    },
    emptyContainer: {
        alignItems: "center" as const,
        paddingVertical: 60,
        gap: 12,
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center" as const,
        paddingHorizontal: 40,
    },
    roleCard: {
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
    },
    roleCardHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
    },
    roleIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        marginRight: 12,
    },
    roleCardInfo: {
        flex: 1,
    },
    roleName: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.text,
    },
    roleType: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    roleDescription: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 8,
        lineHeight: 18,
    },
    templateGrid: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 10,
    },
    templateButton: {
        alignItems: "center" as const,
        width: 80,
        gap: 6,
        paddingVertical: 6,
        borderRadius: 10,
    },
    templateButtonSelected: {
        backgroundColor: theme.colors.groupped.background,
    },
    templateIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center" as const,
        justifyContent: "center" as const,
    },
    templateLabel: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text,
        textAlign: "center" as const,
    },
    templateLabelSelected: {
        ...Typography.default("semiBold"),
    },

    // Modal
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
    dutyRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 4,
    },
    dutyText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    addDutyRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    addDutyButton: {
        padding: 8,
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
