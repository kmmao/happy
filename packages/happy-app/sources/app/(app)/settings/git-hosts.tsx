import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSettingMutable } from "@/sync/storage";
import { useAllMachines } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import {
  generateWebhookSecret,
} from "@/sync/webhookRouteSync";
import type { WebhookRepoConfig } from "@/sync/issueTypes";
import type { GitHost, GitHostTab, Provider } from "@/components/settings/git-hosts/types";
import { GitHostBasicForm } from "@/components/settings/git-hosts/GitHostBasicForm";
import { GitHostAutoIssueForm } from "@/components/settings/git-hosts/GitHostAutoIssueForm";
import { GitHostWebhookForm } from "@/components/settings/git-hosts/GitHostWebhookForm";

// ── Segment Control ────────────────────────────────

const TABS = [
  { key: "basic", label: "gitHosts.tabBasic" },
  { key: "autoIssue", label: "gitHosts.tabAutoIssue" },
  { key: "webhooks", label: "gitHosts.tabWebhooks" },
] as const;

const GitHostSegment = React.memo<{
  active: GitHostTab;
  onSelect: (tab: GitHostTab) => void;
}>(function GitHostSegment({ active, onSelect }) {
  const { theme } = useUnistyles();
  return (
    <View style={{ paddingVertical: 4 }}>
      <View style={[styles.track, { backgroundColor: theme.colors.surface }]}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onSelect(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel={t(tab.label)}
              accessibilityState={{ selected: isActive }}
              style={[
                styles.segment,
                isActive && {
                  backgroundColor: theme.colors.text,
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: isActive
                      ? theme.colors.surface
                      : theme.colors.textSecondary,
                  },
                ]}
              >
                {t(tab.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

// ── Main Screen ────────────────────────────────────

export default React.memo(function GitHostsScreen() {
  const { theme } = useUnistyles();
  const [gitHosts, setGitHosts] = useSettingMutable("gitHosts");
  const machines = useAllMachines();
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editIndex, setEditIndex] = React.useState<number | null>(null);
  const [activeTab, setActiveTab] = React.useState<GitHostTab>("basic");
  const [formHost, setFormHost] = React.useState("");
  const [formProvider, setFormProvider] = React.useState<Provider>("github");
  const [formToken, setFormToken] = React.useState("");
  const [formAutoLabel, setFormAutoLabel] = React.useState("");
  const [formAutoAuthors, setFormAutoAuthors] = React.useState("");
  const [formAutoEnabled, setFormAutoEnabled] = React.useState(false);
  const [formWebhookRepos, setFormWebhookRepos] = React.useState<
    WebhookRepoConfig[]
  >([]);

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
    setActiveTab("basic");
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
    setActiveTab("basic");
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

    const newEntry: GitHost = {
      host: trimmedHost,
      provider: formProvider,
      ...(trimmedToken ? { apiToken: trimmedToken } : {}),
      autoIssueEnabled: formAutoEnabled,
      ...(trimmedLabel ? { autoIssueLabel: trimmedLabel } : {}),
      ...(authors.length > 0 ? { autoIssueAllowedAuthors: authors } : {}),
      webhookRepos: formWebhookRepos,
    };

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

  const editIndexRef = React.useRef(editIndex);
  editIndexRef.current = editIndex;

  const gitHostsRef = React.useRef(gitHosts);
  gitHostsRef.current = gitHosts;

  const handleWebhookRepoSaveComplete = React.useCallback(
    (index: number, updatedRepo: WebhookRepoConfig) => {
      setFormWebhookRepos((prev) =>
        prev.map((r, i) => (i === index ? updatedRepo : r)),
      );

      const idx = editIndexRef.current;
      const currentHosts = gitHostsRef.current;
      if (idx !== null && currentHosts[idx]) {
        const host = currentHosts[idx];
        const newRepos = (host.webhookRepos ?? []).map((r, j) =>
          j === index ? updatedRepo : r,
        );
        setGitHosts(
          currentHosts.map((h, i) =>
            i === idx ? { ...h, webhookRepos: newRepos } : h,
          ),
        );
      }
    },
    [setGitHosts],
  );

  const handleWebhookRepoDeleteComplete = React.useCallback(
    (index: number) => {
      setFormWebhookRepos((prev) => prev.filter((_, i) => i !== index));

      const idx = editIndexRef.current;
      const currentHosts = gitHostsRef.current;
      if (idx !== null && currentHosts[idx]) {
        const host = currentHosts[idx];
        const newRepos = (host.webhookRepos ?? []).filter((_, j) => j !== index);
        setGitHosts(
          currentHosts.map((h, i) =>
            i === idx ? { ...h, webhookRepos: newRepos } : h,
          ),
        );
      }
    },
    [setGitHosts],
  );

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
                  {entry.apiToken ? ` · ${t("gitHosts.tokenSuffix")}` : ""}
                  {(entry.webhookRepos ?? []).length > 0
                    ? ` · ${t("gitHosts.webhookCount", { count: (entry.webhookRepos ?? []).length })}`
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

              {/* Segment Control */}
              <GitHostSegment active={activeTab} onSelect={setActiveTab} />

              {/* Tab content */}
              <View style={{ marginTop: 16 }}>
                {activeTab === "basic" && (
                  <GitHostBasicForm
                    theme={theme}
                    formHost={formHost}
                    formProvider={formProvider}
                    formToken={formToken}
                    onHostChange={setFormHost}
                    onProviderChange={setFormProvider}
                    onTokenChange={setFormToken}
                  />
                )}

                {activeTab === "autoIssue" && (
                  <GitHostAutoIssueForm
                    theme={theme}
                    formAutoEnabled={formAutoEnabled}
                    formAutoLabel={formAutoLabel}
                    formAutoAuthors={formAutoAuthors}
                    onAutoEnabledChange={setFormAutoEnabled}
                    onAutoLabelChange={setFormAutoLabel}
                    onAutoAuthorsChange={setFormAutoAuthors}
                  />
                )}

                {activeTab === "webhooks" && (
                  <GitHostWebhookForm
                    theme={theme}
                    provider={formProvider}
                    machines={machines}
                    formWebhookRepos={formWebhookRepos}
                    onAddRepo={handleAddWebhookRepo}
                    onUpdateRepo={handleUpdateWebhookRepo}
                    onRemoveRepo={handleRemoveWebhookRepo}
                    host={formHost.trim().toLowerCase()}
                    apiToken={formToken.trim() || undefined}
                    autoIssueLabel={formAutoLabel.trim() || undefined}
                    autoIssueAllowedAuthors={
                      formAutoAuthors
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    }
                    onSaveComplete={handleWebhookRepoSaveComplete}
                    onDeleteComplete={handleWebhookRepoDeleteComplete}
                    isNewHost={editIndex === null}
                  />
                )}
              </View>

              {/* Action buttons */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 16,
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
                    opacity: formHost.trim() ? 1 : 0.5,
                  }}
                  onPress={handleSave}
                  disabled={!formHost.trim()}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: theme.colors.button.primary.tint,
                      fontWeight: "600",
                      ...Typography.default("semiBold"),
                    }}
                  >
                    {t("common.save")}
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

const styles = StyleSheet.create((theme) => ({
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  track: {
    flexDirection: "row",
    borderRadius: 20,
    padding: 3,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 18,
  },
  segmentText: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },
}));
