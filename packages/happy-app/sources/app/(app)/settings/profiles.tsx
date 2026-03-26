import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSettingMutable } from "@/sync/storage";
import { StyleSheet } from "react-native-unistyles";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import { AIBackendProfile } from "@/sync/settings";
import { getBuiltInProfile, DEFAULT_PROFILES } from "@/sync/profileUtils";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { randomUUID } from "expo-crypto";

interface ProfileDisplay {
  id: string;
  name: string;
  isBuiltIn: boolean;
}

interface ProfileManagerProps {
  onProfileSelect?: (profile: AIBackendProfile | null) => void;
  selectedProfileId?: string | null;
}

// Profile utilities now imported from @/sync/profileUtils

function ProfileManager({
  onProfileSelect,
  selectedProfileId,
}: ProfileManagerProps) {
  const { theme } = useUnistyles();
  const [profiles, setProfiles] = useSettingMutable("profiles");
  const [lastUsedProfile, setLastUsedProfile] =
    useSettingMutable("lastUsedProfile");
  const [editingProfile, setEditingProfile] =
    React.useState<AIBackendProfile | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = React.useState(false);
  const safeArea = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;

  const handleAddBlankProfile = () => {
    setEditingProfile({
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
    setShowTemplateSelector(false);
    setShowAddForm(true);
  };

  const handleAddFromTemplate = (templateId: string) => {
    const template = getBuiltInProfile(templateId);
    if (!template) return;

    setEditingProfile({
      ...template,
      id: randomUUID(),
      name: `${template.name} (Custom)`,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setShowTemplateSelector(false);
    setShowAddForm(true);
  };

  const handleEditProfile = (profile: AIBackendProfile) => {
    setEditingProfile({ ...profile });
    setShowAddForm(true);
  };

  const handleResetBuiltInProfile = async (profileId: string) => {
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

    // Remove the override, restoring built-in defaults
    setProfiles(profiles.filter((p) => p.id !== profileId));
  };

  const handleDeleteProfile = async (profile: AIBackendProfile) => {
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

    const updatedProfiles = profiles.filter((p) => p.id !== profile.id);
    setProfiles(updatedProfiles);

    // Clear last used profile if it was deleted
    if (lastUsedProfile === profile.id) {
      setLastUsedProfile(null);
    }

    // Notify parent if this was the selected profile
    if (selectedProfileId === profile.id && onProfileSelect) {
      onProfileSelect(null);
    }
  };

  const handleSelectProfile = (profileId: string | null) => {
    let profile: AIBackendProfile | null = null;

    if (profileId) {
      // Check if it's a built-in profile
      const builtInProfile = getBuiltInProfile(profileId);
      if (builtInProfile) {
        profile = builtInProfile;
      } else {
        // Check if it's a custom profile
        profile = profiles.find((p) => p.id === profileId) || null;
      }
    }

    if (onProfileSelect) {
      onProfileSelect(profile);
    }
    setLastUsedProfile(profileId);
  };

  const handleSaveProfile = (profile: AIBackendProfile) => {
    // Profile validation - ensure name is not empty
    if (!profile.name || profile.name.trim() === "") {
      return;
    }

    // Check for duplicate names (excluding current profile)
    const isDuplicate = profiles.some(
      (p) => p.id !== profile.id && p.name.trim() === profile.name.trim(),
    );
    if (isDuplicate) {
      return;
    }

    const existingIndex = profiles.findIndex((p) => p.id === profile.id);
    let updatedProfiles: AIBackendProfile[];

    if (existingIndex >= 0) {
      // Update existing profile (works for both custom and built-in overrides)
      updatedProfiles = [...profiles];
      updatedProfiles[existingIndex] = profile;
    } else {
      // Add new profile (or first-time override of a built-in profile)
      updatedProfiles = [...profiles, profile];
    }

    setProfiles(updatedProfiles);
    setShowAddForm(false);
    setEditingProfile(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: screenWidth > 700 ? 16 : 8,
          paddingBottom: safeArea.bottom + 100,
        }}
      >
        <View
          style={[
            { maxWidth: layout.maxWidth, alignSelf: "center", width: "100%" },
          ]}
        >
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

          {/* None option - no profile */}
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
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={theme.colors.text}
              />
            )}
          </Pressable>

          {/* Built-in profiles (with override support) */}
          {DEFAULT_PROFILES.map((profileDisplay) => {
            const builtInDefault = getBuiltInProfile(profileDisplay.id);
            if (!builtInDefault) return null;

            // Use saved override if exists, otherwise use built-in default
            const override = profiles.find((p) => p.id === profileDisplay.id);
            const profile = override || builtInDefault;

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
                    {profile.anthropicConfig?.model || "Default model"}
                    {profile.anthropicConfig?.baseUrl &&
                      ` • ${profile.anthropicConfig.baseUrl}`}
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
                    onPress={() => handleEditProfile(profile)}
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

          {/* Custom profiles (exclude built-in overrides, shown above) */}
          {profiles.filter((p) => !DEFAULT_PROFILES.some((bp) => bp.id === p.id)).map((profile) => (
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
                  {profile.anthropicConfig?.model || t("profiles.defaultModel")}
                  {profile.tmuxConfig?.sessionName &&
                    ` • tmux: ${profile.tmuxConfig.sessionName}`}
                  {profile.tmuxConfig?.tmpDir &&
                    ` • dir: ${profile.tmuxConfig.tmpDir}`}
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
                  onPress={() => handleEditProfile(profile)}
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
          ))}

          {/* Add profile button / template selector */}
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
            onPress={() => setShowTemplateSelector(!showTemplateSelector)}
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
              {/* Blank profile option */}
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
                  <Ionicons
                    name="document-outline"
                    size={14}
                    color={theme.colors.textSecondary}
                  />
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

              {/* Built-in templates */}
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

      {/* Profile Add/Edit Modal */}
      {showAddForm && editingProfile && (
        <View style={profileManagerStyles.modalOverlay}>
          <View style={profileManagerStyles.modalContent}>
            <ProfileEditForm
              profile={editingProfile}
              machineId={null}
              onSave={handleSaveProfile}
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

// ProfileEditForm now imported from @/components/ProfileEditForm

const profileManagerStyles = StyleSheet.create((theme) => ({
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
