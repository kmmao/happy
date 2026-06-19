import { AgentContentView } from "@/components/AgentContentView";
import { AgentInput } from "@/components/AgentInput";
import {
  appendPasteBlocksToMessage,
  createPasteBlock,
  type PasteBlock,
} from "@/components/pasteBlock";
import { ElicitationBanner } from "@/components/ElicitationBanner";
import { StopFailureBanner } from "@/components/StopFailureBanner";
import { InputFAB, InputFABStatusInfo } from "@/components/InputFAB";
import { IssueSummaryHeader } from "@/components/IssueSummaryHeader";
import { useCollapsibleInput } from "@/hooks/useCollapsibleInput";
import {
  getAvailableModels,
  getAvailablePermissionModes,
  getDefaultModelKey,
  getDefaultPermissionModeKey,
  resolveCurrentOption,
  formatModelName,
} from "@/components/modelModeOptions";
import type { ModelMode, PermissionMode } from "@/components/modelModeOptions";
import { getSuggestions } from "@/components/autocomplete/suggestions";
import { ChatHeaderView } from "@/components/ChatHeaderView";
import { formatSessionCwdLabel } from "@/components/chatHeaderActiveCwd";
import { OptionScoringMetaProvider } from "@/components/markdown/MarkdownView";
import { ChatList, ChatListHandle, LOAD_MORE_INCREMENT } from "@/components/ChatList";
import { Deferred } from "@/components/Deferred";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { OptionsPopover, type OptionItem } from "@/components/OptionsPopover";
import { SessionKnowledgeSheet } from "@/components/knowledge/SessionKnowledgeSheet";
import { EmptyMessages } from "@/components/EmptyMessages";
import { VoiceAssistantStatusBar } from "@/components/VoiceAssistantStatusBar";
import { useDraft } from "@/hooks/useDraft";
import { useLatestOptions } from "@/hooks/useLatestOptions";
import { BookmarkProvider, useBookmarks } from "@/hooks/useBookmarks";
import { InputContext } from "@/hooks/useInputContext";
import { useSessionIssueInfo } from "@/hooks/useSessionIssueInfo";
import { useBackgroundTasks, BackgroundTask } from "@/hooks/useBackgroundTasks";
import { useRunningSubagents, RunningSubagent } from "@/hooks/useRunningSubagents";
import { BackgroundTaskBar } from "@/components/BackgroundTaskBar";
import { BackgroundTaskLogSheet } from "@/components/BackgroundTaskLogSheet";
import { useDevConfig } from "@/hooks/useDevConfig";
import { buildSmartLabel, extractPort } from "@/utils/commandAnalysis";
import { Modal } from "@/modal";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import {
  startRealtimeSession,
  stopRealtimeSession,
} from "@/realtime/RealtimeSession";
import { sessionInterrupt, sessionStopTask, sessionBash } from "@/sync/ops";
import { QueueBanner, QueuePreviewOverlay, type QueuedMessageItem } from "@/components/QueueBanner";
import { reactivateArchivedSession } from "@/sync/sessionResumeFlow";
import { forkSessionFromMessage } from "@/sync/sessionForkFlow";
import { SessionForkProvider } from "@/hooks/useSessionFork";
import { setSessionForkSource } from "@/sync/apiProjects";
import { useAuth } from "@/auth/AuthContext";
import {
    applySessionStartPreferences,
    buildForkSessionStartPreferences,
} from "@/app/(app)/new/sessionStartPreferences";
import { useNavigateToSession } from "@/hooks/useNavigateToSession";
import { isMachineOnline } from "@/utils/machineUtils";
import type { UserTextMessage } from "@/sync/typesMessage";
import { runWithSessionReactivationGuard } from "@/sync/sessionResumeGuard";
import { resolveSessionReactivationContext } from "@/hooks/sessionResumeSupport";
import { buildSessionRespawnProfile } from "@/hooks/sessionUpgradeProfile";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import {
  storage,
  useIsDataReady,
  useLocalSetting,
  usePromptSuggestion,
  useNeedsContinue,
  useRealtimeStatus,
  useSocketStatus,
  useSession,
  useSessionMessages,
  MAX_DISPLAY_MESSAGES,
  useBackgroundTaskEntries,
  useSessionUsage,
  useSessionContextUsage,
  useSessionKnowledgeCount,
  useProjectForSession,
  useSetting,
  useMachine,
  useSessionTerminalStatus,
} from "@/sync/storage";
import { useSessionUpgrade } from "@/hooks/useSessionUpgrade";
import { Session } from "@/sync/storageTypes";
import { randomUUID } from "expo-crypto";
import { sync } from "@/sync/sync";
import { t } from "@/text";
import { tracking, trackMessageSent } from "@/track";
import { useImageUpload } from "@/hooks/useImageUpload";
import { isRunningOnMac } from "@/utils/platform";
import {
  useDeviceType,
  useHeaderHeight,
  useIsLandscape,
  useIsTablet,
} from "@/utils/responsive";
import {
  applyRunningWorkflowStatus,
  getSessionAvatarId,
  getSessionName,
  getSessionProviderKey,
  isSessionRunning,
  formatTerminalLiveStatus,
  useSessionStatus,
} from "@/utils/sessionUtils";
import { isCavemanActive } from "@/utils/cavemanState";
import { isVersionSupported, MINIMUM_CLI_VERSION } from "@/utils/versionUtils";
import { SessionSidePanel, SIDE_PANEL_MIN_WINDOW_WIDTH } from "@/components/session/SessionSidePanel";
import { MobileSessionPanelSheet } from "@/components/session/MobileSessionPanelSheet";
import { ResizableDivider, DIVIDER_WIDTH } from "@/components/session/ResizableDivider";
import { FilePreviewContext } from "@/components/session/FilePreviewContext";
import { OpenFilesTabBar } from "@/components/session/OpenFilesTabBar";
import { SidePanelFilePreview } from "@/components/session/SidePanelFilePreview";
import { useOpenFilesStack } from "@/components/session/useOpenFilesStack";
import { useLayout } from "@/components/layout";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as React from "react";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";
import { Message, ToolCall } from "@/sync/typesMessage";
import { hasPendingAskUserQuestion } from "@/sync/messageQueries";
import { PermissionSheet } from "@/components/tools/PermissionSheet";
import {
  buildOptionsHash,
  extractContextKeywords,
  rankAndSelectOptions,
  type SessionFollowUpOptionsSnapshot,
} from "./autoOptionSend";
import { getSessionContentMaxWidth } from "./sessionContentWidth";
import { useSessionVisibleEffect } from "./useSessionVisibleEffect";
import { autoOptionSendService } from "@/sync/autoOptionSendService";
import { pendingQueueDispatcher } from "@/sync/pendingQueueDispatcher";
import {
  getAutoOptionFeedbackStats,
  subscribeAutoOptionFeedback,
} from "@/sync/autoOptionFeedback";
import { log } from '@/log';
import { shouldShowMobileSessionPanelButton } from "@/components/session/mobileSessionPanelState";
import { resolveSessionRpcVisualState } from "@/utils/sessionRpcVisualState";
import { buildRpcSummaryText } from "@/components/rpcSummaryVisualState";
import { getReasoningSummaryLabels } from "@/components/reasoningEffort";
import { hackMode } from "@/sync/modeHacks";


type PendingPermissionInfo = {
  toolName: string;
  toolInput: any;
  permission: NonNullable<ToolCall["permission"]>;
};

// Stable empty array reference for Zustand selectors — avoids returning a fresh
// `[]` on every render, which would defeat the default Object.is equality check
// and trigger an infinite re-render loop.
const EMPTY_PENDING_QUEUE: ReadonlyArray<{
  localId: string;
  message: string;
  displayText?: string;
}> = [];

// On web the tab runs in a memory-limited renderer process. Seeding displayLimit
// with the full MAX_DISPLAY_MESSAGES window means a multi-thousand-message session
// feeds the *entire* history into ChatList, which rebuilds several O(n) arrays/maps
// on every streaming token and (with RN-web's weak virtualization) lets the heap
// creep toward Chrome's per-tab ceiling until the tab is killed (error code 5 =
// SBOX_FATAL_MEMORY_EXCEEDED). Start with a small window on web; "load older" pages
// the rest back in on demand. Native keeps the full window.
const INITIAL_DISPLAY_LIMIT = Platform.OS === "web" ? 500 : MAX_DISPLAY_MESSAGES;

function findPendingPermission(messages: readonly Message[]): PendingPermissionInfo | null {
  for (const msg of messages) {
    if (msg.kind !== "tool-call") continue;
    const tool = msg.tool;
    if (tool.permission?.status === "pending") {
      return { toolName: tool.name, toolInput: tool.input, permission: tool.permission };
    }
    if (msg.children.length > 0) {
      const found = findPendingPermission(msg.children);
      if (found) return found;
    }
  }
  return null;
}

export const SessionView = React.memo((props: { id: string }) => {
  const sessionId = props.id;
  const router = useRouter();
  const session = useSession(sessionId);
  const machine = useMachine(session?.metadata?.machineId ?? "");
  const { needsUpgrade, upgrading, handleUpgradeDirect } = useSessionUpgrade(
    session ?? ({ active: false } as Session),
    machine,
  );

  // Resume logic for archived sessions
  const reactivationContext = session && machine
    ? resolveSessionReactivationContext(session, machine)
    : null;
  const canReactivate = session?.presence !== "online" && reactivationContext !== null;

  const [reactivating, performReactivation] = useHappyAction(async () => {
    if (!session || !reactivationContext) {
      throw new HappyError(t("machine.failedToStartSession"), false);
    }
    await runWithSessionReactivationGuard(session.id, async () => {
      const worktree = session.metadata?.worktree;
      const spawnProfile = buildSessionRespawnProfile(
        session,
        storage.getState().settings.profiles ?? [],
      );
      const createResumeRequest = (
        directory?: string,
        approvedNewDirectoryCreation: boolean = false,
      ) => {
        if (reactivationContext.mode !== "resume") {
          throw new HappyError(t("machine.failedToStartSession"), false);
        }
        return {
          ...reactivationContext.resumeContext!.baseSpawnOptions,
          directory: directory ?? reactivationContext.resumeContext!.baseSpawnOptions.directory,
          approvedNewDirectoryCreation,
          ...spawnProfile,
        };
      };
      await reactivateArchivedSession({
        sessionId: session.id,
        mode: reactivationContext.mode,
        onSuccess: () => {},
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
        mapRetryDirectory: (directory) => {
          if (
            reactivationContext.mode === "resume"
            && worktree?.isWorktree
            && worktree.parentRepoPath
            && directory === reactivationContext.resumeContext!.baseSpawnOptions.directory
          ) {
            return worktree.parentRepoPath;
          }
          return directory;
        },
      });
    });
  });

  // ── Fork-from-message wiring ─────────────────────────────────────────────
  //
  // The chat's UserTextBlock long-press handler raises a "duplicate from
  // this message" intent via the SessionForkContext. When the experiment
  // toggle is off we leave `requestDuplicate` undefined so the affordance
  // disappears at the consumer (no UI gating needed in MessageView).
  //
  // The fork itself reuses the same machinery as the session-info page:
  // forkSession RPC → spawnSession with claudeSessionId + forkSourceId →
  // record fork lineage on the server → navigate to the new session.
  const expResumeSession = useSetting("expResumeSession");
  const navigateToSession = useNavigateToSession();
  const auth = useAuth();
  const canForkFromMessage =
    expResumeSession &&
    session?.presence === "online" &&
    !!session?.metadata?.claudeSessionId &&
    !!session?.metadata?.machineId &&
    !!session?.metadata?.path &&
    (!session?.metadata?.flavor || session.metadata.flavor === "claude") &&
    !!machine &&
    isMachineOnline(machine);
  const [, performForkFromMessage] = useHappyAction(async () => {
    const anchor = pendingForkAnchorRef.current;
    pendingForkAnchorRef.current = null;
    if (!anchor || !session || !canForkFromMessage) return;
    const realId = anchor.realId;
    if (!realId) return;
    const spawnProfile = buildSessionRespawnProfile(
      session,
      storage.getState().settings.profiles ?? [],
    );
    const result = await forkSessionFromMessage({
      sourceSessionId: session.id,
      upToMessageId: realId,
      baseSpawnOptions: {
        machineId: session.metadata!.machineId!,
        directory: session.metadata!.path!,
        agent: "claude",
        happySessionId: randomUUID(),
        ...spawnProfile,
      },
    });
    if (result.type === "error") {
      throw new HappyError(result.errorMessage, false);
    }
    if (result.type === "success") {
      await sync.refreshSessions();
      applySessionStartPreferences(
        storage.getState(),
        buildForkSessionStartPreferences(session, result.sessionId),
      );
      if (auth.credentials) {
        await setSessionForkSource(result.sessionId, session.id, auth.credentials);
      }
      Modal.toast(t("sessionInfo.forkSessionSuccess"));
      navigateToSession(result.sessionId);
    }
  });
  const pendingForkAnchorRef = React.useRef<UserTextMessage | null>(null);
  const requestDuplicate = React.useCallback((message: UserTextMessage) => {
    pendingForkAnchorRef.current = message;
    performForkFromMessage();
  }, [performForkFromMessage]);

  const isDataReady = useIsDataReady();
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();
  const headerHeight = useHeaderHeight();
  const realtimeStatus = useRealtimeStatus();
  const isTablet = useIsTablet();
  const { width: windowWidth } = useWindowDimensions();
  const sidePanelCollapsed = useLocalSetting("sidePanelCollapsed");
  const storedPanelWidth = useLocalSetting("sidePanelWidth");
  const sessionIsOnline = session?.presence === "online";
  const showSidePanelOuter = isTablet && windowWidth >= SIDE_PANEL_MIN_WINDOW_WIDTH && !!sessionIsOnline;
  const shouldShowMobilePanelButton = shouldShowMobileSessionPanelButton({
    showSidePanelOuter,
    sessionIsOnline: !!sessionIsOnline,
  });
  const toggleSidePanelOuter = React.useCallback(() => {
    storage.getState().applyLocalSettings({ sidePanelCollapsed: !sidePanelCollapsed });
  }, [sidePanelCollapsed]);

  // Ref bridge: lets SessionSidePanel (outside inner InputContext.Provider) append to input
  const appendToInputRef = React.useRef<(text: string) => void>(() => {});
  const appendToInputOuter = React.useCallback((text: string) => {
    appendToInputRef.current(text);
  }, []);

  // Actual container width (excludes sidebar navigator etc.)
  const [containerWidth, setContainerWidth] = React.useState(0);
  const layout = useLayout();
  const handleContainerLayout = React.useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);
  // Use containerWidth when available, fall back to windowWidth
  const effectiveWidth = containerWidth > 0 ? containerWidth : windowWidth;

  const contentMaxWidth = getSessionContentMaxWidth({
    platform: Platform.OS,
    defaultMaxWidth: layout.maxWidth,
  });

  // Resizable panel: compute column widths
  const MIN_PANEL_WIDTH = 250;
  const MIN_LEFT_WIDTH = 500;
  const [dragPanelWidth, setDragPanelWidth] = React.useState<number | null>(null);

  // Auto-expand panel on first layout so left column = content maxWidth (no whitespace)
  const hasAutoExpanded = React.useRef(false);
  React.useEffect(() => {
    if (hasAutoExpanded.current || !showSidePanelOuter || sidePanelCollapsed || effectiveWidth <= 0) return;
    const idealContentWidth = Number.isFinite(contentMaxWidth) ? contentMaxWidth : effectiveWidth;
    const idealPanel = effectiveWidth - idealContentWidth - DIVIDER_WIDTH;
    if (idealPanel >= MIN_PANEL_WIDTH) {
      storage.getState().applyLocalSettings({ sidePanelWidth: idealPanel });
    }
    hasAutoExpanded.current = true;
  }, [showSidePanelOuter, sidePanelCollapsed, effectiveWidth, contentMaxWidth]);

  const activePanelWidth = dragPanelWidth ?? storedPanelWidth;

  const panelWidths = React.useMemo(() => {
    if (!showSidePanelOuter || sidePanelCollapsed) return { left: effectiveWidth, right: 0 };
    const maxPanel = effectiveWidth - MIN_LEFT_WIDTH - DIVIDER_WIDTH;
    const clampedPanel = Math.max(MIN_PANEL_WIDTH, Math.min(activePanelWidth, maxPanel));
    const leftWidth = effectiveWidth - clampedPanel - DIVIDER_WIDTH;
    return { left: leftWidth, right: clampedPanel };
  }, [showSidePanelOuter, sidePanelCollapsed, effectiveWidth, activePanelWidth]);

  const handlePanelResize = React.useCallback((deltaX: number) => {
    // deltaX > 0 means dragging right → left bigger, panel smaller
    setDragPanelWidth((prev) => {
      const current = prev ?? storedPanelWidth;
      const maxPanel = effectiveWidth - MIN_LEFT_WIDTH - DIVIDER_WIDTH;
      return Math.max(MIN_PANEL_WIDTH, Math.min(current - deltaX, maxPanel));
    });
  }, [storedPanelWidth, windowWidth]);

  const handlePanelResizeEnd = React.useCallback(() => {
    setDragPanelWidth((prev) => {
      if (prev !== null) {
        queueMicrotask(() => storage.getState().applyLocalSettings({ sidePanelWidth: prev }));
      }
      return null;
    });
  }, []);
  const knowledgeCount = useSessionKnowledgeCount(sessionId);
  const sessionProject = useProjectForSession(sessionId);
  const [showKnowledgeSheet, setShowKnowledgeSheet] = React.useState(false);
  const [showMobilePanelSheet, setShowMobilePanelSheet] = React.useState(false);


  // Dev environment: detect .happy/dev.yml on connected sessions
  const sessionIsConnected = session?.presence === "online";
  const { hasConfig: hasDevConfig } = useDevConfig(sessionId, sessionIsConnected);

  // Live TUI status (spinner verb + counters) from terminal-signal events —
  // shown as the header subtitle while the session is running.
  const terminalStatus = useSessionTerminalStatus(sessionId);

  // Compute header props based on session state
  const headerProps = useMemo(() => {
    if (!isDataReady) {
      // Loading state - show empty header
      return {
        title: "",
        subtitle: undefined,
        avatarId: undefined,
        onAvatarPress: undefined,
        isConnected: false,
        flavor: null,
        provider: null,
      };
    }

    if (!session) {
      // Deleted state - show deleted message in header
      return {
        title: t("errors.sessionDeleted"),
        subtitle: undefined,
        avatarId: undefined,
        onAvatarPress: undefined,
        isConnected: false,
        flavor: null,
        provider: null,
      };
    }

    // Normal state - show session info
    const isConnected = session.presence === "online";

    // Header subtitle combines process ID + cwd on a single line so the
    // user can see "what process / where am I" without an extra row.
    // Falls back gracefully when either piece is missing.
    const pidLabel = session.metadata?.hostPid != null
      ? `${t("sessionInfo.processId")} ${session.metadata.hostPid}`
      : null;
    const cwdLabel = formatSessionCwdLabel(
      session.metadata?.activeCwd,
      session.metadata?.path,
    );
    const subtitleParts = [pidLabel, cwdLabel].filter(
      (s): s is string => Boolean(s),
    );
    // While the session is running, the live TUI status line ("Reasoning… ·
    // 12s · 1.2k tokens") beats the static pid·cwd label; it goes stale the
    // moment the turn ends, so idle sessions fall back to pid·cwd.
    const liveStatus = isSessionRunning(session)
      ? formatTerminalLiveStatus(terminalStatus)
      : null;
    const subtitle = liveStatus ?? (subtitleParts.length > 0
      ? subtitleParts.join(" · ")
      : undefined);

    return {
      title: getSessionName(session),
      subtitle,
      avatarId: getSessionAvatarId(session),
      onAvatarPress: () => router.push(`/session/${sessionId}/info`),
      isConnected: isConnected,
      flavor: session.metadata?.flavor || null,
      provider: getSessionProviderKey(session),
      tintColor: isConnected ? theme.colors.text : theme.colors.textSecondary,
    };
  }, [session, isDataReady, sessionId, router, theme, terminalStatus]);

  const handleReload = React.useCallback(() => {
    sync.forceReloadMessages(sessionId);
  }, [sessionId]);

  return (
      <InputContext.Provider value={{ appendToInput: appendToInputOuter }}>
        <React.Fragment>
      {/* Two-column layout: left (header + content) + divider + right (side panel) */}
      <View style={{ flex: 1, flexDirection: showSidePanelOuter ? "row" : "column" }} onLayout={handleContainerLayout}>
        {/* Left column: header + chat content, capped to layout.maxWidth */}
        <View style={showSidePanelOuter && !sidePanelCollapsed
          ? { width: panelWidths.left, minWidth: 0 }
          : { flex: 1, minWidth: 0 }
        }>
          {/* Status bar shadow for landscape mode */}
          {isLandscape && deviceType === "phone" && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: safeArea.top,
                backgroundColor: theme.colors.surface,
                zIndex: 1000,
                shadowColor: theme.colors.shadow.color,
                shadowOffset: {
                  width: 0,
                  height: 2,
                },
                shadowOpacity: theme.colors.shadow.opacity,
                shadowRadius: 3,
                elevation: 5,
              }}
            />
          )}

          {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
          {!(isLandscape && deviceType === "phone" && Platform.OS !== "web") && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
              }}
            >
              <ChatHeaderView
                {...headerProps}
                knowledgeCount={knowledgeCount}
                onKnowledgePress={knowledgeCount > 0 ? () => setShowKnowledgeSheet(true) : undefined}
                onPanelPress={shouldShowMobilePanelButton ? () => setShowMobilePanelSheet(true) : undefined}
                onBackPress={() => router.back()}
                onResumePress={canReactivate ? performReactivation : undefined}
                onForkPress={session?.forkedFromSessionId ? () => router.push(`/session/${session.forkedFromSessionId!}` as any) : undefined}
                devButtonState={headerProps.isConnected && hasDevConfig ? "idle" : "hidden"}
                onDevPress={headerProps.isConnected && hasDevConfig ? () => router.push(`/session/${sessionId}/dev` as any) : undefined}
                onDevLongPress={headerProps.isConnected && hasDevConfig ? () => router.push(`/session/${sessionId}/dev` as any) : undefined}
                onUpgradePress={needsUpgrade && !upgrading ? handleUpgradeDirect : undefined}
                onReloadPress={handleReload}
              />
              {/* Voice status bar below header - not on tablet (shown in sidebar) */}
              {!isTablet && realtimeStatus !== "disconnected" && (
                <VoiceAssistantStatusBar variant="full" />
              )}
            </View>
          )}

          {/* Content based on state */}
          <View
            style={{
              flex: 1,
              paddingTop: !(
                isLandscape &&
                deviceType === "phone" &&
                Platform.OS !== "web"
              )
                ? safeArea.top +
                  headerHeight +
                  (!isTablet && realtimeStatus !== "disconnected" ? 48 : 0)
                : 0,
            }}
          >
            {/* Session view uses full available width on web, while native keeps readable max width */}
            <View style={{ flex: 1, maxWidth: contentMaxWidth, alignSelf: "center", width: "100%" }}>
              {!isDataReady ? (
                // Loading state
                <View
                  style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                >
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.textSecondary}
                  />
                </View>
              ) : !session ? (
                // Deleted state
                <View
                  style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={48}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: 20,
                      marginTop: 16,
                      fontWeight: "600",
                    }}
                  >
                    {t("errors.sessionDeleted")}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: 15,
                      marginTop: 8,
                      textAlign: "center",
                      paddingHorizontal: 32,
                    }}
                  >
                    {t("errors.sessionDeletedDescription")}
                  </Text>
                </View>
              ) : (
                // Normal session view
                <SessionViewLoaded
                  key={sessionId}
                  sessionId={sessionId}
                  session={session}
                  appendToInputRef={appendToInputRef}
                  canReactivate={canReactivate}
                  onReactivate={performReactivation}
                  reactivating={reactivating}
                  requestDuplicate={requestDuplicate}
                />
              )}
            </View>
          </View>
        </View>

        {/* Resizable divider + right column: side panel */}
        {showSidePanelOuter && !sidePanelCollapsed && (
          <ResizableDivider
            onResize={handlePanelResize}
            onResizeEnd={handlePanelResizeEnd}
          />
        )}
        {showSidePanelOuter && (
          <SessionSidePanel
            sessionId={sessionId}
            collapsed={sidePanelCollapsed}
            onToggleCollapse={toggleSidePanelOuter}
          />
        )}
      </View>
      <MobileSessionPanelSheet
        visible={showMobilePanelSheet}
        onClose={() => setShowMobilePanelSheet(false)}
        sessionId={sessionId}
      />
      <SessionKnowledgeSheet
        visible={showKnowledgeSheet}
        onClose={() => setShowKnowledgeSheet(false)}
        projectServerId={sessionProject?.serverId ?? undefined}
        sessionId={sessionId}
      />
        </React.Fragment>
      </InputContext.Provider>
  );
});

function SessionViewLoaded({
  sessionId,
  session,
  appendToInputRef,
  canReactivate,
  onReactivate,
  reactivating,
  requestDuplicate,
}: {
  sessionId: string;
  session: Session;
  appendToInputRef: { current: (text: string) => void };
  canReactivate: boolean;
  onReactivate: () => void;
  reactivating: boolean;
  requestDuplicate?: (message: UserTextMessage) => void;
}) {
  return (
    <BookmarkProvider sessionId={sessionId}>
      <SessionForkProvider requestDuplicate={requestDuplicate}>
        <SessionViewInner
          sessionId={sessionId}
          session={session}
          appendToInputRef={appendToInputRef}
          canReactivate={canReactivate}
          onReactivate={onReactivate}
          reactivating={reactivating}
        />
      </SessionForkProvider>
    </BookmarkProvider>
  );
}

function SessionViewInner({
  sessionId,
  session,
  appendToInputRef,
  canReactivate,
  onReactivate,
  reactivating,
}: {
  sessionId: string;
  session: Session;
  appendToInputRef: { current: (text: string) => void };
  canReactivate: boolean;
  onReactivate: () => void;
  reactivating: boolean;
}) {
  const layout = useLayout();
  const { theme } = useUnistyles();
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();
  // Chat-column multi-file preview stack — independent of the side panel's
  // own stack so opening a file from the @ picker doesn't fight with files
  // browsed in the side panel. Provided via FilePreviewContext to AgentInput.
  const filePreview = useOpenFilesStack();
  // Ref bridge: AgentInput populates this with a function that opens its
  // embedded `@` picker. The chat overlay's "+" button uses it to chain
  // "minimize preview → reopen picker" without the user having to tap `@`.
  const openFilePickerRef = React.useRef<(() => void) | null>(null);
  const handleAddFile = React.useCallback(() => {
    filePreview.minimize();
    openFilePickerRef.current?.();
  }, [filePreview]);
  const [message, setMessage] = React.useState("");
  const [pasteBlocks, setPasteBlocks] = React.useState<PasteBlock[]>([]);
  const [autoOptionSend, setAutoOptionSend] = React.useState(() =>
    autoOptionSendService.getState(sessionId),
  );
  React.useEffect(
    () => autoOptionSendService.subscribe(sessionId, () => {
      setAutoOptionSend(autoOptionSendService.getState(sessionId));
    }),
    [sessionId],
  );
  const realtimeStatus = useRealtimeStatus();
  const socketStatus = useSocketStatus();
  const contentMaxWidth = getSessionContentMaxWidth({
    platform: Platform.OS,
    defaultMaxWidth: layout.maxWidth,
  });
  // Track session column height + AgentInput height to compute exact overlay max height
  const [sessionColumnHeight, setSessionColumnHeight] = React.useState(0);
  const [agentInputHeight, setAgentInputHeight] = React.useState(0);
  // Available space above AgentInput = session column minus the input itself minus a small margin
  const agentInputOverlayMaxHeight =
    sessionColumnHeight > 0 && agentInputHeight > 0
      ? Math.max(80, sessionColumnHeight - agentInputHeight - 8)
      : undefined;
  const [displayLimit, setDisplayLimit] = React.useState(INITIAL_DISPLAY_LIMIT);
  const handleLoadMore = React.useCallback(() => {
    setDisplayLimit((prev) => prev + LOAD_MORE_INCREMENT);
  }, []);
  const [isFetchingOlder, setIsFetchingOlder] = React.useState(false);
  const handleFetchOlderMessages = React.useCallback(async () => {
    setIsFetchingOlder(true);
    try {
      await sync.fetchOlderMessages(sessionId);
    } finally {
      setIsFetchingOlder(false);
    }
  }, [sessionId]);
  const { messages, isLoaded, loadingProgress } = useSessionMessages(sessionId, displayLimit);
  const selectedOptionForEditingRef = React.useRef<{
    text: string;
    optionsHash: string;
  } | null>(null);
  const [autoOptionFeedbackRevision, setAutoOptionFeedbackRevision] = React.useState(0);
  const skipDismissOnCloseRef = React.useRef(false);
  const isConnected = session.presence === "online";
  const sessionProjectInner = useProjectForSession(sessionId);
  const autoOptionFeedbackProjectId = sessionProjectInner?.id ?? `session:${sessionId}`;
  const optionStatsResolver = React.useCallback(
    (optionText: string) =>
      getAutoOptionFeedbackStats(autoOptionFeedbackProjectId, optionText),
    [autoOptionFeedbackProjectId],
  );
  React.useEffect(
    () =>
      subscribeAutoOptionFeedback(autoOptionFeedbackProjectId, () => {
        setAutoOptionFeedbackRevision((prev) => prev + 1);
      }),
    [autoOptionFeedbackProjectId],
  );
  const backgroundTaskEntries = useBackgroundTaskEntries(sessionId);
  const { tasks: backgroundTasks, dismissTask: dismissBackgroundTask } = useBackgroundTasks(backgroundTaskEntries, isConnected);
  const [viewingTask, setViewingTask] = React.useState<BackgroundTask | null>(null);

  // Sub-agents (Agent/Task tool calls) that are still running. Derived from
  // the rendered message tree because the reducer only flags them via
  // `tool.state === "running"` — there's no separate background-task entry.
  // Surfaced in BackgroundTaskBar so a sidechain investigation in flight is
  // visible above the input bar, even when the main timeline has scrolled away.
  const runningSubagents = useRunningSubagents(messages, isConnected);

  // Close the log sheet when the viewed task is no longer running (e.g. session went offline)
  React.useEffect(() => {
    if (!viewingTask) return;
    const entry = backgroundTaskEntries.get(viewingTask.taskId);
    if (!entry || entry.status !== "running") {
      setViewingTask(null);
    }
  }, [viewingTask, backgroundTaskEntries]);

  const handleCloseTask = React.useCallback(
    async (task: BackgroundTask) => {
      // Only attempt to stop background tasks; foreground tasks just get dismissed
      if (task.isBackground && task.status === "running") {
        const label = buildSmartLabel(task.command);
        const port = extractPort(task.command);
        const detail = port
          ? t("backgroundTasks.stopConfirmDetail", { name: label, port })
          : t("backgroundTasks.stopConfirmDetailNoPort", { name: label });
        const confirmed = await Modal.confirm(
          t("backgroundTasks.stopConfirmTitle"),
          detail,
          { destructive: true, confirmText: t("backgroundTasks.stop") },
        );
        if (!confirmed) return;

        // Dismiss immediately so the panel disappears, then stop in background
        dismissBackgroundTask(task.taskId);
        if (viewingTask?.taskId === task.taskId) {
          setViewingTask(null);
        }

        // Stop process async — don't block UI
        const isDocker = /\bdocker\s+run\b/i.test(task.command);
        const dockerName = task.command.match(/--name\s+(\S+)/)?.[1];

        sessionStopTask(sessionId, task.taskId)
          .then(() => {
            // SDK stopTask stops tracking but Docker containers keep running
            if (isDocker && dockerName) {
              sessionBash(sessionId, {
                command: `docker stop ${dockerName} 2>/dev/null || true`,
              }).catch(() => {});
            }
          })
          .catch(() => {
            // stopTask fails when idle — fallback to direct kill
            if (isDocker && dockerName) {
              sessionBash(sessionId, {
                command: `docker stop ${dockerName} 2>/dev/null || true`,
              }).catch(() => {});
            } else if (port) {
              sessionBash(sessionId, {
                command: `lsof -ti :${port} | xargs kill 2>/dev/null || true`,
              }).catch(() => {});
            } else {
              const actualCmd = task.command.replace(/^cd\s+\S+\s*[;&|]+\s*/i, "");
              sessionBash(sessionId, {
                command: `pkill -f ${JSON.stringify(actualCmd.slice(0, 80))} 2>/dev/null || true`,
              }).catch(() => {});
            }
          });
        return;
      }
      dismissBackgroundTask(task.taskId);
      if (viewingTask?.taskId === task.taskId) {
        setViewingTask(null);
      }
    },
    [sessionId, viewingTask, dismissBackgroundTask],
  );
  const handlePreview = React.useCallback(
    (url: string) => {
      router.push(`/session/${sessionId}/preview?url=${encodeURIComponent(url)}`);
    },
    [router, sessionId],
  );

  const { issueLink, issueBody } = useSessionIssueInfo(sessionId);
  const acknowledgedCliVersions = useLocalSetting("acknowledgedCliVersions");

  // Check if CLI version is outdated and not already acknowledged
  const cliVersion = session.metadata?.version;
  const machineId = session.metadata?.machineId;
  const isCliOutdated =
    cliVersion && !isVersionSupported(cliVersion, MINIMUM_CLI_VERSION);
  const isAcknowledged =
    machineId && acknowledgedCliVersions[machineId] === cliVersion;
  const shouldShowCliWarning = isCliOutdated && !isAcknowledged;

  // Metadata-driven mode/model selection
  const flavor = session.metadata?.flavor;
  const availableModels = React.useMemo(
    () => getAvailableModels(flavor, session.metadata, t, session.customModels),
    [flavor, session.metadata, session.customModels],
  );
  const availableModes = React.useMemo(
    () => getAvailablePermissionModes(flavor, session.metadata, t),
    [flavor, session.metadata],
  );

  const permissionMode = React.useMemo<PermissionMode | null>(
    () =>
      resolveCurrentOption(availableModes, [
        session.permissionMode,
        session.metadata?.currentOperatingModeCode,
        getDefaultPermissionModeKey(flavor),
      ]),
    [
      availableModes,
      session.permissionMode,
      session.metadata?.currentOperatingModeCode,
      flavor,
    ],
  );

  const modelMode = React.useMemo<ModelMode | null>(
    () =>
      resolveCurrentOption(availableModels, [
        session.modelMode,
        session.metadata?.currentModelCode,
        getDefaultModelKey(flavor),
      ]),
    [
      availableModels,
      session.modelMode,
      session.metadata?.currentModelCode,
      flavor,
    ],
  );

  // Build effective model code for context window detection.
  // Claude API returns model IDs without [1m] suffix (e.g., "claude-sonnet-4-6"),
  // so we append it when the model mode indicates 1M context.
  // Falls back to the mode key itself (e.g., "sonnet-1m") if currentModelCode is absent.
  const effectiveModelCode = modelMode?.key && modelMode.key !== "default"
    ? modelMode.key
    : (session.pinnedModelId ?? session.metadata?.currentModelCode ?? modelMode?.key);

  const baseSessionStatus = useSessionStatus(session);
  // A running background Workflow overrides the idle/thinking status so the
  // user can tell a workflow is in progress (see applyRunningWorkflowStatus).
  const hasRunningWorkflow = React.useMemo(
    () => backgroundTasks.some((task) => task.isWorkflow),
    [backgroundTasks],
  );
  const cavemanActive = React.useMemo(
    () => isCavemanActive(messages),
    [messages],
  );
  const handleCavemanPress = React.useCallback(async () => {
    // Toggle the caveman skill: when inactive, just send `/caveman` (enabling
    // it has no destructive side effects, so we skip the confirm); when active,
    // keep the confirm so the user doesn't disable the mode by accident.
    if (cavemanActive) {
      const confirmed = await Modal.confirm(
        t("session.cavemanCloseTitle"),
        t("session.cavemanCloseMessage"),
        { confirmText: t("common.ok"), destructive: true },
      );
      if (!confirmed) return;
      storage.getState().appendToPendingQueue(sessionId, {
        localId: randomUUID(),
        message: "stop caveman",
      });
      trackMessageSent();
      return;
    }
    storage.getState().appendToPendingQueue(sessionId, {
      localId: randomUUID(),
      message: "/caveman",
    });
    trackMessageSent();
  }, [sessionId, cavemanActive]);
  const sessionStatus = React.useMemo(
    () => applyRunningWorkflowStatus(baseSessionStatus, hasRunningWorkflow),
    [baseSessionStatus, hasRunningWorkflow],
  );
  const modelSummaryRpcState = React.useMemo(
    () =>
      resolveSessionRpcVisualState({
        presence: session.presence,
        realtimeStatus: socketStatus.status,
        rpcReady: session.rpcReady,
      }),
    [socketStatus.status, session.presence, session.rpcReady],
  );
  const isSessionInputDisabled = modelSummaryRpcState !== "rpcReady";
  const disabledInputPlaceholder = React.useMemo(() => {
    if (modelSummaryRpcState === "reconnecting") {
      return t("agentInput.inputDisabledReconnecting");
    }
    if (modelSummaryRpcState === "rpcPending") {
      return t("agentInput.inputDisabledRpcPending");
    }
    if (modelSummaryRpcState === "disconnected") {
      return t("agentInput.inputDisabledDisconnected");
    }
    return null;
  }, [modelSummaryRpcState]);
  const sessionUsage = useSessionUsage(sessionId);
  const contextUsage = useSessionContextUsage(sessionId);
  const isRunning = isSessionRunning(session);
  const isCodex = flavor === "codex";
  const isGemini = flavor === "gemini";
  const requiresAction = session.sdkSessionState === "requires_action";
  const hasPendingPermission = sessionStatus.state === "permission_required";
  const [showPermissionSheet, setShowPermissionSheet] = React.useState(false);
  const pendingPermission = React.useMemo(() => {
    if (!hasPendingPermission) return null;
    // Prefer agentState.requests — available even when the permission message
    // has scrolled past the MAX_DISPLAY_MESSAGES pagination window.
    const requests = session.agentState?.requests;
    if (requests) {
      const entries = Object.entries(requests);
      const entry =
        entries.find(([, req]) => req.tool === "AskUserQuestion") ?? entries[0];
      if (entry) {
        const [permId, req] = entry;
        return {
          toolName: req.tool,
          toolInput: req.arguments,
          permission: { id: permId, status: "pending" as const },
        };
      }
    }
    // Fallback: search the visible messages tree
    return findPendingPermission(messages);
  }, [hasPendingPermission, session.agentState?.requests, messages]);

  // Auto-close the sheet when the permission is resolved
  React.useEffect(() => {
    if (!hasPendingPermission) {
      setShowPermissionSheet(false);
    }
  }, [hasPendingPermission]);

  const sessionStateLogKey = React.useMemo(() => JSON.stringify({
    sdkSessionState: session.sdkSessionState ?? null,
    thinking: session.thinking === true,
    needsAttention: session.needsAttention === true,
    hasPermissionRequests: Boolean(
      session.agentState?.requests && Object.keys(session.agentState.requests).length > 0,
    ),
    hasElicitation: session.agentState?.elicitation != null,
    statusState: sessionStatus.state,
    isRunning,
    requiresAction,
    hasPendingPermission,
  }), [
    isRunning,
    requiresAction,
    hasPendingPermission,
    session.agentState?.elicitation,
    session.agentState?.requests,
    session.needsAttention,
    session.sdkSessionState,
    session.thinking,
    sessionStatus.state,
  ]);

  const prevSessionStateLogKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (prevSessionStateLogKeyRef.current === sessionStateLogKey) {
      return;
    }
    prevSessionStateLogKeyRef.current = sessionStateLogKey;
    if (__DEV__) {
      log.log("[session-state]", sessionId, sessionStateLogKey);
    }
  }, [sessionId, sessionStateLogKey]);

  // Pending queue: messages held locally while AI is running, sent one by one after each turn.
  // Stored in Zustand so the queue survives tab/session switches.
  const pendingQueue = storage(
    (s) => s.sessionPendingQueues[sessionId] ?? EMPTY_PENDING_QUEUE,
  );
  const queuePaused = storage(
    (s) => s.sessionPendingQueuePaused[sessionId] ?? false,
  );
  const [previewQueueItem, setPreviewQueueItem] = React.useState<{
    item: QueuedMessageItem;
    startInEdit: boolean;
  } | null>(null);
  const pendingQueueRef = React.useRef(pendingQueue);
  pendingQueueRef.current = pendingQueue;

  // Pending queue dispatch is owned by sync/pendingQueueDispatcher so queued
  // messages continue sending even when this SessionView is not mounted.

  // (V6) Deliberately no auto-close-when-item-vanishes effect. Previously the
  // effect closed the overlay the moment the previewed item left the queue,
  // which silently wiped any unsaved edits when auto-dispatch shifted it. Now
  // the overlay stays open; if the user clicks Save/Save&Send on an item that
  // is already gone, `handleSaveQueuedEdit` / `handleSaveAndSendQueuedEdit`
  // return false and the overlay surfaces a stale-error banner.
  //
  // Explicit user actions that delete the item (chip ×) call setPreviewQueueItem
  // (null) inline so the overlay still closes promptly in that path.

  const queuedMessages = React.useMemo(
    () =>
      pendingQueue.map((item) => {
        // Count `[image: /path]` segments so the chip can render a camera badge.
        const imageMatches = item.message.match(/\[image:\s*[^\]]+\]/g) ?? [];
        const imageCount = imageMatches.length;
        // Strip image tags out of the raw message to derive a text-only preview when
        // displayText is missing (e.g. for older items persisted before this field).
        const textOnly = item.message.replace(/\[image:\s*[^\]]+\]/g, "").trim();
        const hasOnlyImages = imageCount > 0 && textOnly.length === 0;

        let displayText: string;
        if (item.displayText && item.displayText.length > 0) {
          // The composer already produced a sensible label — trust it, but if
          // displayText accidentally contains image tags (legacy persisted
          // items) fall back to the synthesised label.
          displayText = item.displayText.includes("[image:")
            ? (imageCount === 1
                ? t("session.sentImage")
                : t("session.sentImages", { count: imageCount }))
            : item.displayText;
        } else if (hasOnlyImages) {
          displayText = imageCount === 1
            ? t("session.sentImage")
            : t("session.sentImages", { count: imageCount });
        } else {
          displayText = textOnly.slice(0, 200);
        }

        return {
          localId: item.localId,
          displayText,
          fullMessage: item.message,
          imageCount,
          hasOnlyImages,
        };
      }),
    [pendingQueue],
  );

  const handleCancelQueuedItem = React.useCallback((localId: string) => {
    storage.getState().removePendingQueueItem(sessionId, localId);
    // If the user is currently previewing/editing the same item, close the
    // overlay too — the auto-close effect was removed (V6) so we have to do
    // this explicitly on intentional cancel.
    setPreviewQueueItem((prev) => (prev && prev.item.localId === localId ? null : prev));
  }, [sessionId]);

  const handleTogglePaused = React.useCallback(() => {
    const current = storage.getState().sessionPendingQueuePaused[sessionId] ?? false;
    storage.getState().setPendingQueuePaused(sessionId, !current);
  }, [sessionId]);

  const handleEditQueuedItem = React.useCallback((item: QueuedMessageItem) => {
    setPreviewQueueItem({ item, startInEdit: true });
  }, []);

  const handleOpenPreview = React.useCallback((item: QueuedMessageItem) => {
    setPreviewQueueItem({ item, startInEdit: false });
  }, []);

  const handleSaveQueuedEdit = React.useCallback(
    (localId: string, message: string, displayText: string | undefined) => {
      const ok = storage.getState().updatePendingQueueItem(sessionId, localId, {
        message,
        displayText,
      });
      if (!ok) return false;
      // V7: refresh the previewQueueItem snapshot so the overlay's preview
      // mode (and re-edit/cancel paths) operate on the SAVED content, not the
      // pre-edit snapshot the user opened the overlay with. We recompute
      // imageCount / hasOnlyImages from the new message so chip metadata stays
      // accurate too.
      setPreviewQueueItem((prev) => {
        if (!prev || prev.item.localId !== localId) return prev;
        const imageMatches = message.match(/\[image:\s*[^\]]+\]/g) ?? [];
        const imageCount = imageMatches.length;
        const textOnly = message.replace(/\[image:\s*[^\]]+\]/g, "").trim();
        const hasOnlyImages = imageCount > 0 && textOnly.length === 0;
        return {
          ...prev,
          item: {
            ...prev.item,
            fullMessage: message,
            displayText: displayText ?? prev.item.displayText,
            imageCount,
            hasOnlyImages,
          },
        };
      });
      return true;
    },
    [sessionId],
  );

  const handleSaveAndSendQueuedEdit = React.useCallback(
    (localId: string, message: string, displayText: string | undefined) => {
      const ok = storage.getState().updatePendingQueueItem(sessionId, localId, {
        message,
        displayText,
      });
      if (!ok) return false;

      storage.getState().reorderPendingQueueItemToFront(sessionId, localId);
      if (isRunning) {
        void sessionInterrupt(sessionId).finally(() => {
          pendingQueueDispatcher.schedule(sessionId, { ignorePaused: true });
        });
      } else {
        pendingQueueDispatcher.schedule(sessionId, { ignorePaused: true });
      }

      return true;
    },
    [sessionId, isRunning],
  );

  const handleSendNow = React.useCallback(() => {
    void sessionInterrupt(sessionId).finally(() => {
      pendingQueueDispatcher.schedule(sessionId, { ignorePaused: true });
    });
    // If the previewed item is currently at the head of the queue, it's the
    // one about to be drained — close the overlay so we don't leave a stale
    // snapshot behind. Items further back in the queue are NOT affected by
    // this action, so the preview stays open for them. (V6 still applies for
    // auto-dispatch: only explicit user actions close the overlay.)
    setPreviewQueueItem((prev) => {
      if (!prev) return prev;
      const head = storage.getState().sessionPendingQueues[sessionId]?.[0];
      return head && head.localId === prev.item.localId ? null : prev;
    });
  }, [sessionId]);

  const handleSendItemNow = React.useCallback((localId: string) => {
    storage.getState().reorderPendingQueueItemToFront(sessionId, localId);
    void sessionInterrupt(sessionId).finally(() => {
      pendingQueueDispatcher.schedule(sessionId, { ignorePaused: true });
    });
    // The chip ▶ action explicitly targets THIS item — reorder-to-front +
    // interrupt guarantees it will be the next drain. If the overlay is
    // showing the same item, close it so the user doesn't see a stale
    // snapshot once it ships. (V6 still applies for auto-dispatch.)
    setPreviewQueueItem((prev) => (prev && prev.item.localId === localId ? null : prev));
  }, [sessionId]);

  const rawPromptSuggestion = usePromptSuggestion(sessionId);
  const needsContinue = useNeedsContinue(sessionId);
  const alwaysShowContextSize = useSetting("alwaysShowContextSize");
  const collapsibleInputEnabled = useSetting("collapsibleInput");

  // Scroll-to-bottom state
  const chatListRef = React.useRef<ChatListHandle>(null);
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);

  // Tapping a running sub-agent chip in BackgroundTaskBar should scroll the
  // timeline to that sub-agent's tool-call card. Stable callback so the chip
  // doesn't re-render every tick of its elapsed-time counter.
  const handleSubagentPress = React.useCallback((subagent: RunningSubagent) => {
    chatListRef.current?.scrollToMessage(subagent.messageId);
  }, []);

  // Anchor for options detection — updated by both scroll and nav buttons
  const [scrollAnchor, setScrollAnchor] = React.useState(-1);
  const handleVisibleUserMessage = React.useCallback((msgIndex: number) => {
    setScrollAnchor(msgIndex);
  }, []);

  // Floating options from AI reply at visible/navigated position (or latest)
  // Clamp scrollAnchor to the local messages array length — ChatList may use a
  // larger displayLimit, producing indices beyond SessionView's message slice.
  const effectiveAnchor = showScrollToBottom
    ? Math.min(scrollAnchor, messages.length - 1)
    : -1;
  const latestOptions = useLatestOptions(messages, effectiveAnchor);
  const latestOptionsHash = React.useMemo(
    () => buildOptionsHash(latestOptions.items),
    [latestOptions.items],
  );
  React.useEffect(() => {
    const run = () => {
      if (latestOptions.items.length >= 2) {
        autoOptionSendService.triggerScoringIfNeeded(sessionId, latestOptions.items, latestOptionsHash);
      } else if (latestOptions.items.length === 0) {
        autoOptionSendService.triggerGenerationIfNeeded(sessionId);
      }
    };
    run();
    // Retry after 3s in case sync wasn't authenticated on initial render
    const timer = setTimeout(run, 3000);
    return () => clearTimeout(timer);
  }, [sessionId, latestOptionsHash]);

  const sessionContextKeywords = React.useMemo(() => {
    const recentTexts: string[] = [];
    let count = 0;
    for (const msg of messages) {
      if (count >= 5) break;
      if (msg.kind === "agent-text" || msg.kind === "user-text") {
        recentTexts.push(msg.text);
        count++;
      }
    }
    return extractContextKeywords(recentTexts);
  }, [messages]);
  const rankedLatestOptions = React.useMemo(
    () => {
      if (latestOptions.items.length < 2) return null;
      const semanticScores = autoOptionSendService.getSemanticScores(latestOptionsHash);
      return rankAndSelectOptions(latestOptions.items, optionStatsResolver, sessionContextKeywords, semanticScores ?? undefined);
    },
    [latestOptions.items, optionStatsResolver, autoOptionFeedbackRevision, sessionContextKeywords, latestOptionsHash, autoOptionSend],
  );
  const recommendedOptionIndex = rankedLatestOptions?.recommendedIndex ?? null;
  const recommendedOptionText =
    recommendedOptionIndex !== null
      ? latestOptions.items[recommendedOptionIndex] ?? null
      : null;
  const optionScores = rankedLatestOptions?.allScores ?? null;
  const llmScoredIndices = React.useMemo(() => {
    const semantic = autoOptionSendService.getSemanticScores(latestOptionsHash);
    if (!semantic) return null;
    return new Set(semantic.keys());
  }, [latestOptionsHash, autoOptionSend]);
  const hasPendingAskUserQuestionVisible = React.useMemo(
    () => hasPendingAskUserQuestion(messages),
    [messages],
  );
  const currentOptionsSnapshot = React.useMemo<SessionFollowUpOptionsSnapshot | null>(() => {
    if (latestOptions.items.length < 2) return null;
    return {
      sourceType: "markdown-options",
      sourceMessageId: latestOptions.sourceMessageId,
      items: [...latestOptions.items],
      recommendedIndex: recommendedOptionIndex,
      optionsHash: latestOptionsHash,
    };
  }, [latestOptions, latestOptionsHash, recommendedOptionIndex]);
  // When the SDK sends a prompt-suggestion, override the text with the recommended
  // option from the options list (if one exists) so the input chip and the 推荐 badge
  // always point to the same option. The lifecycle (null ↔ non-null) is unchanged —
  // the chip still appears/disappears based on rawPromptSuggestion, avoiding stale
  // chip issues after the user sends a message.
  const promptSuggestion = React.useMemo(() => {
    if (!rawPromptSuggestion) return null;
    if (recommendedOptionText) {
      return recommendedOptionText;
    }
    return rawPromptSuggestion;
  }, [recommendedOptionText, rawPromptSuggestion]);

  const [showOptionsPopover, setShowOptionsPopover] = React.useState(false);
  const handleFloatingOptionPress = React.useCallback(
    (option: string) => {
      autoOptionSendService.recordManualSend(
        sessionId,
        option,
        latestOptionsHash,
        false,
        "manual",
      );
      autoOptionSendService.dispatch(sessionId, {
        type: "context-invalidated",
        reason: "manual-send",
      });
      setShowOptionsPopover(false);
      // Always enqueue — see the onSend handler for the rationale. Even though
      // floating-option taps are usually well-spaced, the same dual-path race
      // exists: a quick double-tap on two different options while AI is briefly
      // idle would send both directly.
      storage.getState().appendToPendingQueue(sessionId, {
        localId: randomUUID(),
        message: option,
      });
      trackMessageSent();
    },
    [sessionId, latestOptionsHash],
  );

  const { bookmarks, toggleBookmark } = useBookmarks();
  const [showBookmarksPopover, setShowBookmarksPopover] = React.useState(false);
  const [collapsedOverlayHeight, setCollapsedOverlayHeight] = React.useState(0);
  const handleBookmarkOptionPress = React.useCallback(
    (option: string) => {
      setShowBookmarksPopover(false);
      // Always enqueue — same rationale as the onSend handler.
      storage.getState().appendToPendingQueue(sessionId, {
        localId: randomUUID(),
        message: option,
      });
      trackMessageSent();
    },
    [sessionId],
  );

  // Slash command popover
  const [showCommandList, setShowCommandList] = React.useState(false);
  const handleCommandSelect = React.useCallback((text: string) => {
    setShowCommandList(false);
    setMessage(text);
  }, []);

  const handleLargeTextPaste = React.useCallback((text: string) => {
    setPasteBlocks((prev) => [
      ...prev,
      createPasteBlock(`paste-${Date.now()}-${prev.length}`, text, {
        fallbackPreview: t("session.pastedContent"),
        summary: (params) => t("session.pastedContentSummary", params),
      }),
    ]);
  }, [t]);

  const handlePasteBlockRemove = React.useCallback((id: string) => {
    setPasteBlocks((prev) => prev.filter((block) => block.id !== id));
  }, []);

  const handlePasteBlockSave = React.useCallback((id: string, text: string) => {
    setPasteBlocks((prev) =>
      prev.map((block) =>
        block.id !== id
          ? block
          : createPasteBlock(id, text, {
              fallbackPreview: t("session.pastedContent"),
              summary: (params) => t("session.pastedContentSummary", params),
            }),
      ),
    );
  }, [t]);

  // Append option text to input for editing before sending
  const appendToInput = React.useCallback((text: string) => {
    const isCurrentOption = latestOptions.items.includes(text);
    if (isCurrentOption) {
      selectedOptionForEditingRef.current = {
        text,
        optionsHash: latestOptionsHash,
      };
    }

    setMessage((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n${text}` : text;
    });
  }, [latestOptions.items, latestOptionsHash]);

  const inputContextValue = React.useMemo(
    () => ({ appendToInput }),
    [appendToInput],
  );

  // Track option copied to input for edit-send attribution
  React.useEffect(() => {
    if (!message.trim()) return;
    const selected = selectedOptionForEditingRef.current;
    if (!selected) return;
    if (!message.includes(selected.text)) {
      selectedOptionForEditingRef.current = null;
    }
  }, [message]);

  // Keep outer InputContext.Provider (SessionView level) in sync so SessionSidePanel can use it
  React.useEffect(() => {
    appendToInputRef.current = appendToInput;
  }, [appendToInput, appendToInputRef]);

  // Use draft hook for auto-saving message drafts
  const { clearDraft } = useDraft(sessionId, message, setMessage);

  React.useEffect(() => {
    storage.getState().markSessionViewed(sessionId);
  }, [sessionId]);

  // Image sending state (pick, paste, pending paths)
  const {
    pendingImagePaths,
    isPickingImage,
    isProcessingImage,
    pendingImagePathsRef,
    doPickImage,
    doTakePhoto,
    doPickFile,
    handleImagePaste,
    handleFilePaste,
    setPendingImagePaths,
    pendingImageUris,
    fileNameMap,
    removeImageByPath,
  } = useImageUpload(sessionId);

  const handleAutoOptionSendToggle = React.useCallback(
    (enabled: boolean) => {
      autoOptionSendService.toggle(sessionId, enabled);
    },
    [sessionId],
  );

  // While the user is viewing this session, notify the service about context
  // changes (typing, ask-user-question) so it can pause appropriately.
  const hasServiceOptions = autoOptionSend.status === "armed" || autoOptionSend.status === "ready";
  React.useEffect(() => {
    if (!autoOptionSend.enabled) return;
    if (
      message.trim().length === 0 &&
      !hasPendingAskUserQuestionVisible &&
      (currentOptionsSnapshot || hasServiceOptions)
    ) {
      return;
    }
    const reason =
        message.trim().length > 0
          ? "user-typed"
          : hasPendingAskUserQuestionVisible
            ? "ask-user-question"
            : "options-missing";
    if (__DEV__) {
      console.log('[autoSend.effect→invalidate]', {
        reason,
        status: autoOptionSend.status,
        hasSnapshot: !!currentOptionsSnapshot,
        hasServiceOpts: hasServiceOptions,
        msgLen: message.trim().length,
      });
    }
    autoOptionSendService.dispatch(sessionId, {
      type: "context-invalidated",
      reason,
    });
  }, [
    autoOptionSend.enabled,
    message,
    hasPendingAskUserQuestionVisible,
    currentOptionsSnapshot,
    hasServiceOptions,
    sessionId,
  ]);

  // Keep the auto-option-send service aware of UI context so that
  // canFire guards work correctly even on timer-triggered paths.
  React.useEffect(() => {
    autoOptionSendService.updateUIContext(sessionId, {
      inputText: appendPasteBlocksToMessage(message, pasteBlocks),
      hasPendingImages: pendingImagePaths.length > 0 || pasteBlocks.length > 0,
      isSttListening: false,
    });
  }, [sessionId, message, pasteBlocks, pendingImagePaths]);

  // Collapsible input state
  const collapsibleInput = useCollapsibleInput({
    sessionId,
    hasMessages: messages.length > 0,
    promptSuggestion,
    needsContinue,
    requiresAction,
    isSttListening: false,
    hasPendingImages: pendingImagePaths.length > 0 || pasteBlocks.length > 0,
  });

  // Guard against double-tap send — 300ms debounce covers the realistic fat-finger window.
  // queueMicrotask was insufficient because RN bridge batching can deliver two taps in separate frames.
  const sendingRef = React.useRef(false);

  // Handle dismissing CLI version warning
  const handleDismissCliWarning = React.useCallback(() => {
    if (machineId && cliVersion) {
      storage.getState().applyLocalSettings({
        acknowledgedCliVersions: {
          ...acknowledgedCliVersions,
          [machineId]: cliVersion,
        },
      });
    }
  }, [machineId, cliVersion, acknowledgedCliVersions]);

  // Function to update permission mode
  const updatePermissionMode = React.useCallback(
    (mode: PermissionMode) => {
      storage.getState().updateSessionPermissionMode(sessionId, mode.key);
    },
    [sessionId],
  );

  const updateModelMode = React.useCallback(
    (mode: ModelMode) => {
      storage.getState().updateSessionModelMode(sessionId, mode.key);
      sync.applySettings({ lastUsedModelMode: mode.key });
    },
    [sessionId],
  );

  // SDK settings callbacks
  const updateThinkingMode = React.useCallback(
    (mode: string) => {
      storage
        .getState()
        .updateSessionSdkSettings(sessionId, { thinkingMode: mode });
      sync.applySettings({ lastUsedThinkingMode: mode });
    },
    [sessionId],
  );

  const updateEffortLevel = React.useCallback(
    (level: string | null) => {
      storage
        .getState()
        .updateSessionSdkSettings(sessionId, { effortLevel: level });
      sync.applySettings({ lastUsedEffortLevel: level });
    },
    [sessionId],
  );

  const updateMaxBudgetUsd = React.useCallback(
    (budget: number | null) => {
      storage
        .getState()
        .updateSessionSdkSettings(sessionId, { maxBudgetUsd: budget });
    },
    [sessionId],
  );

  const updateTaskBudgetTokens = React.useCallback(
    (tokens: number | null) => {
      storage
        .getState()
        .updateSessionSdkSettings(sessionId, { taskBudgetTokens: tokens });
    },
    [sessionId],
  );

  // Handle microphone button press - memoized to prevent button flashing
  const handleMicrophonePress = React.useCallback(async () => {
    if (realtimeStatus === "connecting") {
      return; // Prevent actions during transitions
    }
    if (realtimeStatus === "disconnected" || realtimeStatus === "error") {
      try {
        const initialContext = voiceHooks.onVoiceStarted(sessionId);
        await startRealtimeSession(sessionId, initialContext);
        tracking?.capture("voice_session_started", { sessionId });
      } catch (error) {
        log.error("Failed to start realtime session:", error);
        Modal.alert(t("common.error"), t("errors.voiceSessionFailed"));
        tracking?.capture("voice_session_error", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } else if (realtimeStatus === "connected") {
      await stopRealtimeSession();
      tracking?.capture("voice_session_stopped");

      // Notify voice assistant about voice session stop
      voiceHooks.onVoiceStopped();
    }
  }, [realtimeStatus, sessionId]);

  // Memoize mic button state to prevent flashing during chat transitions
  const micButtonState = useMemo(
    () => ({
      onMicPress: handleMicrophonePress,
      isMicActive:
        realtimeStatus === "connected" || realtimeStatus === "connecting",
    }),
    [handleMicrophonePress, realtimeStatus],
  );

  // Avoid layout-blocking work and duplicate refreshes when realtime status changes.
  useSessionVisibleEffect(sessionId);

  const scrollNavProps = {
    onPrevUserMessage: () => {
      chatListRef.current?.scrollToUserMessage("next");
    },
    onNextUserMessage: () => {
      chatListRef.current?.scrollToUserMessage("prev");
    },
    hasUserMessages: (chatListRef.current?.getUserMessageCount() ?? 0) > 0,
    optionCount: latestOptions.items.length > 0
      ? latestOptions.items.length
      : (autoOptionSendService.getGeneratedOptions(sessionId)?.length ?? 0),
    onOptionsPress: () => setShowOptionsPopover(true),
    bookmarkCount: bookmarks.length,
    onBookmarksPress: () => setShowBookmarksPopover(true),
  };

  const handleScrollDown = React.useCallback(() => {
    chatListRef.current?.scrollToBottom();
    setScrollAnchor(-1);
  }, []);

  const handleRequiresActionPress = React.useCallback(() => {
    if (pendingPermission) {
      setShowPermissionSheet(true);
    } else {
      // Fallback: scroll to bottom if no specific permission found
      chatListRef.current?.scrollToBottom();
      setScrollAnchor(-1);
    }
  }, [pendingPermission]);

  // Permission mode color mapping
  const permissionModeKey = permissionMode?.key;
  const permissionColor = permissionModeKey
    ? ((theme.colors.permission as Record<string, string>)[permissionModeKey] ??
      theme.colors.textSecondary)
    : undefined;

  const usageSource = sessionUsage ?? session.latestUsage;

  // Primary: turn start time from reducer (survives page refresh).
  // Fallback: ref frozen at first thinking=true (covers the gap before
  // the "Turn started" message arrives through the message stream).
  const reducerTurnStart = usageSource?.currentTurnStartedAt;
  const fallbackTurnStartRef = React.useRef<number | undefined>(undefined);
  if (isRunning && !reducerTurnStart && !fallbackTurnStartRef.current) {
    fallbackTurnStartRef.current = Date.now();
  } else if (!isRunning || reducerTurnStart) {
    fallbackTurnStartRef.current = undefined;
  }
  const turnStartedAt = reducerTurnStart ?? fallbackTurnStartRef.current;

  const autoOptionSendControl = React.useMemo(
    () => ({
      visible: true,
      enabled: autoOptionSend.enabled,
      remainingMs:
        autoOptionSend.status === "armed" || autoOptionSend.status === "ready"
          ? (autoOptionSend.remainingMs ?? 0)
          : null,
      onToggle: handleAutoOptionSendToggle,
    }),
    [latestOptions.items.length, autoOptionSend.enabled, autoOptionSend.status, autoOptionSend.remainingMs, handleAutoOptionSendToggle],
  );

  const effectiveModelLabel = React.useMemo(
    () =>
      modelMode?.key && modelMode.key !== "default"
        ? undefined
        : session.resolvedModelId
          ? formatModelName(session.resolvedModelId)
          : session.pinnedModelId
            ? formatModelName(session.pinnedModelId)
            : undefined,
    [
      modelMode?.key,
      session.pinnedModelId,
      session.resolvedModelId,
    ],
  );

  const displayPermissionLabel = React.useMemo(() => {
    if (!permissionMode) {
      return null;
    }

    const label = hackMode(permissionMode).name;
    const sandbox = session.metadata?.sandbox as unknown;
    const isSandboxEnabled = !sandbox
      ? false
      : typeof sandbox === "object" && sandbox !== null && "enabled" in sandbox
        ? Boolean((sandbox as { enabled?: unknown }).enabled)
        : true;

    if (!isSandboxEnabled) {
      return label;
    }

    if (permissionMode.key === "bypassPermissions" || permissionMode.key === "yolo") {
      return `${label} (sandboxed)`;
    }

    return label;
  }, [permissionMode, session.metadata?.sandbox]);

  const fabModelSummaryText = React.useMemo(
    () =>
      buildRpcSummaryText({
        permissionLabel: displayPermissionLabel,
        modelLabel:
          modelMode?.key && modelMode.key !== "default"
            ? modelMode.name
            : effectiveModelLabel,
        reasoningLabels: getReasoningSummaryLabels({
          isCodex,
          isGemini,
          reasoning: {
            effortLevel: session.effortLevel,
            thinkingMode: session.thinkingMode,
          },
          translate: t,
        }),
      }),
    [
      displayPermissionLabel,
      effectiveModelLabel,
      isCodex,
      isGemini,
      modelMode?.key,
      modelMode?.name,
      session.effortLevel,
      session.thinkingMode,
    ],
  );

  const fabStatusInfo = React.useMemo<InputFABStatusInfo>(
    () => ({
      statusText: sessionStatus.statusText,
      statusColor: sessionStatus.statusColor,
      statusDotColor: sessionStatus.statusDotColor,
      isPulsing: sessionStatus.isPulsing ?? false,
      permissionLabel: displayPermissionLabel ?? permissionMode?.name,
      permissionColor,
      rpcState: modelSummaryRpcState,
      modelLabel: modelMode?.key && modelMode.key !== "default"
        ? modelMode.name
        : effectiveModelLabel ?? modelMode?.name,
      modelSummaryText: fabModelSummaryText,
      contextSize: usageSource?.contextSize,
      contextWindow: usageSource?.contextWindow,
      totalSessionTokens:
        usageSource && "totalInputTokens" in usageSource
          ? (usageSource.totalInputTokens ?? 0) +
            (usageSource.totalOutputTokens ?? 0)
          : undefined,
      totalCostUsd: usageSource?.totalCostUsd,
      alwaysShowContext: alwaysShowContextSize,
      modelCode: effectiveModelCode,
      totalDurationMs: usageSource?.totalDurationMs,
      completedTurnsDurationMs: usageSource?.completedTurnsDurationMs,
      isThinking: isRunning,
      turnStartedAt,
      onStatusPress: hasPendingPermission ? handleRequiresActionPress : undefined,
      cavemanActive,
      onCavemanPress: handleCavemanPress,
    }),
    [
      sessionStatus.statusText,
      sessionStatus.statusColor,
      sessionStatus.statusDotColor,
      sessionStatus.isPulsing,
      hasPendingPermission,
      handleRequiresActionPress,
      displayPermissionLabel,
      permissionMode?.name,
      permissionColor,
      modelSummaryRpcState,
      effectiveModelLabel,
      fabModelSummaryText,
      effectiveModelCode,
      modelMode?.key,
      modelMode?.name,
      usageSource,
      alwaysShowContextSize,
      isRunning,
      turnStartedAt,
      cavemanActive,
      handleCavemanPress,
    ],
  );

  let content = (
    <>
      <Deferred>
        {messages.length > 0 && (
          <ChatList
            ref={chatListRef}
            session={session}
            displayLimit={displayLimit}
            onLoadMore={handleLoadMore}
            onFetchOlderMessages={handleFetchOlderMessages}
            isFetchingOlder={isFetchingOlder}
            onScrollAwayFromBottom={setShowScrollToBottom}
            onVisibleUserMessageChange={handleVisibleUserMessage}
            contentMaxWidth={contentMaxWidth}
          />
        )}
      </Deferred>
      {!collapsibleInput.collapsed && (
        <ScrollToBottomButton
          visible={showScrollToBottom && messages.length > 0}
          onPress={handleScrollDown}
          {...scrollNavProps}
          onCollapseInput={
            collapsibleInputEnabled ? collapsibleInput.collapse : undefined
          }
          hasPendingAction={
            !showScrollToBottom && collapsibleInput.hasPendingAction
          }
          onPendingActionPress={collapsibleInput.expand}
          autoOptionSend={autoOptionSendControl}
        />
      )}
    </>
  );
  const placeholder =
    messages.length === 0 ? (
      <>
        {isLoaded ? (
          <EmptyMessages session={session} />
        ) : (
          <>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            {loadingProgress !== null && loadingProgress.total > 0 && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 8 }}>
                {t("session.loadingProgress", {
                  percent: Math.round((loadingProgress.loaded / loadingProgress.total) * 100),
                  loaded: loadingProgress.loaded,
                  total: loadingProgress.total,
                })}
              </Text>
            )}
          </>
        )}
      </>
    ) : null;

  const input = (
    <>
      <BackgroundTaskBar
        sessionId={sessionId}
        tasks={backgroundTasks}
        onViewLog={setViewingTask}
        onClose={handleCloseTask}
        onDismiss={dismissBackgroundTask}
        onPreview={handlePreview}
        subagents={runningSubagents}
        onSubagentPress={handleSubagentPress}
      />
      <BackgroundTaskLogSheet
        sessionId={sessionId}
        task={viewingTask}
        onClose={() => setViewingTask(null)}
        onStop={handleCloseTask}
        onPreview={handlePreview}
      />
      <QueueBanner
        queuedMessages={queuedMessages}
        onSendNow={handleSendNow}
        onSendItemNow={handleSendItemNow}
        onCancelItem={handleCancelQueuedItem}
        onOpenPreview={handleOpenPreview}
        onEditItem={handleEditQueuedItem}
        isRunning={isRunning}
        paused={queuePaused}
        onTogglePaused={handleTogglePaused}
      />
      <View onLayout={(e) => setAgentInputHeight(e.nativeEvent.layout.height)}>
      <AgentInput
        placeholder={t("session.inputPlaceholder")}
        disabledPlaceholder={disabledInputPlaceholder}
        openFilePickerRef={openFilePickerRef}
        value={message}
        onChangeText={setMessage}
        pasteBlocks={pasteBlocks}
        onLargeTextPaste={handleLargeTextPaste}
        onPasteBlockRemove={handlePasteBlockRemove}
        onPasteBlockSave={handlePasteBlockSave}
        sessionId={sessionId}
        overlayMaxHeight={agentInputOverlayMaxHeight}
        permissionMode={permissionMode}
        onPermissionModeChange={updatePermissionMode}
        availableModes={availableModes}
        contentMaxWidth={contentMaxWidth}
        modelMode={modelMode}
        effectiveModelLabel={effectiveModelLabel}
        availableModels={availableModels}
        onModelModeChange={updateModelMode}
        reasoning={{
          thinkingMode: session.thinkingMode,
          effortLevel: session.effortLevel,
          maxBudgetUsd: session.maxBudgetUsd,
          taskBudgetTokens: session.taskBudgetTokens,
          onThinkingModeChange: updateThinkingMode,
          onEffortLevelChange: updateEffortLevel,
          onMaxBudgetUsdChange: updateMaxBudgetUsd,
          onTaskBudgetTokensChange: updateTaskBudgetTokens,
        }}
        metadata={session.metadata}
        connectionStatus={{
          text: sessionStatus.statusText,
          color: sessionStatus.statusColor,
          dotColor: sessionStatus.statusDotColor,
          isPulsing: sessionStatus.isPulsing,
          cavemanActive: cavemanActive,
          onCavemanPress: handleCavemanPress,
        }}
        modelSummaryRpcState={modelSummaryRpcState}
        isInputDisabled={isSessionInputDisabled}
        isSendDisabled={isSessionInputDisabled}
        sendIcon={isRunning ? (
          <Ionicons name="time-outline" size={17} color={theme.colors.button.primary.tint} />
        ) : undefined}
        onSend={async () => {
          // Prevent double-tap sending duplicate messages
          if (sendingRef.current) return;
          sendingRef.current = true;
          // Reset after 300ms — covers the realistic double-tap window on all platforms
          setTimeout(() => {
            sendingRef.current = false;
          }, 300);

          const visibleText = message.trim();
          // Special commands (/compact, /clear) don't support images or paste blocks — send command only
          const isSpecialCommand = /^\/(compact|clear)\b/.test(visibleText);
          // When caveman mode is active and the user issues /clear, ask
          // whether to re-enable caveman after the wipe. /clear nukes the
          // conversation context, so by the time pendingQueueDispatcher
          // drains the message isCavemanActive(messages) will already
          // return false — capture the choice now, before we enqueue.
          // Both modal outcomes still send /clear; the choice only
          // controls whether to chain /caveman behind it.
          const isClearCmd = /^\/clear\b/.test(visibleText);
          let reEnableCavemanAfterClear = false;
          if (isClearCmd && cavemanActive) {
            reEnableCavemanAfterClear = await Modal.confirm(
              t("session.cavemanKeepAfterClearTitle"),
              t("session.cavemanKeepAfterClearMessage"),
              {
                confirmText: t("session.cavemanKeepAfterClearKeep"),
                cancelText: t("session.cavemanKeepAfterClearClearOnly"),
              },
            );
          }
          const text = appendPasteBlocksToMessage(
            visibleText,
            isSpecialCommand ? [] : pasteBlocks,
          );

          // Read from ref to avoid stale closure — the ref is always current
          const currentPaths = isSpecialCommand
            ? []
            : pendingImagePathsRef.current;
          const imageRefs = currentPaths.map((p) => {
            const name = fileNameMap.get(p);
            return name ? `[image: ${p} | ${name}]` : `[image: ${p}]`;
          }).join("\n");
          const finalMessage = [text, imageRefs].filter(Boolean).join("\n");

          if (!finalMessage) return;

          const selected = selectedOptionForEditingRef.current;
          if (selected && text.includes(selected.text)) {
            autoOptionSendService.recordManualSend(
              sessionId,
              selected.text,
              selected.optionsHash,
              true,
              "manual",
            );
            selectedOptionForEditingRef.current = null;
          }

          const localIdForSend = randomUUID();
          Keyboard.dismiss();
          setMessage("");
          clearDraft();
          setPendingImagePaths([]);
          setPasteBlocks([]);
          const imageCount = currentPaths.length;
          const displayText =
            imageCount > 0
              ? visibleText ||
                (imageCount === 1
                  ? t("session.sentImage")
                  : t("session.sentImages", { count: imageCount }))
              : visibleText || pasteBlocks[0]?.summary;
          // Always enqueue. The auto-dispatch effect drains one-at-a-time when
          // AI is idle, so when the user is idle there is just a one-tick hop
          // through the queue. The dual-path "if isRunning enqueue else send
          // directly" pattern caused a race: two rapid sends in the short
          // window where isRunning has not yet been pushed back from the
          // server would BOTH take the direct-send branch and burst onto the
          // wire, bypassing every queue/pause/dispatch guard. Funneling all
          // sends through the queue is the only way to make that race
          // unrepresentable.
          storage.getState().appendToPendingQueue(sessionId, {
            localId: localIdForSend,
            message: finalMessage,
            displayText,
          });
          // Chain /caveman behind /clear when the user opted to keep
          // caveman after clearing. pendingQueueDispatcher drains
          // one-at-a-time when AI is idle, so /caveman only lands once
          // /clear has fully cleared the context.
          if (isClearCmd && reEnableCavemanAfterClear) {
            storage.getState().appendToPendingQueue(sessionId, {
              localId: randomUUID(),
              message: "/caveman",
            });
          }
          trackMessageSent();
        }}
        onMicPress={micButtonState.onMicPress}
        isMicActive={micButtonState.isMicActive}
        onAbort={() => sessionInterrupt(sessionId)}
        showAbortButton={
          sessionStatus.state === "thinking" ||
          sessionStatus.state === "waiting"
        }
        onFileViewerPress={() => router.push(`/session/${sessionId}/git`)}
        // Autocomplete configuration
        autocompletePrefixes={["@", "/"]}
        autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
        usageData={
          sessionUsage
            ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize,
                totalInputTokens: sessionUsage.totalInputTokens ?? 0,
                totalOutputTokens: sessionUsage.totalOutputTokens ?? 0,
                totalCostUsd: sessionUsage.totalCostUsd,
                contextWindow: sessionUsage.contextWindow,
              }
            : session.latestUsage
              ? {
                  inputTokens: session.latestUsage.inputTokens,
                  outputTokens: session.latestUsage.outputTokens,
                  cacheCreation: session.latestUsage.cacheCreation,
                  cacheRead: session.latestUsage.cacheRead,
                  contextSize: session.latestUsage.contextSize,
                  totalInputTokens: session.latestUsage.totalInputTokens ?? 0,
                  totalOutputTokens: session.latestUsage.totalOutputTokens ?? 0,
                  totalCostUsd: session.latestUsage.totalCostUsd,
                  contextWindow: session.latestUsage.contextWindow,
                }
              : undefined
        }
        alwaysShowContextSize={alwaysShowContextSize}
        sdkContextUsage={contextUsage}
        currentModelCode={effectiveModelCode}
        images={{
          onImagePaste: handleImagePaste,
          onFilePaste: handleFilePaste,
          onImagePickPress: doPickImage,
          onTakePhotoPress: doTakePhoto,
          onFilePickPress: doPickFile,
          isPickingImage: isPickingImage || isProcessingImage,
          imagePaths: pendingImagePaths,
          imageUris: pendingImageUris,
          fileNameMap,
          onImageRemove: removeImageByPath,
        }}
        onShellCommand={(command) => {
          sync.sendMessage(sessionId, `$ ${command}`);
        }}
        packageScripts={session.metadata?.packageScripts}
        commands={{
          onSlashCommandPress: () => setShowCommandList(true),
          showCommandList,
          onCommandSelect: handleCommandSelect,
          onCommandListClose: () => setShowCommandList(false),
        }}
        promptSuggestion={promptSuggestion}
        onPromptSuggestionPress={(text) => {
          storage.getState().setPromptSuggestion(sessionId, null);
          sync.sendMessage(sessionId, text);
        }}
        needsContinue={needsContinue}
        onContinuePress={() => {
          sync.sendMessage(sessionId, "", undefined, { continue: true });
        }}
        requiresAction={hasPendingPermission || requiresAction}
        onRequiresActionPress={handleRequiresActionPress}
        totalDurationMs={usageSource?.totalDurationMs}
        completedTurnsDurationMs={usageSource?.completedTurnsDurationMs}
        isThinking={isRunning}
        turnStartedAt={turnStartedAt}
      />
      </View>
    </>
  );

  return (
    <>
    <OptionScoringMetaProvider value={autoOptionSend.candidate?.scoringMeta ?? null}>
    <InputContext.Provider value={inputContextValue}>
    <FilePreviewContext.Provider value={filePreview}>
      {/* CLI Version Warning Overlay - Subtle centered pill */}
      {shouldShowCliWarning && !(isLandscape && deviceType === "phone") && (
        <Pressable
          onPress={handleDismissCliWarning}
          style={({ pressed }) => ({
            position: "absolute",
            top: 8, // Position at top of content area (padding handled by parent)
            alignSelf: "center",
            backgroundColor: theme.colors.box.warning.background,
            borderRadius: 100, // Fully rounded pill
            paddingHorizontal: 14,
            paddingVertical: 7,
            flexDirection: "row",
            alignItems: "center",
            zIndex: 998, // Below voice bar but above content
            shadowColor: theme.colors.shadow.color,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 4,
            elevation: 4,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons
            name="warning-outline"
            size={14}
            color={theme.colors.accentOrange}
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.box.warning.text,
              fontWeight: "600",
            }}
          >
            {t("sessionInfo.cliVersionOutdated")}
          </Text>
          <Ionicons
            name="close"
            size={14}
            color={theme.colors.box.warning.text}
            style={{ marginLeft: 8 }}
          />
        </Pressable>
      )}

      {/* Main content area - no padding since header is overlay */}
      <View
        style={{
          flexBasis: 0,
          flexGrow: 1,
          paddingBottom:
            safeArea.bottom +
            (isRunningOnMac() || Platform.OS === "web" ? 16 : 0),
        }}
        onLayout={(e) => setSessionColumnHeight(e.nativeEvent.layout.height)}
      >
        {/* Issue summary header for issue-linked sessions */}
        {issueLink && (
          <IssueSummaryHeader
            issueLink={issueLink}
            issueBody={issueBody}
            prUrl={issueLink.prUrl ?? session.metadata?.worktree?.prUrl}
            worktree={
              session.metadata?.worktree?.isWorktree
                ? {
                    branchName: session.metadata.worktree.branchName,
                    parentBranch: session.metadata.worktree.parentBranch,
                  }
                : null
            }
          />
        )}
        {session.agentState?.elicitation && (
          <ElicitationBanner
            sessionId={sessionId}
            elicitation={session.agentState.elicitation}
          />
        )}
        {session.agentState?.stopFailure && session.presence !== "online" && (
          <StopFailureBanner
            stopFailure={session.agentState.stopFailure}
            onRestart={canReactivate ? onReactivate : undefined}
            restarting={reactivating}
          />
        )}
        <AgentContentView
          content={content}
          input={input}
          placeholder={placeholder}
          inputCollapsed={collapsibleInput.collapsed}
          collapsedOverlayBottomInset={collapsedOverlayHeight}
          collapsedOverlay={
            <InputFAB
              visible={collapsibleInput.collapsed}
              onExpandPress={collapsibleInput.expand}
              hasPendingAction={
                !showScrollToBottom && collapsibleInput.hasPendingAction
              }
              showScrollDown={showScrollToBottom && messages.length > 0}
              onScrollDown={handleScrollDown}
              {...scrollNavProps}
              statusInfo={fabStatusInfo}
              autoOptionSend={autoOptionSendControl}
              onHeightChange={setCollapsedOverlayHeight}
            />
          }
        />
        <OptionsPopover
          visible={showOptionsPopover && (latestOptions.items.length > 0 || (autoOptionSendService.getGeneratedOptions(sessionId)?.length ?? 0) > 0)}
          options={latestOptions.items.length > 0 ? latestOptions.items : (autoOptionSendService.getGeneratedOptions(sessionId) ?? []).map((text): OptionItem => ({ text, source: "ai" }))}
          onOptionPress={handleFloatingOptionPress}
          onCopyOption={(text) => {
            skipDismissOnCloseRef.current = true;
            selectedOptionForEditingRef.current = {
              text,
              optionsHash: latestOptionsHash,
            };
          }}
          onClose={() => {
            if (skipDismissOnCloseRef.current) {
              skipDismissOnCloseRef.current = false;
              setShowOptionsPopover(false);
              return;
            }
            if (recommendedOptionText) {
              autoOptionSendService.recordDismiss(
                sessionId,
                recommendedOptionText,
                latestOptionsHash,
              );
            }
            setShowOptionsPopover(false);
          }}
          title=
{
            autoOptionSendControl.enabled && autoOptionSendControl.remainingMs != null
              ? t("session.autoOptionSendTitleCountdown", {
                  seconds: Math.max(
                    1,
                    Math.ceil(autoOptionSendControl.remainingMs / 1000),
                  ),
                })
              : t("session.autoOptionSendTitle")
          }
          recommendedIndex={recommendedOptionIndex}
          recommendedRemainingMs={autoOptionSendControl.remainingMs}
          scores={optionScores}
          llmScoredIndices={llmScoredIndices}
        />
        <OptionsPopover
          visible={showBookmarksPopover && bookmarks.length > 0}
          options={bookmarks}
          onOptionPress={handleBookmarkOptionPress}
          onClose={() => setShowBookmarksPopover(false)}
          title={t("session.bookmarkOption")}
          onRemoveOption={(text) => toggleBookmark(text, "ai")}
        />
        {previewQueueItem != null && (
          <QueuePreviewOverlay
            // S8: keying by localId remounts the overlay when the user opens
            // a different queue item, so internal state (isEditing, editText,
            // editImages, staleError) is reset cleanly. Same-localId updates
            // — e.g. V7's post-save refresh — keep the same mount and just
            // re-render with new props.
            key={previewQueueItem.item.localId}
            item={previewQueueItem.item}
            startInEdit={previewQueueItem.startInEdit}
            onClose={() => setPreviewQueueItem(null)}
            onSendNow={isRunning && handleSendItemNow
              ? () => {
                  handleSendItemNow(previewQueueItem.item.localId);
                  setPreviewQueueItem(null);
                }
              : undefined
            }
            onSaveEdit={handleSaveQueuedEdit}
            onSaveAndSend={handleSaveAndSendQueuedEdit}
          />
        )}

        {/* Multi-file preview overlay for the chat column. Mirrors the side
          * panel's overlay but is driven by FilePreviewContext, so e.g. files
          * tapped in AgentInput's `@` picker land here instead of the legacy
          * /file deep-link route.
          *
          * The overlay leaves `agentInputHeight + 8` of room at the bottom so
          * AgentInput stays visible — the user can keep drafting / paste /
          * `@`-mention more files without dismissing the preview. Before the
          * input has been measured, fall through to a full-screen overlay
          * (covers nothing important, since no message has been drafted yet
          * either). */}
        {filePreview.previewVisible &&
          filePreview.openFiles.length > 0 && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: agentInputHeight > 0 ? agentInputHeight + 8 : 0,
                backgroundColor: theme.colors.surface,
              }}
            >
              <OpenFilesTabBar
                files={filePreview.openFiles}
                activeIndex={filePreview.activeIndex}
                onTabPress={filePreview.pressTab}
                onTabClose={filePreview.closeTab}
                onAddFile={handleAddFile}
              />
              {filePreview.openFiles.map((file, index) => (
                <View
                  key={file.filePath}
                  style={{
                    flex: 1,
                    display:
                      index === filePreview.activeIndex ? "flex" : "none",
                  }}
                >
                  <SidePanelFilePreview
                    sessionId={sessionId}
                    filePath={file.filePath}
                    repoPath={file.repoPath}
                    onClose={filePreview.minimize}
                  />
                </View>
              ))}
            </View>
          )}
      </View>

      {/* Back button for landscape phone mode when header is hidden */}
      {isLandscape && deviceType === "phone" && (
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            position: "absolute",
            top: safeArea.top + 8,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `rgba(${theme.dark ? "28, 23, 28" : "255, 255, 255"}, 0.9)`,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
            ...Platform.select({
              ios: {
                shadowColor: theme.colors.shadow.color,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: theme.colors.shadow.opacity,
                shadowRadius: 4,
              },
              android: {
                elevation: 2,
              },
            }),
          })}
          hitSlop={15}
        >
          <Ionicons
            name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
            size={Platform.select({ ios: 28, default: 24 })}
            color={theme.colors.text}
          />
        </Pressable>
      )}
    </FilePreviewContext.Provider>
    </InputContext.Provider>
    </OptionScoringMetaProvider>
    {showPermissionSheet && pendingPermission != null && (
      <PermissionSheet
        visible={showPermissionSheet}
        sessionId={sessionId}
        toolName={pendingPermission.toolName}
        toolInput={pendingPermission.toolInput}
        permission={pendingPermission.permission}
        metadata={session.metadata ?? null}
        onClose={() => setShowPermissionSheet(false)}
      />
    )}
    </>
  );
}
