import * as React from "react";
import { View, Pressable, ActivityIndicator, Platform } from "react-native";
import { Octicons, Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import { gitFetch, gitPull, gitPush } from "@/sync/gitRemoteOps";
import { Modal } from "@/modal";
import type { GitStatus } from "@/sync/storageTypes";

interface GitBranchHeaderProps {
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly gitStatus: GitStatus | null;
}

type GitRemoteOp = "fetch" | "pull" | "push";

const OP_FNS = { fetch: gitFetch, pull: gitPull, push: gitPush } as const;

const OP_SUCCESS_KEYS = {
  fetch: "git.fetchSuccess",
  pull: "git.pullSuccess",
  push: "git.pushSuccess",
} as const;

const OP_FAILED_KEYS = {
  fetch: "git.fetchFailed",
  pull: "git.pullFailed",
  push: "git.pushFailed",
} as const;

export const GitBranchHeader = React.memo<GitBranchHeaderProps>(
  function GitBranchHeader({ sessionId, repoPath, gitStatus }) {
    const { theme } = useUnistyles();
    const [activeOp, setActiveOp] = React.useState<GitRemoteOp | null>(null);
    const [autoFetching, setAutoFetching] = React.useState(false);

    const branch = gitStatus?.branch ?? null;
    const upstream = gitStatus?.upstreamBranch ?? null;
    const aheadCount = gitStatus?.aheadCount ?? 0;
    const behindCount = gitStatus?.behindCount ?? 0;

    // Auto-fetch on mount to get latest remote tracking info
    React.useEffect(() => {
      let cancelled = false;
      const doFetch = async () => {
        setAutoFetching(true);
        try {
          await gitFetch(sessionId, repoPath);
        } catch {
          // Silently ignore — user can manually fetch
        } finally {
          if (!cancelled) {
            setAutoFetching(false);
          }
        }
      };
      doFetch();
      return () => {
        cancelled = true;
      };
    }, [sessionId, repoPath]);

    const handleOp = React.useCallback(
      async (op: GitRemoteOp) => {
        if (activeOp !== null) return;

        setActiveOp(op);
        try {
          const result = await OP_FNS[op](sessionId, repoPath);

          if (!result.success) {
            Modal.alert(
              t("common.error"),
              result.error ?? t(OP_FAILED_KEYS[op]),
            );
            return;
          }

          const message = result.output
            ? `${t(OP_SUCCESS_KEYS[op])}\n\n${result.output}`
            : t(OP_SUCCESS_KEYS[op]);
          Modal.alert(t("common.success"), message);
        } catch {
          Modal.alert(t("common.error"), t(OP_FAILED_KEYS[op]));
        } finally {
          setActiveOp(null);
        }
      },
      [sessionId, repoPath, activeOp],
    );

    if (!gitStatus || gitStatus.lastUpdatedAt === 0 || !branch) {
      return null;
    }

    const hasUpstream = upstream !== null;

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surfaceHigh,
            borderBottomColor: theme.colors.divider,
          },
        ]}
      >
        {/* Branch info */}
        <View style={styles.branchInfo}>
          <Octicons name="git-branch" size={16} color={theme.colors.textLink} />
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: theme.colors.text,
              ...Typography.mono(),
            }}
            numberOfLines={1}
          >
            {branch}
          </Text>
          {hasUpstream && (
            <>
              <Ionicons
                name="arrow-forward"
                size={12}
                color={theme.colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  ...Typography.mono(),
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                {upstream}
              </Text>
            </>
          )}

          {/* Ahead/behind counts */}
          {hasUpstream && (aheadCount > 0 || behindCount > 0) && (
            <View style={styles.trackingInfo}>
              {aheadCount > 0 && (
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: theme.colors.textLink,
                    ...Typography.mono(),
                  }}
                >
                  ↑{aheadCount}
                </Text>
              )}
              {behindCount > 0 && (
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: theme.colors.box.warning.text,
                    ...Typography.mono(),
                  }}
                >
                  ↓{behindCount}
                </Text>
              )}
            </View>
          )}

          {autoFetching && (
            <ActivityIndicator size={12} color={theme.colors.textSecondary} />
          )}

          {hasUpstream &&
            aheadCount === 0 &&
            behindCount === 0 &&
            !autoFetching && (
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.success,
                  ...Typography.default(),
                }}
              >
                {t("git.upToDate")}
              </Text>
            )}

          {!hasUpstream && (
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.textSecondary,
                fontStyle: "italic",
                ...Typography.default(),
              }}
            >
              {t("git.noUpstreamHint")}
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <OpButton
            label={t("git.fetch")}
            icon="cloud-download-outline"
            loading={activeOp === "fetch"}
            disabled={activeOp !== null}
            onPress={() => handleOp("fetch")}
            theme={theme}
          />
          {hasUpstream && (
            <OpButton
              label={t("git.pull")}
              icon="download-outline"
              loading={activeOp === "pull"}
              disabled={activeOp !== null}
              onPress={() => handleOp("pull")}
              theme={theme}
            />
          )}
          {hasUpstream && (
            <OpButton
              label={t("git.push")}
              icon="push-outline"
              loading={activeOp === "push"}
              disabled={activeOp !== null}
              onPress={() => handleOp("push")}
              theme={theme}
            />
          )}
        </View>
      </View>
    );
  },
);

function OpButton({
  label,
  icon,
  loading,
  disabled,
  onPress,
  theme,
}: {
  readonly label: string;
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly theme: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={(p) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: p.pressed
          ? theme.colors.surfaceHigher
          : theme.colors.surface,
        opacity: disabled && !loading ? 0.5 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size={14} color={theme.colors.textLink} />
      ) : (
        <Ionicons name={icon} size={14} color={theme.colors.textLink} />
      )}
      <Text
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: theme.colors.textLink,
          ...Typography.default(),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
    gap: 8,
  },
  branchInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  trackingInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
}));
