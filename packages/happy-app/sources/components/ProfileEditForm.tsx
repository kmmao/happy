import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ViewStyle,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet } from "react-native-unistyles";
import { useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { AIBackendProfile } from "@/sync/settings";
import { SessionTypeSelector } from "@/components/SessionTypeSelector";
import { getBuiltInProfileDocumentation } from "@/sync/profileUtils";
import { EnvironmentVariablesList } from "@/components/EnvironmentVariablesList";
import { log } from '@/log';
import { buildProfileForSave } from "./profileSavePayload";
import {
  getCodexBackendModeOptions,
  getCodexConfigModeOptions,
} from "@/sync/codexConfigPresentation";

export interface ProfileEditFormProps {
  profile: AIBackendProfile;
  machineId: string | null;
  onSave: (profile: AIBackendProfile) => void;
  onCancel: () => void;
  containerStyle?: ViewStyle;
}

export function ProfileEditForm({
  profile,
  machineId,
  onSave,
  onCancel,
  containerStyle,
}: ProfileEditFormProps) {
  const { theme } = useUnistyles();

  // Get documentation for built-in profiles
  const profileDocs = React.useMemo(() => {
    if (!profile.isBuiltIn) return null;
    return getBuiltInProfileDocumentation(profile.id);
  }, [profile.isBuiltIn, profile.id]);

  // Local state for environment variables (unified for all config)
  const [environmentVariables, setEnvironmentVariables] = React.useState<
    Array<{ name: string; value: string }>
  >(profile.environmentVariables || []);

  const [name, setName] = React.useState(profile.name || "");
  const [useTmux, setUseTmux] = React.useState(
    profile.tmuxConfig?.sessionName !== undefined,
  );
  const [tmuxSession, setTmuxSession] = React.useState(
    profile.tmuxConfig?.sessionName || "",
  );
  const [tmuxTmpDir, setTmuxTmpDir] = React.useState(
    profile.tmuxConfig?.tmpDir || "",
  );
  const [useStartupScript, setUseStartupScript] = React.useState(
    !!profile.startupBashScript,
  );
  const [startupScript, setStartupScript] = React.useState(
    profile.startupBashScript || "",
  );
  const [defaultSessionType, setDefaultSessionType] = React.useState<
    "simple" | "worktree"
  >(profile.defaultSessionType || "simple");
  const [defaultPermissionMode, setDefaultPermissionMode] = React.useState<
    NonNullable<AIBackendProfile["defaultPermissionMode"]>
  >(profile.defaultPermissionMode || "default");
  const [agentType, setAgentType] = React.useState<"claude" | "codex">(() => {
    if (profile.compatibility.claude && !profile.compatibility.codex)
      return "claude";
    if (profile.compatibility.codex && !profile.compatibility.claude)
      return "codex";
    return "claude"; // Default to Claude if both or neither
  });
  const [codexBackendMode, setCodexBackendMode] = React.useState<
    "auto" | "codex-app-server" | "codex-mcp-legacy"
  >(profile.codexConfig?.backendMode || "auto");
  const [codexConfigMode, setCodexConfigMode] = React.useState<
    "inherit" | "managed-profile" | "managed-overrides"
  >(profile.codexConfig?.configMode || "inherit");
  const [codexProfileName, setCodexProfileName] = React.useState(
    profile.codexConfig?.codexProfileName || "",
  );
  const [codexOverrideModel, setCodexOverrideModel] = React.useState(
    profile.codexConfig?.model || "",
  );
  const [codexOverrideReasoningEffort, setCodexOverrideReasoningEffort] =
    React.useState(profile.codexConfig?.reasoningEffort || "");
  const [codexOverrideReasoningSummary, setCodexOverrideReasoningSummary] =
    React.useState(profile.codexConfig?.reasoningSummary || "");
  const [codexOverrideVerbosity, setCodexOverrideVerbosity] = React.useState(
    profile.codexConfig?.verbosity || "",
  );
  const [codexOverridePersonality, setCodexOverridePersonality] =
    React.useState(profile.codexConfig?.personality || "");
  const [codexOverrideServiceTier, setCodexOverrideServiceTier] =
    React.useState(profile.codexConfig?.serviceTier || "");
  const [codexOverrideWebSearch, setCodexOverrideWebSearch] = React.useState(
    profile.codexConfig?.webSearchEnabled === undefined
      ? ""
      : profile.codexConfig.webSearchEnabled
        ? "live"
        : "disabled",
  );
  const [codexOverrideApprovalPolicy, setCodexOverrideApprovalPolicy] =
    React.useState(profile.codexConfig?.approvalPolicy || "");
  const [codexOverrideSandboxMode, setCodexOverrideSandboxMode] =
    React.useState(profile.codexConfig?.sandboxMode || "");
  const codexBackendOptions = React.useMemo(
    () => getCodexBackendModeOptions(t),
    [],
  );
  const codexConfigOptions = React.useMemo(
    () => getCodexConfigModeOptions(t),
    [],
  );

  const handleSave = () => {
    if (!name.trim()) {
      // Profile name validation - prevent saving empty profiles
      return;
    }

    onSave(
      buildProfileForSave({
        profile,
        name,
        environmentVariables,
        useTmux,
        tmuxSession,
        tmuxTmpDir,
        useStartupScript,
        startupScript,
        agentType,
        defaultSessionType,
        defaultPermissionMode,
        codexBackendMode,
        codexConfigMode,
        codexProfileName,
        codexOverrideModel,
        codexOverrideReasoningEffort,
        codexOverrideReasoningSummary,
        codexOverrideVerbosity,
        codexOverridePersonality,
        codexOverrideServiceTier,
        codexOverrideWebSearch,
        codexOverrideApprovalPolicy,
        codexOverrideSandboxMode,
      }) as AIBackendProfile,
    );
  };

  return (
    <ScrollView
      style={[profileEditFormStyles.scrollView, containerStyle]}
      contentContainerStyle={profileEditFormStyles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={profileEditFormStyles.formContainer}>
        {/* Profile Name */}
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 8,
            ...Typography.default("semiBold"),
          }}
        >
          {t("profiles.profileName")}
        </Text>
        <TextInput
          style={{
            backgroundColor: theme.colors.input.background,
            borderRadius: 10, // Matches new session panel input fields
            padding: 12,
            fontSize: 16,
            color: theme.colors.text,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: theme.colors.textSecondary,
          }}
          placeholder={t("profiles.enterName")}
          value={name}
          onChangeText={setName}
        />

        {/* Built-in Profile Documentation - Setup Instructions */}
        {profile.isBuiltIn && profileDocs && (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: theme.colors.button.primary.background,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Ionicons
                name="information-circle"
                size={20}
                color={theme.colors.button.primary.tint}
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: theme.colors.text,
                  ...Typography.default("semiBold"),
                }}
              >
                {t("profiles.setupInstructions")}
              </Text>
            </View>

            <Text
              style={{
                fontSize: 13,
                color: theme.colors.text,
                marginBottom: 12,
                lineHeight: 18,
                ...Typography.default(),
              }}
            >
              {profileDocs.description}
            </Text>

            {profileDocs.setupGuideUrl && (
              <Pressable
                onPress={async () => {
                  try {
                    const url = profileDocs.setupGuideUrl!;
                    // On web/Tauri desktop, use window.open
                    if (Platform.OS === "web") {
                      window.open(url, "_blank");
                    } else {
                      // On native (iOS/Android), use Linking API
                      await Linking.openURL(url);
                    }
                  } catch (error) {
                    log.error("Failed to open URL:", error);
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.colors.button.primary.background,
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Ionicons
                  name="book-outline"
                  size={16}
                  color={theme.colors.button.primary.tint}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.button.primary.tint,
                    fontWeight: "600",
                    flex: 1,
                    ...Typography.default("semiBold"),
                  }}
                >
                  {t("profiles.viewSetupGuide")}
                </Text>
                <Ionicons
                  name="open-outline"
                  size={14}
                  color={theme.colors.button.primary.tint}
                />
              </Pressable>
            )}
          </View>
        )}

        {/* Session Type */}
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 12,
            ...Typography.default("semiBold"),
          }}
        >
          {t("profiles.defaultSessionType")}
        </Text>
        <View style={{ marginBottom: 16 }}>
          <SessionTypeSelector
            value={defaultSessionType}
            onChange={setDefaultSessionType}
          />
        </View>

        {/* Permission Mode */}
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 12,
            ...Typography.default("semiBold"),
          }}
        >
          {t("profiles.defaultPermissionMode")}
        </Text>
        <View style={{ gap: 8, marginBottom: 16 }}>
          {([
            {
              value: "default" as const,
              label: t("profiles.permissionDefault"),
              description: t("profiles.permissionDefaultDesc"),
              icon: "shield-outline" as const,
            },
            {
              value: "acceptEdits" as const,
              label: t("profiles.permissionAcceptEdits"),
              description: t("profiles.permissionAcceptEditsDesc"),
              icon: "checkmark-outline" as const,
            },
            {
              value: "plan" as const,
              label: t("profiles.permissionPlan"),
              description: t("profiles.permissionPlanDesc"),
              icon: "list-outline" as const,
            },
            {
              value: "auto" as const,
              label: t("profiles.permissionAuto"),
              description: t("profiles.permissionAutoDesc"),
              icon: "sparkles-outline" as const,
            },
            {
              value: "bypassPermissions" as const,
              label: t("profiles.permissionYolo"),
              description: t("profiles.permissionYoloDesc"),
              icon: "flash-outline" as const,
            },
          ]).map((option) => {
            const isSelected = defaultPermissionMode === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() =>
                  setDefaultPermissionMode(
                    option.value as NonNullable<
                      AIBackendProfile["defaultPermissionMode"]
                    >,
                  )
                }
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: isSelected
                    ? theme.colors.button.primary.background
                    : theme.colors.input.background,
                  borderRadius: 10,
                  padding: 14,
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: isSelected
                      ? "rgba(255,255,255,0.2)"
                      : theme.colors.surface,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={
                      isSelected
                        ? theme.colors.button.primary.tint
                        : theme.colors.textSecondary
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: isSelected
                        ? theme.colors.button.primary.tint
                        : theme.colors.text,
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: isSelected
                        ? "rgba(255,255,255,0.7)"
                        : theme.colors.textSecondary,
                      marginTop: 2,
                      ...Typography.default(),
                    }}
                  >
                    {option.description}
                  </Text>
                </View>
                {isSelected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={theme.colors.button.primary.tint}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {agentType === "codex" && (
          <>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: theme.colors.text,
                marginBottom: 12,
                ...Typography.default("semiBold"),
              }}
            >
              {t("profiles.codexSettings")}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                marginBottom: 8,
                ...Typography.default(),
              }}
            >
              {t("profiles.codexBackendMode")}
            </Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {codexBackendOptions.map((option) => {
                const isSelected = codexBackendMode === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setCodexBackendMode(option.value)}
                    style={{
                      backgroundColor: isSelected
                        ? theme.colors.button.primary.background
                        : theme.colors.input.background,
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: isSelected
                          ? theme.colors.button.primary.tint
                          : theme.colors.text,
                        ...Typography.default("semiBold"),
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                marginBottom: 8,
                ...Typography.default(),
              }}
            >
              {t("profiles.codexConfigMode")}
            </Text>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {codexConfigOptions.map((option) => {
                const isSelected = codexConfigMode === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setCodexConfigMode(option.value)}
                    style={{
                      backgroundColor: isSelected
                        ? theme.colors.button.primary.background
                        : theme.colors.input.background,
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: isSelected
                          ? theme.colors.button.primary.tint
                          : theme.colors.text,
                        ...Typography.default("semiBold"),
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {codexConfigMode === "managed-profile" && (
              <>
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    marginBottom: 8,
                    ...Typography.default(),
                  }}
                >
                  {t("profiles.codexProfileName")}
                </Text>
                <TextInput
                  style={{
                    backgroundColor: theme.colors.input.background,
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 16,
                    color: theme.colors.text,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: theme.colors.textSecondary,
                  }}
                  placeholder={t("profiles.codexProfilePlaceholder")}
                  value={codexProfileName}
                  onChangeText={setCodexProfileName}
                />
              </>
            )}
            {codexConfigMode === "managed-overrides" && (
              <>
                {([
                  {
                    key: "model",
                    label: t("profiles.codexOverrideModel"),
                    value: codexOverrideModel,
                    onChange: setCodexOverrideModel,
                  },
                  {
                    key: "reasoningEffort",
                    label: t("profiles.codexOverrideReasoningEffort"),
                    value: codexOverrideReasoningEffort,
                    onChange: setCodexOverrideReasoningEffort,
                  },
                  {
                    key: "reasoningSummary",
                    label: t("profiles.codexOverrideReasoningSummary"),
                    value: codexOverrideReasoningSummary,
                    onChange: setCodexOverrideReasoningSummary,
                  },
                  {
                    key: "verbosity",
                    label: t("profiles.codexOverrideVerbosity"),
                    value: codexOverrideVerbosity,
                    onChange: setCodexOverrideVerbosity,
                  },
                  {
                    key: "personality",
                    label: t("profiles.codexOverridePersonality"),
                    value: codexOverridePersonality,
                    onChange: setCodexOverridePersonality,
                  },
                  {
                    key: "serviceTier",
                    label: t("profiles.codexOverrideServiceTier"),
                    value: codexOverrideServiceTier,
                    onChange: setCodexOverrideServiceTier,
                  },
                  {
                    key: "webSearch",
                    label: t("profiles.codexOverrideWebSearch"),
                    value: codexOverrideWebSearch,
                    onChange: setCodexOverrideWebSearch,
                  },
                  {
                    key: "approvalPolicy",
                    label: t("profiles.codexOverrideApprovalPolicy"),
                    value: codexOverrideApprovalPolicy,
                    onChange: setCodexOverrideApprovalPolicy,
                  },
                  {
                    key: "sandboxMode",
                    label: t("profiles.codexOverrideSandboxMode"),
                    value: codexOverrideSandboxMode,
                    onChange: setCodexOverrideSandboxMode,
                  },
                ] as const).map((field) => (
                  <React.Fragment key={field.key}>
                    <Text
                      style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        marginBottom: 8,
                        ...Typography.default(),
                      }}
                    >
                      {field.label}
                    </Text>
                    <TextInput
                      style={{
                        backgroundColor: theme.colors.input.background,
                        borderRadius: 10,
                        padding: 12,
                        fontSize: 16,
                        color: theme.colors.text,
                        marginBottom: 16,
                        borderWidth: 1,
                        borderColor: theme.colors.textSecondary,
                      }}
                      value={field.value}
                      onChangeText={field.onChange}
                    />
                  </React.Fragment>
                ))}
              </>
            )}
          </>
        )}

        {/* Tmux Enable/Disable */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <Pressable
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginRight: 8,
            }}
            onPress={() => setUseTmux(!useTmux)}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: useTmux
                  ? theme.colors.button.primary.background
                  : theme.colors.textSecondary,
                backgroundColor: useTmux
                  ? theme.colors.button.primary.background
                  : "transparent",
                justifyContent: "center",
                alignItems: "center",
                marginRight: 8,
              }}
            >
              {useTmux && (
                <Ionicons
                  name="checkmark"
                  size={12}
                  color={theme.colors.button.primary.tint}
                />
              )}
            </View>
          </Pressable>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.text,
              ...Typography.default("semiBold"),
            }}
          >
            {t("profiles.spawnInTmux")}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textSecondary,
            marginBottom: 12,
            ...Typography.default(),
          }}
        >
          {useTmux
            ? t("profiles.tmuxEnabledDesc")
            : t("profiles.tmuxDisabledDesc")}
        </Text>

        {/* Tmux Session Name */}
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 8,
            ...Typography.default("semiBold"),
          }}
        >
          {t("profiles.tmuxSessionName")} ({t("common.optional")})
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textSecondary,
            marginBottom: 8,
            ...Typography.default(),
          }}
        >
          {t("profiles.tmuxSessionHint")}
        </Text>
        <TextInput
          style={{
            backgroundColor: theme.colors.input.background,
            borderRadius: 10, // Matches new session panel input fields
            padding: 12,
            fontSize: 16,
            color: useTmux ? theme.colors.text : theme.colors.textSecondary,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: theme.colors.textSecondary,
            opacity: useTmux ? 1 : 0.5,
          }}
          placeholder={
            useTmux
              ? t("profiles.tmuxSessionPlaceholder")
              : t("profiles.tmuxDisabledPlaceholder")
          }
          value={tmuxSession}
          onChangeText={setTmuxSession}
          editable={useTmux}
        />

        {/* Tmux Temp Directory */}
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: theme.colors.text,
            marginBottom: 8,
            ...Typography.default("semiBold"),
          }}
        >
          {t("profiles.tmuxTempDir")} ({t("common.optional")})
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textSecondary,
            marginBottom: 8,
            ...Typography.default(),
          }}
        >
          {t("profiles.tmuxTempDirHint")}
        </Text>
        <TextInput
          style={{
            backgroundColor: theme.colors.input.background,
            borderRadius: 10, // Matches new session panel input fields
            padding: 12,
            fontSize: 16,
            color: useTmux ? theme.colors.text : theme.colors.textSecondary,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: theme.colors.textSecondary,
            opacity: useTmux ? 1 : 0.5,
          }}
          placeholder={
            useTmux
              ? t("profiles.tmuxTempDirPlaceholder")
              : t("profiles.tmuxDisabledPlaceholder")
          }
          placeholderTextColor={theme.colors.input.placeholder}
          value={tmuxTmpDir}
          onChangeText={setTmuxTmpDir}
          editable={useTmux}
        />

        {/* Startup Bash Script */}
        <View style={{ marginBottom: 24 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Pressable
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginRight: 8,
              }}
              onPress={() => setUseStartupScript(!useStartupScript)}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 2,
                  borderColor: useStartupScript
                    ? theme.colors.button.primary.background
                    : theme.colors.textSecondary,
                  backgroundColor: useStartupScript
                    ? theme.colors.button.primary.background
                    : "transparent",
                  justifyContent: "center",
                  alignItems: "center",
                  marginRight: 8,
                }}
              >
                {useStartupScript && (
                  <Ionicons
                    name="checkmark"
                    size={12}
                    color={theme.colors.button.primary.tint}
                  />
                )}
              </View>
            </Pressable>
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.colors.text,
                ...Typography.default("semiBold"),
              }}
            >
              {t("profiles.startupBashScript")}
            </Text>
          </View>
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textSecondary,
              marginBottom: 12,
              ...Typography.default(),
            }}
          >
            {useStartupScript
              ? t("profiles.startupScriptEnabledDesc")
              : t("profiles.startupScriptDisabledDesc")}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              opacity: useStartupScript ? 1 : 0.5,
            }}
          >
            <TextInput
              style={{
                flex: 1,
                backgroundColor: useStartupScript
                  ? theme.colors.input.background
                  : theme.colors.surface,
                borderRadius: 10, // Matches new session panel input fields
                padding: 12,
                fontSize: 14,
                color: useStartupScript
                  ? theme.colors.text
                  : theme.colors.textSecondary,
                borderWidth: 1,
                borderColor: theme.colors.textSecondary,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                minHeight: 100,
              }}
              placeholder={
                useStartupScript
                  ? t("profiles.startupScriptPlaceholder")
                  : t("profiles.disabled")
              }
              value={startupScript}
              onChangeText={setStartupScript}
              editable={useStartupScript}
              multiline
              textAlignVertical="top"
            />
            {useStartupScript && startupScript.trim() && (
              <Pressable
                style={{
                  backgroundColor: theme.colors.button.primary.background,
                  borderRadius: 6,
                  padding: 10,
                  justifyContent: "center",
                  alignItems: "center",
                }}
                onPress={() => {
                  if (Platform.OS === "web") {
                    navigator.clipboard.writeText(startupScript);
                  }
                }}
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={theme.colors.button.primary.tint}
                />
              </Pressable>
            )}
          </View>
        </View>

        {/* Environment Variables Section - Unified configuration */}
        <EnvironmentVariablesList
          environmentVariables={environmentVariables}
          machineId={machineId}
          profileDocs={profileDocs}
          onChange={setEnvironmentVariables}
        />

        {/* Action buttons */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: theme.colors.surface,
              borderRadius: 8,
              padding: 12,
              alignItems: "center",
            }}
            onPress={onCancel}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.colors.button.secondary.tint,
                ...Typography.default("semiBold"),
              }}
            >
              {t("common.cancel")}
            </Text>
          </Pressable>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: theme.colors.button.primary.background,
              borderRadius: 8,
              padding: 12,
              alignItems: "center",
            }}
            onPress={handleSave}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.colors.button.primary.tint,
                ...Typography.default("semiBold"),
              }}
            >
              {t("common.save")}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const profileEditFormStyles = StyleSheet.create((theme, rt) => ({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  formContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16, // Matches new session panel main container
    padding: 20,
    width: "100%",
  },
}));
