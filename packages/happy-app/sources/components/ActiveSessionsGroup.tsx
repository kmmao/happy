import React from "react";
import { View, Pressable, Platform, ActivityIndicator } from "react-native";
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
} from "@/utils/sessionUtils";
import { Avatar } from "./Avatar";
import { Typography } from "@/constants/Typography";
import { StatusDot } from "./StatusDot";
import {
  useAllMachines,
  useHasUnreadMessages,
  useSetting,
} from "@/sync/storage";
import { StyleSheet } from "react-native-unistyles";
import { isMachineOnline } from "@/utils/machineUtils";
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
  sessionRow: {
    height: 88,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
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
    marginLeft: 16,
    justifyContent: "center",
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: "500",
    ...Typography.default("semiBold"),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    height: 16,
    marginTop: 2,
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    ...Typography.default(),
  },
  avatarContainer: {
    position: "relative",
    width: 48,
    height: 48,
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
  hoverActions: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    paddingLeft: 24,
    gap: 4,
    backgroundColor: theme.colors.surface,
  },
  hoverActionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
                <Text style={styles.sectionHeaderPath}>
                  {projectGroup.displayPath}
                </Text>
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
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const [hovered, setHovered] = React.useState(false);

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
    }, [performArchive]);

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
      Modal.alert(
        t("sessionInfo.deleteSession"),
        t("sessionInfo.deleteSessionWarning"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("sessionInfo.deleteSession"),
            style: "destructive",
            onPress: performDelete,
          },
        ],
      );
    }, [performDelete]);

    const avatarId = React.useMemo(() => {
      return getSessionAvatarId(session);
    }, [session]);
    const hasUnreadMessages = useHasUnreadMessages(session.id);

    const itemContent = (
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
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
          <View style={styles.avatarContainer}>
            <Avatar
              id={avatarId}
              size={48}
              monochrome={!sessionStatus.isConnected}
              flavor={session.metadata?.flavor}
              hasUnreadMessages={hasUnreadMessages}
            />
          </View>
          <View style={styles.sessionContent}>
            {/* Title line */}
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

            {/* Status line with dot */}
            <View style={styles.statusRow}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={styles.statusDotContainer}>
                  <StatusDot
                    color={sessionStatus.statusDotColor}
                    isPulsing={sessionStatus.isPulsing}
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

              {/* Status indicators on the right side */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  transform: [{ translateY: 1 }],
                }}
              >
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

                {/* Draft status indicator */}
                {session.draft && (
                  <View style={styles.taskStatusContainer}>
                    <Ionicons
                      name="create-outline"
                      size={10}
                      color={styles.taskStatusText.color}
                    />
                  </View>
                )}

                {/* Usage indicator */}
                {session.latestUsage ? (
                  <View style={styles.taskStatusContainer}>
                    <Text style={styles.taskStatusText}>
                      {formatTokenCountShort(
                        session.latestUsage.totalInputTokens +
                          session.latestUsage.totalOutputTokens,
                      )}
                    </Text>
                  </View>
                ) : null}

                {/* Task status indicator */}
                {session.todos &&
                  session.todos.length > 0 &&
                  (() => {
                    const totalTasks = session.todos.length;
                    const completedTasks = session.todos.filter(
                      (t) => t.status === "completed",
                    ).length;

                    // Don't show if all tasks are completed
                    if (completedTasks === totalTasks) {
                      return null;
                    }

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
              </View>
            </View>
          </View>
        </Pressable>
        {hovered && (
          <View
            style={[
              styles.hoverActions,
              selected && {
                backgroundColor: styles.sessionRowSelected.backgroundColor,
              },
            ]}
          >
            <Pressable style={styles.hoverActionButton} onPress={handleArchive}>
              <Ionicons
                name="archive-outline"
                size={18}
                color={styles.swipeActionArchive.backgroundColor as string}
              />
            </Pressable>
            <Pressable style={styles.hoverActionButton} onPress={handleDelete}>
              <Ionicons
                name="trash-outline"
                size={18}
                color={styles.swipeAction.backgroundColor as string}
              />
            </Pressable>
          </View>
        )}
      </View>
    );

    const isBusy = archivingSession || deletingSession;

    const renderRightActions = () => (
      <View style={styles.swipeActionsContainer}>
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
