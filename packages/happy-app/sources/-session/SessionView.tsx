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
import { EmptyMessages } from "@/components/EmptyMessages";
import { VoiceAssistantStatusBar } from "@/components/VoiceAssistantStatusBar";
import { useDraft } from "@/hooks/useDraft";
import { useLatestOptions } from "@/hooks/useLatestOptions";
import { BookmarkProvider, useBookmarks } from "@/hooks/useBookmarks";
import { InputContext } from "@/hooks/useInputContext";
import { useSessionIssueInfo } from "@/hooks/useSessionIssueInfo";
import { Modal } from "@/modal";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import {
  startRealtimeSession,
  stopRealtimeSession,
} from "@/realtime/RealtimeSession";
import { gitStatusSync } from "@/sync/gitStatusSync";
import { sessionAbort, sessionInterrupt } from "@/sync/ops";
import {
  storage,
  useIsDataReady,
  useLocalSetting,
  usePromptSuggestion,
  useNeedsContinue,
  useRealtimeStatus,
  useSession,
  useSessionMessages,
  useSessionUsage,
  useSetting,
} from "@/sync/storage";
import { Session } from "@/sync/storageTypes";
import { randomUUID } from "expo-crypto";
import { sync } from "@/sync/sync";
import { t } from "@/text";
import { tracking, trackMessageSent } from "@/track";
import { useImageUpload } from "@/hooks/useImageUpload";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { correctTranscript } from "@/sync/apiStt";
import { TokenStorage } from "@/auth/tokenStorage";
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
  useSessionStatus,
} from "@/utils/sessionUtils";
import { isVersionSupported, MINIMUM_CLI_VERSION } from "@/utils/versionUtils";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "react-native-unistyles";
import { Message } from "@/sync/typesMessage";

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

  const showAgentActivity = useSetting("showAgentActivity");

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
      tintColor: isConnected ? "#000" : "#8E8E93",
    };
  }, [session, isDataReady, sessionId, router, showAgentActivity]);

  return (
    <>
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
            onBackPress={() => router.back()}
            onRefreshPress={() => sync.refreshSession(sessionId)}
            onPreviewPress={
              headerProps.isConnected
                ? () => router.push(`/session/${sessionId}/preview`)
                : undefined
            }
            onChangesPress={hasChanges ? () => router.push(`/session/${sessionId}/changes`) : undefined}
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
    handleImagePaste,
    setPendingImagePaths,
    pendingImageUris,
    removeImageByPath,
  } = useImageUpload(sessionId);

  // Speech-to-text: append transcripts to the input field
  const voiceAssistantLanguage = useSetting("voiceAssistantLanguage");
  const [isSttCorrecting, setIsSttCorrecting] = React.useState(false);

  const handleTranscript = React.useCallback((text: string) => {
    setMessage((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${text}` : text;
    });
  }, []);

  const stt = useSpeechToText(
    handleTranscript,
    voiceAssistantLanguage ?? undefined,
  );

  // Correct full input content when STT stops listening
  const prevListeningRef = React.useRef(false);
  const messageRef = React.useRef(message);
  messageRef.current = message;
  React.useEffect(() => {
    const wasListening = prevListeningRef.current;
    prevListeningRef.current = stt.isListening;
    if (
      wasListening &&
      !stt.isListening &&
      storage.getState().settings.sttCorrection
    ) {
      const text = messageRef.current.trim();
      if (!text) return;
      let cancelled = false;
      setIsSttCorrecting(true);
      (async () => {
        try {
          const credentials = await TokenStorage.getCredentials();
          if (credentials && !cancelled) {
            const corrected = await correctTranscript(
              credentials,
              text,
              voiceAssistantLanguage ?? undefined,
            );
            if (!cancelled && corrected !== text) {
              setMessage(corrected);
            }
          }
        } catch {
          // Keep original text
        } finally {
          if (!cancelled) {
            setIsSttCorrecting(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [stt.isListening, voiceAssistantLanguage]);

  // Collapsible input state
  const collapsibleInput = useCollapsibleInput({
    sessionId,
    hasMessages: messages.length > 0,
    promptSuggestion,
    needsContinue,
    isSttListening: stt.isListening,
    hasPendingImages: pendingImagePaths.length > 0,
  });

  // Compute display value: message + real-time interim speech text
  const displayMessage = stt.interimTranscript
    ? message.trimEnd()
      ? `${message.trimEnd()} ${stt.interimTranscript}`
      : stt.interimTranscript
    : message;

  // STT toggle: tap to start/stop
  const onSttToggle = React.useCallback(() => {
    if (stt.isListening) {
      stt.stopListening();
    } else {
      stt.startListening();
    }
  }, [stt]);

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

  // Handle microphone button press - memoized to prevent button flashing
  const handleMicrophonePress = React.useCallback(async () => {
    if (realtimeStatus === "connecting") {
      return; // Prevent actions during transitions
    }
    if (realtimeStatus === "disconnected" || realtimeStatus === "error") {
      try {
        voiceHooks.onVoiceStarted(sessionId);
        await startRealtimeSession(sessionId);
        tracking?.capture("voice_session_started", { sessionId });
      } catch (error) {
        console.error("Failed to start realtime session:", error);
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
      <AgentInput
        placeholder={t("session.inputPlaceholder")}
        value={displayMessage}
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
        thinkingMode={session.thinkingMode}
        effortLevel={session.effortLevel}
        maxBudgetUsd={session.maxBudgetUsd}
        onThinkingModeChange={updateThinkingMode}
        onEffortLevelChange={updateEffortLevel}
        onMaxBudgetUsdChange={updateMaxBudgetUsd}
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

          // Use displayMessage to capture any active STT interim transcript.
          // If the user presses send while STT is still listening, we commit
          // the full display value (committed text + interim) rather than just
          // the committed state, which may not yet include the latest utterance.
          const textToSend = stt.isListening ? displayMessage : message;
          if (stt.isListening) {
            stt.stopListening();
          }

          const text = textToSend.trim();
          // Special commands (/compact, /clear) don't support images — send command only
          const isSpecialCommand = /^\/(compact|clear)\b/.test(text);

          // Read from ref to avoid stale closure — the ref is always current
          const currentPaths = isSpecialCommand
            ? []
            : pendingImagePathsRef.current;
          const imageRefs = currentPaths.map((p) => `[image: ${p}]`).join("\n");
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
        onSttPress={onSttToggle}
        isSttListening={stt.isListening}
        isSttCorrecting={isSttCorrecting}
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
        currentModelCode={effectiveModelCode}
        onImagePaste={handleImagePaste}
        onImagePickPress={doPickImage}
        isPickingImage={isPickingImage || isProcessingImage}
        imagePaths={pendingImagePaths}
        imageUris={pendingImageUris}
        onImageRemove={removeImageByPath}
        onShellCommand={(command) => {
          sync.sendMessage(sessionId, `$ ${command}`);
        }}
        packageScripts={session.metadata?.packageScripts}
        onSlashCommandPress={() => setShowCommandList(true)}
        showCommandList={showCommandList}
        onCommandSelect={handleCommandSelect}
        onCommandListClose={() => setShowCommandList(false)}
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
          style={{
            position: "absolute",
            top: 8, // Position at top of content area (padding handled by parent)
            alignSelf: "center",
            backgroundColor: "#FFF3CD",
            borderRadius: 100, // Fully rounded pill
            paddingHorizontal: 14,
            paddingVertical: 7,
            flexDirection: "row",
            alignItems: "center",
            zIndex: 998, // Below voice bar but above content
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 4,
            elevation: 4,
          }}
        >
          <Ionicons
            name="warning-outline"
            size={14}
            color="#FF9500"
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              fontSize: 12,
              color: "#856404",
              fontWeight: "600",
            }}
          >
            {t("sessionInfo.cliVersionOutdated")}
          </Text>
          <Ionicons
            name="close"
            size={14}
            color="#856404"
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
          style={{
            position: "absolute",
            top: safeArea.top + 8,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `rgba(${theme.dark ? "28, 23, 28" : "255, 255, 255"}, 0.9)`,
            alignItems: "center",
            justifyContent: "center",
            ...Platform.select({
              ios: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
              },
              android: {
                elevation: 2,
              },
            }),
          }}
          hitSlop={15}
        >
          <Ionicons
            name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
            size={Platform.select({ ios: 28, default: 24 })}
            color="#000"
          />
        </Pressable>
      )}
    </InputContext.Provider>
  );
}
