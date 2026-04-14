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
import { useRouter } from "expo-router";
import {
    fetchAgentRoles,
    createAgentRole,
    updateAgentRole,
    deleteAgentRole,
    fetchWorldMembers,
    updateWorldMember,
    type AgentRoleSummary,
    type WorldMemberSummary,
} from "@/sync/apiProjects";

const ROLE_TYPES = ["guardian", "builder", "healer", "chronicler", "planner", "messenger", "custom"] as const;

const TYPE_LABELS: Record<string, () => string> = {
    guardian: () => t("roles.typeGuardian"),
    builder: () => t("roles.typeBuilder"),
    healer: () => t("roles.typeHealer"),
    chronicler: () => t("roles.typeChronicler"),
    planner: () => t("roles.typePlanner"),
    messenger: () => t("roles.typeMessenger"),
    custom: () => t("roles.typeCustom"),
};

const TYPE_ICONS: Record<string, string> = {
    guardian: "shield-checkmark",
    builder: "hammer",
    healer: "medkit",
    chronicler: "book",
    planner: "map",
    messenger: "mail",
    custom: "person",
};

const TYPE_COLORS: Record<string, string> = {
    guardian: "#3B82F6",
    builder: "#F59E0B",
    healer: "#10B981",
    chronicler: "#8B5CF6",
    planner: "#EC4899",
    messenger: "#06B6D4",
    custom: "#6B7280",
};
const TEMPLATE_TYPES = ROLE_TYPES.filter((type) => type !== "custom");
const ROLE_TEMPLATE_DEFAULTS: Record<string, { description: string; duties: string[] }> = {
    guardian: {
        description: "You are the Guardian of this world. Your mission is to protect code quality, security, and compliance with world laws.",
        duties: [
            "Scan for security vulnerabilities",
            "Check dependency updates and known CVEs",
            "Verify compliance with world laws",
            "Report violations with evidence",
        ],
    },
    builder: {
        description: "You are the Builder. Your mission is to implement features and write code according to specifications.",
        duties: [
            "Implement assigned tasks and features",
            "Write tests for new code",
            "Follow world conventions and style guides",
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
        description: "You are the Chronicler. Your mission is to maintain this world's knowledge base and documentation.",
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
            "Analyze high-level world goals",
            "Break goals into actionable tasks with estimates",
            "Assess risks and dependencies",
            "Prioritize task execution order",
        ],
    },
    messenger: {
        description: "You are the Messenger. Your mission is to coordinate communication across roles and keep shared context aligned.",
        duties: [
            "Route requests and updates between roles with clear ownership",
            "Summarize key decisions and unresolved conflicts",
            "Ensure law suggestions and conflict reports reach the right reviewers",
            "Keep communication concise, traceable, and actionable",
        ],
    },
};

interface WorldRolesTabProps {
    project: Project;
    isActive: boolean;
}

// Preset models for dropdown
const MODEL_PRESET_VALUES = [
    "",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "gpt-4.5",
];

const MODEL_PRESET_LABELS: Record<string, string> = {
    "": "",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "gpt-4.5": "gpt-4.5",
};

const TASK_STATUS_COLORS: Record<string, string> = {
    running: "#10B981",
    dispatching: "#F59E0B",
    queued: "#6B7280",
};

export const WorldRolesTab = React.memo(
    ({ project, isActive }: WorldRolesTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [roles, setRoles] = React.useState<AgentRoleSummary[]>([]);
        const [members, setMembers] = React.useState<WorldMemberSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [editingRole, setEditingRole] = React.useState<AgentRoleSummary | "new" | null>(null);

        const handleViewSession = React.useCallback((sessionId: string) => {
            router.push(`/session/${sessionId}`);
        }, [router]);

        /** Count members who have this role ID in their assignedRoleIds */
        const getBoundMemberCount = React.useCallback((roleId: string) => {
            return members.filter((m) => m.assignedRoleIds.includes(roleId)).length;
        }, [members]);

        const loadRoles = React.useCallback(async () => {
            if (!project.serverId) return;
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [fetchedRoles, fetchedMembers] = await Promise.all([
                    fetchAgentRoles(credentials, project.serverId),
                    fetchWorldMembers(credentials, project.serverId).catch(() => [] as WorldMemberSummary[]),
                ]);
                setRoles(fetchedRoles);
                setMembers(fetchedMembers);
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
            const boundCount = getBoundMemberCount(role.id);
            const confirmTitle = t("roles.deleteConfirmTitle");
            const confirmBody = boundCount > 0
                ? t("roles.deleteHasMembersBody", { count: boundCount })
                : t("roles.deleteConfirmBody");
            const confirmed = await Modal.confirm(confirmTitle, confirmBody);
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
        }, [getBoundMemberCount]);

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
                                            {role.duties.length > 0 ? ` \u00B7 ${t("roles.dutiesCount", { count: role.duties.length })}` : ""}
                                            {role.skillIds.length > 0 ? ` \u00B7 ${t("roles.skillsCount", { count: role.skillIds.length })}` : ""}
                                            {getBoundMemberCount(role.id) > 0 ? ` \u00B7 ${t("roles.boundMembers", { count: getBoundMemberCount(role.id) })}` : ""}
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
                                {(role.agentType || role.modelOverride) && (
                                    <Text style={styles.roleExecEnv}>
                                        {[
                                            role.agentType ? role.agentType.charAt(0).toUpperCase() + role.agentType.slice(1) : null,
                                            role.modelOverride,
                                        ].filter(Boolean).join(" · ")}
                                    </Text>
                                )}
                                {role.activeTasks && role.activeTasks.length > 0 && (
                                    <View style={styles.activeTasksContainer}>
                                        <Text style={styles.activeTasksLabel}>
                                            {t("roles.activeTasks", { count: role.activeTasks.length })}
                                        </Text>
                                        {role.activeTasks.map((task, idx) => (
                                            <View key={task.id} style={styles.activeTaskRow}>
                                                <View style={[styles.taskStatusDot, { backgroundColor: TASK_STATUS_COLORS[task.status] ?? "#6B7280" }]} />
                                                <Text style={styles.activeTaskStatus}>
                                                    {t("roles.taskStatus", { index: idx + 1, status: task.status })}
                                                </Text>
                                                {task.sessionId && (
                                                    <Pressable
                                                        style={styles.viewSessionButton}
                                                        onPress={(e) => { e.stopPropagation(); handleViewSession(task.sessionId!); }}
                                                    >
                                                        <Ionicons name="open-outline" size={14} color={theme.colors.accentPurple} />
                                                        <Text style={styles.viewSessionText}>{t("goals.viewSession")}</Text>
                                                    </Pressable>
                                                )}
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </Pressable>
                        ))
                    )}
                </ScrollView>

                {editingRole && (
                    <RoleFormSheet
                        role={editingRole === "new" ? undefined : editingRole}
                        projectId={project.serverId ?? ""}
                        members={members}
                        onSave={handleSaved}
                        onMembersChanged={setMembers}
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
    members: WorldMemberSummary[];
    onSave: (role: AgentRoleSummary) => void;
    onMembersChanged: React.Dispatch<React.SetStateAction<WorldMemberSummary[]>>;
    onDelete: (role: AgentRoleSummary) => void;
    onClose: () => void;
}

const RoleFormSheet = React.memo(function RoleFormSheet({
    role,
    projectId,
    members,
    onSave,
    onMembersChanged,
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
    const [agentType, setAgentType] = React.useState<string | null>(role?.agentType ?? null);

    const initModelPreset = (): string => {
        if (!role?.modelOverride) return "";
        if (MODEL_PRESET_VALUES.includes(role.modelOverride)) return role.modelOverride;
        return "custom";
    };
    const [modelPreset, setModelPreset] = React.useState(initModelPreset);
    const [modelCustomValue, setModelCustomValue] = React.useState(
        role?.modelOverride && !MODEL_PRESET_VALUES.includes(role.modelOverride) ? role.modelOverride : "",
    );
    const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false);

    const handleSave = React.useCallback(async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const resolvedModel = modelPreset === "custom"
                ? (modelCustomValue.trim() || null)
                : (modelPreset || null);
            const body = {
                name: name.trim(),
                type,
                description: description.trim() || undefined,
                duties: duties.filter((d) => d.trim()),
                agentType: agentType ?? null,
                modelOverride: resolvedModel,
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
    }, [name, type, description, duties, isNew, projectId, role, onSave, templateType, agentType, modelPreset, modelCustomValue]);

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

                    {/* Execution Config Section */}
                    <View style={styles.sectionDivider}>
                        <View style={styles.sectionDividerLine} />
                        <Text style={styles.sectionDividerLabel}>{t("roles.execConfigSection")}</Text>
                        <View style={styles.sectionDividerLine} />
                    </View>

                    {/* Agent Type */}
                    <Text style={styles.fieldLabel}>{t("roles.agentTypeLabel")}</Text>
                    <View style={styles.chipRow}>
                        {([null, "claude", "codex"] as Array<string | null>).map((at) => {
                            const selected = agentType === at;
                            const label = at === null ? t("roles.agentTypeInherit") : at.charAt(0).toUpperCase() + at.slice(1);
                            return (
                                <Pressable
                                    key={at ?? "inherit"}
                                    style={[styles.chip, selected && { backgroundColor: theme.colors.accentPurple }]}
                                    onPress={() => setAgentType(at)}
                                >
                                    <Text style={[styles.chipText, selected && { color: "#fff" }]}>{label}</Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Model Override Dropdown */}
                    <Text style={styles.fieldLabel}>{t("roles.modelOverrideLabel")}</Text>
                    <Pressable
                        style={styles.modelSelector}
                        onPress={() => setModelDropdownOpen((v) => !v)}
                    >
                        <Text style={[
                            styles.modelSelectorText,
                            !modelPreset && { color: theme.colors.textSecondary },
                        ]}>
                            {modelPreset === ""
                                ? t("roles.modelDefault")
                                : modelPreset === "custom"
                                    ? t("roles.modelCustom")
                                    : (MODEL_PRESET_LABELS[modelPreset] ?? modelPreset)}
                        </Text>
                        <Ionicons
                            name={modelDropdownOpen ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    {modelDropdownOpen && (
                        <View style={styles.modelDropdownList}>
                            {MODEL_PRESET_VALUES.map((val) => {
                                const selected = modelPreset === val;
                                const label = val === ""
                                    ? t("roles.modelDefault")
                                    : (MODEL_PRESET_LABELS[val] ?? val);
                                return (
                                    <Pressable
                                        key={val || "__default__"}
                                        style={[styles.modelDropdownItem, selected && styles.modelDropdownItemSelected]}
                                        onPress={() => {
                                            setModelPreset(val);
                                            setModelDropdownOpen(false);
                                        }}
                                    >
                                        <Text style={[
                                            styles.modelDropdownItemText,
                                            selected && { color: theme.colors.accentPurple },
                                        ]}>
                                            {label}
                                        </Text>
                                        {selected && (
                                            <Ionicons name="checkmark" size={16} color={theme.colors.accentPurple} />
                                        )}
                                    </Pressable>
                                );
                            })}
                            <Pressable
                                style={[styles.modelDropdownItem, modelPreset === "custom" && styles.modelDropdownItemSelected]}
                                onPress={() => {
                                    setModelPreset("custom");
                                    setModelDropdownOpen(false);
                                }}
                            >
                                <Text style={[
                                    styles.modelDropdownItemText,
                                    modelPreset === "custom" && { color: theme.colors.accentPurple },
                                ]}>
                                    {t("roles.modelCustom")}
                                </Text>
                                {modelPreset === "custom" && (
                                    <Ionicons name="checkmark" size={16} color={theme.colors.accentPurple} />
                                )}
                            </Pressable>
                        </View>
                    )}
                    {modelPreset === "custom" && (
                        <TextInput
                            style={[styles.textInput, { marginTop: 8 }]}
                            value={modelCustomValue}
                            onChangeText={setModelCustomValue}
                            placeholder={t("roles.modelOverridePlaceholder")}
                            placeholderTextColor={theme.colors.textSecondary}
                            maxLength={100}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    )}

                    {/* Bound Members Section (edit only, when members exist) */}
                    {!isNew && members.length > 0 && (
                        <>
                            <View style={styles.sectionDivider}>
                                <View style={styles.sectionDividerLine} />
                                <Text style={styles.sectionDividerLabel}>{t("roles.boundMembersSection")}</Text>
                                <View style={styles.sectionDividerLine} />
                            </View>
                            <Text style={[styles.fieldLabel, { marginTop: 4 }]}>{t("roles.boundMembersHint")}</Text>
                            <View style={styles.chipRow}>
                                {members.map((m) => {
                                    const isBound = m.assignedRoleIds.includes(role!.id);
                                    const displayName = m.displayName
                                        ?? m.account?.firstName
                                        ?? m.account?.username
                                        ?? m.accountId.slice(0, 8);
                                    return (
                                        <Pressable
                                            key={m.id}
                                            style={[
                                                styles.chip,
                                                isBound && { backgroundColor: theme.colors.accentPurple },
                                            ]}
                                            onPress={async () => {
                                                try {
                                                    const credentials = await TokenStorage.getCredentials();
                                                    if (!credentials) return;
                                                    const newIds = isBound
                                                        ? m.assignedRoleIds.filter((id) => id !== role!.id)
                                                        : [...m.assignedRoleIds, role!.id];
                                                    const updated = await updateWorldMember(credentials, projectId, m.id, {
                                                        assignedRoleIds: newIds,
                                                    });
                                                    onMembersChanged(
                                                        members.map((p) => (p.id === updated.id ? updated : p)),
                                                    );
                                                } catch {
                                                    Modal.toast(t("members.saveError"));
                                                }
                                            }}
                                        >
                                            <Ionicons
                                                name={isBound ? "checkmark-circle" : "ellipse-outline"}
                                                size={16}
                                                color={isBound ? "#fff" : theme.colors.textSecondary}
                                            />
                                            <Text style={[styles.chipText, isBound && { color: "#fff" }]}>
                                                {displayName}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
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
    roleExecEnv: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.accentPurple,
        marginTop: 6,
        opacity: 0.8,
    },
    activeTasksContainer: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.groupped.background,
    },
    activeTasksLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.text,
        marginBottom: 6,
    },
    activeTaskRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingVertical: 4,
        gap: 6,
    },
    taskStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    activeTaskStatus: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    viewSessionButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.groupped.background,
    },
    viewSessionText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.accentPurple,
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
        backgroundColor: "rgba(0,0,0,0.4)",
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
    sectionDivider: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        marginTop: 16,
        marginBottom: 4,
    },
    sectionDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    sectionDividerLabel: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
        letterSpacing: 0.5,
        textTransform: "uppercase" as const,
    },
    modelSelector: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    modelSelectorText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    modelDropdownList: {
        marginTop: 4,
        backgroundColor: theme.colors.groupped.background,
        borderRadius: 8,
        overflow: "hidden" as const,
    },
    modelDropdownItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.surface,
    },
    modelDropdownItemSelected: {
        backgroundColor: theme.dark
            ? "rgba(139,92,246,0.12)"
            : "rgba(109,40,217,0.06)",
    },
    modelDropdownItemText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
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
