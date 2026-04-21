import * as React from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import type {
  AgentRoleSummary,
  WorldMemberSummary,
} from "@/sync/apiProjects";
import type { SaveWorldRoleInput } from "@/hooks/useWorldRolesCrud";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";
import { RoleDutyEditor } from "./RoleDutyEditor";
import { RoleTemplateSelector } from "./RoleTemplateSelector";
import { RoleModelSelector } from "./RoleModelSelector";
import { RoleMemberBindingSection } from "./RoleMemberBindingSection";
import {
  ROLE_TYPES,
  ROLE_TEMPLATE_DEFAULTS,
  TYPE_LABELS,
  resolveInitialModelPreset,
} from "./roleFormPresentation";

interface RoleFormSheetProps {
  role?: AgentRoleSummary;
  members: WorldMemberSummary[];
  onSave: (input: SaveWorldRoleInput) => Promise<boolean>;
  onToggleMemberBinding: (
    member: WorldMemberSummary,
    roleId: string,
  ) => Promise<boolean>;
  onDelete: (role: AgentRoleSummary) => Promise<boolean>;
  onClose: () => void;
}

export const RoleFormSheet = React.memo(function RoleFormSheet({
  role,
  members,
  onSave,
  onToggleMemberBinding,
  onDelete,
  onClose,
}: RoleFormSheetProps) {
  const { theme } = useUnistyles();
  const isNew = !role;
  const [name, setName] = React.useState(role?.name ?? "");
  const [type, setType] = React.useState(role?.type ?? "custom");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [duties, setDuties] = React.useState<string[]>(role?.duties ?? []);
  const [saving, setSaving] = React.useState(false);
  const [templateType, setTemplateType] = React.useState<string | undefined>(
    role?.type && role.type !== "custom" ? role.type : undefined,
  );
  const [agentType, setAgentType] = React.useState<string | null>(role?.agentType ?? null);
  const [modelPreset, setModelPreset] = React.useState(() =>
    resolveInitialModelPreset(role?.modelOverride),
  );
  const [modelCustomValue, setModelCustomValue] = React.useState(() => {
    const initialPreset = resolveInitialModelPreset(role?.modelOverride);
    return initialPreset === "custom" ? (role?.modelOverride ?? "") : "";
  });

  const handleSave = React.useCallback(async () => {
    if (!name.trim()) return;

    setSaving(true);
    try {
      const resolvedModel = modelPreset === "custom"
        ? (modelCustomValue.trim() || null)
        : (modelPreset || null);

      const didSave = await onSave({
        mode: isNew ? "create" : "update",
        roleId: role?.id,
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        duties: duties.filter((duty) => duty.trim()),
        templateType,
        agentType: agentType ?? null,
        modelOverride: resolvedModel,
      });

      if (didSave) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }, [
    agentType,
    description,
    duties,
    isNew,
    modelCustomValue,
    modelPreset,
    name,
    onClose,
    onSave,
    role,
    templateType,
    type,
  ]);

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
              {isNew ? t("roles.create") : t("roles.edit")}
            </Text>
            <Pressable style={pfs.closeButton} onPress={onClose}>
              <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {isNew ? (
            <>
              <Text style={pfs.fieldLabel}>{t("roles.templateLabel")}</Text>
              <RoleTemplateSelector
                selectedTemplateType={templateType}
                onSelectTemplate={applyTemplate}
              />
            </>
          ) : null}

          <Text style={pfs.fieldLabel}>{t("roles.nameLabel")}</Text>
          <TextInput
            style={pfs.textInput}
            value={name}
            onChangeText={setName}
            maxLength={200}
            autoFocus={isNew}
            placeholderTextColor={theme.colors.textSecondary}
          />

          <Text style={pfs.fieldLabel}>{t("roles.typeLabel")}</Text>
          <View style={pfs.chipRow}>
            {ROLE_TYPES.map((roleType) => (
              <Pressable
                key={roleType}
                style={[
                  pfs.chip,
                  type === roleType && { backgroundColor: theme.colors.accentPurple },
                ]}
                onPress={() => {
                  setType(roleType);
                  setTemplateType(roleType === "custom" ? undefined : roleType);
                }}
              >
                <Text style={[pfs.chipText, type === roleType && { color: "#fff" }]}>
                  {TYPE_LABELS[roleType]?.() ?? roleType}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={pfs.fieldLabel}>{t("roles.descriptionLabel")}</Text>
          <TextInput
            style={[pfs.textInput, { minHeight: 80 }]}
            value={description}
            onChangeText={setDescription}
            placeholder={t("roles.descriptionPlaceholder")}
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            textAlignVertical="top"
            maxLength={5000}
          />

          <RoleDutyEditor
            duties={duties}
            onDutiesChange={setDuties}
          />

          <View style={pfs.sectionDivider}>
            <View style={pfs.sectionDividerLine} />
            <Text style={pfs.sectionDividerLabel}>{t("roles.execConfigSection")}</Text>
            <View style={pfs.sectionDividerLine} />
          </View>

          <Text style={pfs.fieldLabel}>{t("roles.agentTypeLabel")}</Text>
          <View style={pfs.chipRow}>
            {([null, "claude", "codex"] as Array<string | null>).map((nextAgentType) => {
              const isSelected = agentType === nextAgentType;
              const label = nextAgentType === null
                ? t("roles.agentTypeInherit")
                : nextAgentType.charAt(0).toUpperCase() + nextAgentType.slice(1);
              return (
                <Pressable
                  key={nextAgentType ?? "inherit"}
                  style={[pfs.chip, isSelected && { backgroundColor: theme.colors.accentPurple }]}
                  onPress={() => setAgentType(nextAgentType)}
                >
                  <Text style={[pfs.chipText, isSelected && { color: "#fff" }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={pfs.fieldLabel}>{t("roles.modelOverrideLabel")}</Text>
          <RoleModelSelector
            modelPreset={modelPreset}
            modelCustomValue={modelCustomValue}
            onModelPresetChange={setModelPreset}
            onModelCustomValueChange={setModelCustomValue}
          />

          {!isNew ? (
            <RoleMemberBindingSection
              members={members}
              roleId={role!.id}
              onToggleMemberBinding={onToggleMemberBinding}
            />
          ) : null}

          <View style={pfs.modalActions}>
            {!isNew ? (
              <Pressable
                style={pfs.deleteButton}
                onPress={async () => {
                  const didDelete = await onDelete(role!);
                  if (didDelete) {
                    onClose();
                  }
                }}
              >
                <Text style={pfs.deleteButtonText}>{t("roles.delete")}</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable style={pfs.cancelButton} onPress={onClose}>
              <Text style={pfs.cancelButtonText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[pfs.confirmButton, (!name.trim() || saving) && { opacity: 0.4 }]}
              disabled={!name.trim() || saving}
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
