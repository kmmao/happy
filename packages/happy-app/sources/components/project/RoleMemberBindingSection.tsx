import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type { WorldMemberSummary } from "@/sync/apiProjects";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";

interface RoleMemberBindingSectionProps {
    members: WorldMemberSummary[];
    roleId: string;
    onToggleMemberBinding: (
        member: WorldMemberSummary,
        roleId: string,
    ) => Promise<boolean>;
}

function getBoundMemberDisplayName(member: WorldMemberSummary): string {
    return (
        member.displayName
        ?? member.account?.firstName
        ?? member.account?.username
        ?? member.accountId.slice(0, 8)
    );
}

export const RoleMemberBindingSection = React.memo(function RoleMemberBindingSection({
    members,
    roleId,
    onToggleMemberBinding,
}: RoleMemberBindingSectionProps) {
    const { theme } = useUnistyles();

    if (members.length === 0) {
        return null;
    }

    return (
        <>
            <View style={pfs.sectionDivider}>
                <View style={pfs.sectionDividerLine} />
                <Text style={pfs.sectionDividerLabel}>{t("roles.boundMembersSection")}</Text>
                <View style={pfs.sectionDividerLine} />
            </View>
            <Text style={[pfs.fieldLabel, { marginTop: 4 }]}>{t("roles.boundMembersHint")}</Text>
            <View style={pfs.chipRow}>
                {members.map((member) => {
                    const isBound = member.assignedRoleIds.includes(roleId);

                    return (
                        <Pressable
                            key={member.id}
                            style={[
                                pfs.chip,
                                isBound && { backgroundColor: theme.colors.accentPurple },
                            ]}
                            onPress={() => {
                                void onToggleMemberBinding(member, roleId);
                            }}
                        >
                            <Ionicons
                                name={isBound ? "checkmark-circle" : "ellipse-outline"}
                                size={16}
                                color={isBound ? "#fff" : theme.colors.textSecondary}
                            />
                            <Text style={[pfs.chipText, isBound && { color: "#fff" }]}>
                                {getBoundMemberDisplayName(member)}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
});
