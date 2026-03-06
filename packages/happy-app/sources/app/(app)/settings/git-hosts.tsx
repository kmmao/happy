import React from "react";
import { View, Text, Pressable, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSettingMutable } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal as HappyModal } from "@/modal/ModalManager";
import { layout } from "@/components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";

type Provider = "github" | "gitea";

interface GitHost {
  readonly host: string;
  readonly provider: Provider;
  readonly apiToken?: string;
}

export default function GitHostsScreen() {
  const { theme } = useUnistyles();
  const [gitHosts, setGitHosts] = useSettingMutable("gitHosts");
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editIndex, setEditIndex] = React.useState<number | null>(null);
  const [formHost, setFormHost] = React.useState("");
  const [formProvider, setFormProvider] = React.useState<Provider>("github");
  const [formToken, setFormToken] = React.useState("");
  const safeArea = useSafeAreaInsets();
  const screenWidth = useWindowDimensions().width;

  const handleAdd = () => {
    setFormHost("");
    setFormProvider("github");
    setFormToken("");
    setEditIndex(null);
    setShowAddForm(true);
  };

  const handleEdit = (index: number) => {
    const entry = gitHosts[index];
    setFormHost(entry.host);
    setFormProvider(entry.provider);
    setFormToken(entry.apiToken ?? "");
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

  const handleSave = () => {
    const trimmedHost = formHost.trim().toLowerCase();
    if (!trimmedHost) return;

    // Check for duplicate host (excluding current edit)
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
    const newEntry: GitHost = {
      host: trimmedHost,
      provider: formProvider,
      ...(trimmedToken ? { apiToken: trimmedToken } : {}),
    };

    if (editIndex !== null) {
      // Update existing
      setGitHosts(gitHosts.map((h, i) => (i === editIndex ? newEntry : h)));
    } else {
      // Add new
      setGitHosts([...gitHosts, newEntry]);
    }

    setShowAddForm(false);
    setEditIndex(null);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditIndex(null);
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
                  {entry.apiToken ? " · Token ✓" : ""}
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
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  marginBottom: 6,
                  ...Typography.default(),
                }}
              >
                {t("gitHosts.hostLabel")}
              </Text>
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
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  marginBottom: 6,
                  ...Typography.default(),
                }}
              >
                {t("gitHosts.providerLabel")}
              </Text>
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
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.textSecondary,
                      marginBottom: 6,
                      ...Typography.default(),
                    }}
                  >
                    {t("gitHosts.tokenLabel")}
                  </Text>
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
}

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

const styles = StyleSheet.create((theme) => ({
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
}));
