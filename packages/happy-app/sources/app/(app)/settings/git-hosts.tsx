import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSettingMutable } from "@/sync/storage";
import { useAllMachines } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { Switch } from "@/components/Switch";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { TokenStorage } from "@/auth/tokenStorage";
import {
  generateWebhookSecret,
  getWebhookUrl,
  syncWebhookRoutes,
} from "@/sync/webhookRouteSync";
import { machineListGitRepos } from "@/sync/ops";
import type { GitRepoEntry } from "@/sync/ops";
import type { WebhookRepoConfig } from "@/sync/issueTypes";

type Provider = "github" | "gitea";

interface GitHost {
  readonly host: string;
  readonly provider: Provider;
  readonly apiToken?: string;
  readonly autoIssueEnabled?: boolean;
  readonly autoIssueLabel?: string;
  readonly autoIssueAllowedAuthors?: string[];
  readonly webhookRepos?: WebhookRepoConfig[];
}

export default React.memo(function GitHostsScreen() {
  const { theme } = useUnistyles();
  const [gitHosts, setGitHosts] = useSettingMutable("gitHosts");
  const machines = useAllMachines();
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editIndex, setEditIndex] = React.useState<number | null>(null);
  const [formHost, setFormHost] = React.useState("");
  const [formProvider, setFormProvider] = React.useState<Provider>("github");
  const [formToken, setFormToken] = React.useState("");
  const [formAutoLabel, setFormAutoLabel] = React.useState("");
  const [formAutoAuthors, setFormAutoAuthors] = React.useState("");
  const [formAutoEnabled, setFormAutoEnabled] = React.useState(false);
  const [formWebhookRepos, setFormWebhookRepos] = React.useState<
    WebhookRepoConfig[]
  >([]);
  const [webhookSyncing, setWebhookSyncing] = React.useState(false);

  const safeArea = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;

  const handleAdd = () => {
    setFormHost("");
    setFormProvider("github");
    setFormToken("");
    setFormAutoLabel("");
    setFormAutoAuthors("");
    setFormAutoEnabled(false);
    setFormWebhookRepos([]);
    setEditIndex(null);
    setShowAddForm(true);
  };

  const handleEdit = (index: number) => {
    const entry = gitHosts[index];
    setFormHost(entry.host);
    setFormProvider(entry.provider);
    setFormToken(entry.apiToken ?? "");
    setFormAutoLabel(entry.autoIssueLabel ?? "");
    setFormAutoAuthors((entry.autoIssueAllowedAuthors ?? []).join(", "));
    setFormAutoEnabled(entry.autoIssueEnabled ?? Boolean(entry.autoIssueLabel));
    setFormWebhookRepos((entry.webhookRepos ?? []).map((r) => ({ ...r })));
    setEditIndex(index);
    setShowAddForm(true);
  };

  const handleDelete = async (index: number) => {
    const entry = gitHosts[index];
    const confirmed = await HappyModal.confirm(
      t("gitHosts.deleteTitle"),
      t("gitHosts.deleteMessage", { host: entry.host }),
      {
        cancelText: t("common.cancel"),
        confirmText: t("common.delete"),
        destructive: true,
      },
    );
    if (!confirmed) return;
    setGitHosts(gitHosts.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const trimmedHost = formHost.trim().toLowerCase();
    if (!trimmedHost) return;

    const duplicate = gitHosts.findIndex(
      (h, i) => h.host.toLowerCase() === trimmedHost && i !== editIndex,
    );
    if (duplicate >= 0) {
      HappyModal.confirm(
        t("gitHosts.duplicateTitle"),
        t("gitHosts.duplicateMessage", { host: trimmedHost }),
        { cancelText: t("common.ok") },
      );
      return;
    }

    const trimmedToken = formToken.trim();
    const trimmedLabel = formAutoLabel.trim();
    const authors = formAutoAuthors
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let newEntry: GitHost = {
      host: trimmedHost,
      provider: formProvider,
      ...(trimmedToken ? { apiToken: trimmedToken } : {}),
      autoIssueEnabled: formAutoEnabled,
      ...(trimmedLabel ? { autoIssueLabel: trimmedLabel } : {}),
      ...(authors.length > 0 ? { autoIssueAllowedAuthors: authors } : {}),
      webhookRepos: formWebhookRepos,
    };

    // Sync webhook routes to server
    const hasEnabledRepos = formWebhookRepos.some(
      (r) => r.enabled && r.secret && r.machineId && r.repoUrl,
    );
    if (hasEnabledRepos || formWebhookRepos.some((r) => r.routeId)) {
      setWebhookSyncing(true);
      try {
        const credentials = await TokenStorage.getCredentials();
        if (credentials) {
          const synced = await syncWebhookRoutes(credentials, newEntry);
          newEntry = { ...synced } as GitHost;
          HappyModal.toast(t("gitHosts.webhookSyncSuccess"));
        }
      } catch {
        HappyModal.toast(t("gitHosts.webhookSyncError"));
      } finally {
        setWebhookSyncing(false);
      }
    }

    if (editIndex !== null) {
      setGitHosts(gitHosts.map((h, i) => (i === editIndex ? newEntry : h)));
    } else {
      setGitHosts([...gitHosts, newEntry]);
    }

    setShowAddForm(false);
    setEditIndex(null);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditIndex(null);
  };

  const handleAddWebhookRepo = () => {
    setFormWebhookRepos([
      ...formWebhookRepos,
      {
        repoUrl: "",
        machineId: machines[0]?.id ?? "",
        repoPath: "",
        secret: generateWebhookSecret(),
        enabled: true,
      },
    ]);
  };

  const handleUpdateWebhookRepo = (
    index: number,
    updates: Partial<WebhookRepoConfig>,
  ) => {
    setFormWebhookRepos(
      formWebhookRepos.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    );
  };

  const handleRemoveWebhookRepo = (index: number) => {
    setFormWebhookRepos(formWebhookRepos.filter((_, i) => i !== index));
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
          style={{
            maxWidth: layout.maxWidth,
            alignSelf: "center",
            width: "100%",
          }}
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
            {t("gitHosts.title")}
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: theme.colors.textSecondary,
              marginBottom: 16,
              lineHeight: 20,
              ...Typography.default(),
            }}
          >
            {t("gitHosts.description")}
          </Text>

          {/* Host list */}
          {gitHosts.length === 0 && !showAddForm && (
            <View style={styles.emptyContainer}>
              <Ionicons
                name="git-branch-outline"
                size={40}
                color={theme.colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  marginTop: 12,
                  textAlign: "center",
                  lineHeight: 20,
                  ...Typography.default(),
                }}
              >
                {t("gitHosts.empty")}
              </Text>
            </View>
          )}

          {gitHosts.map((entry, index) => (
            <Pressable
              key={`${entry.host}-${index}`}
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 12,
                padding: 16,
                marginBottom: 8,
                flexDirection: "row",
                alignItems: "center",
              }}
              onPress={() => handleEdit(index)}
            >
              <Ionicons
                name={
                  entry.provider === "github" ? "logo-github" : "server-outline"
                }
                size={24}
                color={theme.colors.text}
                style={{ marginRight: 12 }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: theme.colors.text,
                    ...Typography.default("semiBold"),
                  }}
                >
                  {entry.host}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: theme.colors.textSecondary,
                    marginTop: 2,
                    ...Typography.default(),
                  }}
                >
                  {entry.provider === "github" ? "GitHub" : "Gitea"}
                  {entry.apiToken ? " · Token" : ""}
                  {(entry.webhookRepos ?? []).length > 0
                    ? ` · ${(entry.webhookRepos ?? []).length} Webhook`
                    : ""}
                </Text>
              </View>
              <Pressable onPress={() => handleDelete(index)} hitSlop={8}>
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={theme.colors.box.warning.text}
                />
              </Pressable>
            </Pressable>
          ))}

          {/* Add/Edit form */}
          {showAddForm && (
            <View
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: theme.colors.text,
                  marginBottom: 12,
                  ...Typography.default("semiBold"),
                }}
              >
                {editIndex !== null
                  ? t("gitHosts.editHost")
                  : t("gitHosts.addHost")}
              </Text>

              {/* Host input */}
              <FieldLabel theme={theme}>{t("gitHosts.hostLabel")}</FieldLabel>
              <TextInput
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 15,
                  color: theme.colors.text,
                  marginBottom: 12,
                  ...Typography.mono(),
                }}
                value={formHost}
                onChangeText={setFormHost}
                placeholder="github.mycompany.com or http://10.0.0.1:3000"
                placeholderTextColor={theme.colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Provider selector */}
              <FieldLabel theme={theme}>
                {t("gitHosts.providerLabel")}
              </FieldLabel>
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <ProviderButton
                  label="GitHub"
                  icon="logo-github"
                  selected={formProvider === "github"}
                  onPress={() => setFormProvider("github")}
                />
                <ProviderButton
                  label="Gitea"
                  icon="server-outline"
                  selected={formProvider === "gitea"}
                  onPress={() => setFormProvider("gitea")}
                />
              </View>

              {/* API Token input (Gitea only) */}
              {formProvider === "gitea" && (
                <>
                  <FieldLabel theme={theme}>
                    {t("gitHosts.tokenLabel")}
                  </FieldLabel>
                  <TextInput
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 15,
                      color: theme.colors.text,
                      marginBottom: 4,
                      ...Typography.mono(),
                    }}
                    value={formToken}
                    onChangeText={setFormToken}
                    placeholder={t("gitHosts.tokenPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      color: theme.colors.textSecondary,
                      marginBottom: 16,
                      lineHeight: 16,
                      ...Typography.default(),
                    }}
                  >
                    {t("gitHosts.tokenHint")}
                  </Text>
                </>
              )}

              {/* Auto Issue section */}
              <SectionToggle
                theme={theme}
                label={t("gitHosts.autoIssueSectionTitle")}
                value={formAutoEnabled}
                onValueChange={setFormAutoEnabled}
              />
              <HintText theme={theme}>
                {t("gitHosts.autoIssueDescription")}
              </HintText>

              {formAutoEnabled && (
                <>
                  <FieldLabel theme={theme}>
                    {t("gitHosts.autoIssueLabel")}
                  </FieldLabel>
                  <TextInput
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 15,
                      color: theme.colors.text,
                      marginBottom: 12,
                      ...Typography.mono(),
                    }}
                    value={formAutoLabel}
                    onChangeText={setFormAutoLabel}
                    placeholder={t("gitHosts.autoIssueLabelPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <FieldLabel theme={theme}>
                    {t("gitHosts.autoIssueAllowedAuthors")}
                  </FieldLabel>
                  <TextInput
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: 8,
                      padding: 12,
                      fontSize: 15,
                      color: theme.colors.text,
                      marginBottom: 16,
                      ...Typography.mono(),
                    }}
                    value={formAutoAuthors}
                    onChangeText={setFormAutoAuthors}
                    placeholder={t(
                      "gitHosts.autoIssueAllowedAuthorsPlaceholder",
                    )}
                    placeholderTextColor={theme.colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              )}

              {/* Webhook Repos section */}
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: theme.colors.text,
                  marginTop: 4,
                  marginBottom: 8,
                  ...Typography.default("semiBold"),
                }}
              >
                {t("gitHosts.webhookSectionTitle")}
              </Text>
              <HintText theme={theme}>
                {t("gitHosts.webhookDescription")}
              </HintText>

              {formWebhookRepos.map((repo, idx) => (
                <WebhookRepoItem
                  key={idx}
                  repo={repo}
                  index={idx}
                  provider={formProvider}
                  machines={machines}
                  theme={theme}
                  onUpdate={handleUpdateWebhookRepo}
                  onRemove={handleRemoveWebhookRepo}
                />
              ))}

              {/* Add webhook repo button */}
              <Pressable
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: theme.colors.surface,
                  marginBottom: 16,
                }}
                onPress={handleAddWebhookRepo}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={theme.colors.textLink}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textLink,
                    fontWeight: "600",
                    ...Typography.default("semiBold"),
                  }}
                >
                  {t("gitHosts.webhookAddRepo")}
                </Text>
              </Pressable>

              {/* Action buttons */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <Pressable
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 8,
                  }}
                  onPress={handleCancel}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    {t("common.cancel")}
                  </Text>
                </Pressable>
                <Pressable
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: theme.colors.button.primary.background,
                    opacity: formHost.trim() && !webhookSyncing ? 1 : 0.5,
                  }}
                  onPress={handleSave}
                  disabled={!formHost.trim() || webhookSyncing}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: theme.colors.button.primary.tint,
                      fontWeight: "600",
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {webhookSyncing ? "..." : t("common.save")}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Add button */}
          {!showAddForm && (
            <Pressable
              style={{
                backgroundColor: theme.colors.input.background,
                borderRadius: 12,
                padding: 16,
                marginTop: 8,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={handleAdd}
            >
              <Ionicons
                name="add-circle-outline"
                size={20}
                color={theme.colors.textLink}
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontSize: 15,
                  color: theme.colors.textLink,
                  fontWeight: "600",
                  ...Typography.default("semiBold"),
                }}
              >
                {t("gitHosts.addHost")}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

// ── Sub-components ──────────────────────────────────

const FieldLabel = React.memo<{
  theme: any;
  children: string;
}>(function FieldLabel({ theme, children }) {
  return (
    <Text
      style={{
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 6,
        ...Typography.default(),
      }}
    >
      {children}
    </Text>
  );
});

const HintText = React.memo<{
  theme: any;
  children: string;
}>(function HintText({ theme, children }) {
  return (
    <Text
      style={{
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 12,
        lineHeight: 16,
        ...Typography.default(),
      }}
    >
      {children}
    </Text>
  );
});

const SectionToggle = React.memo<{
  theme: any;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}>(function SectionToggle({ theme, label, value, onValueChange }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 4,
        marginBottom: 8,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: theme.colors.text,
          ...Typography.default("semiBold"),
        }}
      >
        {label}
      </Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
});

const ProviderButton = React.memo<{
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  selected: boolean;
  onPress: () => void;
}>(function ProviderButton({ label, icon, selected, onPress }) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: selected
          ? theme.colors.button.primary.background
          : theme.colors.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={selected ? theme.colors.button.primary.tint : theme.colors.text}
      />
      <Text
        style={{
          fontSize: 14,
          fontWeight: selected ? "600" : "400",
          color: selected
            ? theme.colors.button.primary.tint
            : theme.colors.text,
          ...Typography.default(selected ? "semiBold" : undefined),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Individual webhook repo configuration item.
 * Machine picker → Scan repos → Repo URL / Path → Secret → Webhook URL
 */
const WebhookRepoItem = React.memo<{
  repo: WebhookRepoConfig;
  index: number;
  provider: Provider;
  machines: readonly { id: string; metadata?: any }[];
  theme: any;
  onUpdate: (index: number, updates: Partial<WebhookRepoConfig>) => void;
  onRemove: (index: number) => void;
}>(function WebhookRepoItem({
  repo,
  index,
  provider,
  machines,
  theme,
  onUpdate,
  onRemove,
}) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<readonly GitRepoEntry[]>([]);
  const [showScanResults, setShowScanResults] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSearch, setScanSearch] = useState("");
  const [testing, setTesting] = useState(false);

  const handleCopySecret = async () => {
    await Clipboard.setStringAsync(repo.secret);
    HappyModal.toast(t("gitHosts.webhookSecretCopied"));
  };

  const handleCopyUrl = async () => {
    const url = getWebhookUrl(provider);
    await Clipboard.setStringAsync(url);
    HappyModal.toast(t("gitHosts.webhookUrlCopied"));
  };

  const handleRegenSecret = () => {
    onUpdate(index, { secret: generateWebhookSecret() });
  };

  const handleScanRepos = useCallback(async () => {
    if (!repo.machineId || scanning) return;
    setScanning(true);
    setScanError(null);
    setScanResults([]);
    setScanSearch("");
    setShowScanResults(true);
    try {
      const repos = await machineListGitRepos(repo.machineId);
      setScanResults(repos);
      if (repos.length === 0) {
        setScanError(t("gitHosts.scanEmpty"));
      }
    } catch {
      setScanError(t("gitHosts.scanError"));
    } finally {
      setScanning(false);
    }
  }, [repo.machineId, scanning]);

  const handleSelectRepo = useCallback(
    (entry: GitRepoEntry) => {
      onUpdate(index, { repoUrl: entry.remoteUrl, repoPath: entry.repoPath });
      setShowScanResults(false);
    },
    [index, onUpdate],
  );

  const handleShowGuide = useCallback(() => {
    const webhookUrl = getWebhookUrl(provider);
    const providerName = provider === "github" ? "GitHub" : "Gitea";
    const steps =
      provider === "github"
        ? `1. ${t("gitHosts.guideStep1GitHub")}\n2. ${t("gitHosts.guideStep2")}\n3. ${t("gitHosts.guideStep3")}\n4. ${t("gitHosts.guideStep4")}\n5. ${t("gitHosts.guideStep5")}`
        : `1. ${t("gitHosts.guideStep1Gitea")}\n2. ${t("gitHosts.guideStep2")}\n3. ${t("gitHosts.guideStep3")}\n4. ${t("gitHosts.guideStep4")}\n5. ${t("gitHosts.guideStep5")}`;
    HappyModal.confirm(
      t("gitHosts.webhookGuideTitle", { provider: providerName }),
      `${steps}\n\nWebhook URL:\n${webhookUrl}`,
      { cancelText: t("common.ok") },
    );
  }, [provider]);

  const handleTestWebhook = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    try {
      const webhookUrl = getWebhookUrl(provider);
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping" }),
      });
      if (response.ok) {
        HappyModal.toast(t("gitHosts.webhookTestSuccess"));
      } else {
        HappyModal.toast(
          t("gitHosts.webhookTestFail", { status: String(response.status) }),
        );
      }
    } catch {
      HappyModal.toast(t("gitHosts.webhookTestError"));
    } finally {
      setTesting(false);
    }
  }, [provider, testing]);

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
      }}
    >
      {/* Header with enabled toggle, guide, test, remove */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <Switch
          value={repo.enabled}
          onValueChange={(v) => onUpdate(index, { enabled: v })}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={handleShowGuide} hitSlop={8}>
            <Ionicons
              name="help-circle-outline"
              size={20}
              color={theme.colors.textLink}
            />
          </Pressable>
          <Pressable
            onPress={handleTestWebhook}
            hitSlop={8}
            disabled={testing}
            style={{ opacity: testing ? 0.5 : 1 }}
          >
            {testing ? (
              <ActivityIndicator size={16} color={theme.colors.textLink} />
            ) : (
              <Ionicons
                name="flash-outline"
                size={20}
                color={theme.colors.textLink}
              />
            )}
          </Pressable>
          <Pressable onPress={() => onRemove(index)} hitSlop={8}>
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.box.warning.text,
                ...Typography.default(),
              }}
            >
              {t("gitHosts.webhookRemoveRepo")}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Target Machine (moved before repo URL) */}
      <FieldLabel theme={theme}>{t("gitHosts.webhookMachineId")}</FieldLabel>
      {machines.length === 0 ? (
        <Text
          style={{
            fontSize: 13,
            color: theme.colors.box.warning.text,
            marginBottom: 10,
            ...Typography.default(),
          }}
        >
          {t("gitHosts.webhookNoMachines")}
        </Text>
      ) : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {machines.map((machine) => (
            <Pressable
              key={machine.id}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor:
                  repo.machineId === machine.id
                    ? theme.colors.button.primary.background
                    : theme.colors.input.background,
              }}
              onPress={() =>
                onUpdate(index, {
                  machineId: machine.id,
                })
              }
            >
              <Text
                style={{
                  fontSize: 12,
                  color:
                    repo.machineId === machine.id
                      ? theme.colors.button.primary.tint
                      : theme.colors.text,
                  ...Typography.default(
                    repo.machineId === machine.id ? "semiBold" : undefined,
                  ),
                }}
              >
                {machine.metadata?.displayName ??
                  machine.metadata?.host ??
                  machine.id.slice(0, 8)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Scan repos button */}
      {repo.machineId ? (
        <Pressable
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: theme.colors.input.background,
            marginBottom: 10,
            opacity: scanning ? 0.6 : 1,
          }}
          onPress={handleScanRepos}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator
              size="small"
              color={theme.colors.textLink}
              style={{ marginRight: 6 }}
            />
          ) : (
            <Ionicons
              name="search-outline"
              size={16}
              color={theme.colors.textLink}
              style={{ marginRight: 6 }}
            />
          )}
          <Text
            style={{
              fontSize: 13,
              color: theme.colors.textLink,
              ...Typography.default("semiBold"),
            }}
          >
            {scanning ? t("gitHosts.scanning") : t("gitHosts.scanRepos")}
          </Text>
        </Pressable>
      ) : null}

      {/* Scan results */}
      {showScanResults && (
        <View
          style={{
            backgroundColor: theme.colors.input.background,
            borderRadius: 8,
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          {scanError ? (
            <Text
              style={{
                padding: 12,
                fontSize: 13,
                color: theme.colors.textSecondary,
                textAlign: "center",
                ...Typography.default(),
              }}
            >
              {scanError}
            </Text>
          ) : (
            <>
              {scanResults.length > 0 && (
                <TextInput
                  style={{
                    padding: 10,
                    fontSize: 14,
                    color: theme.colors.text,
                    borderBottomWidth: 0.5,
                    borderBottomColor: theme.colors.border,
                    ...Typography.default(),
                  }}
                  value={scanSearch}
                  onChangeText={setScanSearch}
                  placeholder={t("gitHosts.scanSearchPlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                {scanResults
                  .filter((entry) => {
                    if (!scanSearch) return true;
                    const q = scanSearch.toLowerCase();
                    return (
                      entry.name.toLowerCase().includes(q) ||
                      entry.repoPath.toLowerCase().includes(q) ||
                      entry.remoteUrl.toLowerCase().includes(q)
                    );
                  })
                  .map((entry) => (
                    <Pressable
                      key={entry.repoPath}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderBottomWidth: 0.5,
                        borderBottomColor: theme.colors.border,
                      }}
                      onPress={() => handleSelectRepo(entry)}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          color: theme.colors.text,
                          ...Typography.default("semiBold"),
                        }}
                        numberOfLines={1}
                      >
                        {entry.name}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: theme.colors.textSecondary,
                          marginTop: 2,
                          ...Typography.mono(),
                        }}
                        numberOfLines={1}
                      >
                        {entry.repoPath}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* Repo URL */}
      <FieldLabel theme={theme}>{t("gitHosts.webhookRepoUrl")}</FieldLabel>
      <TextInput
        style={{
          backgroundColor: theme.colors.input.background,
          borderRadius: 8,
          padding: 10,
          fontSize: 14,
          color: theme.colors.text,
          marginBottom: 10,
          ...Typography.mono(),
        }}
        value={repo.repoUrl}
        onChangeText={(v) => onUpdate(index, { repoUrl: v })}
        placeholder={t("gitHosts.webhookRepoUrlPlaceholder")}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      {/* Local repo path */}
      <FieldLabel theme={theme}>{t("gitHosts.webhookRepoPath")}</FieldLabel>
      <TextInput
        style={{
          backgroundColor: theme.colors.input.background,
          borderRadius: 8,
          padding: 10,
          fontSize: 14,
          color: theme.colors.text,
          marginBottom: 10,
          ...Typography.mono(),
        }}
        value={repo.repoPath}
        onChangeText={(v) => onUpdate(index, { repoPath: v })}
        placeholder={t("gitHosts.webhookRepoPathPlaceholder")}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Secret */}
      <FieldLabel theme={theme}>{t("gitHosts.webhookSecretLabel")}</FieldLabel>
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          marginBottom: 10,
        }}
      >
        <TextInput
          style={{
            flex: 1,
            backgroundColor: theme.colors.input.background,
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            color: theme.colors.text,
            ...Typography.mono(),
          }}
          value={repo.secret}
          onChangeText={(v) => onUpdate(index, { secret: v })}
          placeholder="..."
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.input.background,
            justifyContent: "center",
          }}
          onPress={handleRegenSecret}
        >
          <Ionicons
            name="refresh-outline"
            size={16}
            color={theme.colors.textLink}
          />
        </Pressable>
        {repo.secret.length > 0 && (
          <Pressable
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
              backgroundColor: theme.colors.input.background,
              justifyContent: "center",
            }}
            onPress={handleCopySecret}
          >
            <Ionicons
              name="copy-outline"
              size={16}
              color={theme.colors.textLink}
            />
          </Pressable>
        )}
      </View>

      {/* Webhook URL (read-only) */}
      <FieldLabel theme={theme}>{t("gitHosts.webhookUrlLabel")}</FieldLabel>
      <Pressable
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.colors.input.background,
          borderRadius: 8,
          padding: 10,
          marginBottom: 4,
          gap: 6,
        }}
        onPress={handleCopyUrl}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            color: theme.colors.text,
            ...Typography.mono(),
          }}
          numberOfLines={1}
        >
          {getWebhookUrl(provider)}
        </Text>
        <Ionicons name="copy-outline" size={14} color={theme.colors.textLink} />
      </Pressable>
      <HintText theme={theme}>{t("gitHosts.webhookUrlHint")}</HintText>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
}));
