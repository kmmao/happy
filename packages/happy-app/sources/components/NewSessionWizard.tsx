import React, { useState, useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { SessionTypeSelector } from "@/components/SessionTypeSelector";
import type {
  PermissionModeKey,
  ModelModeKey,
} from "@/components/PermissionModeSelector";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import {
  useAllMachines,
  useSessions,
  useSetting,
  storage,
} from "@/sync/storage";
import { useRouter } from "expo-router";
import {
  AIBackendProfile,
  validateProfileForAgent,
  getProfileEnvironmentVariables,
} from "@/sync/settings";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { profileSyncService } from "@/sync/profileSync";

import type { WizardStep, NewSessionWizardProps } from "./NewSessionWizardTypes";
import { wizardStylesheet } from "./NewSessionWizardStyles";
import { ProfileSelectionItem } from "./ProfileSelectionItem";
import { ManualConfigurationItem } from "./ManualConfigurationItem";
import {
  profileNeedsConfiguration,
  getProfileRequiredFields,
  BUILT_IN_PROFILES,
} from "./NewSessionWizardHelpers";
import { log } from '@/log';

export function NewSessionWizard({
  onComplete,
  onCancel,
  initialPrompt = "",
}: NewSessionWizardProps) {
  const { theme } = useUnistyles();
  const styles = wizardStylesheet;
  const router = useRouter();
  const machines = useAllMachines();
  const sessions = useSessions();
  const experimentsEnabled = useSetting("experiments");
  const recentMachinePaths = useSetting("recentMachinePaths");
  const lastUsedAgent = useSetting("lastUsedAgent");
  const lastUsedPermissionMode = useSetting("lastUsedPermissionMode");
  const lastUsedModelMode = useSetting("lastUsedModelMode");
  const profiles = useSetting("profiles");
  const lastUsedProfile = useSetting("lastUsedProfile");

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>("profile");
  const [sessionType, setSessionType] = useState<"simple" | "worktree">(
    "simple",
  );
  const [agentType, setAgentType] = useState<"claude" | "codex">(() => {
    if (lastUsedAgent === "claude" || lastUsedAgent === "codex") {
      return lastUsedAgent;
    }
    return "claude";
  });
  const [permissionMode, setPermissionMode] =
    useState<PermissionModeKey>("default");
  const [modelMode, setModelMode] = useState<ModelModeKey>("default");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    () => {
      return lastUsedProfile;
    },
  );

  // Built-in profiles
  const builtInProfiles: AIBackendProfile[] = useMemo(
    () => BUILT_IN_PROFILES,
    [],
  );

  // Combined profiles
  const allProfiles = useMemo(() => {
    return [...builtInProfiles, ...profiles];
  }, [profiles, builtInProfiles]);

  const [selectedMachineId, setSelectedMachineId] = useState<string>(() => {
    if (machines.length > 0) {
      // Check if we have a recently used machine that's currently available
      if (recentMachinePaths.length > 0) {
        for (const recent of recentMachinePaths) {
          if (machines.find((m) => m.id === recent.machineId)) {
            return recent.machineId;
          }
        }
      }
      return machines[0].id;
    }
    return "";
  });
  const [selectedPath, setSelectedPath] = useState<string>(() => {
    if (machines.length > 0 && selectedMachineId) {
      const machine = machines.find((m) => m.id === selectedMachineId);
      return machine?.metadata?.homeDir || "/home";
    }
    return "/home";
  });
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [customPath, setCustomPath] = useState<string>("");
  const [showCustomPathInput, setShowCustomPathInput] =
    useState<boolean>(false);

  // Profile configuration state
  const [profileApiKeys, setProfileApiKeys] = useState<
    Record<string, Record<string, string>>
  >({});
  const [profileConfigs, setProfileConfigs] = useState<
    Record<string, Record<string, string>>
  >({});

  // Dynamic steps based on whether profile needs configuration
  const steps: WizardStep[] = React.useMemo(() => {
    const baseSteps: WizardStep[] = experimentsEnabled
      ? [
          "profile",
          "sessionType",
          "agent",
          "options",
          "machine",
          "path",
          "prompt",
        ]
      : ["profile", "agent", "options", "machine", "path", "prompt"];

    // Insert profileConfig step after profile if needed
    if (profileNeedsConfiguration(selectedProfileId, allProfiles)) {
      const profileIndex = baseSteps.indexOf("profile");
      const beforeProfile = baseSteps.slice(
        0,
        profileIndex + 1,
      ) as WizardStep[];
      const afterProfile = baseSteps.slice(profileIndex + 1) as WizardStep[];
      return [
        ...beforeProfile,
        "profileConfig",
        ...afterProfile,
      ] as WizardStep[];
    }

    return baseSteps;
  }, [experimentsEnabled, selectedProfileId, allProfiles]);

  // Auto-load profile settings and sync with CLI
  React.useEffect(() => {
    if (selectedProfileId) {
      const selectedProfile = allProfiles.find(
        (p) => p.id === selectedProfileId,
      );
      if (selectedProfile) {
        // Auto-select agent type based on profile compatibility
        if (
          selectedProfile.compatibility.claude &&
          !selectedProfile.compatibility.codex
        ) {
          setAgentType("claude");
        } else if (
          selectedProfile.compatibility.codex &&
          !selectedProfile.compatibility.claude
        ) {
          setAgentType("codex");
        }

        // Sync active profile to CLI
        profileSyncService
          .setActiveProfile(selectedProfileId)
          .catch((error) => {
            log.error(
              "[Wizard] Failed to sync active profile to CLI:",
              error,
            );
          });
      }
    }
  }, [selectedProfileId, allProfiles]);

  // Sync profiles with CLI on component mount and when profiles change
  React.useEffect(() => {
    const syncProfiles = async () => {
      try {
        await profileSyncService.bidirectionalSync(allProfiles);
      } catch (error) {
        log.error("[Wizard] Failed to sync profiles with CLI:", error);
        // Continue without sync - profiles work locally
      }
    };

    // Sync on mount
    syncProfiles();

    // Set up sync listener for profile changes
    const handleSyncEvent = (event: any) => {
      if (event.status === "error") {
        log.warn("[Wizard] Profile sync error:", event.error);
      }
    };

    profileSyncService.addEventListener(handleSyncEvent);

    return () => {
      profileSyncService.removeEventListener(handleSyncEvent);
    };
  }, [allProfiles]);

  // Get recent paths for the selected machine
  const recentPaths = useMemo(() => {
    if (!selectedMachineId) return [];

    // Filter out worktree/branch paths (e.g. .dev/worktree/*, .claude/worktrees/*)
    const isWorktreePath = (p: string) =>
      p.includes("/.dev/worktree/") || p.includes("/.claude/worktrees/");

    const paths: string[] = [];
    const pathSet = new Set<string>();

    // First, add paths from recentMachinePaths (these are the most recent)
    recentMachinePaths.forEach((entry) => {
      if (
        entry.machineId === selectedMachineId &&
        !pathSet.has(entry.path) &&
        !isWorktreePath(entry.path)
      ) {
        paths.push(entry.path);
        pathSet.add(entry.path);
      }
    });

    // Then add paths from sessions if we need more
    if (sessions) {
      const pathsWithTimestamps: Array<{ path: string; timestamp: number }> =
        [];

      sessions.forEach((item) => {
        if (typeof item === "string") return; // Skip section headers

        const session = item as any;
        if (
          session.metadata?.machineId === selectedMachineId &&
          session.metadata?.path
        ) {
          const path = session.metadata.path;
          if (!pathSet.has(path) && !isWorktreePath(path)) {
            pathSet.add(path);
            pathsWithTimestamps.push({
              path,
              timestamp: session.updatedAt || session.createdAt,
            });
          }
        }
      });

      // Sort session paths by most recent first and add them
      pathsWithTimestamps
        .sort((a, b) => b.timestamp - a.timestamp)
        .forEach((item) => paths.push(item.path));
    }

    return paths;
  }, [sessions, selectedMachineId, recentMachinePaths]);

  const currentStepIndex = steps.indexOf(currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  // Handler for "Use Profile As-Is" - quick session creation
  const handleUseProfileAsIs = (profile: AIBackendProfile) => {
    setSelectedProfileId(profile.id);

    // Auto-select agent type based on profile compatibility
    if (profile.compatibility.claude && !profile.compatibility.codex) {
      setAgentType("claude");
    } else if (profile.compatibility.codex && !profile.compatibility.claude) {
      setAgentType("codex");
    }

    // Get environment variables from profile (no user configuration)
    const environmentVariables = getProfileEnvironmentVariables(profile);

    // Complete wizard immediately with profile settings
    onComplete({
      sessionType,
      profileId: profile.id,
      agentType:
        agentType || (profile.compatibility.claude ? "claude" : "codex"),
      permissionMode,
      modelMode,
      machineId: selectedMachineId,
      path:
        showCustomPathInput && customPath.trim()
          ? customPath.trim()
          : selectedPath,
      prompt,
      environmentVariables,
    });
  };

  // Handler for "Edit Profile" - load profile and go to configuration step
  const handleEditProfile = (profile: AIBackendProfile) => {
    setSelectedProfileId(profile.id);

    // Auto-select agent type based on profile compatibility
    if (profile.compatibility.claude && !profile.compatibility.codex) {
      setAgentType("claude");
    } else if (profile.compatibility.codex && !profile.compatibility.claude) {
      setAgentType("codex");
    }

    // If profile needs configuration, go to profileConfig step
    if (profileNeedsConfiguration(profile.id, allProfiles)) {
      setCurrentStep("profileConfig");
    } else {
      // If no configuration needed, proceed to next step in the normal flow
      const profileIndex = steps.indexOf("profile");
      setCurrentStep(steps[profileIndex + 1]);
    }
  };

  // Handler for "Create New Profile"
  const handleCreateProfile = () => {
    Modal.prompt("Create New Profile", "Enter a name for your new profile:", {
      defaultValue: "My Custom Profile",
      confirmText: "Create",
      cancelText: "Cancel",
    }).then((profileName) => {
      if (profileName && profileName.trim()) {
        const newProfile: AIBackendProfile = {
          id: crypto.randomUUID(),
          name: profileName.trim(),
          description: "Custom AI profile",
          anthropicConfig: {},
          environmentVariables: [],
          compatibility: { claude: true, codex: true, gemini: true },
          isBuiltIn: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: "1.0.0",
        };

        // Get current profiles from settings
        const currentProfiles = storage.getState().settings.profiles || [];
        const updatedProfiles = [...currentProfiles, newProfile];

        // Persist through settings system
        sync.applySettings({ profiles: updatedProfiles });

        // Sync with CLI
        profileSyncService.syncGuiToCli(updatedProfiles).catch((error) => {
          log.error("[Wizard] Failed to sync new profile with CLI:", error);
        });

        // Auto-select the newly created profile
        setSelectedProfileId(newProfile.id);
      }
    });
  };

  // Handler for "Duplicate Profile"
  const handleDuplicateProfile = (profile: AIBackendProfile) => {
    Modal.prompt(
      "Duplicate Profile",
      `Enter a name for the duplicate of "${profile.name}":`,
      {
        defaultValue: `${profile.name} (Copy)`,
        confirmText: "Duplicate",
        cancelText: "Cancel",
      },
    ).then((newName) => {
      if (newName && newName.trim()) {
        const duplicatedProfile: AIBackendProfile = {
          ...profile,
          id: crypto.randomUUID(),
          name: newName.trim(),
          description: profile.description
            ? `Copy of ${profile.description}`
            : "Custom AI profile",
          isBuiltIn: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Get current profiles from settings
        const currentProfiles = storage.getState().settings.profiles || [];
        const updatedProfiles = [...currentProfiles, duplicatedProfile];

        // Persist through settings system
        sync.applySettings({ profiles: updatedProfiles });

        // Sync with CLI
        profileSyncService.syncGuiToCli(updatedProfiles).catch((error) => {
          log.error(
            "[Wizard] Failed to sync duplicated profile with CLI:",
            error,
          );
        });
      }
    });
  };

  // Handler for "Delete Profile"
  const handleDeleteProfile = (profile: AIBackendProfile) => {
    Modal.confirm(
      "Delete Profile",
      `Are you sure you want to delete "${profile.name}"? This action cannot be undone.`,
      {
        confirmText: "Delete",
        destructive: true,
      },
    ).then((confirmed) => {
      if (confirmed) {
        // Get current profiles from settings
        const currentProfiles = storage.getState().settings.profiles || [];
        const updatedProfiles = currentProfiles.filter(
          (p) => p.id !== profile.id,
        );

        // Persist through settings system
        sync.applySettings({ profiles: updatedProfiles });

        // Sync with CLI
        profileSyncService.syncGuiToCli(updatedProfiles).catch((error) => {
          log.error(
            "[Wizard] Failed to sync profile deletion with CLI:",
            error,
          );
        });

        // Clear selection if deleted profile was selected
        if (selectedProfileId === profile.id) {
          setSelectedProfileId(null);
        }
      }
    });
  };

  // Handler for "Use CLI Environment Variables" - quick session creation with CLI vars
  const handleUseCliEnvironmentVariables = () => {
    setSelectedProfileId(null);

    // Complete wizard immediately with no profile (rely on CLI environment variables)
    onComplete({
      sessionType,
      profileId: null,
      agentType,
      permissionMode,
      modelMode,
      machineId: selectedMachineId,
      path:
        showCustomPathInput && customPath.trim()
          ? customPath.trim()
          : selectedPath,
      prompt,
      environmentVariables: undefined, // Let CLI handle environment variables
    });
  };

  // Handler for "Manual Configuration" - go through normal wizard flow
  const handleManualConfiguration = () => {
    setSelectedProfileId(null);

    // Proceed to next step in normal wizard flow
    const profileIndex = steps.indexOf("profile");
    setCurrentStep(steps[profileIndex + 1]);
  };

  const handleNext = () => {
    // Special handling for profileConfig step - skip if profile doesn't need configuration
    if (
      currentStep === "profileConfig" &&
      (!selectedProfileId || !profileNeedsConfiguration(selectedProfileId, allProfiles))
    ) {
      setCurrentStep(steps[currentStepIndex + 1]);
      return;
    }

    if (isLastStep) {
      // Get environment variables from selected profile with proper precedence handling
      let environmentVariables: Record<string, string> | undefined;
      if (selectedProfileId) {
        const selectedProfile = allProfiles.find(
          (p) => p.id === selectedProfileId,
        );
        if (selectedProfile) {
          // Start with profile environment variables (base configuration)
          environmentVariables =
            getProfileEnvironmentVariables(selectedProfile);

          // Only add user-provided API keys if they're non-empty
          // This preserves CLI environment variable precedence when wizard fields are empty
          const userApiKeys = profileApiKeys[selectedProfileId];
          if (userApiKeys) {
            Object.entries(userApiKeys).forEach(([key, value]) => {
              // Only override if user provided a non-empty value
              if (value && value.trim().length > 0) {
                environmentVariables![key] = value;
              }
            });
          }

          // Only add user configurations if they're non-empty
          const userConfigs = profileConfigs[selectedProfileId];
          if (userConfigs) {
            Object.entries(userConfigs).forEach(([key, value]) => {
              // Only override if user provided a non-empty value
              if (value && value.trim().length > 0) {
                environmentVariables![key] = value;
              }
            });
          }
        }
      }

      onComplete({
        sessionType,
        profileId: selectedProfileId,
        agentType,
        permissionMode,
        modelMode,
        machineId: selectedMachineId,
        path:
          showCustomPathInput && customPath.trim()
            ? customPath.trim()
            : selectedPath,
        prompt,
        environmentVariables,
      });
    } else {
      setCurrentStep(steps[currentStepIndex + 1]);
    }
  };

  const handleBack = () => {
    if (isFirstStep) {
      onCancel();
    } else {
      setCurrentStep(steps[currentStepIndex - 1]);
    }
  };

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case "profile":
        return true; // Always valid (profile can be null for manual config)
      case "profileConfig":
        if (!selectedProfileId) return false;
        const requiredFields = getProfileRequiredFields(selectedProfileId, allProfiles);
        // Profile configuration step is always shown when needed
        // Users can leave fields empty to preserve CLI environment variables
        return true;
      case "sessionType":
        return true; // Always valid
      case "agent":
        return true; // Always valid
      case "options":
        return true; // Always valid
      case "machine":
        return selectedMachineId.length > 0;
      case "path":
        return (
          selectedPath.trim().length > 0 ||
          (showCustomPathInput && customPath.trim().length > 0)
        );
      case "prompt":
        return prompt.trim().length > 0;
      default:
        return false;
    }
  }, [
    currentStep,
    selectedMachineId,
    selectedPath,
    prompt,
    showCustomPathInput,
    customPath,
    selectedProfileId,
    profileApiKeys,
    profileConfigs,
    allProfiles,
  ]);

  const renderStepContent = () => {
    switch (currentStep) {
      case "profile":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.chooseProfile")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.chooseProfileDescription")}
            </Text>

            <ItemGroup title={t("newSession.wizard.builtInProfiles")}>
              {builtInProfiles.map((profile) => (
                <ProfileSelectionItem
                  key={profile.id}
                  profile={profile}
                  isSelected={selectedProfileId === profile.id}
                  onSelect={() => setSelectedProfileId(profile.id)}
                  onUseAsIs={() => handleUseProfileAsIs(profile)}
                  onEdit={() => handleEditProfile(profile)}
                />
              ))}
            </ItemGroup>

            {profiles.length > 0 && (
              <ItemGroup title={t("newSession.wizard.customProfiles")}>
                {profiles.map((profile) => (
                  <ProfileSelectionItem
                    key={profile.id}
                    profile={profile}
                    isSelected={selectedProfileId === profile.id}
                    onSelect={() => setSelectedProfileId(profile.id)}
                    onUseAsIs={() => handleUseProfileAsIs(profile)}
                    onEdit={() => handleEditProfile(profile)}
                    onDuplicate={() => handleDuplicateProfile(profile)}
                    onDelete={() => handleDeleteProfile(profile)}
                    showManagementActions={true}
                  />
                ))}
              </ItemGroup>
            )}

            {/* Create New Profile Button */}
            <Pressable
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: theme.colors.button.primary.background,
                borderStyle: "dashed",
                padding: 16,
                marginBottom: 12,
              }}
              onPress={handleCreateProfile}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: theme.colors.button.primary.background,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                  }}
                >
                  <Ionicons name="add" size={20} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: theme.colors.text,
                      marginBottom: 4,
                      ...Typography.default("semiBold"),
                    }}
                  >
                    Create New Profile
                  </Text>
                  <Text
                    style={{
                      fontSize: 14,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    Set up a custom AI backend configuration
                  </Text>
                </View>
              </View>
            </Pressable>

            <ItemGroup title="Manual Configuration">
              <ManualConfigurationItem
                isSelected={selectedProfileId === null}
                onSelect={() => setSelectedProfileId(null)}
                onUseCliVars={() => handleUseCliEnvironmentVariables()}
                onConfigureManually={() => handleManualConfiguration()}
              />
            </ItemGroup>

            <View
              style={{
                backgroundColor: theme.colors.input.background,
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                marginTop: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                💡 **Profile Selection Options:**
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  marginTop: 4,
                }}
              >
                • **Use As-Is**: Quick session creation with current profile
                settings
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  marginTop: 4,
                }}
              >
                • **Edit**: Configure API keys and settings before session
                creation
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  marginTop: 4,
                }}
              >
                • **Manual**: Use CLI environment variables without profile
                configuration
              </Text>
            </View>
          </View>
        );

      case "profileConfig":
        if (
          !selectedProfileId ||
          !profileNeedsConfiguration(selectedProfileId, allProfiles)
        ) {
          // Skip configuration if no profile selected or profile doesn't need configuration
          setCurrentStep(steps[currentStepIndex + 1]);
          return null;
        }

        return (
          <View>
            <Text style={styles.stepTitle}>
              {t("newSession.wizard.configureProfile")}{" "}
              {allProfiles.find((p) => p.id === selectedProfileId)?.name ||
                "Profile"}
            </Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.configureProfileDescription")}
            </Text>

            <ItemGroup title={t("newSession.wizard.requiredConfiguration")}>
              {getProfileRequiredFields(selectedProfileId, allProfiles).map((field) => (
                <View key={field.key} style={{ marginBottom: 16 }}>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: theme.colors.text,
                      marginBottom: 8,
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {field.label}
                  </Text>
                  <TextInput
                    style={[
                      styles.textInput,
                      { fontFamily: "monospace" }, // Monospace font for API keys
                    ]}
                    placeholder={field.placeholder}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={
                      (profileApiKeys[selectedProfileId!] as any)?.[
                        field.key
                      ] ||
                      (profileConfigs[selectedProfileId!] as any)?.[
                        field.key
                      ] ||
                      ""
                    }
                    onChangeText={(text) => {
                      if (field.isPassword) {
                        // API key
                        setProfileApiKeys((prev) => ({
                          ...prev,
                          [selectedProfileId!]: {
                            ...((prev[selectedProfileId!] as Record<
                              string,
                              string
                            >) || {}),
                            [field.key]: text,
                          },
                        }));
                      } else {
                        // Configuration field
                        setProfileConfigs((prev) => ({
                          ...prev,
                          [selectedProfileId!]: {
                            ...((prev[selectedProfileId!] as Record<
                              string,
                              string
                            >) || {}),
                            [field.key]: text,
                          },
                        }));
                      }
                    }}
                    secureTextEntry={field.isPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
              ))}
            </ItemGroup>

            <View
              style={{
                backgroundColor: theme.colors.input.background,
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                marginTop: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                💡 Tip: Your API keys are only used for this session and are not
                stored permanently
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  marginTop: 4,
                }}
              >
                📝 Note: Leave fields empty to use CLI environment variables if
                they're already set
              </Text>
            </View>
          </View>
        );

      case "sessionType":
        return (
          <View>
            <Text style={styles.stepTitle}>
              {t("newSession.wizard.chooseBackendAndSessionType")}
            </Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.chooseBackendDescription")}
            </Text>

            <ItemGroup title={t("newSession.wizard.aiBackend")}>
              {[
                {
                  id: "anthropic",
                  name: "Anthropic Claude",
                  description: "Advanced reasoning and coding assistant",
                  icon: "cube-outline",
                  agentType: "claude" as const,
                },
                {
                  id: "openai",
                  name: "OpenAI GPT-5",
                  description: "Specialized coding assistant",
                  icon: "code-outline",
                  agentType: "codex" as const,
                },
                {
                  id: "deepseek",
                  name: "DeepSeek Reasoner",
                  description: "Advanced reasoning model",
                  icon: "analytics-outline",
                  agentType: "claude" as const,
                },
                {
                  id: "zai",
                  name: "Z.ai",
                  description: "AI assistant for development",
                  icon: "flash-outline",
                  agentType: "claude" as const,
                },
                {
                  id: "microsoft",
                  name: "Microsoft Azure",
                  description: "Enterprise AI services",
                  icon: "cloud-outline",
                  agentType: "codex" as const,
                },
              ].map((backend) => (
                <Item
                  key={backend.id}
                  title={backend.name}
                  subtitle={backend.description}
                  leftElement={
                    <Ionicons
                      name={backend.icon as any}
                      size={24}
                      color={theme.colors.textSecondary}
                    />
                  }
                  rightElement={
                    agentType === backend.agentType ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.button.primary.background}
                      />
                    ) : null
                  }
                  onPress={() => setAgentType(backend.agentType)}
                  showChevron={false}
                  selected={agentType === backend.agentType}
                  showDivider={true}
                />
              ))}
            </ItemGroup>

            <SessionTypeSelector
              value={sessionType}
              onChange={setSessionType}
            />
          </View>
        );

      case "agent":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.chooseAgent")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.chooseAgentDescription")}
            </Text>

            {selectedProfileId && (
              <View
                style={{
                  backgroundColor: theme.colors.input.background,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  Profile:{" "}
                  {allProfiles.find((p) => p.id === selectedProfileId)?.name ||
                    "Unknown"}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {
                    allProfiles.find((p) => p.id === selectedProfileId)
                      ?.description
                  }
                </Text>
              </View>
            )}

            <Pressable
              style={[
                styles.agentOption,
                agentType === "claude"
                  ? styles.agentOptionSelected
                  : styles.agentOptionUnselected,
                selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.claude && {
                    opacity: 0.5,
                    backgroundColor: theme.colors.surface,
                  },
              ]}
              onPress={() => {
                if (
                  !selectedProfileId ||
                  allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.claude
                ) {
                  setAgentType("claude");
                }
              }}
              disabled={
                !!(
                  selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.claude
                )
              }
            >
              <View style={styles.agentIcon}>
                <Text
                  style={{ color: "white", fontSize: 16, fontWeight: "bold" }}
                >
                  C
                </Text>
              </View>
              <View style={styles.agentInfo}>
                <Text style={styles.agentName}>Claude</Text>
                <Text style={styles.agentDescription}>
                  Anthropic's AI assistant, great for coding and analysis
                </Text>
                {selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.claude && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: theme.colors.textDestructive,
                        marginTop: 4,
                      }}
                    >
                      Not compatible with selected profile
                    </Text>
                  )}
              </View>
              {agentType === "claude" && (
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color={theme.colors.button.primary.background}
                />
              )}
            </Pressable>

            <Pressable
              style={[
                styles.agentOption,
                agentType === "codex"
                  ? styles.agentOptionSelected
                  : styles.agentOptionUnselected,
                selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.codex && {
                    opacity: 0.5,
                    backgroundColor: theme.colors.surface,
                  },
              ]}
              onPress={() => {
                if (
                  !selectedProfileId ||
                  allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.codex
                ) {
                  setAgentType("codex");
                }
              }}
              disabled={
                !!(
                  selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.codex
                )
              }
            >
              <View style={styles.agentIcon}>
                <Text
                  style={{ color: "white", fontSize: 16, fontWeight: "bold" }}
                >
                  X
                </Text>
              </View>
              <View style={styles.agentInfo}>
                <Text style={styles.agentName}>Codex</Text>
                <Text style={styles.agentDescription}>
                  OpenAI's specialized coding assistant
                </Text>
                {selectedProfileId &&
                  !allProfiles.find((p) => p.id === selectedProfileId)
                    ?.compatibility.codex && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: theme.colors.textDestructive,
                        marginTop: 4,
                      }}
                    >
                      Not compatible with selected profile
                    </Text>
                  )}
              </View>
              {agentType === "codex" && (
                <Ionicons
                  name="checkmark-circle"
                  size={24}
                  color={theme.colors.button.primary.background}
                />
              )}
            </Pressable>
          </View>
        );

      case "options":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.agentOptions")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.agentOptionsDescription")}
            </Text>

            {selectedProfileId && (
              <View
                style={{
                  backgroundColor: theme.colors.input.background,
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  Using profile:{" "}
                  {allProfiles.find((p) => p.id === selectedProfileId)?.name ||
                    "Unknown"}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Environment variables will be applied automatically
                </Text>
              </View>
            )}
            <ItemGroup title="Permission Mode">
              {(
                [
                  {
                    value: "default",
                    label: "Default",
                    description: "Ask for permissions",
                    icon: "shield-outline",
                  },
                  {
                    value: "acceptEdits",
                    label: "Accept Edits",
                    description: "Auto-approve edits",
                    icon: "checkmark-outline",
                  },
                  {
                    value: "plan",
                    label: "Plan",
                    description: "Plan before executing",
                    icon: "list-outline",
                  },
                  {
                    value: "bypassPermissions",
                    label: "Yolo",
                    description: "Skip all permissions",
                    icon: "flash-outline",
                  },
                ] as const
              ).map((option, index, array) => (
                <Item
                  key={option.value}
                  title={option.label}
                  subtitle={option.description}
                  leftElement={
                    <Ionicons
                      name={option.icon}
                      size={24}
                      color={theme.colors.textSecondary}
                    />
                  }
                  rightElement={
                    permissionMode === option.value ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.button.primary.background}
                      />
                    ) : null
                  }
                  onPress={() => setPermissionMode(option.value)}
                  showChevron={false}
                  selected={permissionMode === option.value}
                  showDivider={index < array.length - 1}
                />
              ))}
            </ItemGroup>

            <ItemGroup title="Model Mode">
              {(agentType === "claude"
                ? ([
                    {
                      value: "default",
                      label: "Default",
                      description: "Balanced performance",
                      icon: "cube-outline",
                    },
                    {
                      value: "adaptiveUsage:sonnet",
                      label: "Auto (Sonnet)",
                      description: "Smart routing \u00B7 Sonnet base",
                      icon: "analytics-outline",
                    },
                    {
                      value: "adaptiveUsage:opus",
                      label: "Auto (Opus)",
                      description: "Smart routing \u00B7 Opus base",
                      icon: "analytics-outline",
                    },
                    {
                      value: "adaptiveUsage:haiku",
                      label: "Auto (Haiku)",
                      description: "Smart routing \u00B7 Haiku base",
                      icon: "analytics-outline",
                    },
                    {
                      value: "haiku",
                      label: "Haiku",
                      description: "Fastest \u00B7 $1/$5 \u00B7 200K",
                      icon: "flash-outline",
                    },
                    {
                      value: "sonnet",
                      label: "Sonnet",
                      description: "Balanced \u00B7 $3/$15 \u00B7 200K",
                      icon: "speedometer-outline",
                    },
                    {
                      value: "opus",
                      label: "Opus",
                      description: "Most capable \u00B7 $5/$25 \u00B7 200K",
                      icon: "diamond-outline",
                    },
                  ] as const)
                : ([
                    {
                      value: "gpt-5.3-codex",
                      label: "GPT-5.3 Codex",
                      description: "Most capable coding model",
                      icon: "diamond-outline",
                    },
                    {
                      value: "gpt-5.3-codex-spark",
                      label: "GPT-5.3 Codex Spark",
                      description: "Ultra-fast real-time coding",
                      icon: "flash-outline",
                    },
                    {
                      value: "gpt-5.2-codex",
                      label: "GPT-5.2 Codex",
                      description: "Balanced coding assistance",
                      icon: "cube-outline",
                    },
                  ] as const)
              ).map((option, index, array) => (
                <Item
                  key={option.value}
                  title={option.label}
                  subtitle={option.description}
                  leftElement={
                    <Ionicons
                      name={option.icon}
                      size={24}
                      color={theme.colors.textSecondary}
                    />
                  }
                  rightElement={
                    modelMode === option.value ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.button.primary.background}
                      />
                    ) : null
                  }
                  onPress={() => setModelMode(option.value)}
                  showChevron={false}
                  selected={modelMode === option.value}
                  showDivider={index < array.length - 1}
                />
              ))}
            </ItemGroup>
          </View>
        );

      case "machine":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.selectMachine")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.selectMachineDescription")}
            </Text>

            <ItemGroup title={t("newSession.wizard.availableMachines")}>
              {machines.map((machine, index) => (
                <Item
                  key={machine.id}
                  title={
                    machine.metadata?.displayName ||
                    machine.metadata?.host ||
                    machine.id
                  }
                  subtitle={machine.metadata?.host || ""}
                  leftElement={
                    <Ionicons
                      name="laptop-outline"
                      size={24}
                      color={theme.colors.textSecondary}
                    />
                  }
                  rightElement={
                    selectedMachineId === machine.id ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.colors.button.primary.background}
                      />
                    ) : null
                  }
                  onPress={() => {
                    setSelectedMachineId(machine.id);
                    // Update path when machine changes
                    const homeDir = machine.metadata?.homeDir || "/home";
                    setSelectedPath(homeDir);
                  }}
                  showChevron={false}
                  selected={selectedMachineId === machine.id}
                  showDivider={index < machines.length - 1}
                />
              ))}
            </ItemGroup>
          </View>
        );

      case "path":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.workingDirectory")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.workingDirectoryDescription")}
            </Text>

            {/* Recent Paths */}
            {recentPaths.length > 0 && (
              <ItemGroup title={t("newSession.wizard.recentPaths")}>
                {recentPaths.map((path, index) => (
                  <Item
                    key={path}
                    title={path}
                    subtitle="Recently used"
                    leftElement={
                      <Ionicons
                        name="time-outline"
                        size={24}
                        color={theme.colors.textSecondary}
                      />
                    }
                    rightElement={
                      selectedPath === path && !showCustomPathInput ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={theme.colors.button.primary.background}
                        />
                      ) : null
                    }
                    onPress={() => {
                      setSelectedPath(path);
                      setShowCustomPathInput(false);
                    }}
                    showChevron={false}
                    selected={selectedPath === path && !showCustomPathInput}
                    showDivider={index < recentPaths.length - 1}
                  />
                ))}
              </ItemGroup>
            )}

            {/* Common Directories */}
            <ItemGroup title="Common Directories">
              {(() => {
                const machine = machines.find(
                  (m) => m.id === selectedMachineId,
                );
                const homeDir = machine?.metadata?.homeDir || "/home";
                const pathOptions = [
                  {
                    value: homeDir,
                    label: homeDir,
                    description: "Home directory",
                  },
                  {
                    value: `${homeDir}/projects`,
                    label: `${homeDir}/projects`,
                    description: "Projects folder",
                  },
                  {
                    value: `${homeDir}/Documents`,
                    label: `${homeDir}/Documents`,
                    description: "Documents folder",
                  },
                  {
                    value: `${homeDir}/Desktop`,
                    label: `${homeDir}/Desktop`,
                    description: "Desktop folder",
                  },
                ];
                return pathOptions.map((option, index) => (
                  <Item
                    key={option.value}
                    title={option.label}
                    subtitle={option.description}
                    leftElement={
                      <Ionicons
                        name="folder-outline"
                        size={24}
                        color={theme.colors.textSecondary}
                      />
                    }
                    rightElement={
                      selectedPath === option.value && !showCustomPathInput ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={theme.colors.button.primary.background}
                        />
                      ) : null
                    }
                    onPress={() => {
                      setSelectedPath(option.value);
                      setShowCustomPathInput(false);
                    }}
                    showChevron={false}
                    selected={
                      selectedPath === option.value && !showCustomPathInput
                    }
                    showDivider={index < pathOptions.length - 1}
                  />
                ));
              })()}
            </ItemGroup>

            {/* Custom Path Option */}
            <ItemGroup title="Custom Directory">
              <Item
                title="Enter custom path"
                subtitle={
                  showCustomPathInput && customPath
                    ? customPath
                    : "Specify a custom directory path"
                }
                leftElement={
                  <Ionicons
                    name="create-outline"
                    size={24}
                    color={theme.colors.textSecondary}
                  />
                }
                rightElement={
                  showCustomPathInput ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={theme.colors.button.primary.background}
                    />
                  ) : null
                }
                onPress={() => setShowCustomPathInput(true)}
                showChevron={false}
                selected={showCustomPathInput}
                showDivider={false}
              />
              {showCustomPathInput && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <TextInput
                    style={styles.textInput}
                    placeholder={t("newSession.wizard.enterDirectoryPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={customPath}
                    onChangeText={setCustomPath}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                </View>
              )}
            </ItemGroup>
          </View>
        );

      case "prompt":
        return (
          <View>
            <Text style={styles.stepTitle}>{t("newSession.wizard.initialMessage")}</Text>
            <Text style={styles.stepDescription}>
              {t("newSession.wizard.initialMessageDescription")}
            </Text>

            <TextInput
              style={[
                styles.textInput,
                { height: 120, textAlignVertical: "top" },
              ]}
              placeholder={t("session.inputPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={prompt}
              onChangeText={setPrompt}
              multiline={true}
              autoCapitalize="sentences"
              autoCorrect={true}
              returnKeyType="default"
            />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>New Session</Text>
        <Pressable onPress={onCancel}>
          <Ionicons name="close" size={24} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.stepIndicator}>
        {steps.map((step, index) => (
          <View
            key={step}
            style={[
              styles.stepDot,
              index <= currentStepIndex
                ? styles.stepDotActive
                : styles.stepDotInactive,
            ]}
          />
        ))}
      </View>

      <ScrollView
        style={styles.stepContent}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={true}
      >
        {renderStepContent()}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, styles.buttonSecondary]}
          onPress={handleBack}
        >
          <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
            {isFirstStep ? "Cancel" : "Back"}
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.button,
            styles.buttonPrimary,
            !canProceed && { opacity: 0.5 },
          ]}
          onPress={handleNext}
          disabled={!canProceed}
        >
          <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
            {isLastStep ? "Create Session" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
