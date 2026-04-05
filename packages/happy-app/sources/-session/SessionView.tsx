import { AgentContentView } from "@/components/AgentContentView";
import { AgentInput } from "@/components/AgentInput";
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
import { ChatList, ChatListHandle } from "@/components/ChatList";
import { Deferred } from "@/components/Deferred";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { OptionsPopover } from "@/components/OptionsPopover";
import { SessionKnowledgeSheet } from "@/components/knowledge/SessionKnowledgeSheet";
import { EmptyMessages } from "@/components/EmptyMessages";
import { VoiceAssistantStatusBar } from "@/components/VoiceAssistantStatusBar";
import { useDraft } from "@/hooks/useDraft";
import { useLatestOptions } from "@/hooks/useLatestOptions";
import { BookmarkProvider, useBookmarks } from "@/hooks/useBookmarks";
import { InputContext } from "@/hooks/useInputContext";
import { useSessionIssueInfo } from "@/hooks/useSessionIssueInfo";
import { useBackgroundTasks, BackgroundTask } from "@/hooks/useBackgroundTasks";
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
import { gitStatusSync } from "@/sync/gitStatusSync";
import { sessionAbort, sessionInterrupt, sessionStopTask, sessionBash } from "@/sync/ops";
import {
  storage,
  useIsDataReady,
  useLocalSetting,
  usePromptSuggestion,
  useNeedsContinue,
  useRealtimeStatus,
  useSession,
  useSessionMessages,
  useBackgroundTaskEntries,
  useSessionUsage,
  useSessionContextUsage,
  useSessionKnowledgeCount,
  useProjectForSession,
  useSetting,
} from "@/sync/storage";
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
  formatPathRelativeToHome,
  getSessionAvatarId,
  getSessionName,
  getSessionProviderKey,
  useSessionStatus,
} from "@/utils/sessionUtils";
import { isVersionSupported, MINIMUM_CLI_VERSION } from "@/utils/versionUtils";
import { SessionSidePanel, SIDE_PANEL_MIN_WINDOW_WIDTH } from "@/components/session/SessionSidePanel";
import { ResizableDivider, DIVIDER_WIDTH } from "@/components/session/ResizableDivider";
import { layout } from "@/components/layout";
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
import { Message } from "@/sync/typesMessage";
import { log } from '@/log';

const FILE_EDIT_TOOLS = new Set(["Edit", "edit", "MultiEdit", "Write"]);

function hasFileChanges(messages: readonly Message[]): boolean {
  for (const msg of messages) {
    if (msg.kind === "tool-call") {
      if (msg.tool && FILE_EDIT_TOOLS.has(msg.tool.name) && msg.tool.state === "completed") {
        return true;
      }
      if (msg.children.length > 0 && hasFileChanges(msg.children)) {
        return true;
      }
    }
  }
  return false;
}

export const SessionView = React.memo((props: { id: string }) => {
  const sessionId = props.id;
  const router = useRouter();
  const session = useSession(sessionId);
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
  const toggleSidePanelOuter = React.useCallback(() => {
    storage.getState().applyLocalSettings({ sidePanelCollapsed: !sidePanelCollapsed });
  }, [sidePanelCollapsed]);

  // Actual container width (excludes sidebar navigator etc.)
  const [containerWidth, setContainerWidth] = React.useState(0);
  const handleContainerLayout = React.useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);
  // Use containerWidth when available, fall back to windowWidth
  const effectiveWidth = containerWidth > 0 ? containerWidth : windowWidth;

  // Resizable panel: compute column widths
  const MIN_PANEL_WIDTH = 250;
  const MIN_LEFT_WIDTH = 500;
  const [dragPanelWidth, setDragPanelWidth] = React.useState<number | null>(null);

  // Auto-expand panel on first layout so left column = content maxWidth (no whitespace)
  const hasAutoExpanded = React.useRef(false);
  React.useEffect(() => {
    if (hasAutoExpanded.current || !showSidePanelOuter || sidePanelCollapsed || effectiveWidth <= 0) return;
    const idealPanel = effectiveWidth - layout.maxWidth - DIVIDER_WIDTH;
    if (idealPanel >= MIN_PANEL_WIDTH) {
      storage.getState().applyLocalSettings({ sidePanelWidth: idealPanel });
    }
    hasAutoExpanded.current = true;
  }, [showSidePanelOuter, sidePanelCollapsed, effectiveWidth]);

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
        storage.getState().applyLocalSettings({ sidePanelWidth: prev });
      }
      return null;
    });
  }, []);
  const knowledgeCount = useSessionKnowledgeCount(sessionId);
  const sessionProject = useProjectForSession(sessionId);
  const [showKnowledgeSheet, setShowKnowledgeSheet] = React.useState(false);

  const showAgentActivity = useSetting("showAgentActivity");

  // Dev environment: detect .happy/dev.yml on connected sessions
  const sessionIsConnected = session?.presence === "online";
  const { hasConfig: hasDevConfig } = useDevConfig(sessionId, sessionIsConnected);

  const hasChanges = storage((state) => {
    const msgs = state.sessionMessages[sessionId]?.messages;
    if (!msgs || !hasFileChanges(msgs)) return false;
    // Hide when all changes have been committed (clean working tree)
    const gitStatus = state.getSessionProjectGitStatus(sessionId)
      ?? state.sessionGitStatus[sessionId];
    if (gitStatus && !gitStatus.isDirty) return false;
    return true;
  });

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

    // When showAgentActivity is enabled and agent is thinking, show thinking indicator
    const pathSubtitle = session.metadata?.path
      ? formatPathRelativeToHome(
          session.metadata.path,
          session.metadata?.homeDir,
        )
      : undefined;
    const subtitle =
      showAgentActivity && session.thinking
        ? t("tools.taskView.agentThinking")
        : pathSubtitle;

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
  }, [session, isDataReady, sessionId, router, showAgentActivity, theme]);

  return (
    <>
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
                onBackPress={() => router.back()}
                onRefreshPress={() => sync.refreshSession(sessionId)}
                onPreviewPress={
                  headerProps.isConnected
                    ? () => router.push(`/session/${sessionId}/preview`)
                    : undefined
                }
                onChangesPress={hasChanges ? () => router.push(`/session/${sessionId}/changes`) : undefined}
                devButtonState={headerProps.isConnected ? "idle" : "hidden"}
                onDevPress={headerProps.isConnected ? () => router.push(`/session/${sessionId}/dev` as any) : undefined}
                onDevLongPress={headerProps.isConnected ? () => router.push(`/session/${sessionId}/dev` as any) : undefined}
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
            {/* Centered max-width container — keeps chat content readable on very wide displays */}
            <View style={{ flex: 1, maxWidth: layout.maxWidth, alignSelf: "center", width: "100%" }}>
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
      <SessionKnowledgeSheet
        visible={showKnowledgeSheet}
        onClose={() => setShowKnowledgeSheet(false)}
        projectServerId={sessionProject?.serverId ?? undefined}
        sessionId={sessionId}
      />
    </>
  );
});

function SessionViewLoaded({
  sessionId,
  session,
}: {
  sessionId: string;
  session: Session;
}) {
  return (
    <BookmarkProvider sessionId={sessionId}>
      <SessionViewInner sessionId={sessionId} session={session} />
    </BookmarkProvider>
  );
}

function SessionViewInner({
  sessionId,
  session,
}: {
  sessionId: string;
  session: Session;
}) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();
  const [message, setMessage] = React.useState("");
  const realtimeStatus = useRealtimeStatus();
  const { messages, isLoaded } = useSessionMessages(sessionId);
  const isConnected = session.presence === "online";
  const backgroundTaskEntries = useBackgroundTaskEntries(sessionId);
  const { tasks: backgroundTasks, dismissTask: dismissBackgroundTask } = useBackgroundTasks(backgroundTaskEntries, isConnected);
  const [viewingTask, setViewingTask] = React.useState<BackgroundTask | null>(null);

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
    : (session.metadata?.currentModelCode ?? modelMode?.key);

  const sessionStatus = useSessionStatus(session);
  const sessionUsage = useSessionUsage(sessionId);
  const contextUsage = useSessionContextUsage(sessionId);

  // Clear queued message markers when AI finishes thinking
  const prevThinkingRef = React.useRef(session.thinking);
  React.useEffect(() => {
    if (prevThinkingRef.current && !session.thinking) {
      storage.getState().clearQueuedMessageIds(sessionId);
    }
    prevThinkingRef.current = session.thinking;
  }, [session.thinking, sessionId]);
  const promptSuggestion = usePromptSuggestion(sessionId);
  const needsContinue = useNeedsContinue(sessionId);
  const alwaysShowContextSize = useSetting("alwaysShowContextSize");
  const collapsibleInputEnabled = useSetting("collapsibleInput");

  // Scroll-to-bottom state
  const chatListRef = React.useRef<ChatListHandle>(null);
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);

  // Anchor for options detection — updated by both scroll and nav buttons
  const [scrollAnchor, setScrollAnchor] = React.useState(-1);
  const handleVisibleUserMessage = React.useCallback((msgIndex: number) => {
    setScrollAnchor(msgIndex);
  }, []);

  // Floating options from AI reply at visible/navigated position (or latest)
  const effectiveAnchor = showScrollToBottom ? scrollAnchor : -1;
  const latestOptions = useLatestOptions(messages, effectiveAnchor);
  const [showOptionsPopover, setShowOptionsPopover] = React.useState(false);
  const handleFloatingOptionPress = React.useCallback(
    (option: string) => {
      setShowOptionsPopover(false);
      sync.sendMessage(sessionId, option);
      trackMessageSent();
    },
    [sessionId],
  );

  // Bookmarks
  const { bookmarks, toggleBookmark } = useBookmarks();
  const [showBookmarksPopover, setShowBookmarksPopover] = React.useState(false);
  const handleBookmarkOptionPress = React.useCallback(
    (option: string) => {
      setShowBookmarksPopover(false);
      sync.sendMessage(sessionId, option);
      trackMessageSent();
    },
    [sessionId],
  );

  // Slash command popover
  const [showCommandList, setShowCommandList] = React.useState(false);
  const handleCommandSelect = React.useCallback((command: string) => {
    setShowCommandList(false);
    setMessage(`/${command} `);
  }, []);

  // Append option text to input for editing before sending
  const appendToInput = React.useCallback((text: string) => {
    setMessage((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed}\n${text}` : text;
    });
  }, []);

  const inputContextValue = React.useMemo(
    () => ({ appendToInput }),
    [appendToInput],
  );

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

  // Collapsible input state
  const collapsibleInput = useCollapsibleInput({
    sessionId,
    hasMessages: messages.length > 0,
    promptSuggestion,
    needsContinue,
    isSttListening: false,
    hasPendingImages: pendingImagePaths.length > 0,
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
    (level: string) => {
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

  // Trigger session visibility and initialize git status sync
  React.useLayoutEffect(() => {
    // Trigger session sync
    sync.onSessionVisible(sessionId);

    // Initialize git status sync for this session
    gitStatusSync.getSync(sessionId);
  }, [sessionId, realtimeStatus]);

  const scrollNavProps = {
    onPrevUserMessage: () => {
      chatListRef.current?.scrollToUserMessage("next");
    },
    onNextUserMessage: () => {
      chatListRef.current?.scrollToUserMessage("prev");
    },
    hasUserMessages: (chatListRef.current?.getUserMessageCount() ?? 0) > 0,
    optionCount: latestOptions.length,
    onOptionsPress: () => setShowOptionsPopover(true),
    bookmarkCount: bookmarks.length,
    onBookmarksPress: () => setShowBookmarksPopover(true),
  };

  const handleScrollDown = React.useCallback(() => {
    chatListRef.current?.scrollToBottom();
    setScrollAnchor(-1);
  }, []);

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
  if (session.thinking && !reducerTurnStart && !fallbackTurnStartRef.current) {
    fallbackTurnStartRef.current = Date.now();
  } else if (!session.thinking || reducerTurnStart) {
    fallbackTurnStartRef.current = undefined;
  }
  const turnStartedAt = reducerTurnStart ?? fallbackTurnStartRef.current;

  const fabStatusInfo = React.useMemo<InputFABStatusInfo>(
    () => ({
      statusText: sessionStatus.statusText,
      statusColor: sessionStatus.statusColor,
      statusDotColor: sessionStatus.statusDotColor,
      isPulsing: sessionStatus.isPulsing ?? false,
      permissionLabel: permissionMode?.name,
      permissionColor,
      modelLabel: modelMode?.key && modelMode.key !== "default"
        ? modelMode.name
        : session.resolvedModelId
          ? formatModelName(session.resolvedModelId)
          : modelMode?.name,
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
      isThinking: session.thinking === true,
      turnStartedAt,
    }),
    [
      sessionStatus.statusText,
      sessionStatus.statusColor,
      sessionStatus.statusDotColor,
      sessionStatus.isPulsing,
      permissionMode?.name,
      permissionColor,
      effectiveModelCode,
      modelMode?.name,
      usageSource,
      alwaysShowContextSize,
      session.thinking,
      turnStartedAt,
    ],
  );

  let content = (
    <>
      <Deferred>
        {messages.length > 0 && (
          <ChatList
            ref={chatListRef}
            session={session}
            onScrollAwayFromBottom={setShowScrollToBottom}
            onVisibleUserMessageChange={handleVisibleUserMessage}
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
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
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
      />
      <BackgroundTaskLogSheet
        sessionId={sessionId}
        task={viewingTask}
        onClose={() => setViewingTask(null)}
        onStop={handleCloseTask}
        onPreview={handlePreview}
      />
      <AgentInput
        placeholder={t("session.inputPlaceholder")}
        value={message}
        onChangeText={setMessage}
        sessionId={sessionId}
        permissionMode={permissionMode}
        onPermissionModeChange={updatePermissionMode}
        availableModes={availableModes}
        modelMode={modelMode}
        effectiveModelLabel={
          modelMode?.key && modelMode.key !== "default"
            ? undefined
            : session.resolvedModelId
              ? formatModelName(session.resolvedModelId)
              : undefined
        }
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
        }}
        onSend={() => {
          // Prevent double-tap sending duplicate messages
          if (sendingRef.current) return;
          sendingRef.current = true;
          // Reset after 300ms — covers the realistic double-tap window on all platforms
          setTimeout(() => {
            sendingRef.current = false;
          }, 300);

          const text = message.trim();
          // Special commands (/compact, /clear) don't support images — send command only
          const isSpecialCommand = /^\/(compact|clear)\b/.test(text);

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

          const localIdForSend = randomUUID();
          // Mark as queued before sending if AI is currently thinking
          if (sessionStatus.state === "thinking") {
            storage.getState().addQueuedMessageId(sessionId, localIdForSend);
          }
          Keyboard.dismiss();
          setMessage("");
          clearDraft();
          setPendingImagePaths([]);
          const imageCount = currentPaths.length;
          const displayText =
            imageCount > 0
              ? text ||
                (imageCount === 1
                  ? t("session.sentImage")
                  : t("session.sentImages", { count: imageCount }))
              : undefined;
          sync.sendMessage(sessionId, finalMessage, displayText, {
            localId: localIdForSend,
          });
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
        totalDurationMs={usageSource?.totalDurationMs}
        completedTurnsDurationMs={usageSource?.completedTurnsDurationMs}
        isThinking={session.thinking === true}
        turnStartedAt={turnStartedAt}
      />
    </>
  );

  return (
    <InputContext.Provider value={inputContextValue}>
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
          />
        )}
        <AgentContentView
          content={content}
          input={input}
          placeholder={placeholder}
          inputCollapsed={collapsibleInput.collapsed}
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
            />
          }
        />
        <OptionsPopover
          visible={showOptionsPopover && latestOptions.length > 0}
          options={latestOptions}
          onOptionPress={handleFloatingOptionPress}
          onClose={() => setShowOptionsPopover(false)}
        />
        <OptionsPopover
          visible={showBookmarksPopover && bookmarks.length > 0}
          options={bookmarks}
          onOptionPress={handleBookmarkOptionPress}
          onClose={() => setShowBookmarksPopover(false)}
          title={t("session.bookmarkOption")}
          onRemoveOption={(text) => toggleBookmark(text, "ai")}
        />
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
    </InputContext.Provider>
  );
}
