import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import {
    fetchWorldMembers,
    createWorldMember,
    updateWorldMember,
    deleteWorldMember,
    fetchAgentRoles,
    type WorldMemberSummary,
    type AgentRoleSummary,
} from "@/sync/apiProjects";

const ROLE_COLORS: Record<string, string> = {
    owner: "#F59E0B",
    admin: "#3B82F6",
    member: "#10B981",
    observer: "#6B7280",
};

const ROLE_ICONS: Record<string, string> = {
    owner: "shield",
    admin: "key",
    member: "person",
    observer: "eye",
};

const AVAILABILITY_COLORS: Record<string, string> = {
    active: "#10B981",
    away: "#F59E0B",
    delegate: "#8B5CF6",
};

const ROLE_LABELS: Record<string, () => string> = {
    owner: () => t("members.roleOwner"),
    admin: () => t("members.roleAdmin"),
    member: () => t("members.roleMember"),
    observer: () => t("members.roleObserver"),
};

const NOTIFY_LABELS: Record<string, () => string> = {
    all: () => t("members.notifyAll"),
    critical: () => t("members.notifyCritical"),
    assigned: () => t("members.notifyAssigned"),
    none: () => t("members.notifyNone"),
};

const AVAILABILITY_LABELS: Record<string, () => string> = {
    active: () => t("members.availabilityActive"),
    away: () => t("members.availabilityAway"),
    delegate: () => t("members.availabilityDelegate"),
};

interface WorldMembersTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldMembersTab = React.memo(
    ({ project, isActive }: WorldMembersTabProps) => {
        const { theme } = useUnistyles();
        const [members, setMembers] = React.useState<WorldMemberSummary[]>([]);
        const [agentRoles, setAgentRoles] = React.useState<AgentRoleSummary[]>([]);
        const [loading, setLoading] = React.useState(false);
        const [editingMember, setEditingMember] = React.useState<WorldMemberSummary | "new" | null>(null);

        const loadMembers = React.useCallback(async () => {
            if (!project.serverId) return;
            setLoading(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [fetched, fetchedRoles] = await Promise.all([
                    fetchWorldMembers(credentials, project.serverId),
                    fetchAgentRoles(credentials, project.serverId).catch(() => [] as AgentRoleSummary[]),
                ]);
                setMembers(fetched);
                setAgentRoles(fetchedRoles);
            } catch {
                // best effort
            } finally {
                setLoading(false);
            }
        }, [project.serverId]);

        React.useEffect(() => {
            if (isActive) {
                loadMembers();
            }
        }, [isActive, loadMembers]);

        const handleDelete = React.useCallback(async (member: WorldMemberSummary) => {
            if (member.role === "owner") {
                Modal.toast(t("members.cannotRemoveOwner"));
                return;
            }
            const confirmed = await Modal.confirm(
                t("members.removeConfirmTitle"),
                t("members.removeConfirmBody"),
            );
            if (!confirmed) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || !project.serverId) return;
                await deleteWorldMember(credentials, project.serverId, member.id);
                setMembers((prev) => prev.filter((m) => m.id !== member.id));
                Modal.toast(t("members.removed"));
            } catch {
                Modal.toast(t("members.saveError"));
            }
        }, [project.serverId]);

        const handleSaved = React.useCallback((member: WorldMemberSummary) => {
            setMembers((prev) => {
                const idx = prev.findIndex((m) => m.id === member.id);
                return idx >= 0
                    ? prev.map((m, i) => (i === idx ? member : m))
                    : [member, ...prev];
            });
            setEditingMember(null);
        }, []);

        const getDisplayName = React.useCallback((member: WorldMemberSummary) => {
            if (member.displayName) return member.displayName;
            if (member.account?.firstName) {
                return member.account.lastName
                    ? `${member.account.firstName} ${member.account.lastName}`
                    : member.account.firstName;
            }
            return member.account?.username ?? member.accountId.slice(0, 8);
        }, []);

        return (
            <View style={styles.container}>
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                >
                    <View style={styles.header}>
                        <Text style={styles.title}>{t("members.title")}</Text>
                        <Pressable style={styles.createButton} onPress={() => setEditingMember("new")}>
                            <Ionicons name="person-add" size={20} color={theme.colors.accentPurple} />
                            <Text style={styles.createButtonText}>{t("members.addMember")}</Text>
                        </Pressable>
                    </View>

                    {loading && members.length === 0 ? (
                        <ActivityIndicator style={{ marginTop: 40 }} />
                    ) : members.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="people-outline" size={48} color={theme.colors.textSecondary} />
                            <Text style={styles.emptyText}>{t("members.emptyState")}</Text>
                        </View>
                    ) : (
                        members.map((member) => (
                            <Pressable
                                key={member.id}
                                style={styles.memberCard}
                                onPress={() => setEditingMember(member)}
                            >
                                <View style={styles.memberCardHeader}>
                                    <View style={[styles.memberIcon, { backgroundColor: ROLE_COLORS[member.role] ?? "#6B7280" }]}>
                                        <Ionicons
                                            name={(ROLE_ICONS[member.role] ?? "person") as any}
                                            size={18}
                                            color="#fff"
                                        />
                                    </View>
                                    <View style={styles.memberCardInfo}>
                                        <Text style={styles.memberName}>{getDisplayName(member)}</Text>
                                        <Text style={styles.memberMeta}>
                                            {ROLE_LABELS[member.role]?.() ?? member.role}
                                            {member.account?.username ? ` · @${member.account.username}` : ""}
                                        </Text>
                                    </View>
                                    <View style={[styles.availabilityDot, { backgroundColor: AVAILABILITY_COLORS[member.availability] ?? "#6B7280" }]} />
                                </View>
                                {member.expertise.length > 0 && (
                                    <View style={styles.expertiseRow}>
                                        {member.expertise.map((tag) => (
                                            <View key={tag} style={styles.expertiseChip}>
                                                <Text style={styles.expertiseChipText}>{tag}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </Pressable>
                        ))
                    )}
                </ScrollView>

                {editingMember && (
                    <MemberFormSheet
                        member={editingMember === "new" ? undefined : editingMember}
                        projectId={project.serverId ?? ""}
                        agentRoles={agentRoles}
                        onSave={handleSaved}
                        onDelete={handleDelete}
                        onClose={() => setEditingMember(null)}
                    />
                )}
            </View>
        );
    },
);

// --- Member Form Sheet ---

interface MemberFormSheetProps {
    member?: WorldMemberSummary;
    projectId: string;
    agentRoles: AgentRoleSummary[];
    onSave: (member: WorldMemberSummary) => void;
    onDelete: (member: WorldMemberSummary) => void;
    onClose: () => void;
}

const ROLES = ["owner", "admin", "member", "observer"] as const;

const MemberFormSheet = React.memo(function MemberFormSheet({
    member,
    projectId,
    agentRoles,
    onSave,
    onDelete,
    onClose,
}: MemberFormSheetProps) {
    const { theme } = useUnistyles();
    const isNew = !member;
    const [username, setUsername] = React.useState("");
    const [role, setRole] = React.useState(member?.role ?? "member");
    const [expertise, setExpertise] = React.useState<string[]>(member?.expertise ?? []);
    const [newTag, setNewTag] = React.useState("");
    const [maxConcurrency, setMaxConcurrency] = React.useState(member?.maxConcurrency ?? 3);
    const [notifyLevel, setNotifyLevel] = React.useState(member?.notifyLevel ?? "all");
    const [availability, setAvailability] = React.useState(member?.availability ?? "active");
    const [assignedRoleIds, setAssignedRoleIds] = React.useState<string[]>(member?.assignedRoleIds ?? []);
    const [saving, setSaving] = React.useState(false);

    const addTag = React.useCallback(() => {
        const trimmed = newTag.trim().toLowerCase();
        if (trimmed && expertise.length < 20 && !expertise.includes(trimmed)) {
            setExpertise((prev) => [...prev, trimmed]);
            setNewTag("");
        }
    }, [newTag, expertise]);

    const removeTag = React.useCallback((idx: number) => {
        setExpertise((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const handleSave = React.useCallback(async () => {
        setSaving(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            if (isNew) {
                if (!username.trim()) return;
                const saved = await createWorldMember(credentials, projectId, {
                    accountId: username.trim(), // Server resolves username → accountId
                    role,
                    expertise,
                });
                onSave(saved);
            } else {
                const saved = await updateWorldMember(credentials, projectId, member!.id, {
                    role: member!.role === "owner" ? undefined : role,
                    expertise,
                    maxConcurrency,
                    notifyLevel,
                    availability,
                    assignedRoleIds,
                });
                onSave(saved);
            }
            Modal.toast(t("members.saved"));
        } catch {
            Modal.toast(t("members.saveError"));
        } finally {
            setSaving(false);
        }
    }, [isNew, username, role, expertise, notifyLevel, availability, projectId, member, onSave]);

    const canSave = isNew ? username.trim().length > 0 : true;

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
                            {isNew ? t("members.addMember") : t("members.editMember")}
                        </Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {/* Username (new only) */}
                    {isNew && (
                        <>
                            <Text style={styles.fieldLabel}>{t("members.usernameLabel")}</Text>
                            <TextInput
                                style={styles.textInput}
                                value={username}
                                onChangeText={setUsername}
                                placeholder={t("members.usernamePlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                maxLength={100}
                                autoFocus
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </>
                    )}

                    {/* Role */}
                    <Text style={styles.fieldLabel}>{t("members.roleLabel")}</Text>
                    <View style={styles.chipRow}>
                        {ROLES.map((r) => {
                            const selected = role === r;
                            const disabled = !isNew && member?.role === "owner" && r !== "owner";
                            return (
                                <Pressable
                                    key={r}
                                    style={[
                                        styles.chip,
                                        selected && { backgroundColor: ROLE_COLORS[r] },
                                        disabled && { opacity: 0.3 },
                                    ]}
                                    onPress={() => !disabled && setRole(r)}
                                    disabled={disabled}
                                >
                                    <Ionicons
                                        name={(ROLE_ICONS[r] ?? "person") as any}
                                        size={14}
                                        color={selected ? "#fff" : theme.colors.text}
                                    />
                                    <Text style={[styles.chipText, selected && { color: "#fff" }]}>
                                        {ROLE_LABELS[r]?.() ?? r}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Expertise */}
                    <Text style={styles.fieldLabel}>{t("members.expertiseLabel")}</Text>
                    <View style={styles.expertiseRow}>
                        {expertise.map((tag, idx) => (
                            <Pressable key={tag} style={styles.expertiseChip} onPress={() => removeTag(idx)}>
                                <Text style={styles.expertiseChipText}>{tag}</Text>
                                <Ionicons name="close-circle" size={14} color={theme.colors.textSecondary} />
                            </Pressable>
                        ))}
                    </View>
                    {expertise.length < 20 && (
                        <View style={styles.addTagRow}>
                            <TextInput
                                style={[styles.textInput, { flex: 1 }]}
                                value={newTag}
                                onChangeText={setNewTag}
                                placeholder={t("members.expertisePlaceholder")}
                                placeholderTextColor={theme.colors.textSecondary}
                                maxLength={50}
                                autoCapitalize="none"
                                onSubmitEditing={addTag}
                            />
                            <Pressable style={styles.addTagButton} onPress={addTag}>
                                <Ionicons name="add" size={20} color={theme.colors.accentPurple} />
                            </Pressable>
                        </View>
                    )}

                    {/* Assigned Agent Roles (edit only, when roles exist) */}
                    {!isNew && agentRoles.length > 0 && (
                        <>
                            <View style={styles.sectionDivider}>
                                <View style={styles.sectionDividerLine} />
                                <Text style={styles.sectionDividerLabel}>{t("members.assignedRolesSection")}</Text>
                                <View style={styles.sectionDividerLine} />
                            </View>
                            <Text style={[styles.fieldLabel, { marginTop: 4 }]}>{t("members.assignedRolesHint")}</Text>
                            <View style={styles.chipRow}>
                                {agentRoles.map((ar) => {
                                    const isAssigned = assignedRoleIds.includes(ar.id);
                                    return (
                                        <Pressable
                                            key={ar.id}
                                            style={[
                                                styles.chip,
                                                isAssigned && { backgroundColor: theme.colors.accentPurple },
                                            ]}
                                            onPress={() =>
                                                setAssignedRoleIds((prev) =>
                                                    isAssigned
                                                        ? prev.filter((id) => id !== ar.id)
                                                        : [...prev, ar.id],
                                                )
                                            }
                                        >
                                            <Ionicons
                                                name={isAssigned ? "checkmark-circle" : "ellipse-outline"}
                                                size={16}
                                                color={isAssigned ? "#fff" : theme.colors.textSecondary}
                                            />
                                            <Text style={[styles.chipText, isAssigned && { color: "#fff" }]}>
                                                {ar.name}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {/* Task Capacity (edit only) */}
                    {!isNew && (
                        <>
                            <View style={styles.sectionDivider}>
                                <View style={styles.sectionDividerLine} />
                                <Text style={styles.sectionDividerLabel}>{t("members.capacitySection")}</Text>
                                <View style={styles.sectionDividerLine} />
                            </View>

                            <Text style={styles.fieldLabel}>{t("members.maxConcurrencyLabel")}</Text>
                            <View style={styles.chipRow}>
                                {[1, 2, 3, 5, 10].map((n) => {
                                    const selected = maxConcurrency === n;
                                    return (
                                        <Pressable
                                            key={n}
                                            style={[styles.chip, selected && { backgroundColor: theme.colors.accentPurple }]}
                                            onPress={() => setMaxConcurrency(n)}
                                        >
                                            <Text style={[styles.chipText, selected && { color: "#fff" }]}>{n}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {/* Notifications Section (edit only) */}
                    {!isNew && (
                        <>
                            <View style={styles.sectionDivider}>
                                <View style={styles.sectionDividerLine} />
                                <Text style={styles.sectionDividerLabel}>{t("members.notificationsSection")}</Text>
                                <View style={styles.sectionDividerLine} />
                            </View>

                            <Text style={styles.fieldLabel}>{t("members.notifyLevelLabel")}</Text>
                            <View style={styles.chipRow}>
                                {(["all", "critical", "assigned", "none"] as const).map((level) => {
                                    const selected = notifyLevel === level;
                                    return (
                                        <Pressable
                                            key={level}
                                            style={[styles.chip, selected && { backgroundColor: theme.colors.accentPurple }]}
                                            onPress={() => setNotifyLevel(level)}
                                        >
                                            <Text style={[styles.chipText, selected && { color: "#fff" }]}>
                                                {NOTIFY_LABELS[level]?.() ?? level}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>

                            <Text style={styles.fieldLabel}>{t("members.availabilityLabel")}</Text>
                            <View style={styles.chipRow}>
                                {(["active", "away", "delegate"] as const).map((av) => {
                                    const selected = availability === av;
                                    return (
                                        <Pressable
                                            key={av}
                                            style={[styles.chip, selected && { backgroundColor: AVAILABILITY_COLORS[av] }]}
                                            onPress={() => setAvailability(av)}
                                        >
                                            <Text style={[styles.chipText, selected && { color: "#fff" }]}>
                                                {AVAILABILITY_LABELS[av]?.() ?? av}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {/* Actions */}
                    <View style={styles.modalActions}>
                        {!isNew && member?.role !== "owner" && (
                            <Pressable
                                style={styles.deleteButton}
                                onPress={() => { onDelete(member!); onClose(); }}
                            >
                                <Text style={styles.deleteButtonText}>{t("members.removeMember")}</Text>
                            </Pressable>
                        )}
                        <View style={{ flex: 1 }} />
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.confirmButton, (!canSave || saving) && { opacity: 0.4 }]}
                            disabled={!canSave || saving}
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
    memberCard: {
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
    },
    memberCardHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
    },
    memberIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        marginRight: 12,
    },
    memberCardInfo: {
        flex: 1,
    },
    memberName: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        color: theme.colors.text,
    },
    memberMeta: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    availabilityDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    expertiseRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        marginTop: 8,
    },
    expertiseChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: theme.dark
            ? "rgba(139,92,246,0.15)"
            : "rgba(109,40,217,0.08)",
    },
    expertiseChipText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.accentPurple,
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
    addTagRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
    },
    addTagButton: {
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
