import React from "react";
import {
  View,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Text } from "@/components/StyledText";
import { router, useRouter } from "expo-router";
import { Session, Machine } from "@/sync/storageTypes";
import { Ionicons } from "@expo/vector-icons";
import {
  getSessionName,
  useSessionStatus,
  getSessionAvatarId,
  formatPathRelativeToHome,
  getSessionProjectPath,
} from "@/utils/sessionUtils";
import { Avatar } from "./Avatar";
import { Typography } from "@/constants/Typography";
import { StatusDot } from "./StatusDot";
import {
  useAllMachines,
  useHasUnreadMessages,
  useMachine,
  useSetting,
} from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isMachineOnline } from "@/utils/machineUtils";
import { useSessionUpgrade } from "@/hooks/useSessionUpgrade";
import { machineSpawnNewSession, sessionKill, sessionDelete } from "@/sync/ops";
import { resolveAbsolutePath } from "@/utils/pathUtils";
import { storage } from "@/sync/storage";
import { Modal } from "@/modal";
import { t } from "@/text";
import { formatTokenCountShort } from "@/utils/formatUsage";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { useIsTablet } from "@/utils/responsive";
import { ProjectGitStatus } from "./ProjectGitStatus";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { useIssueSessionBySessionId } from "@/sync/issueSessionStore";
import {
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";

const stylesheet = StyleSheet.create((theme, runtime) => ({
  container: {
    backgroundColor: theme.colors.groupped.background,
    paddingTop: 8,
  },
  projectCard: {
    backgroundColor: theme.colors.surface,
    marginBottom: 8,
    marginHorizontal: Platform.select({ ios: 16, default: 12 }),
    borderRadius: Platform.select({ ios: 10, default: 16 }),
    overflow: "hidden",
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 0.33 },
    shadowOpacity: theme.colors.shadow.opacity,
    shadowRadius: 0,
    elevation: 1,
  },
  sectionHeader: {
    paddingTop: 12,
    paddingBottom: Platform.select({ ios: 6, default: 8 }),
    paddingHorizontal: Platform.select({ ios: 32, default: 24 }),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  sectionHeaderAvatar: {
    marginRight: 8,
  },
  sectionHeaderPath: {
    ...Typography.default("regular"),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
    fontWeight: Platform.select({ ios: "normal", default: "500" }),
    flex: 1,
  },
  sessionRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
  },
  sessionRowWithBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
  },
  sessionRowSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  sessionContent: {
    flex: 1,
    justifyContent: "center",
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sessionTitle: {
    fontSize: 15,
    flex: 1,
    ...Typography.default("regular"),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  statusDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
  },
  usageLabel: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginLeft: 8,
    ...Typography.default(),
  },
  newSessionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    height: 56,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  newSessionButtonDisabled: {
    opacity: 0.4,
  },
  newSessionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  newSessionButtonIcon: {
    marginRight: 8,
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  newSessionButtonText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    ...Typography.default("regular"),
  },
  swipeActionsContainer: {
    flexDirection: "row",
  },
  swipeActionUpgrade: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentBlue,
  },
  swipeActionArchive: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.warning,
  },
  swipeAction: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.status.error,
  },
  swipeActionText: {
    marginTop: 4,
    fontSize: 11,
    color: "#FFFFFF",
    textAlign: "center",
    ...Typography.default("semiBold"),
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.groupped.background,
  },
  tagText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  upgradeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 159, 10, 0.15)",
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 4,
    gap: 2,
  },
  upgradeBadgeText: {
    fontSize: 10,
    fontWeight: "500",
    color: theme.colors.warning,
    ...Typography.default("semiBold"),
  },
  tagBranch: {
    backgroundColor: "rgba(88, 86, 214, 0.12)",
  },
  tagBranchText: {
    color: "#5856D6",
    ...Typography.default("semiBold"),
  },
  tagMain: {
    backgroundColor: "rgba(52, 199, 89, 0.12)",
  },
  tagMainText: {
    color: "#34C759",
    ...Typography.default("semiBold"),
  },
  worktreeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 4,
    marginLeft: 6,
    gap: 2,
  },
  worktreeBadgeText: {
    fontSize: 10,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    ...Typography.default(),
    maxWidth: 80,
  },
  issueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  issueNumber: {
    fontSize: 11,
    ...Typography.default("semiBold"),
  },
  issueTitle: {
    fontSize: 11,
    ...Typography.default(),
    flex: 1,
  },
  issueStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  issueStatusText: {
    fontSize: 10,
    ...Typography.default("semiBold"),
  },
  issuePrIcon: {
    marginLeft: 2,
  },
}));

interface ActiveSessionsGroupProps {
  sessions: Session[];
  selectedSessionId?: string;
}

export function ActiveSessionsGroupCompact({
  sessions,
  selectedSessionId,
}: ActiveSessionsGroupProps) {
  const styles = stylesheet;
  const realtimeSessionSort = useSetting("realtimeSessionSort");
  const machines = useAllMachines();

  const machinesMap = React.useMemo(() => {
    const map: Record<string, Machine> = {};
    machines.forEach((machine) => {
      map[machine.id] = machine;
    });
    return map;
  }, [machines]);

  // Group sessions by project, then associate with machine
  const projectGroups = React.useMemo(() => {
    const groups = new Map<
      string,
      {
        path: string;
        displayPath: string;
        machines: Map<
          string,
          {
            machine: Machine | null;
            machineName: string;
            sessions: Session[];
          }
        >;
      }
    >();

    sessions.forEach((session) => {
      const projectPath = getSessionProjectPath(session);
      const unknownText = t("status.unknown");
      const machineId = session.metadata?.machineId || unknownText;

      // Get machine info
      const machine = machineId !== unknownText ? machinesMap[machineId] : null;
      const machineName =
        machine?.metadata?.displayName ||
        machine?.metadata?.host ||
        (machineId !== unknownText ? machineId : `<${unknownText}>`);

      // Get or create project group
      let projectGroup = groups.get(projectPath);
      if (!projectGroup) {
        const displayPath = formatPathRelativeToHome(
          projectPath,
          session.metadata?.homeDir,
        );
        projectGroup = {
          path: projectPath,
          displayPath,
          machines: new Map(),
        };
        groups.set(projectPath, projectGroup);
      }

      // Get or create machine group within project
      let machineGroup = projectGroup.machines.get(machineId);
      if (!machineGroup) {
        machineGroup = {
          machine,
          machineName,
          sessions: [],
        };
        projectGroup.machines.set(machineId, machineGroup);
      }

      // Add session to machine group
      machineGroup.sessions.push(session);
    });

    // Sort sessions within each machine group by last activity (newest first)
    const sortKey = realtimeSessionSort ? "updatedAt" : "createdAt";
    groups.forEach((projectGroup) => {
      projectGroup.machines.forEach((machineGroup) => {
        machineGroup.sessions.sort((a, b) => b[sortKey] - a[sortKey]);
      });
    });

    return groups;
  }, [sessions, machinesMap, realtimeSessionSort]);

  // Sort project groups by most recent session activity (newest first)
  const sortedProjectGroups = React.useMemo(() => {
    const sk = realtimeSessionSort ? "updatedAt" : "createdAt";
    return Array.from(projectGroups.entries()).sort(
      ([, groupA], [, groupB]) => {
        const latestA = Math.max(
          ...Array.from(groupA.machines.values()).flatMap((m) =>
            m.sessions.map((s) => s[sk]),
          ),
        );
        const latestB = Math.max(
          ...Array.from(groupB.machines.values()).flatMap((m) =>
            m.sessions.map((s) => s[sk]),
          ),
        );
        return latestB - latestA;
      },
    );
  }, [projectGroups, realtimeSessionSort]);

  return (
    <View style={styles.container}>
      {sortedProjectGroups.map(([projectPath, projectGroup]) => {
        // Get the avatar ID from the first session
        const firstSession = Array.from(projectGroup.machines.values())[0]
          ?.sessions[0];
        const avatarId = firstSession
          ? getSessionAvatarId(firstSession)
          : undefined;

        return (
          <View key={projectPath}>
            {/* Section header on grouped background */}
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                {avatarId && firstSession && (
                  <View style={styles.sectionHeaderAvatar}>
                    <ProjectHeaderAvatar
                      avatarId={avatarId}
                      flavor={firstSession.metadata?.flavor}
                      sessionId={firstSession.id}
                    />
                  </View>
                )}
                <Text style={styles.sectionHeaderPath}>
                  {projectGroup.displayPath}
                </Text>
              </View>
              {/* Show git status instead of machine name */}
              {firstSession ? (
                <ProjectGitStatus sessionId={firstSession.id} />
              ) : null}
            </View>

            {/* Card with just the sessions */}
            <View style={styles.projectCard}>
              {/* Sessions grouped by machine within the card */}
              {Array.from(projectGroup.machines.entries())
                .sort(([, machineA], [, machineB]) =>
                  machineA.machineName.localeCompare(machineB.machineName),
                )
                .map(([machineId, machineGroup]) => (
                  <View key={`${projectPath}-${machineId}`}>
                    {machineGroup.sessions.map((session, index) => (
                      <CompactSessionRow
                        key={session.id}
                        session={session}
                        selected={selectedSessionId === session.id}
                        showBorder={
                          index < machineGroup.sessions.length - 1 ||
                          Array.from(projectGroup.machines.keys()).indexOf(
                            machineId,
                          ) <
                            projectGroup.machines.size - 1
                        }
                      />
                    ))}
                  </View>
                ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const ProjectHeaderAvatar = React.memo(
  ({
    avatarId,
    flavor,
    sessionId,
  }: {
    avatarId: string;
    flavor?: string | null;
    sessionId: string;
  }) => {
    const hasUnreadMessages = useHasUnreadMessages(sessionId);
    return (
      <Avatar
        id={avatarId}
        size={24}
        flavor={flavor}
        hasUnreadMessages={hasUnreadMessages}
      />
    );
  },
);

// Compact session row component with status line
const CompactSessionRow = React.memo(
  ({
    session,
    selected,
    showBorder,
  }: {
    session: Session;
    selected?: boolean;
    showBorder?: boolean;
  }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const navigateToSession = useNavigateToSession();
    const issueLink = useIssueSessionBySessionId(session.id);
    const machine = useMachine(session.metadata?.machineId ?? "");
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);

    const [archivingSession, performArchive] = useHappyAction(async () => {
      const result = await sessionKill(session.id);
      if (!result.success) {
        throw new HappyError(
          result.message || t("sessionInfo.failedToArchiveSession"),
          false,
        );
      }
    });

    const handleArchive = React.useCallback(() => {
      swipeableRef.current?.close();
      if (issueLink && (issueLink.status === "processing" || issueLink.prUrl)) {
        Modal.alert("", t("issues.cannotArchiveProcessing"));
        return;
      }
      Modal.alert(
        t("sessionInfo.archiveSession"),
        t("sessionInfo.archiveSessionConfirm"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("sessionInfo.archiveSession"),
            style: "destructive",
            onPress: performArchive,
          },
        ],
      );
    }, [performArchive, issueLink]);

    const [deletingSession, performDelete] = useHappyAction(async () => {
      const result = await sessionDelete(session.id);
      if (!result.success) {
        throw new HappyError(
          result.message || t("sessionInfo.failedToDeleteSession"),
          false,
        );
      }
    });

    const handleDelete = React.useCallback(() => {
      swipeableRef.current?.close();
      if (issueLink && (issueLink.status === "processing" || issueLink.prUrl)) {
        Modal.alert("", t("issues.cannotArchiveProcessing"));
        return;
      }

      const wt = session.metadata?.worktree;
      let warningMessage = t("sessionInfo.deleteSessionWarning");

      if (wt?.isWorktree && wt.branchName) {
        if (wt.prUrl) {
          warningMessage = t("sessionInfo.deleteSessionWorktreePrWarning", {
            branchName: wt.branchName,
          });
        } else if (wt.state !== "merged") {
          warningMessage = t("sessionInfo.deleteSessionWorktreeWarning", {
            branchName: wt.branchName,
          });
        }
      }

      Modal.alert(t("sessionInfo.deleteSession"), warningMessage, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("sessionInfo.deleteSession"),
          style: "destructive",
          onPress: performDelete,
        },
      ]);
    }, [performDelete, issueLink, session.metadata?.worktree]);

    const { needsUpgrade, machineCliVersion, upgrading: upgradingSession, handleUpgrade: onUpgrade } = useSessionUpgrade(session, machine);

    const handleUpgrade = React.useCallback(() => {
      swipeableRef.current?.close();
      onUpgrade();
    }, [onUpgrade]);

    const itemContent = (
      <View>
        <Pressable
          style={[
            styles.sessionRow,
            showBorder && styles.sessionRowWithBorder,
            selected && styles.sessionRowSelected,
          ]}
          onPressIn={() => {
            if (isTablet) {
              navigateToSession(session.id);
            }
          }}
          onPress={() => {
            if (!isTablet) {
              navigateToSession(session.id);
            }
          }}
        >
          <View style={styles.sessionContent}>
            {/* Title line with status */}
            <View style={styles.sessionTitleRow}>
              {/* Status dot or draft icon on the left */}
              {(() => {
                // Show draft icon when online with draft
                if (sessionStatus.state === "waiting" && session.draft) {
                  return (
                    <Ionicons
                      name="create-outline"
                      size={14}
                      color={theme.colors.textSecondary}
                      style={{ marginRight: 8 }}
                    />
                  );
                }

                // Show status dot only for permission_required/thinking states
                if (
                  sessionStatus.state === "permission_required" ||
                  sessionStatus.state === "thinking"
                ) {
                  return (
                    <View
                      style={[styles.statusDotContainer, { marginRight: 8 }]}
                    >
                      <StatusDot
                        color={sessionStatus.statusDotColor}
                        isPulsing={sessionStatus.isPulsing}
                      />
                    </View>
                  );
                }

                // Show grey dot for online without draft
                if (sessionStatus.state === "waiting") {
                  return (
                    <View
                      style={[styles.statusDotContainer, { marginRight: 8 }]}
                    >
                      <StatusDot
                        color={theme.colors.textSecondary}
                        isPulsing={false}
                      />
                    </View>
                  );
                }

                return null;
              })()}

              <Text
                style={[
                  styles.sessionTitle,
                  sessionStatus.isConnected
                    ? styles.sessionTitleConnected
                    : styles.sessionTitleDisconnected,
                ]}
                numberOfLines={2}
              >
                {sessionName}
              </Text>
              {session.metadata?.worktree?.isWorktree && (
                <View style={styles.worktreeBadge}>
                  <Ionicons
                    name="git-branch-outline"
                    size={10}
                    color={styles.worktreeBadgeText.color}
                  />
                  <Text style={styles.worktreeBadgeText} numberOfLines={1}>
                    {session.metadata.worktree.branchName}
                  </Text>
                </View>
              )}
              {session.latestUsage ? (
                <Text style={styles.usageLabel}>
                  {formatTokenCountShort(
                    session.latestUsage.totalInputTokens +
                      session.latestUsage.totalOutputTokens,
                  )}
                </Text>
              ) : null}
            </View>
            {/* Tags line */}
            <View style={styles.tagsRow}>
              <View
                style={[
                  styles.tag,
                  session.metadata?.worktree?.isWorktree
                    ? styles.tagBranch
                    : styles.tagMain,
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    session.metadata?.worktree?.isWorktree
                      ? styles.tagBranchText
                      : styles.tagMainText,
                  ]}
                >
                  {session.metadata?.worktree?.isWorktree
                    ? t("sessionInfo.tagBranch")
                    : t("sessionInfo.tagMain")}
                </Text>
              </View>
              {(machine?.metadata?.displayName || session.metadata?.host) && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>
                    {machine?.metadata?.displayName || session.metadata?.host}
                  </Text>
                </View>
              )}
              {session.metadata?.version && (
                <View style={[styles.tag, needsUpgrade && styles.upgradeBadge]}>
                  <Text style={[styles.tagText, needsUpgrade && styles.upgradeBadgeText]}>
                    {session.metadata.version}
                  </Text>
                  {needsUpgrade && (
                    <Ionicons
                      name="arrow-up-circle-outline"
                      size={10}
                      color={styles.upgradeBadgeText.color}
                    />
                  )}
                </View>
              )}
            </View>

            {/* Issue info line */}
            {issueLink &&
              (() => {
                const statusColor = ISSUE_STATUS_COLORS[issueLink.status].text;
                const prUrl =
                  issueLink.prUrl ?? session.metadata?.worktree?.prUrl;
                return (
                  <View style={styles.issueRow}>
                    <Ionicons
                      name="pricetag-outline"
                      size={11}
                      color={statusColor}
                    />
                    <Text style={[styles.issueNumber, { color: statusColor }]}>
                      #{issueLink.issueNumber}
                    </Text>
                    <Text
                      style={[styles.issueTitle, { color: statusColor }]}
                      numberOfLines={1}
                    >
                      {issueLink.issueTitle}
                    </Text>
                    <View
                      style={[
                        styles.issueStatusDot,
                        { backgroundColor: statusColor },
                      ]}
                    />
                    <Text
                      style={[styles.issueStatusText, { color: statusColor }]}
                    >
                      {ISSUE_STATUS_LABELS[issueLink.status]()}
                    </Text>
                    {prUrl ? (
                      <Pressable
                        style={styles.issuePrIcon}
                        onPress={() => Linking.openURL(prUrl)}
                        hitSlop={8}
                      >
                        <Ionicons
                          name="git-pull-request-outline"
                          size={12}
                          color="#007AFF"
                        />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })()}
          </View>
        </Pressable>
      </View>
    );

    const isBusy = archivingSession || deletingSession || upgradingSession;

    const renderRightActions = () => (
      <View style={styles.swipeActionsContainer}>
        {needsUpgrade && (
          <Pressable
            style={styles.swipeActionUpgrade}
            onPress={handleUpgrade}
            disabled={isBusy}
          >
            <Ionicons name="arrow-up-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={1}>
              {t("sessionInfo.upgradeRestart")}
            </Text>
          </Pressable>
        )}
        <Pressable
          style={styles.swipeActionArchive}
          onPress={handleArchive}
          disabled={isBusy}
        >
          <Ionicons name="archive-outline" size={20} color="#FFFFFF" />
          <Text style={styles.swipeActionText} numberOfLines={1}>
            {t("sessionInfo.archiveSession")}
          </Text>
        </Pressable>
        <Pressable
          style={styles.swipeAction}
          onPress={handleDelete}
          disabled={isBusy}
        >
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
          <Text style={styles.swipeActionText} numberOfLines={1}>
            {t("sessionInfo.deleteSession")}
          </Text>
        </Pressable>
      </View>
    );

    return (
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        enabled={!isBusy}
      >
        {itemContent}
      </Swipeable>
    );
  },
);
