import * as React from "react";
import {
  View,
  ActivityIndicator,
  Platform,
  TextInput,
  Pressable,
  RefreshControl,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemList } from "@/components/ItemList";
import { Typography } from "@/constants/Typography";
import {
  getGitStatusFiles,
  GitFileStatus,
  GitStatusFiles,
} from "@/sync/gitStatusFiles";
import { searchFiles, FileItem } from "@/sync/suggestionFile";
import {
  useSessionGitStatus,
  useSessionProjectGitStatus,
} from "@/sync/storage";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { FileIcon } from "@/components/FileIcon";
import { Modal } from "@/modal";
import {
  gitStageFiles,
  gitUnstageFiles,
  gitDiscardFiles,
  gitIgnoreFiles,
  gitCommit,
  gitStageAll,
  gitUnstageAll,
} from "@/sync/gitFileOps";

// Inline helper component for section header action buttons
const SectionButton = React.memo<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: any;
  primary?: boolean;
  destructive?: boolean;
}>(({ label, onPress, disabled, theme, primary, destructive }) => {
  const bgColor = primary
    ? theme.colors.accentPrimary
    : destructive
      ? theme.colors.textDestructive
      : theme.colors.surfaceHigh;
  const textColor = primary || destructive ? "#FFFFFF" : theme.colors.textLink;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: bgColor,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: textColor,
          ...Typography.default(),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
});

SectionButton.displayName = "SectionButton";

function renderCheckbox(checked: boolean, theme: any) {
  return (
    <Ionicons
      name={checked ? "checkbox" : "square-outline"}
      size={22}
      color={checked ? theme.colors.accentPrimary : theme.colors.textSecondary}
    />
  );
}

const SCROLL_COLLAPSE_THRESHOLD = 20;

const GitChangesTab = React.memo<{
  sessionId: string;
  repoPath?: string;
  onPullDown?: () => void;
  onScrollUp?: () => void;
}>(({ sessionId, repoPath, onPullDown, onScrollUp }) => {
  const router = useRouter();

  const [gitStatusFiles, setGitStatusFiles] =
    React.useState<GitStatusFiles | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [stagedCollapsed, setStagedCollapsed] = React.useState(false);
  const [unstagedCollapsed, setUnstagedCollapsed] = React.useState(false);
  const [collapsedSubmodules, setCollapsedSubmodules] = React.useState<
    Set<string>
  >(new Set());
  // Use project git status first, fallback to session git status for backward compatibility
  const projectGitStatus = useSessionProjectGitStatus(sessionId);
  const sessionGitStatus = useSessionGitStatus(sessionId);
  const gitStatus = projectGitStatus || sessionGitStatus;
  const { theme } = useUnistyles();

  // Selection mode state
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedFiles, setSelectedFiles] = React.useState<Set<string>>(
    new Set(),
  );
  const [activeOp, setActiveOp] = React.useState<string | null>(null);

  // Exit selection mode when git status changes
  React.useEffect(() => {
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedFiles(new Set());
    }
  }, [gitStatus?.lastUpdatedAt]);

  const toggleFileSelection = React.useCallback((fullPath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      // Auto-exit selection mode when all files deselected
      if (next.size === 0) {
        setSelectionMode(false);
      }
      return next;
    });
  }, []);

  const enterSelectionMode = React.useCallback((fullPath: string) => {
    setSelectionMode(true);
    setSelectedFiles(new Set([fullPath]));
  }, []);

  const exitSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedFiles(new Set());
  }, []);

  // Derive selected file info for toolbar
  const selectedFileInfo = React.useMemo(() => {
    if (!gitStatusFiles || selectedFiles.size === 0) {
      return {
        staged: [] as GitFileStatus[],
        unstaged: [] as GitFileStatus[],
      };
    }
    const staged = gitStatusFiles.stagedFiles.filter((f) =>
      selectedFiles.has(f.fullPath),
    );
    const unstaged = gitStatusFiles.unstagedFiles.filter((f) =>
      selectedFiles.has(f.fullPath),
    );
    return { staged, unstaged };
  }, [gitStatusFiles, selectedFiles]);

  // Load git status files — declared before handleOp so it can be referenced
  const loadGitStatusFiles = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await getGitStatusFiles(sessionId, repoPath);
      setGitStatusFiles(result);
    } catch {
      setGitStatusFiles(null);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, repoPath]);

  // Git operation wrapper — uses pre-resolved failedMessage string to avoid dynamic t() calls
  const handleOp = React.useCallback(
    async (
      failedMessage: string,
      action: () => Promise<{ success: boolean; error?: string }>,
    ) => {
      if (activeOp) return;
      setActiveOp("running");
      try {
        const result = await action();
        if (!result.success) {
          Modal.alert(t("common.error"), result.error ?? failedMessage);
        }
        await loadGitStatusFiles();
        exitSelectionMode();
      } catch {
        Modal.alert(t("common.error"), failedMessage);
      } finally {
        setActiveOp(null);
      }
    },
    [activeOp, loadGitStatusFiles, exitSelectionMode],
  );

  const handleStageSelected = React.useCallback(() => {
    const paths = selectedFileInfo.unstaged.map((f) => f.fullPath);
    if (paths.length === 0) return;
    handleOp(t("git.stageFailed"), () =>
      gitStageFiles(sessionId, paths, repoPath),
    );
  }, [selectedFileInfo.unstaged, sessionId, repoPath, handleOp]);

  const handleUnstageSelected = React.useCallback(() => {
    const paths = selectedFileInfo.staged.map((f) => f.fullPath);
    if (paths.length === 0) return;
    handleOp(t("git.unstageFailed"), () =>
      gitUnstageFiles(sessionId, paths, repoPath),
    );
  }, [selectedFileInfo.staged, sessionId, repoPath, handleOp]);

  const handleDiscardSelected = React.useCallback(async () => {
    const files = selectedFileInfo.unstaged;
    if (files.length === 0) return;
    const confirmed = await Modal.confirm(
      t("git.discardConfirmTitle"),
      t("git.discardConfirmMessage", { count: files.length }),
      { destructive: true },
    );
    if (!confirmed) return;
    handleOp(t("git.discardFailed"), () =>
      gitDiscardFiles(sessionId, files, repoPath),
    );
  }, [selectedFileInfo.unstaged, sessionId, repoPath, handleOp]);

  const handleGitignoreSelected = React.useCallback(() => {
    const paths = [
      ...selectedFileInfo.unstaged.map((f) => f.fullPath),
      ...selectedFileInfo.staged.map((f) => f.fullPath),
    ];
    if (paths.length === 0) return;
    handleOp(t("git.gitignoreFailed"), () =>
      gitIgnoreFiles(sessionId, paths, repoPath),
    );
  }, [selectedFileInfo, sessionId, repoPath, handleOp]);

  const handleStageAll = React.useCallback(() => {
    handleOp(t("git.stageFailed"), () => gitStageAll(sessionId, repoPath));
  }, [sessionId, repoPath, handleOp]);

  const handleUnstageAll = React.useCallback(() => {
    handleOp(t("git.unstageFailed"), () => gitUnstageAll(sessionId, repoPath));
  }, [sessionId, repoPath, handleOp]);

  const handleDiscardAll = React.useCallback(async () => {
    const confirmed = await Modal.confirm(
      t("git.discardConfirmTitle"),
      t("git.discardAllConfirmMessage"),
      { destructive: true },
    );
    if (!confirmed) return;
    if (!gitStatusFiles) return;
    handleOp(t("git.discardFailed"), () =>
      gitDiscardFiles(sessionId, gitStatusFiles.unstagedFiles, repoPath),
    );
  }, [sessionId, repoPath, gitStatusFiles, handleOp]);

  const handleCommit = React.useCallback(async () => {
    if (!gitStatusFiles || gitStatusFiles.stagedFiles.length === 0) {
      Modal.alert(t("common.error"), t("git.noStagedFiles"));
      return;
    }
    const message = await Modal.prompt(t("git.commit"), undefined, {
      placeholder: t("git.commitMessagePlaceholder"),
    });
    if (!message) return;
    handleOp(t("git.commitFailed"), () =>
      gitCommit(sessionId, message, repoPath),
    );
  }, [sessionId, repoPath, gitStatusFiles, handleOp]);

  // Load on mount
  React.useEffect(() => {
    loadGitStatusFiles();
  }, [loadGitStatusFiles]);

  // Refresh when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      loadGitStatusFiles();
    }, [loadGitStatusFiles]),
  );

  // Handle search and file loading
  React.useEffect(() => {
    const loadFiles = async () => {
      if (!sessionId) return;

      try {
        setIsSearching(true);
        const results = await searchFiles(sessionId, searchQuery, {
          limit: 100,
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    // Load files when searching or when repo is clean (including submodules)
    // But NOT in child repo mode (non-git parent with child repos)
    const hasSubmoduleChanges = gitStatusFiles?.submodules?.some(
      (s) => s.totalStaged > 0 || s.totalUnstaged > 0,
    );
    const isChildMode =
      gitStatusFiles !== null &&
      gitStatusFiles.branch === null &&
      (gitStatusFiles.submodules?.length ?? 0) > 0;
    const shouldShowAllFiles =
      searchQuery ||
      (!isChildMode &&
        gitStatusFiles?.totalStaged === 0 &&
        gitStatusFiles?.totalUnstaged === 0 &&
        !hasSubmoduleChanges);

    if (shouldShowAllFiles && !isLoading) {
      loadFiles();
    } else if (!searchQuery) {
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [searchQuery, gitStatusFiles, sessionId, isLoading]);

  const handleFilePress = React.useCallback(
    (file: GitFileStatus | FileItem) => {
      const encodedPath = btoa(file.fullPath);
      router.push(`/session/${sessionId}/file?path=${encodedPath}`);
    },
    [router, sessionId],
  );

  const renderFileIcon = (file: GitFileStatus) => {
    return <FileIcon fileName={file.fileName} size={32} />;
  };

  const renderStatusIcon = (file: GitFileStatus) => {
    let statusColor: string;
    let statusIcon: string;

    switch (file.status) {
      case "modified":
        statusColor = "#FF9500";
        statusIcon = "diff-modified";
        break;
      case "added":
        statusColor = "#34C759";
        statusIcon = "diff-added";
        break;
      case "deleted":
        statusColor = "#FF3B30";
        statusIcon = "diff-removed";
        break;
      case "renamed":
        statusColor = "#007AFF";
        statusIcon = "arrow-right";
        break;
      case "untracked":
        statusColor = theme.dark ? "#b0b0b0" : "#8E8E93";
        statusIcon = "file";
        break;
      default:
        return null;
    }

    return <Octicons name={statusIcon as any} size={16} color={statusColor} />;
  };

  const renderLineChanges = (file: GitFileStatus) => {
    const parts = [];
    if (file.linesAdded > 0) {
      parts.push(`+${file.linesAdded}`);
    }
    if (file.linesRemoved > 0) {
      parts.push(`-${file.linesRemoved}`);
    }
    return parts.length > 0 ? parts.join(" ") : "";
  };

  const renderFileSubtitle = (file: GitFileStatus) => {
    const lineChanges = renderLineChanges(file);
    const pathPart = file.filePath || t("files.projectRoot");
    return lineChanges ? `${pathPart} • ${lineChanges}` : pathPart;
  };

  const renderFileIconForSearch = (file: FileItem) => {
    if (file.fileType === "folder") {
      return <Octicons name="file-directory" size={29} color="#007AFF" />;
    }
    return <FileIcon fileName={file.fileName} size={29} />;
  };

  const toggleSubmoduleCollapsed = React.useCallback((path: string) => {
    setCollapsedSubmodules((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Determine if this is a non-git parent with child repos
  const isChildRepoMode =
    gitStatusFiles !== null &&
    gitStatusFiles.branch === null &&
    (gitStatusFiles.submodules?.length ?? 0) > 0;

  // File item rendering with selection support
  const renderGitFileItem = (
    file: GitFileStatus,
    key: string,
    showDivider: boolean,
  ) => (
    <Item
      key={key}
      title={file.fileName}
      subtitle={renderFileSubtitle(file)}
      icon={
        selectionMode
          ? renderCheckbox(selectedFiles.has(file.fullPath), theme)
          : renderFileIcon(file)
      }
      rightElement={renderStatusIcon(file)}
      onPress={
        selectionMode
          ? () => toggleFileSelection(file.fullPath)
          : () => handleFilePress(file)
      }
      onLongPress={
        selectionMode ? undefined : () => enterSelectionMode(file.fullPath)
      }
      showDivider={showDivider}
    />
  );

  const scrollCollapseCalledRef = React.useRef(false);
  const handleScroll = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!onScrollUp) return;
      const y = e.nativeEvent.contentOffset.y;
      if (y > SCROLL_COLLAPSE_THRESHOLD && !scrollCollapseCalledRef.current) {
        scrollCollapseCalledRef.current = true;
        onScrollUp();
      } else if (y <= 0) {
        scrollCollapseCalledRef.current = false;
      }
    },
    [onScrollUp],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {/* Search Input - Always Visible */}
      <View
        style={{
          padding: 16,
          borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
          borderBottomColor: theme.colors.divider,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: theme.colors.input.background,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Octicons
            name="search"
            size={16}
            color={theme.colors.textSecondary}
            style={{ marginRight: 8 }}
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("files.searchPlaceholder")}
            style={{
              flex: 1,
              fontSize: 16,
              ...Typography.default(),
            }}
            placeholderTextColor={theme.colors.input.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Header with branch info or child repos summary */}
      {!isLoading && gitStatusFiles && (
        <View
          style={{
            padding: 16,
            borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderBottomColor: theme.colors.divider,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Octicons
              name={isChildRepoMode ? "repo-forked" : "git-branch"}
              size={16}
              color={theme.colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: theme.colors.text,
                ...Typography.default(),
              }}
            >
              {isChildRepoMode
                ? t("files.childReposSummary", {
                    count: gitStatusFiles.submodules?.length ?? 0,
                  })
                : gitStatusFiles.branch || t("files.detachedHead")}
            </Text>
          </View>
          {!isChildRepoMode && (
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {t("files.summary", {
                staged: gitStatusFiles.totalStaged,
                unstaged: gitStatusFiles.totalUnstaged,
              })}
            </Text>
          )}
        </View>
      )}

      {/* Git Status List */}
      <ItemList
        style={{ flex: 1 }}
        onScroll={onScrollUp ? handleScroll : undefined}
        scrollEventThrottle={onScrollUp ? 16 : undefined}
        refreshControl={
          onPullDown ? (
            <RefreshControl refreshing={false} onRefresh={onPullDown} />
          ) : undefined
        }
      >
        {isLoading ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              paddingTop: 40,
            }}
          >
            <ActivityIndicator
              size="small"
              color={theme.colors.textSecondary}
            />
          </View>
        ) : !gitStatusFiles ? (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              paddingTop: 40,
              paddingHorizontal: 20,
            }}
          >
            <Octicons
              name="git-branch"
              size={48}
              color={theme.colors.textSecondary}
            />
            <Text
              style={{
                fontSize: 16,
                color: theme.colors.textSecondary,
                textAlign: "center",
                marginTop: 16,
                ...Typography.default(),
              }}
            >
              {t("files.notRepo")}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                textAlign: "center",
                marginTop: 8,
                ...Typography.default(),
              }}
            >
              {t("files.notUnderGit")}
            </Text>
          </View>
        ) : searchQuery ||
          (gitStatusFiles.totalStaged === 0 &&
            gitStatusFiles.totalUnstaged === 0 &&
            !isChildRepoMode) ? (
          // Show search results or all files when clean repo
          isSearching ? (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                paddingTop: 40,
              }}
            >
              <ActivityIndicator
                size="small"
                color={theme.colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 16,
                  color: theme.colors.textSecondary,
                  textAlign: "center",
                  marginTop: 16,
                  ...Typography.default(),
                }}
              >
                {t("files.searching")}
              </Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                paddingTop: 40,
                paddingHorizontal: 20,
              }}
            >
              <Octicons
                name={searchQuery ? "search" : "file-directory"}
                size={48}
                color={theme.colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 16,
                  color: theme.colors.textSecondary,
                  textAlign: "center",
                  marginTop: 16,
                  ...Typography.default(),
                }}
              >
                {searchQuery
                  ? t("files.noFilesFound")
                  : t("files.noFilesInProject")}
              </Text>
              {searchQuery && (
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: "center",
                    marginTop: 8,
                    ...Typography.default(),
                  }}
                >
                  {t("files.tryDifferentTerm")}
                </Text>
              )}
            </View>
          ) : (
            <>
              {searchQuery && (
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: Platform.select({
                      ios: 0.33,
                      default: 1,
                    }),
                    borderBottomColor: theme.colors.divider,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: theme.colors.textLink,
                      ...Typography.default(),
                    }}
                  >
                    {t("files.searchResults", {
                      count: searchResults.length,
                    })}
                  </Text>
                </View>
              )}
              {searchResults.map((file, index) => (
                <Item
                  key={`file-${file.fullPath}-${index}`}
                  title={file.fileName}
                  subtitle={file.filePath || t("files.projectRoot")}
                  icon={renderFileIconForSearch(file)}
                  onPress={() => handleFilePress(file)}
                  showDivider={index < searchResults.length - 1}
                />
              ))}
            </>
          )
        ) : (
          <>
            {/* Staged Changes Section */}
            {gitStatusFiles.stagedFiles.length > 0 && (
              <>
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderBottomWidth: Platform.select({
                      ios: 0.33,
                      default: 1,
                    }),
                    borderBottomColor: theme.colors.divider,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Pressable
                    onPress={() => setStagedCollapsed((v) => !v)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: theme.colors.success,
                        ...Typography.default(),
                      }}
                    >
                      {t("files.stagedChanges", {
                        count: gitStatusFiles.stagedFiles.length,
                      })}
                    </Text>
                    <Ionicons
                      name={
                        stagedCollapsed ? "chevron-forward" : "chevron-down"
                      }
                      size={16}
                      color={theme.colors.textSecondary}
                      style={{ marginLeft: 4 }}
                    />
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <SectionButton
                      label={t("git.unstageAll")}
                      onPress={handleUnstageAll}
                      disabled={activeOp !== null}
                      theme={theme}
                    />
                    <SectionButton
                      label={t("git.commit")}
                      onPress={handleCommit}
                      disabled={activeOp !== null}
                      theme={theme}
                      primary
                    />
                  </View>
                </View>
                {!stagedCollapsed &&
                  gitStatusFiles.stagedFiles.map((file, index) =>
                    renderGitFileItem(
                      file,
                      `staged-${file.fullPath}-${index}`,
                      index < gitStatusFiles.stagedFiles.length - 1 ||
                        gitStatusFiles.unstagedFiles.length > 0,
                    ),
                  )}
              </>
            )}

            {/* Unstaged Changes Section */}
            {gitStatusFiles.unstagedFiles.length > 0 && (
              <>
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceHigh,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderBottomWidth: Platform.select({
                      ios: 0.33,
                      default: 1,
                    }),
                    borderBottomColor: theme.colors.divider,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Pressable
                    onPress={() => setUnstagedCollapsed((v) => !v)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: theme.colors.warning,
                        ...Typography.default(),
                      }}
                    >
                      {t("files.unstagedChanges", {
                        count: gitStatusFiles.unstagedFiles.length,
                      })}
                    </Text>
                    <Ionicons
                      name={
                        unstagedCollapsed ? "chevron-forward" : "chevron-down"
                      }
                      size={16}
                      color={theme.colors.textSecondary}
                      style={{ marginLeft: 4 }}
                    />
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <SectionButton
                      label={t("git.stageAll")}
                      onPress={handleStageAll}
                      disabled={activeOp !== null}
                      theme={theme}
                    />
                    <SectionButton
                      label={t("git.discardAll")}
                      onPress={handleDiscardAll}
                      disabled={activeOp !== null}
                      theme={theme}
                      destructive
                    />
                  </View>
                </View>
                {!unstagedCollapsed &&
                  gitStatusFiles.unstagedFiles.map((file, index) =>
                    renderGitFileItem(
                      file,
                      `unstaged-${file.fullPath}-${index}`,
                      index < gitStatusFiles.unstagedFiles.length - 1,
                    ),
                  )}
              </>
            )}

            {/* Submodule / Child Repo Sections */}
            {gitStatusFiles.submodules?.map((submodule) => {
              if (!submodule.initialized) {
                return (
                  <View
                    key={`submodule-${submodule.path}`}
                    style={{
                      backgroundColor: theme.colors.surfaceHigh,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderBottomWidth: Platform.select({
                        ios: 0.33,
                        default: 1,
                      }),
                      borderBottomColor: theme.colors.divider,
                      marginTop: 8,
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <Octicons
                      name={"repo-forked" as any}
                      size={13}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        color: theme.colors.textSecondary,
                        ...Typography.default(),
                      }}
                    >
                      {submodule.path} — {t("files.submoduleNotInitialized")}
                    </Text>
                  </View>
                );
              }

              const hasChanges =
                submodule.totalStaged > 0 || submodule.totalUnstaged > 0;
              if (!hasChanges && !isChildRepoMode) return null;

              const isCollapsed = collapsedSubmodules.has(submodule.path);

              const headerContent = (
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginBottom: 2,
                    }}
                  >
                    <Octicons
                      name={"repo-forked" as any}
                      size={13}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: theme.colors.text,
                        ...Typography.default(),
                      }}
                    >
                      {isChildRepoMode
                        ? submodule.path
                        : `${t("files.submodule")}: ${submodule.path}`}
                    </Text>
                  </View>
                  {submodule.branch && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginLeft: 19,
                      }}
                    >
                      <Octicons
                        name="git-branch"
                        size={11}
                        color={theme.colors.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          color: theme.colors.textSecondary,
                          ...Typography.default(),
                        }}
                      >
                        {submodule.branch}
                      </Text>
                    </View>
                  )}
                </View>
              );

              const headerStyle = {
                backgroundColor: theme.colors.surfaceHigh,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderBottomWidth: Platform.select({
                  ios: 0.33,
                  default: 1,
                }) as number,
                borderBottomColor: theme.colors.divider,
                marginTop: 8,
                flexDirection: "row" as const,
                alignItems: "center" as const,
                justifyContent: "space-between" as const,
              };

              return (
                <React.Fragment key={`submodule-${submodule.path}`}>
                  {hasChanges ? (
                    <Pressable
                      onPress={() => toggleSubmoduleCollapsed(submodule.path)}
                      style={headerStyle}
                    >
                      {headerContent}
                      <Ionicons
                        name={isCollapsed ? "chevron-forward" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                      />
                    </Pressable>
                  ) : (
                    <View style={headerStyle}>
                      {headerContent}
                      <Text
                        style={{
                          fontSize: 11,
                          color: theme.colors.textSecondary,
                          ...Typography.default(),
                        }}
                      >
                        {t("files.noChanges")}
                      </Text>
                    </View>
                  )}

                  {!isCollapsed && submodule.stagedFiles.length > 0 && (
                    <>
                      <View
                        style={{
                          backgroundColor: theme.colors.surfaceHigh,
                          paddingHorizontal: 24,
                          paddingVertical: 8,
                          borderBottomWidth: Platform.select({
                            ios: 0.33,
                            default: 1,
                          }),
                          borderBottomColor: theme.colors.divider,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: theme.colors.success,
                            ...Typography.default(),
                          }}
                        >
                          {t("files.stagedChanges", {
                            count: submodule.stagedFiles.length,
                          })}
                        </Text>
                      </View>
                      {submodule.stagedFiles.map((file, idx) => (
                        <Item
                          key={`sub-${submodule.path}-staged-${file.fullPath}-${idx}`}
                          title={file.fileName}
                          subtitle={renderFileSubtitle(file)}
                          icon={renderFileIcon(file)}
                          rightElement={renderStatusIcon(file)}
                          onPress={() => handleFilePress(file)}
                          showDivider={
                            idx < submodule.stagedFiles.length - 1 ||
                            submodule.unstagedFiles.length > 0
                          }
                        />
                      ))}
                    </>
                  )}

                  {!isCollapsed && submodule.unstagedFiles.length > 0 && (
                    <>
                      <View
                        style={{
                          backgroundColor: theme.colors.surfaceHigh,
                          paddingHorizontal: 24,
                          paddingVertical: 8,
                          borderBottomWidth: Platform.select({
                            ios: 0.33,
                            default: 1,
                          }),
                          borderBottomColor: theme.colors.divider,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: theme.colors.warning,
                            ...Typography.default(),
                          }}
                        >
                          {t("files.unstagedChanges", {
                            count: submodule.unstagedFiles.length,
                          })}
                        </Text>
                      </View>
                      {submodule.unstagedFiles.map((file, idx) => (
                        <Item
                          key={`sub-${submodule.path}-unstaged-${file.fullPath}-${idx}`}
                          title={file.fileName}
                          subtitle={renderFileSubtitle(file)}
                          icon={renderFileIcon(file)}
                          rightElement={renderStatusIcon(file)}
                          onPress={() => handleFilePress(file)}
                          showDivider={idx < submodule.unstagedFiles.length - 1}
                        />
                      ))}
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </ItemList>

      {/* Selection mode floating toolbar */}
      {selectionMode && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: theme.colors.surfaceHigh,
            borderTopWidth: Platform.select({ ios: 0.33, default: 1 }),
            borderTopColor: theme.colors.divider,
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingBottom: Platform.select({ ios: 28, default: 12 }),
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: theme.colors.text,
                ...Typography.default(),
              }}
            >
              {t("git.selectedCount", { count: selectedFiles.size })}
            </Text>
            <Pressable onPress={exitSelectionMode}>
              <Text
                style={{
                  fontSize: 14,
                  color: theme.colors.textLink,
                  ...Typography.default(),
                }}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {selectedFileInfo.unstaged.length > 0 && (
              <SectionButton
                label={t("git.stage")}
                onPress={handleStageSelected}
                disabled={activeOp !== null}
                theme={theme}
                primary
              />
            )}
            {selectedFileInfo.staged.length > 0 && (
              <SectionButton
                label={t("git.unstage")}
                onPress={handleUnstageSelected}
                disabled={activeOp !== null}
                theme={theme}
              />
            )}
            {selectedFileInfo.unstaged.length > 0 && (
              <SectionButton
                label={t("git.discard")}
                onPress={handleDiscardSelected}
                disabled={activeOp !== null}
                theme={theme}
                destructive
              />
            )}
            <SectionButton
              label={t("git.addToGitignore")}
              onPress={handleGitignoreSelected}
              disabled={activeOp !== null}
              theme={theme}
            />
          </View>
        </View>
      )}
    </View>
  );
});

GitChangesTab.displayName = "GitChangesTab";

export { GitChangesTab };

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
}));
