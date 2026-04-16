import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import type { AIBackendProfile } from "@/sync/settings";
import { getBuiltInProfile, DEFAULT_PROFILES } from "@/sync/profileUtils";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { randomUUID } from "expo-crypto";
import { TokenStorage } from "@/auth/tokenStorage";
import {
  createAccountProfile,
  deleteAccountProfile,
  fetchAccountProfiles,
  updateAccountProfile,
} from "@/sync/apiAccountProfiles";
import { sync } from "@/sync/sync";
import { storage, useSettingMutable } from "@/sync/storage";
import { getProfileConfigSummary } from "@/utils/profileConfigSummary";
import { mergeAccountProfiles } from "@/utils/mergeAccountProfiles";

interface ProfileManagerProps {
  onProfileSelect?: (profile: AIBackendProfile | null) => void;
  selectedProfileId?: string | null;
}

function ProfileManager({
  onProfileSelect,
  selectedProfileId,
}: ProfileManagerProps) {
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;

  const [profiles, setProfiles] = useSettingMutable("profiles");
  const [profileRevisions, setProfileRevisions] = React.useState<Record<string, number>>({});
  const [editingProfile, setEditingProfile] = React.useState<AIBackendProfile | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = React.useState(false);

  const loadProfiles = React.useCallback(async () => {
    const currentLocalProfiles = storage.getState().settings.profiles ?? [];
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
      setProfileRevisions({});
      return;
    }
    const remoteProfiles = await fetchAccountProfiles(credentials);
    const mergedProfiles = mergeAccountProfiles({
      localProfiles: currentLocalProfiles,
      remoteProfiles,
    });
    storage.getState().applySettingsLocal({
      profiles: mergedProfiles.profiles,
    });
    setProfileRevisions(mergedProfiles.revisions);
  }, []);

  React.useEffect(() => {
    loadProfiles().catch(() => {
      // noop
    });
  }, [loadProfiles]);

  const openEditor = React.useCallback((profile: AIBackendProfile) => {
    setEditingProfile({ ...profile });
    setShowTemplateSelector(false);
    setShowAddForm(true);
  }, []);

  const handleAddBlankProfile = React.useCallback(() => {
    openEditor({
      id: randomUUID(),
      name: "",
      anthropicConfig: {},
      environmentVariables: [],
      compatibility: { claude: true, codex: true, gemini: true },
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: "1.0.0",
    });
  }, [openEditor]);

  const handleAddFromTemplate = React.useCallback(
    (templateId: string) => {
      const template = getBuiltInProfile(templateId);
      if (!template) return;
      openEditor({
        ...template,
        id: randomUUID(),
        name: `${template.name} (Custom)`,
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },
    [openEditor],
  );

  const handleSelectProfile = React.useCallback(
    (profileId: string | null) => {
      let profile: AIBackendProfile | null = null;
      if (profileId) {
        const override = profiles.find((p) => p.id === profileId) ?? null;
        profile = override ?? getBuiltInProfile(profileId);
      }
      onProfileSelect?.(profile);
      sync.applySettings({ lastUsedProfile: profileId });
    },
    [onProfileSelect, profiles],
  );

  const handleResetBuiltInProfile = React.useCallback(
    async (profileId: string) => {
      const builtIn = getBuiltInProfile(profileId);
      if (!builtIn) return;

      const confirmed = await HappyModal.confirm(
        t("profiles.reset.title"),
        t("profiles.reset.message", { name: builtIn.name }),
        {
          cancelText: t("common.cancel"),
          confirmText: t("profiles.reset.confirm"),
        },
      );
      if (!confirmed) return;

      const existingRevision = profileRevisions[profileId];
      const credentials = await TokenStorage.getCredentials();
      if (credentials && existingRevision != null) {
        const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
        setProfiles(nextProfiles);
        setProfileRevisions((currentRevisions) => {
          const nextRevisions = { ...currentRevisions };
          delete nextRevisions[profileId];
          return nextRevisions;
        });
        await deleteAccountProfile(credentials, profileId);
        await loadProfiles();
        return;
      }

      setProfiles(profiles.filter((profile) => profile.id !== profileId));
      setProfileRevisions((currentRevisions) => {
        const nextRevisions = { ...currentRevisions };
        delete nextRevisions[profileId];
        return nextRevisions;
      });
    },
    [loadProfiles, profileRevisions, profiles, setProfiles],
  );


  const handleDeleteProfile = React.useCallback(
    async (profile: AIBackendProfile) => {
      const confirmed = await HappyModal.confirm(
        t("profiles.delete.title"),
        t("profiles.delete.message", { name: profile.name }),
        {
          cancelText: t("profiles.delete.cancel"),
          confirmText: t("profiles.delete.confirm"),
          destructive: true,
        },
      );
      if (!confirmed) return;

      if (selectedProfileId === profile.id) {
        handleSelectProfile(null);
      }

      const existingRevision = profileRevisions[profile.id];
      const credentials = await TokenStorage.getCredentials();
      if (credentials && existingRevision != null) {
        const nextProfiles = profiles.filter((currentProfile) => currentProfile.id !== profile.id);
        setProfiles(nextProfiles);
        setProfileRevisions((currentRevisions) => {
          const nextRevisions = { ...currentRevisions };
          delete nextRevisions[profile.id];
          return nextRevisions;
        });
        await deleteAccountProfile(credentials, profile.id);
        await loadProfiles();
        return;
      }

      setProfiles(profiles.filter((currentProfile) => currentProfile.id !== profile.id));
      setProfileRevisions((currentRevisions) => {
        const nextRevisions = { ...currentRevisions };
        delete nextRevisions[profile.id];
        return nextRevisions;
      });
    },
    [
      handleSelectProfile,
      loadProfiles,
      profileRevisions,
      profiles,
      selectedProfileId,
      setProfiles,
    ],
  );

  const handleSaveProfile = React.useCallback(
    async (profile: AIBackendProfile) => {
      if (!profile.name.trim()) return;

      const isDuplicate = profiles.some(
        (p) => p.id !== profile.id && p.name.trim() === profile.name.trim(),
      );
      if (isDuplicate) return;

      const existingIndex = profiles.findIndex(
        (currentProfile) => currentProfile.id === profile.id,
      );
      const existingProfile =
        existingIndex >= 0 ? profiles[existingIndex] : undefined;
      const normalizedProfile: AIBackendProfile = {
        ...profile,
        createdAt: existingProfile?.createdAt ?? profile.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      const nextProfiles =
        existingIndex >= 0
          ? profiles.map((currentProfile) =>
              currentProfile.id === normalizedProfile.id ? normalizedProfile : currentProfile,
            )
          : [...profiles, normalizedProfile];

      setProfiles(nextProfiles);

      const credentials = await TokenStorage.getCredentials();
      if (!credentials) {
        setShowAddForm(false);
        setEditingProfile(null);
        return;
      }

      const existingRevision = profileRevisions[normalizedProfile.id];
      if (existingRevision == null) {
        await createAccountProfile(credentials, normalizedProfile);
      } else {
        const result = await updateAccountProfile(
          credentials,
          normalizedProfile.id,
          normalizedProfile,
          existingRevision,
        );
        if (!result.success) {
          throw new Error("revision-mismatch");
        }
      }

      await loadProfiles();
      setShowAddForm(false);
      setEditingProfile(null);
    },
    [loadProfiles, profileRevisions, profiles, setProfiles],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: screenWidth > 700 ? 16 : 8,
          paddingBottom: safeArea.bottom + 100,
        }}
      >
        <View style={{ maxWidth: layout.maxWidth, alignSelf: "center", width: "100%" }}>
          <Text
            style={{
              fontSize: 24,
              fontWeight: "bold",
              color: theme.colors.text,
              marginVertical: 16,
              ...Typography.default("semiBold"),
            }}
          >
            {t("profiles.title")}
          </Text>

          <Pressable
            style={{
              backgroundColor: theme.colors.input.background,
              borderRadius: 12,
              padding: 16,
              marginBottom: 12,
              flexDirection: "row",
              alignItems: "center",
              borderWidth: selectedProfileId === null ? 2 : 0,
              borderColor: theme.colors.text,
            }}
            onPress={() => handleSelectProfile(null)}
            accessibilityLabel={t("profiles.noProfile")}
            accessibilityRole="button"
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: theme.colors.button.secondary.tint,
                justifyContent: "center",
                alignItems: "center",
                marginRight: 12,
              }}
            >
              <Ionicons name="remove" size={16} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: theme.colors.text,
                  ...Typography.default("semiBold"),
                }}
              >
                {t("profiles.noProfile")}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  marginTop: 2,
                  ...Typography.default(),
                }}
              >
                {t("profiles.noProfileDescription")}
              </Text>
            </View>
            {selectedProfileId === null && (
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.text} />
            )}
          </Pressable>

          {DEFAULT_PROFILES.map((profileDisplay) => {
            const builtInDefault = getBuiltInProfile(profileDisplay.id);
            if (!builtInDefault) return null;
            const override = profiles.find((p) => p.id === profileDisplay.id);
            const profile = override || builtInDefault;
            const profileSummary =
              getProfileConfigSummary(profile, { includeTmux: true }) ||
              t("profiles.defaultModel");

            return (
              <Pressable
                key={profile.id}
                style={{
                  backgroundColor: theme.colors.input.background,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  borderWidth: selectedProfileId === profile.id ? 2 : 0,
                  borderColor: theme.colors.text,
                }}
                onPress={() => handleSelectProfile(profile.id)}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: theme.colors.button.primary.background,
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 12,
                  }}
                >
                  <Ionicons name="star" size={16} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: theme.colors.text,
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {profile.name}
                  </Text>
                  <Text
                    style={{
                      fontSize: 14,
                      color: theme.colors.textSecondary,
                      marginTop: 2,
                      ...Typography.default(),
                    }}
                  >
                    {profileSummary}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {selectedProfileId === profile.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={theme.colors.text}
                      style={{ marginRight: 12 }}
                    />
                  )}
                  {profiles.some((p) => p.id === profile.id) && (
                    <Pressable
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => handleResetBuiltInProfile(profile.id)}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={20}
                        color={theme.colors.button.secondary.tint}
                      />
                    </Pressable>
                  )}
                  <Pressable
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => openEditor(profile)}
                    style={{ marginLeft: profiles.some((p) => p.id === profile.id) ? 16 : 0 }}
                  >
                    <Ionicons
                      name="create-outline"
                      size={20}
                      color={theme.colors.button.secondary.tint}
                    />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}

          {profiles
            .filter((p) => !DEFAULT_PROFILES.some((bp) => bp.id === p.id))
            .map((profile) => {
              const profileSummary =
                getProfileConfigSummary(profile, { includeTmux: true }) ||
                t("profiles.defaultModel");

              return (
                <Pressable
                  key={profile.id}
                  style={{
                    backgroundColor: theme.colors.input.background,
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: selectedProfileId === profile.id ? 2 : 0,
                    borderColor: theme.colors.text,
                  }}
                  onPress={() => handleSelectProfile(profile.id)}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: theme.colors.button.secondary.tint,
                      justifyContent: "center",
                      alignItems: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons name="person" size={16} color="white" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "600",
                        color: theme.colors.text,
                        ...Typography.default("semiBold"),
                      }}
                    >
                      {profile.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 14,
                        color: theme.colors.textSecondary,
                        marginTop: 2,
                        ...Typography.default(),
                      }}
                    >
                      {profileSummary}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {selectedProfileId === profile.id && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.text}
                        style={{ marginRight: 12 }}
                      />
                    )}
                    <Pressable
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => openEditor(profile)}
                    >
                      <Ionicons
                        name="create-outline"
                        size={20}
                        color={theme.colors.button.secondary.tint}
                      />
                    </Pressable>
                    <Pressable
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => handleDeleteProfile(profile)}
                      style={{ marginLeft: 16 }}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color={theme.colors.deleteAction}
                      />
                    </Pressable>
                  </View>
                </Pressable>
              );
            })}

          <Pressable
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
              marginBottom: showTemplateSelector ? 0 : 12,
              borderBottomLeftRadius: showTemplateSelector ? 0 : 12,
              borderBottomRightRadius: showTemplateSelector ? 0 : 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={() => setShowTemplateSelector((prev) => !prev)}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={theme.colors.button.secondary.tint}
            />
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.colors.button.secondary.tint,
                marginLeft: 8,
                flex: 1,
                ...Typography.default("semiBold"),
              }}
            >
              {t("profiles.addProfile")}
            </Text>
            <Ionicons
              name={showTemplateSelector ? "chevron-up" : "chevron-down"}
              size={18}
              color={theme.colors.button.secondary.tint}
            />
          </Pressable>

          {showTemplateSelector && (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                marginBottom: 12,
                overflow: "hidden",
              }}
            >
              <Pressable
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  paddingHorizontal: 16,
                  borderTopWidth: 0.5,
                  borderTopColor: theme.colors.input.background,
                }}
                onPress={handleAddBlankProfile}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: theme.colors.input.background,
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 12,
                  }}
                >
                  <Ionicons name="document-outline" size={14} color={theme.colors.textSecondary} />
                </View>
                <Text
                  style={{
                    fontSize: 15,
                    color: theme.colors.text,
                    ...Typography.default(),
                  }}
                >
                  {t("profiles.blankProfile")}
                </Text>
              </Pressable>

              {DEFAULT_PROFILES.map((bp) => (
                <Pressable
                  key={bp.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 14,
                    paddingHorizontal: 16,
                    borderTopWidth: 0.5,
                    borderTopColor: theme.colors.input.background,
                  }}
                  onPress={() => handleAddFromTemplate(bp.id)}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: theme.colors.button.primary.background,
                      justifyContent: "center",
                      alignItems: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons name="star" size={14} color="white" />
                  </View>
                  <Text
                    style={{
                      fontSize: 15,
                      color: theme.colors.text,
                      ...Typography.default(),
                    }}
                  >
                    {bp.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {showAddForm && editingProfile && (
        <View style={profileManagerStyles.modalOverlay}>
          <View style={profileManagerStyles.modalContent}>
            <ProfileEditForm
              profile={editingProfile}
              machineId={null}
              onSave={(savedProfile) => {
                handleSaveProfile(savedProfile).catch((error) => {
                  HappyModal.alert(
                    t("common.error"),
                    error instanceof Error ? error.message : t("profiles.saveFailed"),
                  );
                });
              }}
              onCancel={() => {
                setShowAddForm(false);
                setEditingProfile(null);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const profileManagerStyles = StyleSheet.create(() => ({
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: Math.min(layout.maxWidth, 600),
    maxHeight: "90%",
  },
}));

export default React.memo(ProfileManager);
