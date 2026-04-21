import * as React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import {
    type WorldMemberSummary,
    type AgentRoleSummary,
} from "@/sync/apiProjects";
import { SharedStateView } from "@/components/SharedStateView";
import { MemberFormSheet } from "./MemberFormSheet";
import { deriveWorldTabCollectionScreenState } from "./worldTabCollectionViewModel";
import { useWorldMembersData } from "@/hooks/useWorldMembersData";
import { useWorldMembersCrud } from "@/hooks/useWorldMembersCrud";
import {
    AVAILABILITY_COLORS,
    ROLE_COLORS,
    ROLE_ICONS,
    ROLE_LABELS,
} from "./memberFormPresentation";

interface WorldMembersTabProps {
    project: Project;
    isActive: boolean;
}

export const WorldMembersTab = React.memo(
    ({ project, isActive }: WorldMembersTabProps) => {
        const { theme } = useUnistyles();
        const {
            members,
            setMembers,
            agentRoles,
            loading,
            error: loadError,
            refresh: loadMembers,
        } = useWorldMembersData(project.serverId, isActive);
        const {
            saveMember,
            deleteMember,
        } = useWorldMembersCrud({
            projectServerId: project.serverId,
            setMembers,
        });
        const [editingMember, setEditingMember] = React.useState<WorldMemberSummary | "new" | null>(null);

        const getDisplayName = React.useCallback((member: WorldMemberSummary) => {
            if (member.displayName) return member.displayName;
            if (member.account?.firstName) {
                return member.account.lastName
                    ? `${member.account.firstName} ${member.account.lastName}`
                    : member.account.firstName;
            }
            return member.account?.username ?? member.accountId.slice(0, 8);
        }, []);

        // Resolve assignedRoleIds → role names for display on member cards
        const roleNameMap = React.useMemo(() => {
            const map = new Map<string, string>();
            for (const r of agentRoles) map.set(r.id, r.name);
            return map;
        }, [agentRoles]);

        const membersScreenState = React.useMemo(
            () =>
                deriveWorldTabCollectionScreenState({
                    loading,
                    error: loadError,
                    totalCount: members.length,
                }),
            [loadError, loading, members.length],
        );

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

                    {membersScreenState.screenKind === "loading" ? (
                        <SharedStateView
                            inline
                            kind="loading"
                            title={t("common.loading")}
                        />
                    ) : membersScreenState.screenKind === "error" ? (
                        <SharedStateView
                            inline
                            kind="error"
                            title={t("common.error")}
                            description={membersScreenState.requestState.error ?? undefined}
                            onAction={() => {
                                void loadMembers();
                            }}
                        />
                    ) : membersScreenState.screenKind === "empty" ? (
                        <SharedStateView
                            inline
                            kind="empty"
                            title={t("members.emptyState")}
                            icon={
                                <Ionicons
                                    name="people-outline"
                                    size={48}
                                    color={theme.colors.textSecondary}
                                />
                            }
                        />
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
                                    <View style={styles.memberCardActions}>
                                        <View style={[styles.availabilityDot, { backgroundColor: AVAILABILITY_COLORS[member.availability] ?? "#6B7280" }]} />
                                        {member.role !== "owner" && (
                                            <Pressable
                                                style={styles.cardDeleteButton}
                                                onPress={(e) => {
                                                    e.stopPropagation?.();
                                                    void deleteMember(member);
                                                }}
                                                hitSlop={8}
                                            >
                                                <Ionicons name="trash-outline" size={16} color="#DC2626" />
                                            </Pressable>
                                        )}
                                    </View>
                                </View>
                                {member.assignedRoleIds.length > 0 && (
                                    <View style={styles.roleTagRow}>
                                        {member.assignedRoleIds.map((rid) => {
                                            const name = roleNameMap.get(rid);
                                            if (!name) return null;
                                            return (
                                                <View key={rid} style={styles.roleTag}>
                                                    <Ionicons name="briefcase-outline" size={11} color={theme.colors.accentPurple} />
                                                    <Text style={styles.roleTagText}>{name}</Text>
                                                </View>
                                            );
                                        })}
                                    </View>
                                )}
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
                        agentRoles={agentRoles}
                        onSave={async (input) => {
                            const didSave = await saveMember(input);
                            if (didSave) {
                                setEditingMember(null);
                            }
                            return didSave;
                        }}
                        onDelete={async (member) => {
                            const didDelete = await deleteMember(member);
                            if (didDelete) {
                                setEditingMember(null);
                            }
                            return didDelete;
                        }}
                        onClose={() => setEditingMember(null)}
                    />
                )}
            </View>
        );
    },
);

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
    memberCardActions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
    },
    availabilityDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    cardDeleteButton: {
        padding: 4,
    },
    roleTagRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        marginTop: 8,
    },
    roleTag: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: theme.dark
            ? "rgba(59,130,246,0.15)"
            : "rgba(59,130,246,0.08)",
    },
    roleTagText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.accentPurple,
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
}));
