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
import { useRouter } from "expo-router";
import { Session, Machine } from "@/sync/storageTypes";
import { Ionicons } from "@expo/vector-icons";
import {
  getSessionName,
  useSessionStatus,
  getSessionAvatarId,
  formatPathRelativeToHome,
  getSessionProjectPath,
  getSessionProviderKey,
  getSessionProviderLabel,
} from "@/utils/sessionUtils";
import { Avatar } from "./Avatar";
import { Typography } from "@/constants/Typography";
import { StatusDot } from "./StatusDot";
import {
  useAllMachines,
  useHasUnreadMessages,
  useMachine,
  useSetting,
  useProjectAliasMap,
} from "@/sync/storage";
import { StyleSheet } from "react-native-unistyles";
import { isMachineOnline } from "@/utils/machineUtils";
import { useSessionUpgrade } from "@/hooks/useSessionUpgrade";
import { machineSpawnNewSession, sessionKill, sessionDelete } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { Modal } from "@/modal";
import { CompactGitStatus } from "./CompactGitStatus";
import { ProjectGitStatus } from "./ProjectGitStatus";
import { t } from "@/text";
import { formatTokenCountShort } from "@/utils/formatUsage";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { useIsTablet } from "@/utils/responsive";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { useIssueSessionBySessionId } from "@/sync/issueSessionStore";
import {
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import { useAutoOptionSendEnabled } from "@/hooks/useAutoOptionSendEnabled";

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
  sectionHeaderPath: {
    ...Typography.default("regular"),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
    fontWeight: Platform.select({ ios: "normal", default: "500" }),
  },
  sectionHeaderMachine: {
    ...Typography.default("regular"),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
    fontWeight: Platform.select({ ios: "normal", default: "500" }),
    maxWidth: 150,
    textAlign: "right",
  },
  sectionHeaderNameGroup: {
    flexDirection: "column",
    flex: 1,
  },
  sectionHeaderAlias: {
    ...Typography.default("semiBold"),
    color: theme.colors.groupped.sectionTitle,
    fontSize: Platform.select({ ios: 13, default: 14 }),
    lineHeight: Platform.select({ ios: 18, default: 20 }),
    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
  },
  sectionHeaderSubpath: {
    ...Typography.default("regular"),
    color: theme.colors.textSecondary,
    fontSize: Platform.select({ ios: 11, default: 12 }),
    lineHeight: Platform.select({ ios: 14, default: 16 }),
    marginTop: 1,
  },
  sessionRow: {
    flexDirection: "column",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
  },
  sessionTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
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
    marginLeft: 10,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    height: 38,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
    ...Typography.default("semiBold"),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  statusMiddleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    ...Typography.default(),
  },
  avatarColumn: {
    alignItems: "center",
    width: 36,
    marginTop: 2,
  },
  newSessionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
  },
  newSessionButtonDisabled: {
    opacity: 0.5,
  },
  newSessionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  newSessionButtonIcon: {
    marginRight: 6,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  newSessionButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  newSessionButtonTextDisabled: {
    color: theme.colors.textSecondary,
  },
  taskStatusContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 4,
  },
  taskStatusText: {
    fontSize: 10,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  autoSendBadge: {
    backgroundColor: `${theme.colors.accentPurple}1F`,
  },
  autoSendBadgeText: {
    color: theme.colors.accentPurple,
    ...Typography.default("semiBold"),
  },
  swipeActionsContainer: {
    flexDirection: "row",
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
    marginTop: 4,
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
  tagBranch: {
    backgroundColor: "rgba(88, 86, 214, 0.12)",
  },
  tagBranchText: {
    color: theme.colors.accentPurple,
    ...Typography.default("semiBold"),
  },
  tagMain: {
    backgroundColor: "rgba(52, 199, 89, 0.12)",
  },
  tagMainText: {
    color: theme.colors.success,
    ...Typography.default("semiBold"),
  },
  worktreeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceHighest,
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 4,
    gap: 2,
  },
  worktreeBadgeText: {
    fontSize: 10,
    fontWeight: "500",
    color: theme.colors.textSecondary,
    ...Typography.default(),
    maxWidth: 80,
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
  swipeActionUpgrade: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentBlue,
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
    color: theme.colors.accentBlue,
  },
}));

interface ActiveSessionsGroupProps {
  sessions: Session[];
  selectedSessionId?: string;
}

export function ActiveSessionsGroup({
  sessions,
  selectedSessionId,
}: ActiveSessionsGroupProps) {
  const styles = stylesheet;
  const realtimeSessionSort = useSetting("realtimeSessionSort");
  const machines = useAllMachines();
  const projectAliasMap = useProjectAliasMap();
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
      const machineId = session.metadata?.machineId || "unknown";

      // Get machine info
      const machine = machineId !== "unknown" ? machinesMap[machineId] : null;
      const machineName =
        machine?.metadata?.displayName ||
        machine?.metadata?.host ||
        (machineId !== "unknown" ? machineId : "<unknown>");

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

    // Sort sessions within each machine group (by updatedAt or createdAt)
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
        // Get the first machine name from this project's machines
        const firstMachine = Array.from(projectGroup.machines.values())[0];
        const machineName =
          projectGroup.machines.size === 1
            ? firstMachine?.machineName
            : `${projectGroup.machines.size} machines`;

        return (
          <View key={projectPath}>
            {/* Section header on grouped background */}
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                {projectAliasMap.has(projectPath) ? (
                  <View style={styles.sectionHeaderNameGroup}>
                    <Text style={styles.sectionHeaderAlias} numberOfLines={1}>
                      {projectAliasMap.get(projectPath)}
                    </Text>
                    <Text style={styles.sectionHeaderSubpath} numberOfLines={1}>
                      {projectGroup.displayPath}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.sectionHeaderPath}>
                    {projectGroup.displayPath}
                  </Text>
                )}
              </View>
              {/* Show git status instead of machine name */}
              {(() => {
                // Get the first session from any machine in this project
                const firstSession = Array.from(
                  projectGroup.machines.values(),
                )[0]?.sessions[0];
                return firstSession ? (
                  <ProjectGitStatus sessionId={firstSession.id} />
                ) : (
                  <Text style={styles.sectionHeaderMachine} numberOfLines={1}>
                    {machineName}
                  </Text>
                );
              })()}
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
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const navigateToSession = useNavigateToSession();
    const issueLink = useIssueSessionBySessionId(session.id);
    const machine = useMachine(session.metadata?.machineId ?? "");
    const isTablet = useIsTablet();
    const isAutoOptionSend = useAutoOptionSendEnabled(session.id);
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

    const avatarId = React.useMemo(() => {
      return getSessionAvatarId(session);
    }, [session]);
    const hasUnreadMessages = useHasUnreadMessages(session.id);

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
          {/* Top row: avatar + title */}
          <View style={styles.sessionTopRow}>
            <View style={styles.avatarColumn}>
              <Avatar
                id={avatarId}
                size={36}
                monochrome={!sessionStatus.isConnected}
                flavor={session.metadata?.flavor}
                provider={getSessionProviderKey(session)}
                hasUnreadMessages={hasUnreadMessages}
                glowColor={isAutoOptionSend ? styles.autoSendBadgeText.color : null}
              />
            </View>
            <View style={styles.sessionContent}>
              <View style={styles.sessionTitleRow}>
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
                            color={styles.issuePrIcon.color}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })()}
            </View>
          </View>

          {/* Middle row: status + usage (full width) */}
          <View style={styles.statusMiddleRow}>
            <View style={styles.statusLeft}>
              <View style={styles.statusDotContainer}>
                <StatusDot
                  color={sessionStatus.statusDotColor}
                  isPulsing={sessionStatus.isPulsing}
                  size={6}
                />
              </View>
              <Text
                style={[
                  styles.statusText,
                  { color: sessionStatus.statusColor },
                ]}
              >
                {sessionStatus.statusText}
              </Text>
            </View>
            {session.latestUsage ? (
              <Text style={styles.taskStatusText}>
                {formatTokenCountShort(
                  session.latestUsage.totalInputTokens +
                    session.latestUsage.totalOutputTokens,
                )}
              </Text>
            ) : null}
          </View>

          {/* Bottom row - tags + indicators */}
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
            <View style={styles.tag}>
              <Text style={styles.tagText}>
                {getSessionProviderLabel(session)}
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
            {/* Worktree badge */}
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
            {/* Draft indicator */}
            {session.draft && (
              <View style={styles.taskStatusContainer}>
                <Ionicons
                  name="create-outline"
                  size={10}
                  color={styles.taskStatusText.color}
                />
              </View>
            )}
            {/* Task status indicator */}
            {Array.isArray(session.todos) &&
              session.todos.length > 0 &&
              (() => {
                const totalTasks = session.todos.length;
                const completedTasks = session.todos.filter(
                  (t) => t.status === "completed",
                ).length;
                if (completedTasks === totalTasks) return null;
                return (
                  <View style={styles.taskStatusContainer}>
                    <Ionicons
                      name="bulb-outline"
                      size={10}
                      color={styles.taskStatusText.color}
                      style={{ marginRight: 2 }}
                    />
                    <Text style={styles.taskStatusText}>
                      {completedTasks}/{totalTasks}
                    </Text>
                  </View>
                );
              })()}
            {/* Auto-send indicator */}
            {isAutoOptionSend && (
              <View style={[styles.taskStatusContainer, styles.autoSendBadge]}>
                <Ionicons
                  name="sparkles"
                  size={10}
                  color={styles.autoSendBadgeText.color}
                  style={{ marginRight: 2 }}
                />
                <Text style={[styles.taskStatusText, styles.autoSendBadgeText]}>
                  {t("session.autoOptionSendLabel")}
                </Text>
              </View>
            )}
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
