import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type {
    AgentRoleSummary,
    WorldMemberSummary,
} from "@/sync/apiProjects";
import type { SaveWorldMemberInput } from "@/hooks/useWorldMembersCrud";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";
import { MemberAssignedRolesSection } from "./MemberAssignedRolesSection";
import { MemberExpertiseEditor } from "./MemberExpertiseEditor";
import { MemberPermissionSection } from "./MemberPermissionSection";
import { MemberRoleSelector } from "./MemberRoleSelector";
import { PERMISSION_DEFAULTS } from "./memberFormPresentation";

interface MemberFormSheetProps {
    member?: WorldMemberSummary;
    agentRoles: AgentRoleSummary[];
    onSave: (input: SaveWorldMemberInput) => Promise<boolean>;
    onDelete: (member: WorldMemberSummary) => Promise<boolean>;
    onClose: () => void;
}

export const MemberFormSheet = React.memo(function MemberFormSheet({
    member,
    agentRoles,
    onSave,
    onDelete,
    onClose,
}: MemberFormSheetProps) {
    const { theme } = useUnistyles();
    const isNew = !member;
    const initialDefaults = PERMISSION_DEFAULTS[member?.role ?? "member"] ?? PERMISSION_DEFAULTS.member;
    const [username, setUsername] = React.useState("");
    const [role, setRole] = React.useState(member?.role ?? "member");
    const [expertise, setExpertise] = React.useState<string[]>(member?.expertise ?? []);
    const [maxConcurrency, setMaxConcurrency] = React.useState(member?.maxConcurrency ?? 3);
    const [notifyLevel, setNotifyLevel] = React.useState(member?.notifyLevel ?? initialDefaults.notifyLevel);
    const [availability, setAvailability] = React.useState(member?.availability ?? "active");
    const [assignedRoleIds, setAssignedRoleIds] = React.useState<string[]>(member?.assignedRoleIds ?? []);
    const [decisionScope, setDecisionScope] = React.useState(member?.decisionScope ?? initialDefaults.decisionScope);
    const [saving, setSaving] = React.useState(false);

    const roleDefaults = PERMISSION_DEFAULTS[role] ?? PERMISSION_DEFAULTS.member;
    const lawAuthority = member?.lawAuthority ?? roleDefaults.lawAuthority;
    const goalAuthority = member?.goalAuthority ?? roleDefaults.goalAuthority;

    const handleRoleChange = React.useCallback((nextRole: string) => {
        setRole(nextRole);
        if (isNew) {
            const defaults = PERMISSION_DEFAULTS[nextRole] ?? PERMISSION_DEFAULTS.member;
            setDecisionScope(defaults.decisionScope);
            setNotifyLevel(defaults.notifyLevel);
        }
    }, [isNew]);

    const handleSave = React.useCallback(async () => {
        setSaving(true);
        try {
            const didSave = await onSave(
                isNew
                    ? {
                        mode: "create",
                        accountId: username.trim(),
                        role,
                        expertise,
                        lawAuthority,
                        decisionScope,
                        goalAuthority,
                        notifyLevel,
                        availability,
                        maxConcurrency,
                        assignedRoleIds,
                    }
                    : {
                        mode: "update",
                        memberId: member!.id,
                        existingRole: member!.role,
                        role,
                        expertise,
                        lawAuthority,
                        decisionScope,
                        goalAuthority,
                        notifyLevel,
                        availability,
                        maxConcurrency,
                        assignedRoleIds,
                    },
            );

            if (didSave) {
                onClose();
            }
        } finally {
            setSaving(false);
        }
    }, [
        assignedRoleIds,
        availability,
        decisionScope,
        expertise,
        goalAuthority,
        isNew,
        lawAuthority,
        maxConcurrency,
        member,
        notifyLevel,
        onClose,
        onSave,
        role,
        username,
    ]);

    const canSave = isNew ? username.trim().length > 0 : true;

    return (
        <View style={pfs.modalOverlay}>
            <Pressable style={pfs.modalBackdrop} onPress={onClose} />
            <ScrollView
                style={pfs.modalScroll}
                contentContainerStyle={pfs.modalScrollContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={pfs.modalContent}>
                    <View style={pfs.modalHeader}>
                        <Text style={pfs.modalTitle}>
                            {isNew ? t("members.addMember") : t("members.editMember")}
                        </Text>
                        <Pressable style={pfs.closeButton} onPress={onClose}>
                            <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {isNew ? (
                        <>
                            <Text style={pfs.fieldLabel}>{t("members.usernameLabel")}</Text>
                            <TextInput
                                style={pfs.textInput}
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
                    ) : null}

                    <MemberRoleSelector
                        role={role}
                        isNew={isNew}
                        isOwnerLocked={member?.role === "owner"}
                        onRoleChange={handleRoleChange}
                    />

                    <MemberExpertiseEditor
                        expertise={expertise}
                        onExpertiseChange={setExpertise}
                    />

                    <MemberAssignedRolesSection
                        agentRoles={agentRoles}
                        assignedRoleIds={assignedRoleIds}
                        onAssignedRoleIdsChange={setAssignedRoleIds}
                    />

                    <MemberPermissionSection
                        decisionScope={decisionScope}
                        onDecisionScopeChange={setDecisionScope}
                        maxConcurrency={maxConcurrency}
                        onMaxConcurrencyChange={setMaxConcurrency}
                        notifyLevel={notifyLevel}
                        onNotifyLevelChange={setNotifyLevel}
                        availability={availability}
                        onAvailabilityChange={setAvailability}
                    />

                    <View style={pfs.modalActions}>
                        {!isNew && member?.role !== "owner" ? (
                            <Pressable
                                style={pfs.deleteButton}
                                onPress={async () => {
                                    const didDelete = await onDelete(member);
                                    if (didDelete) {
                                        onClose();
                                    }
                                }}
                            >
                                <Text style={pfs.deleteButtonText}>{t("members.removeMember")}</Text>
                            </Pressable>
                        ) : null}
                        <View style={{ flex: 1 }} />
                        <Pressable style={pfs.cancelButton} onPress={onClose}>
                            <Text style={pfs.cancelButtonText}>{t("common.cancel")}</Text>
                        </Pressable>
                        <Pressable
                            style={[pfs.confirmButton, (!canSave || saving) && { opacity: 0.4 }]}
                            disabled={!canSave || saving}
                            onPress={handleSave}
                        >
                            {saving ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={pfs.confirmButtonText}>{t("common.save")}</Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
});
