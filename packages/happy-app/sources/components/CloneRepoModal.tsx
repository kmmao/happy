import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { GitHostMapping } from "@/sync/issueTypes";
import type { RemoteGitRepoEntry } from "@/sync/ops";

function formatRepoUpdatedAt(updatedAt?: number | null): string | null {
  if (!updatedAt || !Number.isFinite(updatedAt)) return null;
  try {
    return new Date(updatedAt).toLocaleDateString();
  } catch {
    return null;
  }
}

type VisibilityFilter = "all" | "private" | "public";

interface CloneRepoModalProps {
  readonly onClose: () => void;
  readonly initialTargetDir: string;
  readonly gitHosts: readonly GitHostMapping[];
  readonly lastUsedGitHost?: string | null;
  readonly recentRemoteRepos: readonly {
    host: string;
    repoUrl: string;
    fullName: string;
  }[];
  readonly onLoadRepos: (
    host: GitHostMapping,
    options?: { forceRefresh?: boolean },
  ) => Promise<readonly RemoteGitRepoEntry[]>;
  readonly onClone: (input: {
    repoUrl: string;
    targetDir: string;
    provider?: "github" | "gitea";
    apiToken?: string;
    host?: string;
  }) => Promise<void>;
}

const stylesheet = StyleSheet.create((theme) => ({
  card: {
    width: 420,
    maxWidth: "94%",
    borderRadius: 16,
    padding: 16,
    backgroundColor: theme.colors.surface,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    marginBottom: 6,
    ...Typography.default("semiBold"),
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
    ...Typography.default(),
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 12,
    ...Typography.default(),
  },
  helperBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    ...Typography.default(),
  },
  hostRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  hostChip: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hostChipText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  filterChip: {
    minHeight: 30,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },
  repoList: {
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 12,
    overflow: "hidden",
  },
  repoRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  repoNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  repoName: {
    flex: 1,
    fontSize: 14,
    ...Typography.default("semiBold"),
  },
  repoSub: {
    fontSize: 11,
    marginTop: 3,
    ...Typography.default(),
  },
  repoUrl: {
    fontSize: 11,
    marginTop: 2,
    ...Typography.mono(),
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
    ...Typography.default(),
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  button: {
    minWidth: 96,
    minHeight: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 8,
  },
  buttonText: {
    fontSize: 14,
    ...Typography.default("semiBold"),
  },
  smallButton: {
    minHeight: 28,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  smallButtonText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    ...Typography.default(),
  },
}));

export const CloneRepoModal = React.memo(function CloneRepoModal({
  onClose,
  initialTargetDir,
  gitHosts,
  lastUsedGitHost,
  recentRemoteRepos,
  onLoadRepos,
  onClone,
}: CloneRepoModalProps) {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const availableHosts = useMemo(
    () => gitHosts.filter((host) => !!host.apiToken),
    [gitHosts],
  );
  const [selectedHostKey, setSelectedHostKey] = useState(
    availableHosts.find((host) => host.host === lastUsedGitHost)?.host ??
      availableHosts[0]?.host ??
      "",
  );
  const [repoSearch, setRepoSearch] = useState("");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [repos, setRepos] = useState<readonly RemoteGitRepoEntry[]>([]);
  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");
  const [targetDir, setTargetDir] = useState(initialTargetDir);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedHost = useMemo(
    () => availableHosts.find((host) => host.host === selectedHostKey),
    [availableHosts, selectedHostKey],
  );
  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.cloneUrl === selectedRepoUrl),
    [repos, selectedRepoUrl],
  );
  const visibilityCounts = useMemo(
    () => ({
      all: repos.length,
      private: repos.filter((repo) => repo.private).length,
      public: repos.filter((repo) => !repo.private).length,
    }),
    [repos],
  );

  const filteredRepos = useMemo(() => {
    const query = repoSearch.toLowerCase();
    const visibilityRepos = repos.filter((repo) => {
      if (visibilityFilter === "private") return repo.private;
      if (visibilityFilter === "public") return !repo.private;
      return true;
    });
    const baseRepos = query
      ? visibilityRepos.filter(
          (repo) =>
            repo.name.toLowerCase().includes(query) ||
            repo.fullName.toLowerCase().includes(query) ||
            repo.cloneUrl.toLowerCase().includes(query),
        )
      : visibilityRepos;

    const recentRank = new Map<string, number>();
    recentRemoteRepos.forEach((repo, index) => {
      if (repo.host === selectedHost?.host) {
        recentRank.set(repo.repoUrl, index);
      }
    });
    const orderMap = new Map(baseRepos.map((repo, index) => [repo.cloneUrl, index]));

    return [...baseRepos].sort((a, b) => {
      const aRank = recentRank.get(a.cloneUrl);
      const bRank = recentRank.get(b.cloneUrl);
      if (aRank != null && bRank != null) return aRank - bRank;
      if (aRank != null) return -1;
      if (bRank != null) return 1;
      return (orderMap.get(a.cloneUrl) ?? 0) - (orderMap.get(b.cloneUrl) ?? 0);
    });
  }, [recentRemoteRepos, repoSearch, repos, selectedHost?.host, visibilityFilter]);

  const handleLoadRepos = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!selectedHost) return;
    setLoadingRepos(true);
    setLoadError(null);
    setSelectedRepoUrl("");
    try {
      const remoteRepos = await onLoadRepos(selectedHost, options);
      setRepos(remoteRepos);
    } catch (loadReposError) {
      setRepos([]);
      setLoadError(
        loadReposError instanceof Error
          ? loadReposError.message
          : t("newSession.gitRepos.loadReposFailed", {
              error: "Unknown error",
            }),
      );
    } finally {
      setLoadingRepos(false);
    }
  }, [onLoadRepos, selectedHost]);

  useEffect(() => {
    if (!selectedHost && availableHosts.length > 0) {
      setSelectedHostKey(availableHosts[0].host);
      return;
    }
    if (selectedHost) {
      setRepoSearch("");
      handleLoadRepos();
    } else {
      setRepos([]);
      setLoadError(null);
      setSelectedRepoUrl("");
    }
  }, [availableHosts, handleLoadRepos, selectedHost]);

  const handleSubmit = async () => {
    if (!selectedHost) {
      setError(t("newSession.gitRepos.noConfiguredHosts"));
      return;
    }
    if (!selectedRepo) {
      setError(t("newSession.gitRepos.noRepoSelected"));
      return;
    }
    if (!targetDir.trim()) {
      setError(t("newSession.gitRepos.noTargetDir"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onClone({
        repoUrl: selectedRepo.cloneUrl,
        targetDir: targetDir.trim(),
        provider: selectedHost.provider,
        apiToken: selectedHost.apiToken,
        host: selectedHost.host,
      });
      onClose();
    } catch (cloneError) {
      setError(
        cloneError instanceof Error
          ? cloneError.message
          : t("newSession.gitRepos.cloneFailed", {
              error: "Unknown error",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          shadowColor: theme.colors.shadow.color,
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>
        {t("newSession.gitRepos.cloneRepo")}
      </Text>
      <Text style={[styles.description, { color: theme.colors.textSecondary }]}> 
        {t("newSession.gitRepos.cloneDescription")}
      </Text>

      <Text style={[styles.label, { color: theme.colors.text, marginBottom: 8 }]}> 
        {t("newSession.gitRepos.repoHostLabel")}
      </Text>
      {availableHosts.length === 0 ? (
        <View
          style={[
            styles.helperBox,
            { backgroundColor: theme.colors.input.background },
          ]}
        >
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={theme.colors.textSecondary}
            style={{ marginTop: 1 }}
          />
          <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}> 
            {t("newSession.gitRepos.noConfiguredHosts")}
          </Text>
        </View>
      ) : (
        <View style={styles.hostRow}>
          {availableHosts.map((host) => {
            const selected = host.host === selectedHostKey;
            return (
              <Pressable
                key={host.host}
                onPress={() => setSelectedHostKey(host.host)}
                style={({ pressed }) => [
                  styles.hostChip,
                  {
                    borderColor: selected
                      ? theme.colors.textLink
                      : theme.colors.divider,
                    backgroundColor: selected
                      ? `${theme.colors.textLink}12`
                      : theme.colors.input.background,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={
                    host.provider === "github"
                      ? "logo-github"
                      : "git-branch-outline"
                  }
                  size={14}
                  color={selected ? theme.colors.textLink : theme.colors.textSecondary}
                />
                <Text
                  style={[
                    styles.hostChipText,
                    { color: selected ? theme.colors.textLink : theme.colors.text },
                  ]}
                >
                  {host.host}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selectedHost && (
        <View
          style={[
            styles.helperBox,
            { backgroundColor: theme.colors.input.background },
          ]}
        >
          <Ionicons
            name="key-outline"
            size={16}
            color={theme.colors.textLink}
            style={{ marginTop: 1 }}
          />
          <Text style={[styles.helperText, { color: theme.colors.textSecondary }]}> 
            {t("newSession.gitRepos.configuredHostDetected", {
              provider: selectedHost.provider === "github" ? "GitHub" : "Gitea",
              host: selectedHost.host,
            })}
          </Text>
        </View>
      )}

      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: theme.colors.text }]}> 
          {t("newSession.gitRepos.title")}
        </Text>
        {selectedHost && (
          <Pressable
            onPress={() => handleLoadRepos({ forceRefresh: true })}
            disabled={loadingRepos}
            style={({ pressed }) => [
              styles.smallButton,
              {
                backgroundColor: theme.colors.input.background,
                opacity: pressed || loadingRepos ? 0.75 : 1,
              },
            ]}
          >
            {loadingRepos ? (
              <ActivityIndicator size="small" color={theme.colors.textLink} />
            ) : (
              <Ionicons
                name="refresh-outline"
                size={14}
                color={theme.colors.textLink}
              />
            )}
            <Text style={[styles.smallButtonText, { color: theme.colors.textLink }]}> 
              {loadingRepos
                ? t("newSession.gitRepos.loadingRepos")
                : t("newSession.gitRepos.loadRepos")}
            </Text>
          </Pressable>
        )}
      </View>

      {repos.length > 0 && (
        <>
          <View style={styles.filterRow}>
            {([
              ["all", t("newSession.gitRepos.filterAll", { count: visibilityCounts.all })],
              [
                "private",
                t("newSession.gitRepos.filterPrivate", { count: visibilityCounts.private }),
              ],
              [
                "public",
                t("newSession.gitRepos.filterPublic", { count: visibilityCounts.public }),
              ],
            ] as const).map(([key, label]) => {
              const selected = visibilityFilter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setVisibilityFilter(key)}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      borderColor: selected
                        ? theme.colors.textLink
                        : theme.colors.divider,
                      backgroundColor: selected
                        ? `${theme.colors.textLink}12`
                        : theme.colors.input.background,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: selected ? theme.colors.textLink : theme.colors.textSecondary },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.colors.divider,
                color: theme.colors.text,
                backgroundColor: theme.colors.input.background,
                marginBottom: 10,
              },
            ]}
            value={repoSearch}
            onChangeText={setRepoSearch}
            placeholder={t("newSession.gitRepos.remoteSearchPlaceholder")}
            placeholderTextColor={theme.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <View
        style={[
          styles.repoList,
          {
            borderColor: theme.colors.divider,
            backgroundColor: theme.colors.input.background,
          },
        ]}
      >
        {loadingRepos ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="small" color={theme.colors.textLink} />
          </View>
        ) : loadError ? (
          <Text style={[styles.emptyText, { color: theme.colors.accentOrange }]}> 
            {loadError}
          </Text>
        ) : filteredRepos.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}> 
            {repos.length === 0
              ? t("newSession.gitRepos.noRemoteRepos")
              : t("newSession.gitRepos.noSearchResults")}
          </Text>
        ) : (
          <ScrollView nestedScrollEnabled>
            {filteredRepos.map((repo, index) => {
              const selected = repo.cloneUrl === selectedRepoUrl;
              const isLast = index === filteredRepos.length - 1;
              return (
                <Pressable
                  key={`${repo.fullName}:${repo.cloneUrl}`}
                  onPress={() => setSelectedRepoUrl(repo.cloneUrl)}
                  style={({ pressed }) => [
                    styles.repoRow,
                    {
                      borderBottomColor: isLast
                        ? "transparent"
                        : theme.colors.divider,
                      backgroundColor: selected
                        ? theme.colors.surfaceSelected
                        : pressed
                          ? `${theme.colors.textLink}08`
                          : "transparent",
                    },
                  ]}
                >
                  <View style={styles.repoNameRow}>
                    <Ionicons
                      name={repo.private ? "lock-closed-outline" : "folder-open-outline"}
                      size={14}
                      color={theme.colors.textSecondary}
                    />
                    <Text style={[styles.repoName, { color: theme.colors.text }]}> 
                      {repo.fullName}
                    </Text>
                  </View>
                  <Text style={[styles.repoSub, { color: theme.colors.textSecondary }]}> 
                    {[
                      recentRemoteRepos.some(
                        (recent) =>
                          recent.host === selectedHost?.host &&
                          recent.repoUrl === repo.cloneUrl,
                      )
                        ? t("newSession.gitRepos.recentlyUsed")
                        : null,
                      repo.private
                        ? t("newSession.gitRepos.visibilityPrivate")
                        : t("newSession.gitRepos.visibilityPublic"),
                      formatRepoUpdatedAt(repo.updatedAt)
                        ? t("newSession.gitRepos.updatedOn", {
                            date: formatRepoUpdatedAt(repo.updatedAt)!,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <Text
                    style={[styles.repoUrl, { color: theme.colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {repo.cloneUrl}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Text style={[styles.label, { color: theme.colors.text }]}> 
        {t("newSession.gitRepos.repoUrlLabel")}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: theme.colors.divider,
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.input.background,
          },
        ]}
        value={selectedRepo?.cloneUrl ?? ""}
        placeholder={t("newSession.gitRepos.selectRepoPlaceholder")}
        placeholderTextColor={theme.colors.textSecondary}
        editable={false}
      />

      <Text style={[styles.label, { color: theme.colors.text }]}> 
        {t("newSession.gitRepos.targetDirLabel")}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: theme.colors.divider,
            color: theme.colors.text,
            backgroundColor: theme.colors.input.background,
          },
        ]}
        value={targetDir}
        onChangeText={setTargetDir}
        placeholder={t("newSession.gitRepos.targetDirPlaceholder")}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error && (
        <Text style={[styles.errorText, { color: theme.colors.accentOrange }]}> 
          {error}
        </Text>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          onPress={onClose}
          disabled={submitting}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.input.background,
              opacity: pressed || submitting ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: theme.colors.text }]}> 
            {t("common.cancel")}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          disabled={submitting || !selectedRepo || !selectedHost}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.textLink,
              opacity:
                pressed || submitting || !selectedRepo || !selectedHost
                  ? 0.8
                  : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : null}
          <Text style={[styles.buttonText, { color: "#fff" }]}> 
            {submitting
              ? t("newSession.gitRepos.cloning")
              : t("newSession.gitRepos.cloneRepo")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});
