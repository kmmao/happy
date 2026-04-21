import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import type { AIBackendProfile } from "@/sync/settings";
import { DEFAULT_PROFILES, getBuiltInProfile } from "@/sync/profileUtils";
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
import { storage, useSetting, useSettingMutable } from "@/sync/storage";
import {
  resolveCodexBackendModeLabel,
  resolveCodexConfigModeLabel,
} from "@/sync/codexConfigPresentation";
import { getProfileConfigSummary } from "@/utils/profileConfigSummary";
import { mergeAccountProfiles } from "@/utils/mergeAccountProfiles";
import {
  buildConflictRetryProfile,
  buildProfileSettingsOverview,
  getProfileSyncActionState,
  getProfileSyncStatus,
  type ProfileRemoteState,
  type ProfileSyncActionState,
  type ProfileSyncStatus,
} from "@/components/settings/profiles/profileSettingsUtils";

interface ProfileManagerProps {
  onProfileSelect?: (profile: AIBackendProfile | null) => void;
  selectedProfileId?: string | null;
}

interface SyncStatusBadgeProps {
  label: string;
  tone: "neutral" | "success" | "warning" | "info";
}

const SyncStatusBadge = React.memo(function SyncStatusBadge({
  label,
  tone,
}: SyncStatusBadgeProps) {
  const { theme } = useUnistyles();

  const colors = React.useMemo(() => {
    switch (tone) {
      case "success":
        return {
          backgroundColor: `${theme.colors.success}18`,
          textColor: theme.colors.success,
        };
      case "warning":
        return {
          backgroundColor: `${theme.colors.warningCritical}18`,
          textColor: theme.colors.warningCritical,
        };
      case "info":
        return {
          backgroundColor: `${theme.colors.accentBlue}18`,
          textColor: theme.colors.accentBlue,
        };
      default:
        return {
          backgroundColor: theme.colors.surfaceHighest,
          textColor: theme.colors.textSecondary,
        };
    }
  }, [theme.colors.accentBlue, theme.colors.success, theme.colors.surfaceHighest, theme.colors.textSecondary, theme.colors.warningCritical, tone]);

  return (
    <View style={[styles.badge, { backgroundColor: colors.backgroundColor }]}> 
      <Text style={[styles.badgeText, { color: colors.textColor }]}>{label}</Text>
    </View>
  );
});

const SectionHeader = React.memo(function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDescription}>{description}</Text>
    </View>
  );
});

function getSyncBadgeLabel(syncStatus: ProfileSyncStatus): string {
  switch (syncStatus) {
    case "synced":
      return t("profiles.badgeSynced");
    case "pending":
      return t("profiles.badgePending");
    case "local-only":
      return t("profiles.badgeLocalOnly");
  }
}

function getSyncBadgeTone(syncStatus: ProfileSyncStatus): SyncStatusBadgeProps["tone"] {
  switch (syncStatus) {
    case "synced":
      return "success";
    case "pending":
      return "warning";
    case "local-only":
      return "neutral";
  }
}

function getSyncActionIconName(syncStatus: ProfileSyncStatus): keyof typeof Ionicons.glyphMap {
  switch (syncStatus) {
    case "pending":
      return "arrow-up-circle-outline";
    case "local-only":
      return "cloud-upload-outline";
    case "synced":
      return "cloud-done-outline";
  }
}

function buildRemoteState(remoteProfiles: Awaited<ReturnType<typeof fetchAccountProfiles>>): ProfileRemoteState {
  return remoteProfiles.reduce<ProfileRemoteState>((accumulator, entry) => {
    accumulator[entry.profile.id] = {
      revision: entry.revision,
      updatedAt: entry.profile.updatedAt ?? 0,
    };
    return accumulator;
  }, {});
}

async function persistProfileToAccount(
  profile: AIBackendProfile,
  remoteEntry: ProfileRemoteState[string] | undefined,
) {
  const credentials = await TokenStorage.getCredentials();
  if (!credentials) {
    return;
  }

  if (!remoteEntry) {
    await createAccountProfile(credentials, profile);
    return;
  }

  const result = await updateAccountProfile(
    credentials,
    profile.id,
    profile,
    remoteEntry.revision,
  );

  if (result.success) {
    return;
  }

  const retryProfile = buildConflictRetryProfile(profile, result.current.profile);
  const retryResult = await updateAccountProfile(
    credentials,
    profile.id,
    retryProfile,
    result.current.revision,
  );

  if (!retryResult.success) {
    throw new Error("revision-mismatch");
  }
}

function ProfileManager({
  onProfileSelect,
  selectedProfileId,
}: ProfileManagerProps) {
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;

  const lastUsedProfile = useSetting("lastUsedProfile");
  const effectiveSelectedProfileId = selectedProfileId === undefined
    ? lastUsedProfile
    : selectedProfileId;

  const [profiles, setProfiles] = useSettingMutable("profiles");
  const [profileRemoteState, setProfileRemoteState] = React.useState<ProfileRemoteState>({});
  const [editingProfile, setEditingProfile] = React.useState<AIBackendProfile | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = React.useState(false);
  const [accountSyncAvailable, setAccountSyncAvailable] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(true);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [syncingProfileId, setSyncingProfileId] = React.useState<string | null>(null);

  const refreshProfiles = React.useCallback(async () => {
    setRefreshing(true);
    setSyncError(null);

    const currentLocalProfiles = storage.getState().settings.profiles ?? [];
    const credentials = await TokenStorage.getCredentials();

    setAccountSyncAvailable(Boolean(credentials));

    if (!credentials) {
      setProfileRemoteState({});
      setRefreshing(false);
      return;
    }

    try {
      const remoteProfiles = await fetchAccountProfiles(credentials);
      const mergedProfiles = mergeAccountProfiles({
        localProfiles: currentLocalProfiles,
        remoteProfiles,
      });

      storage.getState().applySettingsLocal({
        profiles: mergedProfiles.profiles,
      });
      setProfileRemoteState(buildRemoteState(remoteProfiles));
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "sync-failed");
      throw error;
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    refreshProfiles().catch(() => {
      // noop - screen keeps local profiles available
    });
  }, [refreshProfiles]);

  const overview = React.useMemo(
    () => buildProfileSettingsOverview({
      profiles,
      remoteState: profileRemoteState,
    }),
    [profileRemoteState, profiles],
  );

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
        const override = profiles.find((candidate) => candidate.id === profileId) ?? null;
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

      const remoteEntry = profileRemoteState[profileId];
      const nextProfiles = profiles.filter((profile) => profile.id !== profileId);

      try {
        setProfiles(nextProfiles);
        setProfileRemoteState((currentState) => {
          const nextState = { ...currentState };
          delete nextState[profileId];
          return nextState;
        });

        const credentials = await TokenStorage.getCredentials();
        if (credentials && remoteEntry) {
          await deleteAccountProfile(credentials, profileId);
          await refreshProfiles();
        }
      } catch (error) {
        await refreshProfiles().catch(() => {
          // noop
        });
        await HappyModal.alert(
          t("common.error"),
          error instanceof Error ? error.message : t("profiles.saveFailed"),
        );
      }
    },
    [profileRemoteState, profiles, refreshProfiles, setProfiles],
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

      if (effectiveSelectedProfileId === profile.id) {
        handleSelectProfile(null);
      }

      const remoteEntry = profileRemoteState[profile.id];
      const nextProfiles = profiles.filter((candidate) => candidate.id !== profile.id);

      try {
        setProfiles(nextProfiles);
        setProfileRemoteState((currentState) => {
          const nextState = { ...currentState };
          delete nextState[profile.id];
          return nextState;
        });

        const credentials = await TokenStorage.getCredentials();
        if (credentials && remoteEntry) {
          await deleteAccountProfile(credentials, profile.id);
          await refreshProfiles();
        }
      } catch (error) {
        await refreshProfiles().catch(() => {
          // noop
        });
        await HappyModal.alert(
          t("common.error"),
          error instanceof Error ? error.message : t("profiles.saveFailed"),
        );
      }
    },
    [effectiveSelectedProfileId, handleSelectProfile, profileRemoteState, profiles, refreshProfiles, setProfiles],
  );

  const handleSaveProfile = React.useCallback(
    async (profile: AIBackendProfile) => {
      if (!profile.name.trim()) {
        return;
      }

      const duplicate = profiles.some(
        (candidate) => candidate.id !== profile.id && candidate.name.trim() === profile.name.trim(),
      );
      if (duplicate) {
        return;
      }

      const existingIndex = profiles.findIndex((candidate) => candidate.id === profile.id);
      const existingProfile = existingIndex >= 0 ? profiles[existingIndex] : undefined;
      const normalizedProfile: AIBackendProfile = {
        ...profile,
        createdAt: existingProfile?.createdAt ?? profile.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      const nextProfiles = existingIndex >= 0
        ? profiles.map((candidate) =>
            candidate.id === normalizedProfile.id ? normalizedProfile : candidate,
          )
        : [...profiles, normalizedProfile];

      setProfiles(nextProfiles);

      await persistProfileToAccount(
        normalizedProfile,
        profileRemoteState[normalizedProfile.id],
      );
      await refreshProfiles();
      setShowAddForm(false);
      setEditingProfile(null);
    },
    [profileRemoteState, profiles, refreshProfiles, setProfiles],
  );

  const handleManualRefresh = React.useCallback(async () => {
    try {
      await refreshProfiles();
    } catch (error) {
      await HappyModal.alert(
        t("common.error"),
        error instanceof Error ? error.message : t("profiles.saveFailed"),
      );
    }
  }, [refreshProfiles]);

  const handleSyncProfile = React.useCallback(
    async (profile: AIBackendProfile) => {
      if (!accountSyncAvailable) {
        await HappyModal.alert(t("common.error"), t("profiles.syncSignedOut"));
        return;
      }

      try {
        setSyncingProfileId(profile.id);
        await persistProfileToAccount(profile, profileRemoteState[profile.id]);
        await refreshProfiles();
      } catch (error) {
        await refreshProfiles().catch(() => {
          // noop
        });
        await HappyModal.alert(
          t("common.error"),
          error instanceof Error ? error.message : t("profiles.saveFailed"),
        );
      } finally {
        setSyncingProfileId((current) => (current === profile.id ? null : current));
      }
    },
    [accountSyncAvailable, profileRemoteState, refreshProfiles],
  );

  const syncSummaryText = refreshing
    ? t("profiles.syncRefreshing")
    : !accountSyncAvailable
      ? t("profiles.syncSignedOut")
      : syncError
        ? t("profiles.syncError")
        : t("profiles.syncReady");

  const syncIconName = refreshing
    ? "sync-outline"
    : !accountSyncAvailable
      ? "cloud-offline-outline"
      : syncError
        ? "alert-circle-outline"
        : "cloud-done-outline";

  const renderProfileSummary = React.useCallback(
    (profile: AIBackendProfile) => {
      const parts: string[] = [];

      if (profile.codexConfig?.backendMode) {
        parts.push(
          resolveCodexBackendModeLabel(
            profile.codexConfig.backendMode,
            t,
            "profile",
          ),
        );
      }

      if (profile.codexConfig?.configMode) {
        parts.push(
          resolveCodexConfigModeLabel(
            profile.codexConfig.configMode,
            t,
            "profile",
          ),
        );
      }

      const configSummary = getProfileConfigSummary(profile, {
        includeTmux: true,
      });
      if (configSummary) {
        parts.push(configSummary);
      }

      return parts.join(" · ") || t("profiles.defaultModel");
    },
    [],
  );

  const renderSyncActionButton = React.useCallback(
    (profile: AIBackendProfile, syncStatus: ProfileSyncStatus) => {
      const actionState: ProfileSyncActionState = getProfileSyncActionState(
        syncStatus,
        accountSyncAvailable,
      );

      if (actionState === "hidden") {
        return null;
      }

      const isSyncing = syncingProfileId === profile.id;
      const isDisabled = actionState === "disabled" || refreshing || isSyncing;

      return (
        <Pressable
          hitSlop={10}
          onPress={() => {
            handleSyncProfile(profile).catch(() => {
              // noop - errors are handled inside the callback
            });
          }}
          disabled={isDisabled}
          accessibilityRole="button"
          accessibilityLabel={t("profiles.syncAction")}
          style={[
            styles.syncActionButton,
            isDisabled && styles.syncActionButtonDisabled,
          ]}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color={theme.colors.accentBlue} />
          ) : (
            <Ionicons
              name={getSyncActionIconName(syncStatus)}
              size={16}
              color={theme.colors.accentBlue}
            />
          )}
          <Text style={styles.syncActionButtonText}>{t("profiles.syncAction")}</Text>
        </Pressable>
      );
    },
    [accountSyncAvailable, handleSyncProfile, refreshing, syncingProfileId, theme.colors.accentBlue],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingHorizontal: screenWidth > 700 ? 16 : 12,
          paddingTop: 12,
          paddingBottom: safeArea.bottom + 120,
        }}
      >
        <View style={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>{t("profiles.title")}</Text>
            <Text style={styles.heroSubtitle}>{t("profiles.subtitle")}</Text>
          </View>

          <View style={styles.syncCard}>
            <View style={styles.syncHeader}>
              <View style={styles.syncHeaderLeft}>
                <View style={styles.syncIconWrap}>
                  {refreshing ? (
                    <ActivityIndicator size="small" color={theme.colors.accentBlue} />
                  ) : (
                    <Ionicons
                      name={syncIconName as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={syncError ? theme.colors.warningCritical : theme.colors.accentBlue}
                    />
                  )}
                </View>
                <View style={styles.syncHeaderText}>
                  <Text style={styles.syncTitle}>{t("profiles.syncTitle")}</Text>
                  <Text style={styles.syncSummary}>{syncSummaryText}</Text>
                </View>
              </View>
              <Pressable
                style={[
                  styles.refreshButton,
                  (!accountSyncAvailable || refreshing) && styles.refreshButtonDisabled,
                ]}
                onPress={handleManualRefresh}
                disabled={!accountSyncAvailable || refreshing}
              >
                <Ionicons
                  name="refresh-outline"
                  size={16}
                  color={theme.colors.text}
                />
                <Text style={styles.refreshButtonText}>{t("profiles.syncRefresh")}</Text>
              </Pressable>
            </View>

            <View style={styles.syncBadgeRow}>
              <SyncStatusBadge
                label={t("profiles.syncCountSynced", { count: overview.syncedCount })}
                tone="success"
              />
              <SyncStatusBadge
                label={t("profiles.syncCountPending", { count: overview.pendingCount })}
                tone="warning"
              />
              <SyncStatusBadge
                label={t("profiles.syncCountLocalOnly", { count: overview.localOnlyCount })}
                tone="neutral"
              />
            </View>

            <Text style={styles.syncDetails}>{t("profiles.syncDetails")}</Text>
          </View>

          <Pressable
            style={[
              styles.profileCard,
              effectiveSelectedProfileId === null && styles.profileCardSelected,
            ]}
            onPress={() => handleSelectProfile(null)}
            accessibilityLabel={t("profiles.noProfile")}
            accessibilityRole="button"
          >
            <View style={styles.profileCardIconWrap}>
              <Ionicons name="remove" size={18} color="white" />
            </View>
            <View style={styles.profileCardBody}>
              <View style={styles.profileCardHeaderRow}>
                <Text style={styles.profileCardTitle}>{t("profiles.noProfile")}</Text>
              </View>
              <Text style={styles.profileCardSummary}>{t("profiles.noProfileDescription")}</Text>
            </View>
            {effectiveSelectedProfileId === null && (
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.text} />
            )}
          </Pressable>

          <SectionHeader
            title={t("profiles.builtInSection")}
            description={t("profiles.builtInSectionDescription")}
          />

          {DEFAULT_PROFILES.map((profileDisplay) => {
            const builtInDefault = getBuiltInProfile(profileDisplay.id);
            if (!builtInDefault) {
              return null;
            }

            const override = profiles.find((profile) => profile.id === profileDisplay.id);
            const profile = override ?? builtInDefault;
            const syncStatus = override
              ? getProfileSyncStatus(profile, profileRemoteState[profile.id])
              : null;

            return (
              <Pressable
                key={profile.id}
                style={[
                  styles.profileCard,
                  effectiveSelectedProfileId === profile.id && styles.profileCardSelected,
                ]}
                onPress={() => handleSelectProfile(profile.id)}
              >
                <View style={[styles.profileCardIconWrap, styles.profileCardIconWrapBuiltIn]}>
                  <Ionicons name="sparkles" size={18} color="white" />
                </View>
                <View style={styles.profileCardBody}>
                  <View style={styles.profileCardHeaderRow}>
                    <Text style={styles.profileCardTitle}>{profile.name}</Text>
                    <View style={styles.inlineBadgeRow}>
                      <SyncStatusBadge label={t("profiles.badgeBuiltIn")} tone="info" />
                      {override && (
                        <SyncStatusBadge label={t("profiles.badgeOverride")} tone="neutral" />
                      )}
                      {syncStatus && (
                        <SyncStatusBadge
                          label={getSyncBadgeLabel(syncStatus)}
                          tone={getSyncBadgeTone(syncStatus)}
                        />
                      )}
                    </View>
                  </View>
                  <Text style={styles.profileCardSummary}>{renderProfileSummary(profile)}</Text>
                </View>
                <View style={styles.actionRow}>
                  {effectiveSelectedProfileId === profile.id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={theme.colors.text}
                      style={styles.selectionIcon}
                    />
                  )}
                  {override && syncStatus && renderSyncActionButton(profile, syncStatus)}
                  {override && (
                    <Pressable
                      hitSlop={10}
                      onPress={() => handleResetBuiltInProfile(profile.id)}
                      style={styles.actionIconButton}
                    >
                      <Ionicons
                        name="refresh-outline"
                        size={20}
                        color={theme.colors.button.secondary.tint}
                      />
                    </Pressable>
                  )}
                  <Pressable
                    hitSlop={10}
                    onPress={() => openEditor(profile)}
                    style={override ? styles.actionIconButton : undefined}
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

          <SectionHeader
            title={t("profiles.customSection")}
            description={t("profiles.customSectionDescription")}
          />

          {overview.customProfiles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name="folder-open-outline"
                size={18}
                color={theme.colors.textSecondary}
              />
              <Text style={styles.emptyCardText}>{t("profiles.customEmpty")}</Text>
            </View>
          ) : (
            overview.customProfiles.map((profile) => {
              const syncStatus = getProfileSyncStatus(
                profile,
                profileRemoteState[profile.id],
              );

              return (
                <Pressable
                  key={profile.id}
                  style={[
                    styles.profileCard,
                    effectiveSelectedProfileId === profile.id && styles.profileCardSelected,
                  ]}
                  onPress={() => handleSelectProfile(profile.id)}
                >
                  <View style={[styles.profileCardIconWrap, styles.profileCardIconWrapCustom]}>
                    <Ionicons name="person" size={18} color="white" />
                  </View>
                  <View style={styles.profileCardBody}>
                    <View style={styles.profileCardHeaderRow}>
                      <Text style={styles.profileCardTitle}>{profile.name}</Text>
                      <View style={styles.inlineBadgeRow}>
                        <SyncStatusBadge
                          label={getSyncBadgeLabel(syncStatus)}
                          tone={getSyncBadgeTone(syncStatus)}
                        />
                      </View>
                    </View>
                    <Text style={styles.profileCardSummary}>{renderProfileSummary(profile)}</Text>
                  </View>
                  <View style={styles.actionRow}>
                    {effectiveSelectedProfileId === profile.id && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.text}
                        style={styles.selectionIcon}
                      />
                    )}
                    {renderSyncActionButton(profile, syncStatus)}
                    <Pressable
                      hitSlop={10}
                      onPress={() => openEditor(profile)}
                      style={styles.actionIconButton}
                    >
                      <Ionicons
                        name="create-outline"
                        size={20}
                        color={theme.colors.button.secondary.tint}
                      />
                    </Pressable>
                    <Pressable
                      hitSlop={10}
                      onPress={() => handleDeleteProfile(profile)}
                      style={styles.actionIconButton}
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
            })
          )}

          <SectionHeader
            title={t("profiles.addProfile")}
            description={t("profiles.createDescription")}
          />

          <Pressable
            style={[
              styles.createCard,
              showTemplateSelector && styles.createCardExpanded,
            ]}
            onPress={() => setShowTemplateSelector((current) => !current)}
          >
            <View style={styles.createCardHeader}>
              <View style={styles.createCardIconWrap}>
                <Ionicons
                  name="add-circle-outline"
                  size={20}
                  color={theme.colors.button.secondary.tint}
                />
              </View>
              <Text style={styles.createCardTitle}>{t("profiles.addProfile")}</Text>
              <Ionicons
                name={showTemplateSelector ? "chevron-up" : "chevron-down"}
                size={18}
                color={theme.colors.button.secondary.tint}
              />
            </View>
          </Pressable>

          {showTemplateSelector && (
            <View style={styles.templatePanel}>
              <Pressable style={styles.templateRow} onPress={handleAddBlankProfile}>
                <View style={[styles.templateIconWrap, styles.templateIconWrapBlank]}>
                  <Ionicons name="document-outline" size={14} color={theme.colors.textSecondary} />
                </View>
                <Text style={styles.templateTitle}>{t("profiles.blankProfile")}</Text>
              </Pressable>

              {DEFAULT_PROFILES.map((profile) => (
                <Pressable
                  key={profile.id}
                  style={styles.templateRow}
                  onPress={() => handleAddFromTemplate(profile.id)}
                >
                  <View style={[styles.templateIconWrap, styles.templateIconWrapBuiltIn]}>
                    <Ionicons name="sparkles" size={14} color="white" />
                  </View>
                  <Text style={styles.templateTitle}>{profile.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {showAddForm && editingProfile && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
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

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    width: "100%",
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    gap: 12,
  },
  heroCard: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  syncCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: theme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    gap: 12,
  },
  syncHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  syncIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceHighest,
  },
  syncHeaderText: {
    flex: 1,
  },
  syncTitle: {
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  syncSummary: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonDisabled: {
    opacity: 0.45,
  },
  refreshButtonText: {
    fontSize: 13,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  syncBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  syncDetails: {
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  sectionHeader: {
    paddingTop: 4,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 17,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  sectionDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: theme.colors.input.background,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  profileCardSelected: {
    borderWidth: 2,
    borderColor: theme.colors.text,
  },
  profileCardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.button.secondary.tint,
  },
  profileCardIconWrapBuiltIn: {
    backgroundColor: theme.colors.button.primary.background,
  },
  profileCardIconWrapCustom: {
    backgroundColor: theme.colors.button.secondary.tint,
  },
  profileCardBody: {
    flex: 1,
    gap: 6,
  },
  profileCardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  profileCardTitle: {
    flexShrink: 1,
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  profileCardSummary: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  inlineBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectionIcon: {
    marginRight: 10,
  },
  actionIconButton: {
    marginLeft: 2,
  },
  syncActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accentBlue,
    backgroundColor: `${theme.colors.accentBlue}12`,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncActionButtonDisabled: {
    opacity: 0.45,
  },
  syncActionButtonText: {
    fontSize: 12,
    color: theme.colors.accentBlue,
    ...Typography.default("semiBold"),
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    ...Typography.default("semiBold"),
  },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
    padding: 14,
  },
  emptyCardText: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  createCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
    padding: 16,
  },
  createCardExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  createCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  createCardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  createCardTitle: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.button.secondary.tint,
    ...Typography.default("semiBold"),
  },
  templatePanel: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
  },
  templateIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  templateIconWrapBlank: {
    backgroundColor: theme.colors.surface,
  },
  templateIconWrapBuiltIn: {
    backgroundColor: theme.colors.button.primary.background,
  },
  templateTitle: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    ...Typography.default(),
  },
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
