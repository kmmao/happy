import * as React from "react";
import { View, Text, ScrollView, Pressable, Switch } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Project } from "@/sync/projectManager";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  type AgentRoleSummary,
} from "@/sync/apiProjects";
import { SharedStateView } from "@/components/SharedStateView";
import { RoleFormSheet } from "./RoleFormSheet";
import { deriveWorldTabCollectionScreenState } from "./worldTabCollectionViewModel";
import { useWorldRolesData } from "@/hooks/useWorldRolesData";
import { useWorldRolesCrud } from "@/hooks/useWorldRolesCrud";
import {
  TYPE_COLORS,
  TYPE_ICONS,
  TYPE_LABELS,
} from "./roleFormPresentation";

interface WorldRolesTabProps {
  project: Project;
  isActive: boolean;
}

const TASK_STATUS_COLORS: Record<string, string> = {
  running: "#10B981",
  dispatching: "#F59E0B",
  queued: "#6B7280",
};

export const WorldRolesTab = React.memo(
  ({ project, isActive }: WorldRolesTabProps) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const {
      roles,
      setRoles,
      members,
      setMembers,
      loading,
      error: loadError,
      refresh: loadRoles,
    } = useWorldRolesData(project.serverId, isActive);
    const {
      saveRole,
      deleteRole,
      toggleRoleEnabled,
      toggleMemberBinding,
    } = useWorldRolesCrud({
      projectServerId: project.serverId,
      members,
      setRoles,
      setMembers,
    });
    const [editingRole, setEditingRole] = React.useState<AgentRoleSummary | "new" | null>(null);

    const handleViewSession = React.useCallback((sessionId: string) => {
      router.push(`/session/${sessionId}`);
    }, [router]);

    const getBoundMemberCount = React.useCallback((roleId: string) => {
      return members.filter((member) => member.assignedRoleIds.includes(roleId)).length;
    }, [members]);

    const rolesScreenState = React.useMemo(
      () => deriveWorldTabCollectionScreenState({
        loading,
        error: loadError,
        totalCount: roles.length,
      }),
      [loadError, loading, roles.length],
    );

    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t("roles.title")}</Text>
            <Pressable style={styles.createButton} onPress={() => setEditingRole("new")}>
              <Ionicons name="add-circle" size={22} color={theme.colors.accentPurple} />
              <Text style={styles.createButtonText}>{t("roles.create")}</Text>
            </Pressable>
          </View>

          {rolesScreenState.screenKind === "loading" ? (
            <SharedStateView
              inline
              kind="loading"
              title={t("common.loading")}
            />
          ) : rolesScreenState.screenKind === "error" ? (
            <SharedStateView
              inline
              kind="error"
              title={t("common.error")}
              description={rolesScreenState.requestState.error ?? undefined}
              onAction={() => {
                void loadRoles();
              }}
            />
          ) : rolesScreenState.screenKind === "empty" ? (
            <SharedStateView
              inline
              kind="empty"
              title={t("roles.emptyState")}
              icon={
                <Ionicons
                  name="people-outline"
                  size={48}
                  color={theme.colors.textSecondary}
                />
              }
            />
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
                      {role.duties.length > 0 ? ` · ${t("roles.dutiesCount", { count: role.duties.length })}` : ""}
                      {role.skillIds.length > 0 ? ` · ${t("roles.skillsCount", { count: role.skillIds.length })}` : ""}
                      {getBoundMemberCount(role.id) > 0 ? ` · ${t("roles.boundMembers", { count: getBoundMemberCount(role.id) })}` : ""}
                    </Text>
                  </View>
                  <Switch
                    value={role.enabled}
                    onValueChange={() => {
                      void toggleRoleEnabled(role);
                    }}
                  />
                </View>
                {role.description ? (
                  <Text style={styles.roleDescription} numberOfLines={2}>
                    {role.description}
                  </Text>
                ) : null}
                {(role.agentType || role.modelOverride) ? (
                  <Text style={styles.roleExecEnv}>
                    {[
                      role.agentType ? role.agentType.charAt(0).toUpperCase() + role.agentType.slice(1) : null,
                      role.modelOverride,
                    ].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
                {role.activeTasks && role.activeTasks.length > 0 ? (
                  <View style={styles.activeTasksContainer}>
                    <Text style={styles.activeTasksLabel}>
                      {t("roles.activeTasks", { count: role.activeTasks.length })}
                    </Text>
                    {role.activeTasks.map((task, index) => (
                      <View key={task.id} style={styles.activeTaskRow}>
                        <View style={[styles.taskStatusDot, { backgroundColor: TASK_STATUS_COLORS[task.status] ?? "#6B7280" }]} />
                        <Text style={styles.activeTaskStatus}>
                          {t("roles.taskStatus", { index: index + 1, status: task.status })}
                        </Text>
                        {task.sessionId ? (
                          <Pressable
                            style={styles.viewSessionButton}
                            onPress={(event) => {
                              event.stopPropagation();
                              handleViewSession(task.sessionId!);
                            }}
                          >
                            <Ionicons name="open-outline" size={14} color={theme.colors.accentPurple} />
                            <Text style={styles.viewSessionText}>{t("goals.viewSession")}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>

        {editingRole ? (
          <RoleFormSheet
            role={editingRole === "new" ? undefined : editingRole}
            members={members}
            onSave={async (input) => {
              const didSave = await saveRole(input);
              if (didSave) {
                setEditingRole(null);
              }
              return didSave;
            }}
            onToggleMemberBinding={toggleMemberBinding}
            onDelete={async (role) => {
              const didDelete = await deleteRole(role);
              if (didDelete) {
                setEditingRole(null);
              }
              return didDelete;
            }}
            onClose={() => setEditingRole(null)}
          />
        ) : null}
      </View>
    );
  },
);

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
}));
