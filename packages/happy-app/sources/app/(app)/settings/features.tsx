import * as React from "react";
import { Platform, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { useSettingMutable, useLocalSettingMutable } from "@/sync/storage";
import { Switch } from "@/components/Switch";
import { t } from "@/text";
import { StyleSheet } from "react-native-unistyles";
import {
  requestNotificationPermission,
  getNotificationPermission,
} from "@/utils/webNotification";
import { useUnistyles } from "react-native-unistyles";

function FeaturesSettingsScreen() {
  const { theme } = useUnistyles();
  const [experiments, setExperiments] = useSettingMutable("experiments");
  const [agentInputEnterToSend, setAgentInputEnterToSend] = useSettingMutable(
    "agentInputEnterToSend",
  );
  const [commandPaletteEnabled, setCommandPaletteEnabled] =
    useLocalSettingMutable("commandPaletteEnabled");
  const [markdownCopyV2, setMarkdownCopyV2] =
    useLocalSettingMutable("markdownCopyV2");
  const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable(
    "hideInactiveSessions",
  );
  const [enablePreviewTab, setEnablePreviewTab] = useSettingMutable(
    "enablePreviewTab",
  );
  const [useEnhancedSessionWizard, setUseEnhancedSessionWizard] =
    useSettingMutable("useEnhancedSessionWizard");
  const [knowledgeBase, setKnowledgeBase] = useSettingMutable("knowledgeBase");
  const [knowledgeBaseMode, setKnowledgeBaseMode] = useSettingMutable("knowledgeBaseMode");
  const [knowledgeBaseSensitivity, setKnowledgeBaseSensitivity] = useSettingMutable("knowledgeBaseSensitivity");
  const [knowledgeBaseTrackFileEdits, setKnowledgeBaseTrackFileEdits] = useSettingMutable("knowledgeBaseTrackFileEdits");
  const [knowledgeBaseTrackToolCalls, setKnowledgeBaseTrackToolCalls] = useSettingMutable("knowledgeBaseTrackToolCalls");
  const [knowledgeBaseTrackTokens, setKnowledgeBaseTrackTokens] = useSettingMutable("knowledgeBaseTrackTokens");
  const [webNotifications, setWebNotifications] =
    useSettingMutable("webNotifications");
  const [webNotificationsPersistent, setWebNotificationsPersistent] =
    useSettingMutable("webNotificationsPersistent");
  const [scoringModelOverride, setScoringModelOverride] =
    useLocalSettingMutable("scoringModelOverride");

  // Track browser notification permission state to avoid calling browser API in render
  const [notifPermission, setNotifPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(() => getNotificationPermission());

  return (
    <ItemList style={{ paddingTop: 0 }}>
      {/* Experimental Features */}
      <ItemGroup
        title={t("settingsFeatures.experiments")}
        footer={t("settingsFeatures.experimentsDescription")}
      >
        <Item
          title={t("settingsFeatures.experimentalFeatures")}
          subtitle={
            experiments
              ? t("settingsFeatures.experimentalFeaturesEnabled")
              : t("settingsFeatures.experimentalFeaturesDisabled")
          }
          icon={<Ionicons name="flask-outline" size={29} color={theme.colors.accentPurple} />}
          rightElement={
            <Switch value={experiments} onValueChange={setExperiments} />
          }
          showChevron={false}
        />
        <Item
          title={t("settingsFeatures.markdownCopyV2")}
          subtitle={t("settingsFeatures.markdownCopyV2Subtitle")}
          icon={<Ionicons name="text-outline" size={29} color={theme.colors.success} />}
          rightElement={
            <Switch value={markdownCopyV2} onValueChange={setMarkdownCopyV2} />
          }
          showChevron={false}
        />
        <Item
          title={t("settingsFeatures.hideInactiveSessions")}
          subtitle={t("settingsFeatures.hideInactiveSessionsSubtitle")}
          icon={<Ionicons name="eye-off-outline" size={29} color={theme.colors.accentOrange} />}
          rightElement={
            <Switch
              value={hideInactiveSessions}
              onValueChange={setHideInactiveSessions}
            />
          }
          showChevron={false}
        />
        <Item
          title={t("settingsFeatures.previewTab")}
          subtitle={
            enablePreviewTab
              ? t("settingsFeatures.previewTabEnabled")
              : t("settingsFeatures.previewTabDisabled")
          }
          icon={<Ionicons name="images-outline" size={29} color={theme.colors.textLink} />}
          rightElement={
            <Switch
              value={enablePreviewTab}
              onValueChange={setEnablePreviewTab}
            />
          }
          showChevron={false}
        />
      </ItemGroup>

      {/* Knowledge Base */}
      <ItemGroup
        title={t("settingsFeatures.knowledgeBase")}
        footer={
          knowledgeBase && !knowledgeBaseTrackFileEdits && !knowledgeBaseTrackToolCalls && !knowledgeBaseTrackTokens
            ? t("settingsFeatures.knowledgeBaseAllTracksOff")
            : t("settingsFeatures.knowledgeBaseFooter")
        }
      >
        <Item
          title={t("settingsFeatures.knowledgeBase")}
          subtitle={
            knowledgeBase
              ? t("settingsFeatures.knowledgeBaseEnabled")
              : t("settingsFeatures.knowledgeBaseDisabled")
          }
          icon={<Ionicons name="bulb-outline" size={29} color={theme.colors.accentOrange} />}
          rightElement={
            <Switch value={knowledgeBase} onValueChange={setKnowledgeBase} />
          }
          showChevron={false}
        />
        {knowledgeBase && (
          <>
            <Item
              title={t("settingsFeatures.knowledgeBaseMode")}
              subtitle={t("settingsFeatures.knowledgeBaseModeAuto")}
              icon={<Ionicons name="flash-outline" size={29} color={theme.colors.accentOrange} />}
              rightElement={
                <Switch
                  value={knowledgeBaseMode === "auto"}
                  onValueChange={() => setKnowledgeBaseMode("auto")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseMode")}
              subtitle={t("settingsFeatures.knowledgeBaseModeFull")}
              icon={<Ionicons name="server-outline" size={29} color={theme.colors.accentOrange} />}
              rightElement={
                <Switch
                  value={knowledgeBaseMode === "full"}
                  onValueChange={() => setKnowledgeBaseMode("full")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseMode")}
              subtitle={t("settingsFeatures.knowledgeBaseModeMinimal")}
              icon={<Ionicons name="leaf-outline" size={29} color={theme.colors.accentOrange} />}
              rightElement={
                <Switch
                  value={knowledgeBaseMode === "minimal"}
                  onValueChange={() => setKnowledgeBaseMode("minimal")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseSensitivity")}
              subtitle={t("settingsFeatures.knowledgeBaseSensitivityConservative")}
              icon={<Ionicons name="shield-outline" size={29} color={theme.colors.accentTeal} />}
              rightElement={
                <Switch
                  value={knowledgeBaseSensitivity === "conservative"}
                  onValueChange={() => setKnowledgeBaseSensitivity("conservative")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseSensitivity")}
              subtitle={t("settingsFeatures.knowledgeBaseSensitivityBalanced")}
              icon={<Ionicons name="options-outline" size={29} color={theme.colors.accentTeal} />}
              rightElement={
                <Switch
                  value={knowledgeBaseSensitivity === "balanced"}
                  onValueChange={() => setKnowledgeBaseSensitivity("balanced")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseSensitivity")}
              subtitle={t("settingsFeatures.knowledgeBaseSensitivityAggressive")}
              icon={<Ionicons name="rocket-outline" size={29} color={theme.colors.accentTeal} />}
              rightElement={
                <Switch
                  value={knowledgeBaseSensitivity === "aggressive"}
                  onValueChange={() => setKnowledgeBaseSensitivity("aggressive")}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseTrackFileEdits")}
              subtitle={t("settingsFeatures.knowledgeBaseTrackFileEditsSubtitle")}
              icon={<Ionicons name="document-text-outline" size={29} color={theme.colors.accentBlue} />}
              rightElement={
                <Switch
                  value={knowledgeBaseTrackFileEdits}
                  onValueChange={setKnowledgeBaseTrackFileEdits}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseTrackToolCalls")}
              subtitle={t("settingsFeatures.knowledgeBaseTrackToolCallsSubtitle")}
              icon={<Ionicons name="hammer-outline" size={29} color={theme.colors.accentBlue} />}
              rightElement={
                <Switch
                  value={knowledgeBaseTrackToolCalls}
                  onValueChange={setKnowledgeBaseTrackToolCalls}
                />
              }
              showChevron={false}
            />
            <Item
              title={t("settingsFeatures.knowledgeBaseTrackTokens")}
              subtitle={t("settingsFeatures.knowledgeBaseTrackTokensSubtitle")}
              icon={<Ionicons name="chatbubbles-outline" size={29} color={theme.colors.accentBlue} />}
              rightElement={
                <Switch
                  value={knowledgeBaseTrackTokens}
                  onValueChange={setKnowledgeBaseTrackTokens}
                />
              }
              showChevron={false}
            />
          </>
        )}
      </ItemGroup>

      {/* Scoring Model Override */}
      <ItemGroup
        title={t("settingsFeatures.scoringModel")}
        footer={t("settingsFeatures.scoringModelDescription")}
      >
        {(["anthropic", "openai", "ollama"] as const).map((provider) => (
          <Item
            key={provider}
            title={`${provider.charAt(0).toUpperCase() + provider.slice(1)} Model`}
            icon={
              <Ionicons
                name={provider === "anthropic" ? "sparkles-outline" : provider === "openai" ? "logo-github" : "server-outline"}
                size={29}
                color={theme.colors.accentTeal}
              />
            }
            rightElement={
              <View style={scoringStyles.inputContainer}>
                <TextInput
                  style={[scoringStyles.input, { color: theme.colors.text, borderColor: theme.colors.divider }]}
                  value={scoringModelOverride[provider] ?? ""}
                  onChangeText={(text) => {
                    const next = { ...scoringModelOverride };
                    if (text.trim()) {
                      next[provider] = text.trim();
                    } else {
                      delete next[provider];
                    }
                    setScoringModelOverride(next);
                  }}
                  placeholder={t("settingsFeatures.scoringModelPlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            }
            showChevron={false}
          />
        ))}
      </ItemGroup>

      {/* Web-only Features */}
      {Platform.OS === "web" && (
        <ItemGroup
          title={t("settingsFeatures.webFeatures")}
          footer={t("settingsFeatures.webFeaturesDescription")}
        >
          <Item
            title={t("settingsFeatures.enterToSend")}
            subtitle={
              agentInputEnterToSend
                ? t("settingsFeatures.enterToSendEnabled")
                : t("settingsFeatures.enterToSendDisabled")
            }
            icon={
              <Ionicons
                name="return-down-forward-outline"
                size={29}
                color={theme.colors.accentBlue}
              />
            }
            rightElement={
              <Switch
                value={agentInputEnterToSend}
                onValueChange={setAgentInputEnterToSend}
              />
            }
            showChevron={false}
          />
          <Item
            title={t("settingsFeatures.commandPalette")}
            subtitle={
              commandPaletteEnabled
                ? t("settingsFeatures.commandPaletteEnabled")
                : t("settingsFeatures.commandPaletteDisabled")
            }
            icon={<Ionicons name="keypad-outline" size={29} color={theme.colors.accentBlue} />}
            rightElement={
              <Switch
                value={commandPaletteEnabled}
                onValueChange={setCommandPaletteEnabled}
              />
            }
            showChevron={false}
          />
          <Item
            title={t("settingsFeatures.webNotifications")}
            subtitle={
              webNotifications
                ? t("settingsFeatures.webNotificationsEnabled")
                : notifPermission === "denied"
                  ? t("settingsFeatures.webNotificationsDenied")
                  : t("settingsFeatures.webNotificationsDisabled")
            }
            icon={
              <Ionicons
                name="notifications-outline"
                size={29}
                color={theme.colors.accentOrange}
              />
            }
            rightElement={
              <Switch
                value={webNotifications}
                onValueChange={async (value) => {
                  if (value) {
                    try {
                      const permission = await requestNotificationPermission();
                      setNotifPermission(permission);
                      if (permission === "granted") {
                        setWebNotifications(true);
                      }
                    } catch {
                      setNotifPermission("denied");
                    }
                  } else {
                    setWebNotifications(false);
                  }
                }}
              />
            }
            showChevron={false}
          />
          {webNotifications && (
            <Item
              title={t("settingsFeatures.webNotificationsPersistent")}
              subtitle={
                webNotificationsPersistent
                  ? t("settingsFeatures.webNotificationsPersistentEnabled")
                  : t("settingsFeatures.webNotificationsPersistentDisabled")
              }
              icon={<Ionicons name="pin-outline" size={29} color={theme.colors.accentOrange} />}
              rightElement={
                <Switch
                  value={webNotificationsPersistent}
                  onValueChange={setWebNotificationsPersistent}
                />
              }
              showChevron={false}
            />
          )}
        </ItemGroup>
      )}
    </ItemList>
  );
}

const scoringStyles = StyleSheet.create((theme) => ({
  inputContainer: {
    width: 160,
  },
  input: {
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
    textAlign: "right" as const,
  },
}));

export default React.memo(FeaturesSettingsScreen);
