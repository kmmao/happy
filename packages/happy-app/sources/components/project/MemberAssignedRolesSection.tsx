import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { AgentRoleSummary } from "@/sync/apiProjects";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";

interface MemberAssignedRolesSectionProps {
    agentRoles: AgentRoleSummary[];
    assignedRoleIds: string[];
    onAssignedRoleIdsChange: React.Dispatch<React.SetStateAction<string[]>>;
}

export const MemberAssignedRolesSection = React.memo(function MemberAssignedRolesSection({
    agentRoles,
    assignedRoleIds,
    onAssignedRoleIdsChange,
}: MemberAssignedRolesSectionProps) {
    const { theme } = useUnistyles();

    if (agentRoles.length === 0) {
        return null;
    }

    return (
        <>
            <View style={pfs.sectionDivider}>
                <View style={pfs.sectionDividerLine} />
                <Text style={pfs.sectionDividerLabel}>{t("members.assignedRolesSection")}</Text>
                <View style={pfs.sectionDividerLine} />
            </View>
            <Text style={[pfs.fieldLabel, { marginTop: 4 }]}>{t("members.assignedRolesHint")}</Text>
            <View style={pfs.chipRow}>
                {agentRoles.map((agentRole) => {
                    const isAssigned = assignedRoleIds.includes(agentRole.id);

                    return (
                        <Pressable
                            key={agentRole.id}
                            style={[
                                pfs.chip,
                                isAssigned && { backgroundColor: theme.colors.accentPurple },
                            ]}
                            onPress={() => {
                                onAssignedRoleIdsChange((previousAssignedRoleIds) =>
                                    isAssigned
                                        ? previousAssignedRoleIds.filter((roleId) => roleId !== agentRole.id)
                                        : [...previousAssignedRoleIds, agentRole.id],
                                );
                            }}
                        >
                            <Ionicons
                                name={isAssigned ? "checkmark-circle" : "ellipse-outline"}
                                size={16}
                                color={isAssigned ? "#fff" : theme.colors.textSecondary}
                            />
                            <Text style={[pfs.chipText, isAssigned && { color: "#fff" }]}>
                                {agentRole.name}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
});
