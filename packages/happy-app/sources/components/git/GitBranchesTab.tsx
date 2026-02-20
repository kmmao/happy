import * as React from "react";
import {
  View,
  ActivityIndicator,
  Pressable,
  Platform,
  RefreshControl,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Item } from "@/components/Item";
import { ItemList } from "@/components/ItemList";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { Modal } from "@/modal";
import {
  fetchGitBranches,
  checkoutBranch,
  createBranch,
  GitBranch,
  GitBranchList,
} from "@/sync/gitBranches";

const SCROLL_COLLAPSE_THRESHOLD = 20;

interface GitBranchesTabProps {
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly onPullDown?: () => void;
  readonly onScrollUp?: () => void;
}

export const GitBranchesTab = React.memo<GitBranchesTabProps>(
  function GitBranchesTab({ sessionId, repoPath, onPullDown, onScrollUp }) {
    const { theme } = useUnistyles();
    const [branches, setBranches] = React.useState<GitBranchList | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [localCollapsed, setLocalCollapsed] = React.useState(false);
    const [remoteCollapsed, setRemoteCollapsed] = React.useState(false);
    const [operatingBranch, setOperatingBranch] = React.useState<string | null>(
      null,
    );
    const [isCreating, setIsCreating] = React.useState(false);

    const loadBranches = React.useCallback(async () => {
      try {
        setIsLoading(true);
        const result = await fetchGitBranches(sessionId, repoPath);
        setBranches(result);
      } catch {
        setBranches(null);
      } finally {
        setIsLoading(false);
      }
    }, [sessionId, repoPath]);

    // Load on mount
    React.useEffect(() => {
      loadBranches();
    }, [loadBranches]);

    // Refresh when screen is focused
    useFocusEffect(
      React.useCallback(() => {
        loadBranches();
      }, [loadBranches]),
    );

    const handleCheckout = React.useCallback(
      async (branch: GitBranch) => {
        if (branch.isCurrent || operatingBranch !== null) return;

        setOperatingBranch(branch.name);
        try {
          const result = await checkoutBranch(
            sessionId,
            branch.name,
            branch.type,
            repoPath,
          );

          if (!result.success) {
            const errorMessage =
              result.error === "dirty_working_tree"
                ? t("git.dirtyWorkingTree")
                : t("git.branchSwitchFailed");
            Modal.alert(t("common.error"), errorMessage);
            return;
          }

          const displayName =
            branch.type === "remote"
              ? branch.name.replace(/^[^/]+\//, "")
              : branch.name;
          Modal.alert(
            t("common.success"),
            t("git.switchBranchSuccess", { name: displayName }),
          );
          await loadBranches();
        } catch {
          Modal.alert(t("common.error"), t("git.branchSwitchFailed"));
        } finally {
          setOperatingBranch(null);
        }
      },
      [sessionId, repoPath, operatingBranch, loadBranches],
    );

    const handleCreateBranch = React.useCallback(async () => {
      if (isCreating) return;

      const branchName = await Modal.prompt(
        t("git.createBranch"),
        t("git.enterBranchName"),
        {
          placeholder: t("git.branchNamePlaceholder"),
          confirmText: t("git.createBranch"),
        },
      );

      if (!branchName) return;

      setIsCreating(true);
      try {
        const result = await createBranch(sessionId, branchName, repoPath);

        if (!result.success) {
          let errorMessage: string;
          if (result.error === "invalid_branch_name") {
            errorMessage = t("git.invalidBranchName");
          } else if (result.error === "branch_already_exists") {
            errorMessage = t("git.branchAlreadyExists", { name: branchName });
          } else {
            errorMessage = t("git.branchCreateFailed");
          }
          Modal.alert(t("common.error"), errorMessage);
          return;
        }

        Modal.alert(
          t("common.success"),
          t("git.createBranchSuccess", { name: branchName }),
        );
        await loadBranches();
      } catch {
        Modal.alert(t("common.error"), t("git.branchCreateFailed"));
      } finally {
        setIsCreating(false);
      }
    }, [sessionId, repoPath, isCreating, loadBranches]);

    const renderTrackingInfo = React.useCallback(
      (branch: GitBranch) => {
        if (!branch.upstream) {
          return null;
        }
        const parts: string[] = [];
        if (branch.aheadCount > 0) {
          parts.push(`\u2191${branch.aheadCount}`);
        }
        if (branch.behindCount > 0) {
          parts.push(`\u2193${branch.behindCount}`);
        }
        if (parts.length === 0) {
          return null;
        }
        return (
          <Text
            style={{
              fontSize: 13,
              color: theme.colors.textSecondary,
              ...Typography.mono(),
            }}
          >
            {parts.join(" ")}
          </Text>
        );
      },
      [theme],
    );

    const renderCurrentBadge = React.useCallback(() => {
      return (
        <View
          style={{
            backgroundColor: theme.colors.success + "20",
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 4,
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
            {t("git.currentBranch")}
          </Text>
        </View>
      );
    }, [theme]);

    const renderBranchRightElement = React.useCallback(
      (branch: GitBranch) => {
        if (branch.isCurrent) {
          const tracking = renderTrackingInfo(branch);
          if (tracking) {
            return (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {tracking}
                {renderCurrentBadge()}
              </View>
            );
          }
          return renderCurrentBadge();
        }
        return renderTrackingInfo(branch);
      },
      [renderTrackingInfo, renderCurrentBadge],
    );

    const renderBranchIcon = React.useCallback(
      (branch: GitBranch) => {
        if (branch.isCurrent) {
          return (
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={theme.colors.success}
            />
          );
        }
        if (branch.type === "remote") {
          return (
            <Octicons
              name="globe"
              size={20}
              color={theme.colors.textSecondary}
            />
          );
        }
        return (
          <Octicons
            name="git-branch"
            size={20}
            color={theme.colors.textSecondary}
          />
        );
      },
      [theme],
    );

    const hasNoBranches =
      branches !== null &&
      branches.local.length === 0 &&
      branches.remote.length === 0;

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
      <View
        style={[styles.container, { backgroundColor: theme.colors.surface }]}
      >
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
            <View style={styles.centerState}>
              <ActivityIndicator
                size="small"
                color={theme.colors.textSecondary}
              />
            </View>
          ) : hasNoBranches ? (
            <View style={styles.centerState}>
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
                {t("git.noBranches")}
              </Text>
            </View>
          ) : (
            <>
              {/* Local Branches Section */}
              {branches !== null && branches.local.length > 0 && (
                <>
                  <Pressable
                    onPress={() => setLocalCollapsed((v) => !v)}
                    style={{
                      backgroundColor: theme.colors.surfaceHigh,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
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
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: theme.colors.text,
                        ...Typography.default(),
                      }}
                    >
                      {`${t("git.localBranches")} (${branches.local.length})`}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleCreateBranch();
                        }}
                        hitSlop={8}
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <ActivityIndicator
                            size="small"
                            color={theme.colors.textLink}
                          />
                        ) : (
                          <Ionicons
                            name="add-circle-outline"
                            size={20}
                            color={theme.colors.textLink}
                          />
                        )}
                      </Pressable>
                      <Ionicons
                        name={
                          localCollapsed ? "chevron-forward" : "chevron-down"
                        }
                        size={16}
                        color={theme.colors.textSecondary}
                      />
                    </View>
                  </Pressable>
                  {!localCollapsed &&
                    branches.local.map((branch, index) => (
                      <Item
                        key={`local-${branch.name}`}
                        title={branch.name}
                        subtitle={branch.shortHash}
                        icon={renderBranchIcon(branch)}
                        rightElement={renderBranchRightElement(branch)}
                        showDivider={index < branches.local.length - 1}
                        onPress={
                          branch.isCurrent
                            ? undefined
                            : () => handleCheckout(branch)
                        }
                        disabled={branch.isCurrent}
                        loading={operatingBranch === branch.name}
                        showChevron={!branch.isCurrent}
                      />
                    ))}
                </>
              )}

              {/* Remote Branches Section */}
              {branches !== null && branches.remote.length > 0 && (
                <>
                  <Pressable
                    onPress={() => setRemoteCollapsed((v) => !v)}
                    style={{
                      backgroundColor: theme.colors.surfaceHigh,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
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
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: theme.colors.text,
                        ...Typography.default(),
                      }}
                    >
                      {`${t("git.remoteBranches")} (${branches.remote.length})`}
                    </Text>
                    <Ionicons
                      name={
                        remoteCollapsed ? "chevron-forward" : "chevron-down"
                      }
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                  {!remoteCollapsed &&
                    branches.remote.map((branch, index) => (
                      <Item
                        key={`remote-${branch.name}`}
                        title={branch.name}
                        subtitle={branch.shortHash}
                        icon={renderBranchIcon(branch)}
                        rightElement={renderTrackingInfo(branch)}
                        showDivider={index < branches.remote.length - 1}
                        onPress={() => handleCheckout(branch)}
                        loading={operatingBranch === branch.name}
                        showChevron={true}
                      />
                    ))}
                </>
              )}
            </>
          )}
        </ItemList>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center",
    width: "100%",
  },
  centerState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 20,
  },
}));
