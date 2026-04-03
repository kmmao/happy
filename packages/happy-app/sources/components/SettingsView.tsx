import { View, ScrollView, Pressable, Platform, Linking } from "react-native";
import { Image } from "expo-image";
import * as React from "react";
import { Text } from "@/components/StyledText";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuth } from "@/auth/AuthContext";
import { Typography } from "@/constants/Typography";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { useConnectTerminal } from "@/hooks/useConnectTerminal";
import {
  useEntitlement,
  useLocalSettingMutable,
  useSetting,
} from "@/sync/storage";
import { sync } from "@/sync/sync";
import { isUsingCustomServer } from "@/sync/serverConfig";
import { trackWhatsNewClicked } from "@/track";
import { Modal } from "@/modal";
import { useMultiClick } from "@/hooks/useMultiClick";
import { useAllMachines } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { useHappyAction } from "@/hooks/useHappyAction";
import { getGitHubOAuthParams, disconnectGitHub } from "@/sync/apiGithub";
import { disconnectService } from "@/sync/apiServices";
import { useProfile } from "@/sync/storage";
import { getDisplayName, getAvatarUrl, getBio } from "@/sync/profile";
import { Avatar } from "@/components/Avatar";
import { t } from "@/text";
import { useSub2ApiUsage } from "@/sub2api";
import type { UsageProgress } from "@/sub2api";
import { UsageBar } from "@/components/usage/UsageBar";

function Sub2ApiInlineUsage({ onPress }: { onPress: () => void }) {
    const { theme } = useUnistyles();
    const { data, loading, configured } = useSub2ApiUsage();

    const getColor = (u: number) => u >= 90 ? "#FF3B30" : u >= 70 ? "#FF9500" : "#34C759";
    const formatTime = (s: number) => {
        if (s <= 0) return "";
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return h > 0 ? `${h}h${m}m` : `${m}m`;
    };

    const renderBar = (label: string, p: UsageProgress) => (
        <View key={label} style={{ marginBottom: 6 }}>
            <UsageBar
                label={label}
                value={p.utilization}
                maxValue={100}
                color={getColor(p.utilization)}
                formatValue={(v) => `${Math.round(v)}%`}
            />
            {p.remaining_seconds > 0 && (
                <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 1 }}>
                    {t("sub2api.resetsIn", { time: formatTime(p.remaining_seconds) })}
                </Text>
            )}
        </View>
    );

    // Not configured — show setup entry
    if (!configured && !loading) {
        return (
            <Item
                title={t("sub2api.title")}
                subtitle={t("sub2api.subtitle")}
                icon={<Ionicons name="speedometer-outline" size={29} color={theme.colors.accentTeal} />}
                onPress={onPress}
            />
        );
    }

    // Loading
    if (loading && data.length === 0) {
        return (
            <Item
                title={t("sub2api.title")}
                subtitle={t("sub2api.refreshing")}
                icon={<Ionicons name="speedometer-outline" size={29} color={theme.colors.accentTeal} />}
                onPress={onPress}
                showChevron={false}
            />
        );
    }

    // Show inline usage bars
    return (
        <Pressable onPress={onPress}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                {data.map(({ account, usage }, index) => (
                    <View key={account.id}>
                        {index > 0 && (
                            <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 10 }} />
                        )}
                        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text, marginBottom: 4 }}>
                            {account.name}
                        </Text>
                        {usage.five_hour && renderBar(t("sub2api.fiveHourLimit"), usage.five_hour)}
                        {usage.seven_day && renderBar(t("sub2api.sevenDayLimit"), usage.seven_day)}
                        {usage.seven_day_sonnet && renderBar(t("sub2api.sevenDaySonnetLimit"), usage.seven_day_sonnet)}
                    </View>
                ))}
                {data.length === 0 && (
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                        {t("sub2api.noAccounts")}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

export const SettingsView = React.memo(function SettingsView() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const auth = useAuth();
  const [devModeEnabled, setDevModeEnabled] =
    useLocalSettingMutable("devModeEnabled");
  const isPro = __DEV__ || useEntitlement("pro");
  const experiments = useSetting("experiments");
  const isCustomServer = isUsingCustomServer();
  const allMachines = useAllMachines();
  const profile = useProfile();
  const displayName = getDisplayName(profile);
  const avatarUrl = getAvatarUrl(profile);
  const bio = getBio(profile);

  const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();

  // Use the multi-click hook for version clicks
  const handleVersionClick = useMultiClick(
    () => {
      // Toggle dev mode
      const newDevMode = !devModeEnabled;
      setDevModeEnabled(newDevMode);
      Modal.alert(
        t("modals.developerMode"),
        newDevMode
          ? t("modals.developerModeEnabled")
          : t("modals.developerModeDisabled"),
      );
    },
    {
      requiredClicks: 10,
      resetTimeout: 2000,
    },
  );

  // Connection status
  const isGitHubConnected = !!profile.github;
  // GitHub connection
  const [connectingGitHub, connectGitHub] = useHappyAction(async () => {
    const params = await getGitHubOAuthParams(auth.credentials!);
    await Linking.openURL(params.url);
  });

  // GitHub disconnection
  const [disconnectingGitHub, handleDisconnectGitHub] = useHappyAction(
    async () => {
      const confirmed = await Modal.confirm(
        t("modals.disconnectGithub"),
        t("modals.disconnectGithubConfirm"),
        { confirmText: t("modals.disconnect"), destructive: true },
      );
      if (confirmed) {
        await disconnectGitHub(auth.credentials!);
      }
    },
  );


  return (
    <ItemList style={{ paddingTop: 0 }}>
      {/* App Info Header - only show when profile exists */}
      {profile.firstName && (
        <View
          style={{
            maxWidth: layout.maxWidth,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <View
            style={{
              alignItems: "center",
              paddingVertical: 24,
              backgroundColor: theme.colors.surface,
              marginTop: 16,
              borderRadius: 12,
              marginHorizontal: 16,
            }}
          >
            <View style={{ marginBottom: 12 }}>
              <Avatar
                id={profile.id}
                size={90}
                imageUrl={avatarUrl}
                thumbhash={profile.avatar?.thumbhash}
              />
            </View>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "600",
                color: theme.colors.text,
                marginBottom: bio ? 4 : 8,
              }}
            >
              {displayName}
            </Text>
            {bio && (
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  textAlign: "center",
                  marginBottom: 8,
                  paddingHorizontal: 16,
                }}
              >
                {bio}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Connect Terminal - Only show on native platforms */}
      {Platform.OS !== "web" && (
        <ItemGroup>
          <Item
            title={t("settings.scanQrCodeToAuthenticate")}
            icon={<Ionicons name="qr-code-outline" size={29} color={theme.colors.accentBlue} />}
            onPress={connectTerminal}
            loading={isLoading}
            showChevron={false}
          />
          <Item
            title={t("connect.enterUrlManually")}
            icon={<Ionicons name="link-outline" size={29} color={theme.colors.accentBlue} />}
            onPress={async () => {
              const url = await Modal.prompt(
                t("modals.authenticateTerminal"),
                t("modals.pasteUrlFromTerminal"),
                {
                  placeholder: "happy://terminal?...",
                  confirmText: t("common.authenticate"),
                },
              );
              if (url?.trim()) {
                connectWithUrl(url.trim());
              }
            }}
            showChevron={false}
          />
        </ItemGroup>
      )}

      <ItemGroup title={t("settings.connectedAccounts")}>
        <Item
          title={t("settings.github")}
          subtitle={
            isGitHubConnected
              ? t("settings.githubConnected", { login: profile.github?.login! })
              : t("settings.connectGithubAccount")
          }
          icon={
            <Ionicons
              name="logo-github"
              size={29}
              color={
                isGitHubConnected
                  ? theme.colors.status.connected
                  : theme.colors.textSecondary
              }
            />
          }
          onPress={isGitHubConnected ? handleDisconnectGitHub : connectGitHub}
          loading={connectingGitHub || disconnectingGitHub}
          showChevron={false}
        />
      </ItemGroup>

      {/* Social */}
      {/* <ItemGroup title={t('settings.social')}>
                <Item
                    title={t('navigation.friends')}
                    subtitle={t('friends.manageFriends')}
                    icon={<Ionicons name="people-outline" size={29} color={theme.colors.accentBlue} />}
                    onPress={() => router.push('/friends')}
                />
            </ItemGroup> */}

      {/* Machines (sorted: online first, then last seen desc) */}
      {allMachines.length > 0 && (
        <ItemGroup title={t("settings.machines")}>
          {[...allMachines].map((machine) => {
            const isOnline = isMachineOnline(machine);
            const host = machine.metadata?.host || "Unknown";
            const displayName = machine.metadata?.displayName;
            const platform = machine.metadata?.platform || "";

            // Use displayName if available, otherwise use host
            const title = displayName || host;

            // Build subtitle: show hostname if different from title, plus platform and status
            let subtitle = "";
            if (displayName && displayName !== host) {
              subtitle = host;
            }
            if (platform) {
              subtitle = subtitle ? `${subtitle} • ${platform}` : platform;
            }
            subtitle = subtitle
              ? `${subtitle} • ${isOnline ? t("status.ready") : t("status.offline")}`
              : isOnline
                ? t("status.ready")
                : t("status.offline");

            return (
              <Item
                key={machine.id}
                title={title}
                subtitle={subtitle}
                icon={
                  <Ionicons
                    name="desktop-outline"
                    size={29}
                    color={
                      isOnline
                        ? theme.colors.status.connected
                        : theme.colors.status.disconnected
                    }
                  />
                }
                onPress={() => router.push(`/machine/${machine.id}`)}
              />
            );
          })}
        </ItemGroup>
      )}

      {/* Features */}
      <ItemGroup title={t("settings.features")}>
        <Item
          title={t("settings.account")}
          subtitle={t("settings.accountSubtitle")}
          icon={
            <Ionicons name="person-circle-outline" size={29} color={theme.colors.accentBlue} />
          }
          onPress={() => router.push("/settings/account")}
        />
        <Item
          title={t("settings.appearance")}
          subtitle={t("settings.appearanceSubtitle")}
          icon={
            <Ionicons name="color-palette-outline" size={29} color={theme.colors.accentPurple} />
          }
          onPress={() => router.push("/settings/appearance")}
        />
        <Item
          title={t("settings.voiceAssistant")}
          subtitle={t("settings.voiceAssistantSubtitle")}
          icon={<Ionicons name="mic-outline" size={29} color={theme.colors.success} />}
          onPress={() => router.push("/settings/voice")}
        />
        <Item
          title={t("settings.featuresTitle")}
          subtitle={t("settings.featuresSubtitle")}
          icon={<Ionicons name="flask-outline" size={29} color={theme.colors.accentOrange} />}
          onPress={() => router.push("/settings/features")}
        />
        <Item
          title={t("settings.profiles")}
          subtitle={t("settings.profilesSubtitle")}
          icon={<Ionicons name="person-outline" size={29} color="#AF52DE" />}
          onPress={() => router.push("/settings/profiles")}
        />
        <Item
          title={t("settings.gitHosts")}
          subtitle={t("settings.gitHostsSubtitle")}
          icon={
            <Ionicons name="git-branch-outline" size={29} color="#64748B" />
          }
          onPress={() => router.push("/settings/git-hosts")}
        />
        {experiments && (
          <Item
            title={t("settings.usage")}
            subtitle={t("settings.usageSubtitle")}
            icon={
              <Ionicons name="analytics-outline" size={29} color={theme.colors.accentBlue} />
            }
            onPress={() => router.push("/settings/usage")}
          />
        )}
      </ItemGroup>

      {/* OpenClaw */}
      <ItemGroup title={t("openclaw.title")}>
        <Item
          title={t("openclaw.title")}
          subtitle={t("openclaw.connectDescription")}
          icon={
            <Image
              source={require("@/assets/images/openclaw-icon-color.png")}
              contentFit="contain"
              style={{ width: 29, height: 29 }}
            />
          }
          onPress={() => router.push("/(app)/openclaw")}
        />
      </ItemGroup>

      {/* Sub2API Usage Monitor */}
      <ItemGroup title={t("sub2api.title")}>
        <Sub2ApiInlineUsage onPress={() => router.push("/(app)/sub2api")} />
      </ItemGroup>

      {/* Developer */}
      {(__DEV__ || devModeEnabled) && (
        <ItemGroup title={t("settings.developer")}>
          <Item
            title={t("settings.developerTools")}
            icon={
              <Ionicons name="construct-outline" size={29} color={theme.colors.accentPurple} />
            }
            onPress={() => router.push("/dev")}
          />
        </ItemGroup>
      )}

      {/* About */}
      <ItemGroup title={t("settings.about")} footer={t("settings.aboutFooter")}>
        <Item
          title={t("settings.installGuide")}
          subtitle={t("settings.installGuideSubtitle")}
          icon={
            <Ionicons name="book-outline" size={29} color={theme.colors.accentTeal} />
          }
          onPress={() => router.push("/settings/installation-guide")}
        />
        <Item
          title={t("settings.whatsNew")}
          subtitle={t("settings.whatsNewSubtitle")}
          icon={<Ionicons name="sparkles-outline" size={29} color={theme.colors.accentOrange} />}
          onPress={() => {
            trackWhatsNewClicked();
            router.push("/changelog");
          }}
        />
        {Platform.OS === "ios" && (
          <Item
            title={t("settings.eula")}
            icon={
              <Ionicons
                name="document-text-outline"
                size={29}
                color={theme.colors.accentBlue}
              />
            }
            onPress={async () => {
              const url =
                "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
              const supported = await Linking.canOpenURL(url);
              if (supported) {
                await Linking.openURL(url);
              }
            }}
          />
        )}
        <Item
          title={t("common.version")}
          detail={appVersion}
          icon={
            <Ionicons
              name="information-circle-outline"
              size={29}
              color={theme.colors.textSecondary}
            />
          }
          onPress={handleVersionClick}
          showChevron={false}
        />
      </ItemGroup>
    </ItemList>
  );
});
