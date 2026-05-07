import React from "react";
import {
  View,
  Pressable,
  FlatList,
  ActivityIndicator,
  Linking,
  ScrollView,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Text } from "@/components/StyledText";
import { usePathname } from "expo-router";
import {
  SessionListViewItem,
  useHasUnreadMessages,
  useSetting,
  useMachine,
  storage,
} from "@/sync/storage";
import { Ionicons } from "@expo/vector-icons";
import {
  getSessionName,
  useSessionStatus,
  getSessionSubtitle,
  getSessionAvatarId,
  formatLastSeen,
  getSessionProviderKey,
} from "@/utils/sessionUtils";
import { Avatar } from "./Avatar";
import { ActiveSessionsGroup } from "./ActiveSessionsGroup";
import { ActiveSessionsGroupCompact } from "./ActiveSessionsGroupCompact";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVisibleSessionListViewData } from "@/hooks/useVisibleSessionListViewData";
import { Typography } from "@/constants/Typography";
import { Session } from "@/sync/storageTypes";
import { StatusDot } from "./StatusDot";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsTablet } from "@/utils/responsive";
import { requestReview } from "@/utils/requestReview";
import { UpdateBanner } from "./UpdateBanner";
import { useLayout, screenLayoutMaxWidth } from "./layout";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { t } from "@/text";
import { formatTokenCountShort } from "@/utils/formatUsage";
import { useRouter } from "expo-router";
import { useHappyAction } from "@/hooks/useHappyAction";
import { sessionDelete } from "@/sync/ops";
import { buildSessionRespawnProfile } from "@/hooks/sessionUpgradeProfile";
import { resolveSessionReactivationContext } from "@/hooks/sessionResumeSupport";
import { reactivateArchivedSession } from "@/sync/sessionResumeFlow";
import { runWithSessionReactivationGuard } from "@/sync/sessionResumeGuard";
import { HappyError } from "@/utils/errors";
import { Modal } from "@/modal";
import { useAutoOptionSendEnabled } from "@/hooks/useAutoOptionSendEnabled";
import { useIssueSessionBySessionId } from "@/sync/issueSessionStore";
import {
  ISSUE_STATUS_COLORS,
  ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import { SessionProviderTag } from "@/components/session/SessionProviderTag";
import {
  resolveProjectSessionScopeTone,
  resolveProjectSessionTextBadges,
} from "@/components/project/projectSessionBadges";
import { SharedGroupHeader } from "./SharedGroupHeader";

const stylesheet = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    backgroundColor: theme.colors.groupped.background,
  },
  contentContainer: {
    flex: 1,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
  },
  headerSection: {
    backgroundColor: theme.colors.groupped.background,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.groupped.sectionTitle,
    letterSpacing: 0.1,
    ...Typography.default("semiBold"),
  },
  projectGroup: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: theme.colors.groupped.background,
  },
  projectGroupTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  projectGroupSubtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
    ...Typography.default(),
  },
  sessionItem: {
    flexDirection: "column",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
  },
  sessionTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sessionItemContainer: {
    marginHorizontal: 16,
    marginBottom: 1,
    overflow: "hidden",
  },
  sessionItemFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionItemLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  sessionItemSingle: {
    borderRadius: 12,
  },
  sessionItemContainerFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionItemContainerLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginBottom: 12,
  },
  sessionItemContainerSingle: {
    borderRadius: 12,
    marginBottom: 12,
  },
  sessionItemSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  sessionContent: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
    gap: 8,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
    ...Typography.default("semiBold"),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  sessionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  requestPreview: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  requestPreviewAuto: {
    color: theme.colors.accentPurple,
    textShadowColor: `${theme.colors.accentPurple}66`,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.groupped.background,
    maxWidth: "100%",
  },
  tagText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default(),
    flexShrink: 1,
  },
  tagBranch: {
    backgroundColor: `${theme.colors.accentPurple}1F`,
  },
  tagBranchText: {
    color: theme.colors.accentPurple,
    ...Typography.default("semiBold"),
  },
  tagMain: {
    backgroundColor: `${theme.colors.success}1F`,
  },
  tagMainText: {
    color: theme.colors.success,
    ...Typography.default("semiBold"),
  },
  autoSendBadge: {
    backgroundColor: `${theme.colors.accentPurple}1F`,
  },
  autoSendBadgeText: {
    color: theme.colors.accentPurple,
    ...Typography.default("semiBold"),
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
  sessionTimestamp: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  starButton: {
    padding: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  usageText: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  statusDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    height: 16,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    ...Typography.default(),
  },
  avatarContainer: {
    position: "relative",
    width: 44,
    height: 44,
  },
  draftIconContainer: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  draftIconOverlay: {
    color: theme.colors.textSecondary,
  },
  sessionItemPressed: {
    backgroundColor: theme.colors.surfacePressedOverlay,
  },
  branchNameTag: {
    backgroundColor: theme.colors.surfaceHighest,
  },
  branchNameTagText: {
    color: theme.colors.text,
    ...Typography.default("semiBold"),
  },
  artifactsSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.groupped.background,
  },
  swipeAction: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.status.error,
  },
  swipeActionResume: {
    width: 80,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.success,
  },
  swipeActionText: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.button.primary.tint,
    textAlign: "center",
    ...Typography.default("semiBold"),
  },
  tagFilterBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  tagFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 0.5,
    borderColor: theme.colors.divider,
  },
  tagFilterChipActive: {
    backgroundColor: `${theme.colors.accentBlue}1A`,
    borderColor: theme.colors.accentBlue,
  },
  tagFilterChipText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default("semiBold"),
  },
  tagFilterChipTextActive: {
    color: theme.colors.accentBlue,
  },
  deleteAllContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: "center",
  },
  deleteAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    gap: 8,
  },
  deleteAllText: {
    fontSize: 14,
    color: theme.colors.status.error,
    ...Typography.default("semiBold"),
  },
}));

export function SessionsList() {
    const layout = useLayout();
  const styles = stylesheet;
  const safeArea = useSafeAreaInsets();
  const data = useVisibleSessionListViewData();
  const pathname = usePathname();
  const isTablet = useIsTablet();
  const navigateToSession = useNavigateToSession();
  const compactSessionView = useSetting("compactSessionView");
  const router = useRouter();
  const selectable = isTablet;

  const [activeTag, setActiveTag] = React.useState<string | null>(null);

  const allTags = React.useMemo(() => {
    if (!data) return [];
    const tagSet = new Set<string>();
    for (const item of data) {
      if (item.type === "session") {
        item.session.metadata?.tags?.forEach((tag) => tagSet.add(tag));
      } else if (item.type === "active-sessions") {
        item.sessions.forEach((s) =>
          s.metadata?.tags?.forEach((tag) => tagSet.add(tag)),
        );
      }
    }
    return Array.from(tagSet).sort();
  }, [data]);

  const filteredData = React.useMemo(() => {
    if (!activeTag || !data) return data;
    const result: SessionListViewItem[] = [];
    let pendingHeader: SessionListViewItem | null = null;
    for (const item of data) {
      if (item.type === "header") {
        pendingHeader = item;
        continue;
      }
      if (item.type === "active-sessions") {
        const matching = item.sessions.filter((s) =>
          s.metadata?.tags?.includes(activeTag),
        );
        if (matching.length > 0) {
          result.push({ type: "active-sessions", sessions: matching });
        }
        pendingHeader = null;
        continue;
      }
      if (item.type === "session") {
        if (item.session.metadata?.tags?.includes(activeTag)) {
          if (pendingHeader) {
            result.push(pendingHeader);
            pendingHeader = null;
          }
          result.push(item);
        }
        continue;
      }
      pendingHeader = null;
      result.push(item);
    }
    return result;
  }, [data, activeTag]);

  const dataWithSelected = selectable
    ? React.useMemo(() => {
        return filteredData?.map((item) => ({
          ...item,
          selected: pathname.startsWith(
            `/session/${item.type === "session" ? item.session.id : ""}`,
          ),
        }));
      }, [filteredData, pathname])
    : filteredData;

  // Request review
  React.useEffect(() => {
    if (data && data.length > 0) {
      requestReview();
    }
  }, [data && data.length > 0]);

  // Early return if no data yet
  if (!data) {
    return <View style={styles.container} />;
  }

  const keyExtractor = React.useCallback(
    (item: SessionListViewItem & { selected?: boolean }, index: number) => {
      switch (item.type) {
        case "header":
          return `header-${item.title}-${index}`;
        case "active-sessions":
          return "active-sessions";
        case "project-group":
          return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
        case "session":
          return `session-${item.session.id}`;
      }
    },
    [],
  );

  const renderItem = React.useCallback(
    ({
      item,
      index,
    }: {
      item: SessionListViewItem & { selected?: boolean };
      index: number;
    }) => {
      switch (item.type) {
        case "header":
          return (
            <View style={styles.headerSection}>
              <SharedGroupHeader title={item.title} variant="section" />
            </View>
          );

        case "active-sessions":
          // Extract just the session ID from pathname (e.g., /session/abc123/file -> abc123)
          let selectedId: string | undefined;
          if (isTablet && pathname.startsWith("/session/")) {
            const parts = pathname.split("/");
            selectedId = parts[2]; // parts[0] is empty, parts[1] is 'session', parts[2] is the ID
          }

          const ActiveComponent = compactSessionView
            ? ActiveSessionsGroupCompact
            : ActiveSessionsGroup;
          return (
            <ActiveComponent
              sessions={item.sessions}
              selectedSessionId={selectedId}
            />
          );

        case "project-group":
          return (
            <View style={styles.projectGroup}>
              <SharedGroupHeader
                title={item.displayPath}
                subtitle={
                  item.machine.metadata?.displayName ||
                  item.machine.metadata?.host ||
                  item.machine.id
                }
                variant="context"
              />
            </View>
          );

        case "session":
          // Determine card styling based on position within date group
          const prevItem =
            index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
          const nextItem =
            index < (dataWithSelected?.length || 0) - 1 && dataWithSelected
              ? dataWithSelected[index + 1]
              : null;

          const isFirst = prevItem?.type === "header";
          const isLast =
            nextItem?.type === "header" ||
            nextItem == null ||
            nextItem?.type === "active-sessions";
          const isSingle = isFirst && isLast;

          return (
            <SessionItem
              session={item.session}
              selected={item.selected}
              isFirst={isFirst}
              isLast={isLast}
              isSingle={isSingle}
            />
          );
      }
    },
    [pathname, dataWithSelected, compactSessionView],
  );

  // Remove this section as we'll use FlatList for all items now

  const HeaderComponent = React.useCallback(() => {
    return (
      <>
        <UpdateBanner />
        {allTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagFilterBar}
          >
            {allTags.map((tag) => (
              <Pressable
                key={tag}
                style={[
                  styles.tagFilterChip,
                  activeTag === tag && styles.tagFilterChipActive,
                ]}
                onPress={() =>
                  setActiveTag((prev) => (prev === tag ? null : tag))
                }
              >
                <Text
                  style={[
                    styles.tagFilterChipText,
                    activeTag === tag && styles.tagFilterChipTextActive,
                  ]}
                >
                  {tag}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </>
    );
  }, [allTags, activeTag]);

  // Count inactive sessions for "delete all" button
  const inactiveSessionIds = React.useMemo(() => {
    if (!data) return [];
    return data
      .filter((item) => item.type === "session")
      .map(
        (item) => (item as { type: "session"; session: Session }).session.id,
      );
  }, [data]);

  const [deletingAll, performDeleteAll] = useHappyAction(async () => {
    const errors: string[] = [];
    const deleted: string[] = [];
    for (const id of inactiveSessionIds) {
      const result = await sessionDelete(id);
      if (!result.success) {
        errors.push(result.message || id);
      } else {
        deleted.push(id);
      }
    }
    for (const id of deleted) {
      storage.getState().deleteSession(id);
    }
    if (errors.length > 0) {
      throw new HappyError(t("sessionInfo.failedToDeleteSession"), false);
    }
  });

  const handleDeleteAll = React.useCallback(() => {
    Modal.alert(
      t("sessionInfo.deleteAllArchivedSessions"),
      t("sessionInfo.deleteAllArchivedWarning", {
        count: inactiveSessionIds.length,
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("sessionInfo.deleteAllArchivedSessions"),
          style: "destructive",
          onPress: performDeleteAll,
        },
      ],
    );
  }, [performDeleteAll, inactiveSessionIds.length]);

  const FooterComponent = React.useCallback(() => {
    if (inactiveSessionIds.length === 0) {
      return null;
    }
    return (
      <View style={styles.deleteAllContainer}>
        <Pressable
          style={styles.deleteAllButton}
          onPress={handleDeleteAll}
          disabled={deletingAll}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={styles.deleteAllText.color}
          />
          <Text style={styles.deleteAllText}>
            {deletingAll
              ? t("common.loading")
              : t("sessionInfo.deleteAllArchivedSessions")}
          </Text>
        </Pressable>
      </View>
    );
  }, [
    deletingAll,
    handleDeleteAll,
    inactiveSessionIds.length,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <FlatList
          data={dataWithSelected}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingBottom: safeArea.bottom + 128,
            maxWidth: layout.maxWidth,
          }}
          ListHeaderComponent={HeaderComponent}
          ListFooterComponent={FooterComponent}
        />
      </View>
    </View>
  );
}

// Sub-component that handles session message logic

const SessionItem = React.memo(
  ({
    session,
    selected,
    isFirst,
    isLast,
    isSingle,
  }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
  }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const issueLink = useIssueSessionBySessionId(session.id);
    const isAutoOptionSend = useAutoOptionSendEnabled(session.id);

    const [deletingSession, performDelete] = useHappyAction(async () => {
      const result = await sessionDelete(session.id);
      if (!result.success) {
        throw new HappyError(
          result.message || t("sessionInfo.failedToDeleteSession"),
          false,
        );
      }
      storage.getState().deleteSession(session.id);
    });

    const handleDelete = React.useCallback(() => {
      swipeableRef.current?.close();
      if (issueLink && (issueLink.status === "processing" || issueLink.prUrl)) {
        Modal.alert("", t("issues.cannotArchiveProcessing"));
        return;
      }
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
    }, [performDelete, issueLink]);

    const machine = useMachine(session.metadata?.machineId ?? "");
    const reactivationContext = resolveSessionReactivationContext(session, machine);
    const reactivationMode = reactivationContext?.mode;
    const canReactivate = reactivationContext !== null;

    const [reactivatingSession, performReactivation] = useHappyAction(async () => {
      if (!reactivationContext) {
        throw new HappyError(
          t("machine.failedToStartSession"),
          false,
        );
      }
      await runWithSessionReactivationGuard(session.id, async () => {
        const spawnProfile = buildSessionRespawnProfile(
          session,
          storage.getState().settings.profiles ?? [],
        );
        const createResumeRequest = (
          directory?: string,
          approvedNewDirectoryCreation: boolean = false,
        ) => {
          if (reactivationContext.mode !== "resume") {
            throw new HappyError(
              t("machine.failedToStartSession"),
              false,
            );
          }

          return {
            ...reactivationContext.resumeContext!.baseSpawnOptions,
            directory:
              directory ?? reactivationContext.resumeContext!.baseSpawnOptions.directory,
            approvedNewDirectoryCreation,
            ...spawnProfile,
          };
        };

        await reactivateArchivedSession({
          sessionId: session.id,
          mode: reactivationContext.mode,
          onSuccess: () => navigateToSession(session.id),
          requestDirectoryApproval: (directory) =>
            Modal.confirm(
              t("machine.createDirectoryTitle"),
              t("machine.createDirectoryMessage", { directory }),
              { cancelText: t("common.cancel"), confirmText: t("common.create") },
            ),
          createError: (message) => new HappyError(message, false),
          getStartSessionFallbackMessage: () =>
            reactivationContext.mode === "unarchive"
              ? t("sessionInfo.failedToUnarchiveSession")
              : t("machine.failedToStartSession"),
          createResumeRequest,
        });
      });
    });

    const handleReactivate = React.useCallback(() => {
      swipeableRef.current?.close();
      performReactivation();
    }, [performReactivation]);

    const avatarId = React.useMemo(() => {
      return getSessionAvatarId(session);
    }, [session]);
    const hasUnreadMessages = useHasUnreadMessages(session.id);
    const latestRequestPreview = session.latestUserRequestPreview;
    const scopeTone = React.useMemo(
      () => resolveProjectSessionScopeTone(session),
      [session],
    );
    const textBadges = React.useMemo(
      () =>
        resolveProjectSessionTextBadges({
          session,
          machineLabel: machine?.metadata?.displayName ?? null,
        }),
      [machine?.metadata?.displayName, session],
    );

    const itemContent = (
      <View>
        <Pressable
          style={({ pressed }) => [
            styles.sessionItem,
            selected && styles.sessionItemSelected,
            isSingle
              ? styles.sessionItemSingle
              : isFirst
                ? styles.sessionItemFirst
                : isLast
                  ? styles.sessionItemLast
                  : {},
            pressed && styles.sessionItemPressed,
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
          <View style={styles.sessionTopRow}>
            <View style={styles.avatarContainer}>
              <Avatar
                id={avatarId}
                size={44}
                monochrome={!sessionStatus.isConnected}
                flavor={session.metadata?.flavor}
                provider={getSessionProviderKey(session)}
                hasUnreadMessages={hasUnreadMessages}
                glowColor={isAutoOptionSend ? theme.colors.accentPurple : null}
              />
              {session.draft && (
                <View style={styles.draftIconContainer}>
                  <Ionicons
                    name="create-outline"
                    size={12}
                    style={styles.draftIconOverlay}
                  />
                </View>
              )}
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
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    storage.getState().updateSessionStarred(session.id, !session.starred);
                  }}
                  hitSlop={8}
                  style={styles.starButton}
                >
                  <Ionicons
                    name={session.starred ? 'star' : 'star-outline'}
                    size={14}
                    color={session.starred ? theme.colors.warning : theme.colors.textSecondary}
                  />
                </Pressable>
                <Text style={styles.sessionTimestamp}>
                  {formatLastSeen(session.updatedAt, false)}
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

              {/* Subtitle line */}
              <Text style={styles.sessionSubtitle} numberOfLines={1}>
                {sessionSubtitle}
              </Text>

              {/* Status line with dot and usage */}
              <View style={styles.statusRow}>
                <View style={styles.statusLeft}>
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
                {session.latestUsage ? (
                  <Text style={styles.usageText}>
                    {formatTokenCountShort(
                      session.latestUsage.totalInputTokens +
                        session.latestUsage.totalOutputTokens,
                    )}
                  </Text>
                ) : null}
              </View>
              {latestRequestPreview ? (
                <Text
                  style={[
                    styles.requestPreview,
                    latestRequestPreview.isAutoOptionSend &&
                      styles.requestPreviewAuto,
                  ]}
                  numberOfLines={1}
                >
                  {latestRequestPreview.text}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Tags line - full width at bottom */}
          <View style={styles.tagsRow}>
            <View
              style={[
                styles.tag,
                scopeTone === "branch"
                  ? styles.tagBranch
                  : styles.tagMain,
              ]}
            >
              <Text
                style={[
                  styles.tagText,
                  scopeTone === "branch"
                    ? styles.tagBranchText
                    : styles.tagMainText,
                ]}
              >
                {scopeTone === "branch"
                  ? t("sessionInfo.tagBranch")
                  : t("sessionInfo.tagMain")}
              </Text>
            </View>
            <SessionProviderTag
              session={session}
              includeModel
            />
            {textBadges.map((badge) => (
              <View
                key={`${session.id}-${badge.kind}-${badge.value}`}
                style={[
                  styles.tag,
                  badge.kind === "branchName" && styles.branchNameTag,
                ]}
              >
                {badge.kind === "branchName" ? (
                  <Ionicons
                    name="git-branch-outline"
                    size={11}
                    color={theme.colors.text}
                  />
                ) : null}
                <Text
                  style={[
                    styles.tagText,
                    badge.kind === "branchName" && styles.branchNameTagText,
                  ]}
                  numberOfLines={1}
                >
                  {badge.value}
                </Text>
              </View>
            ))}
            {session.metadata?.tags?.map((tag) => (
              <View
                key={`${session.id}-user-tag-${tag}`}
                style={[styles.tag, { backgroundColor: `${theme.colors.accentBlue}1A` }]}
              >
                <Text
                  style={[styles.tagText, { color: theme.colors.accentBlue }]}
                  numberOfLines={1}
                >
                  {tag}
                </Text>
              </View>
            ))}
            {isAutoOptionSend && (
              <View style={[styles.tag, styles.autoSendBadge]}>
                <Ionicons
                  name="sparkles"
                  size={10}
                  color={styles.autoSendBadgeText.color}
                  style={{ marginRight: 2 }}
                />
                <Text style={[styles.tagText, styles.autoSendBadgeText]}>
                  {t("session.autoOptionSendLabel")}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
      </View>
    );

    const containerStyles = [
      styles.sessionItemContainer,
      isSingle
        ? styles.sessionItemContainerSingle
        : isFirst
          ? styles.sessionItemContainerFirst
          : isLast
            ? styles.sessionItemContainerLast
            : {},
    ];

    const isBusy = deletingSession || reactivatingSession;

    const renderRightActions = () => (
      <View style={{ flexDirection: "row" }}>
        {canReactivate && (
          <Pressable
            style={styles.swipeActionResume}
            onPress={handleReactivate}
            disabled={isBusy}
          >
            <Ionicons
              name={reactivationMode === "resume" ? "play-outline" : "arrow-up-circle-outline"}
              size={20}
              color={theme.colors.button.primary.tint}
            />
            <Text style={styles.swipeActionText} numberOfLines={2}>
              {reactivationMode === "resume"
                ? t("sessionInfo.resumeSession")
                : t("sessionInfo.unarchiveSession")}
            </Text>
          </Pressable>
        )}
        <Pressable
          style={styles.swipeAction}
          onPress={handleDelete}
          disabled={isBusy}
        >
          <Ionicons name="trash-outline" size={20} color={theme.colors.button.primary.tint} />
          <Text style={styles.swipeActionText} numberOfLines={2}>
            {t("sessionInfo.deleteSession")}
          </Text>
        </Pressable>
      </View>
    );

    return (
      <View style={containerStyles}>
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          overshootRight={false}
          enabled={!isBusy}
        >
          {itemContent}
        </Swipeable>
      </View>
    );
  },
);
