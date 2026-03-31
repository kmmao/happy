import React, { useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { CommonActions, useNavigation } from "@react-navigation/native";
import { ItemGroup } from "@/components/ItemGroup";
import { Item } from "@/components/Item";
import { Typography } from "@/constants/Typography";
import { useAllMachines, useSessions, useSetting } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Modal } from "@/modal";
import {
  MultiTextInput,
  MultiTextInputHandle,
} from "@/components/MultiTextInput";
import { useGitRepoScanner } from "@/hooks/useGitRepoScanner";
import { CloneRepoModal } from "@/components/CloneRepoModal";
import {
  machineCloneGitRepo,
  machineListRemoteGitRepos,
} from "@/sync/ops";

const remoteRepoCache = new Map<string, readonly import("@/sync/ops").RemoteGitRepoEntry[]>();

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.groupped.background,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
  },
  contentWrapper: {
    width: "100%",
    maxWidth: layout.maxWidth,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: "center",
    ...Typography.default(),
  },
  pathInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  pathInput: {
    flex: 1,
    backgroundColor: theme.colors.input.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 36,
    position: "relative",
    borderWidth: 0.5,
    borderColor: theme.colors.divider,
  },
}));

function PathPickerScreen() {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    machineId?: string;
    selectedPath?: string;
  }>();
  const machines = useAllMachines();
  const sessions = useSessions();
  const inputRef = useRef<MultiTextInputHandle>(null);
  const recentMachinePaths = useSetting("recentMachinePaths");
  const recentRemoteRepos = useSetting("recentRemoteRepos");
  const lastUsedGitHost = useSetting("lastUsedGitHost");
  const gitHosts = useSetting("gitHosts") || [];

  const [customPath, setCustomPath] = useState(params.selectedPath || "");

  const {
    scanning,
    scanError,
    scanResults,
    showResults,
    searchQuery,
    setSearchQuery,
    filteredResults,
    handleScan,
  } = useGitRepoScanner(params.machineId);

  const MAX_VISIBLE_REPOS = 20;

  // Get the selected machine
  const machine = useMemo(() => {
    return machines.find((m) => m.id === params.machineId);
  }, [machines, params.machineId]);

  // Get recent paths for this machine - prioritize from settings, then fall back to sessions
  const recentPaths = useMemo(() => {
    if (!params.machineId) return [];

    // Filter out worktree/branch paths (e.g. .dev/worktree/*, .claude/worktrees/*)
    const isWorktreePath = (p: string) =>
      p.includes("/.dev/worktree/") || p.includes("/.claude/worktrees/");

    const paths: string[] = [];
    const pathSet = new Set<string>();

    // First, add paths from recentMachinePaths (these are the most recent)
    recentMachinePaths.forEach((entry) => {
      if (
        entry.machineId === params.machineId &&
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
          session.metadata?.machineId === params.machineId &&
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
  }, [sessions, params.machineId, recentMachinePaths]);

  const handleSelectPath = React.useCallback(() => {
    const pathToUse =
      customPath.trim() || machine?.metadata?.homeDir || "/home";
    // Pass path back via navigation params (main's pattern, received by new/index.tsx)
    const state = navigation.getState();
    const previousRoute = state?.routes?.[state.index - 1];
    if (state && state.index > 0 && previousRoute) {
      navigation.dispatch({
        ...CommonActions.setParams({ path: pathToUse }),
        source: previousRoute.key,
      } as never);
    }
    router.back();
  }, [customPath, router, machine, navigation]);

  const handleCloneRepo = React.useCallback(() => {
    const machineId = params.machineId;
    if (!machineId) return;

    Modal.show({
      component: CloneRepoModal,
      props: {
        initialTargetDir: customPath.trim() || machine?.metadata?.homeDir || "/home",
        gitHosts,
        lastUsedGitHost,
        recentRemoteRepos,
        onLoadRepos: async (
          host: (typeof gitHosts)[number],
          options?: { forceRefresh?: boolean },
        ) => {
          if (!host.apiToken) {
            throw new Error(t("newSession.gitRepos.noConfiguredHosts"));
          }

          const cacheKey = `${machineId}:${host.provider}:${host.host}`;
          if (!options?.forceRefresh) {
            const cachedRepos = remoteRepoCache.get(cacheKey);
            if (cachedRepos) {
              sync.applySettings({ lastUsedGitHost: host.host });
              return cachedRepos;
            }
          }

          const result = await machineListRemoteGitRepos({
            machineId,
            provider: host.provider,
            apiToken: host.apiToken,
            host: host.host,
          });
          if (!result.success) {
            throw new Error(
              result.error ||
                t("newSession.gitRepos.loadReposFailed", {
                  error: "Unknown error",
                }),
            );
          }
          const repos = result.repos || [];
          remoteRepoCache.set(cacheKey, repos);
          sync.applySettings({ lastUsedGitHost: host.host });
          return repos;
        },
        onClone: async ({
          repoUrl,
          targetDir,
          provider,
          apiToken,
          host,
        }: {
          repoUrl: string;
          targetDir: string;
          provider?: "github" | "gitea";
          apiToken?: string;
          host?: string;
        }) => {
          const result = await machineCloneGitRepo({
            machineId,
            repoUrl,
            targetDirectory: targetDir,
            provider,
            apiToken,
            host,
          });

          if (!result.success || !result.repoPath) {
            throw new Error(
              result.stderr?.trim() ||
                result.error ||
                t("newSession.gitRepos.cloneFailed", {
                  error: "Unknown error",
                }),
            );
          }

          const updatedRecentRemoteRepos = [
            {
              host: host || "",
              repoUrl,
              fullName: repoUrl.replace(/\.git$/, "").split("/").slice(-2).join("/"),
            },
            ...recentRemoteRepos.filter(
              (entry) => !(entry.host === (host || "") && entry.repoUrl === repoUrl),
            ),
          ].slice(0, 12);

          sync.applySettings({
            lastUsedGitHost: host || null,
            recentRemoteRepos: updatedRecentRemoteRepos,
          });
          setCustomPath(result.repoPath);
          setTimeout(() => inputRef.current?.focus(), 50);
          Modal.toast(t("newSession.gitRepos.cloneSuccess"));
        },
      },
    });
  }, [customPath, gitHosts, lastUsedGitHost, machine?.metadata?.homeDir, params.machineId, recentRemoteRepos]);

  if (!machine) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: t("pickPath.selectPath"),
            headerBackTitle: t("common.back"),
            headerRight: () => (
              <Pressable
                onPress={handleSelectPath}
                disabled={!customPath.trim()}
                style={({ pressed }) => ({
                  marginRight: 16,
                  opacity: pressed ? 0.7 : 1,
                  padding: 4,
                })}
              >
                <Ionicons
                  name="checkmark"
                  size={24}
                  color={theme.colors.header.tint}
                />
              </Pressable>
            ),
          }}
        />
        <View style={styles.container}>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t("pickPath.noMachineSelected")}</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("pickPath.selectPath"),
          headerBackTitle: t("common.back"),
          headerRight: () => (
            <Pressable
              onPress={handleSelectPath}
              disabled={!customPath.trim()}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                padding: 4,
              })}
            >
              <Ionicons
                name="checkmark"
                size={24}
                color={theme.colors.header.tint}
              />
            </Pressable>
          ),
        }}
      />
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contentWrapper}>
            <ItemGroup title={t("pickPath.enterPath")}>
              <View style={styles.pathInputContainer}>
                <View style={[styles.pathInput, { paddingVertical: 8 }]}>
                  <MultiTextInput
                    ref={inputRef}
                    value={customPath}
                    onChangeText={setCustomPath}
                    placeholder={t("pickPath.enterPathPlaceholder")}
                    maxHeight={76}
                    paddingTop={8}
                    paddingBottom={8}
                    // onSubmitEditing={handleSelectPath}
                    // blurOnSubmit={true}
                    // returnKeyType="done"
                  />
                </View>
              </View>
            </ItemGroup>

            <ItemGroup title={t("newSession.gitRepos.title")}>
              <Item
                title={t("newSession.gitRepos.cloneRepo")}
                subtitle={t("newSession.gitRepos.cloneDescription")}
                leftElement={
                  <Ionicons
                    name="cloud-download-outline"
                    size={18}
                    color={theme.colors.textLink}
                  />
                }
                onPress={handleCloneRepo}
                titleStyle={{ color: theme.colors.textLink }}
                showDivider
              />
              <Item
                title={
                  scanning ? t("gitHosts.scanning") : t("gitHosts.scanRepos")
                }
                leftElement={
                  scanning ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.textLink}
                    />
                  ) : (
                    <Ionicons
                      name="git-branch-outline"
                      size={18}
                      color={theme.colors.textLink}
                    />
                  )
                }
                onPress={handleScan}
                disabled={scanning}
                titleStyle={{ color: theme.colors.textLink }}
                showChevron={false}
                showDivider={showResults && filteredResults.length > 0}
              />
              {showResults && scanError && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.textSecondary,
                      textAlign: "center",
                      ...Typography.default(),
                    }}
                  >
                    {scanError}
                  </Text>
                </View>
              )}
              {showResults && scanResults.length > 0 && (
                <>
                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderBottomWidth: 0.5,
                      borderBottomColor: theme.colors.divider,
                    }}
                  >
                    <TextInput
                      style={{
                        fontSize: 14,
                        color: theme.colors.text,
                        padding: 0,
                        ...Typography.default(),
                      }}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder={t("gitHosts.scanSearchPlaceholder")}
                      placeholderTextColor={theme.colors.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  {filteredResults
                    .slice(0, MAX_VISIBLE_REPOS)
                    .map((entry, index) => {
                      const isSelected = customPath.trim() === entry.repoPath;
                      const isLast =
                        index ===
                        Math.min(filteredResults.length, MAX_VISIBLE_REPOS) - 1;

                      return (
                        <Item
                          key={entry.repoPath}
                          title={entry.name}
                          subtitle={entry.repoPath}
                          leftElement={
                            <Ionicons
                              name="folder-outline"
                              size={18}
                              color={theme.colors.textSecondary}
                            />
                          }
                          onPress={() => {
                            setCustomPath(entry.repoPath);
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                          selected={isSelected}
                          showChevron={false}
                          pressableStyle={
                            isSelected
                              ? {
                                  backgroundColor: theme.colors.surfaceSelected,
                                }
                              : undefined
                          }
                          showDivider={!isLast}
                        />
                      );
                    })}
                  {filteredResults.length > MAX_VISIBLE_REPOS && (
                    <View
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: theme.colors.textSecondary,
                          textAlign: "center",
                          ...Typography.default(),
                        }}
                      >
                        {t("newSession.gitRepos.showingCount", {
                          showing: MAX_VISIBLE_REPOS,
                          total: filteredResults.length,
                        })}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ItemGroup>

            {recentPaths.length > 0 && (
              <ItemGroup title={t("pickPath.recentPaths")}>
                {recentPaths.map((path, index) => {
                  const isSelected = customPath.trim() === path;
                  const isLast = index === recentPaths.length - 1;

                  return (
                    <Item
                      key={path}
                      title={path}
                      leftElement={
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={theme.colors.textSecondary}
                        />
                      }
                      onPress={() => {
                        setCustomPath(path);
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                      selected={isSelected}
                      showChevron={false}
                      pressableStyle={
                        isSelected
                          ? { backgroundColor: theme.colors.surfaceSelected }
                          : undefined
                      }
                      showDivider={!isLast}
                    />
                  );
                })}
              </ItemGroup>
            )}

            {recentPaths.length === 0 && (
              <ItemGroup title={t("pickPath.suggestedPaths")}>
                {(() => {
                  const homeDir = machine.metadata?.homeDir || "/home";
                  const suggestedPaths = [
                    homeDir,
                    `${homeDir}/projects`,
                    `${homeDir}/Documents`,
                    `${homeDir}/Desktop`,
                  ];
                  return suggestedPaths.map((path, index) => {
                    const isSelected = customPath.trim() === path;

                    return (
                      <Item
                        key={path}
                        title={path}
                        leftElement={
                          <Ionicons
                            name="folder-outline"
                            size={18}
                            color={theme.colors.textSecondary}
                          />
                        }
                        onPress={() => {
                          setCustomPath(path);
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                        selected={isSelected}
                        showChevron={false}
                        pressableStyle={
                          isSelected
                            ? { backgroundColor: theme.colors.surfaceSelected }
                            : undefined
                        }
                        showDivider={index < 3}
                      />
                    );
                  });
                })()}
              </ItemGroup>
            )}
          </View>
        </ScrollView>
      </View>
    </>
  );
}

export default React.memo(PathPickerScreen);
