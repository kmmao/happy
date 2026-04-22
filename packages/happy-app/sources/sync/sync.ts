import Constants from "expo-constants";
import { apiSocket } from "@/sync/apiSocket";
import { AuthCredentials } from "@/auth/tokenStorage";
import { hasCredentialSecret } from "@/auth/authCredentials";
import { Encryption } from "@/sync/encryption/encryption";
import { SessionEncryption } from "@/sync/encryption/sessionEncryption";
import { decodeBase64 } from "@/encryption/base64";
import { storage, registerPreferencesSyncCallback } from "./storage";
import {
  ApiEphemeralUpdateSchema,
  ApiMessage,
  ApiUpdateContainerSchema,
} from "./apiTypes";
import type { ApiEphemeralActivityUpdate } from "./apiTypes";
import { Session, Machine } from "./storageTypes";
import { InvalidateSync } from "@/utils/sync";
import { ActivityUpdateAccumulator } from "./reducer/activityUpdateAccumulator";
import { resolveActivityThinking } from "./reducer/resolveActivityThinking";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "./apiPush";
import { Platform, AppState, type AppStateStatus } from "react-native";
import { isRunningOnMac } from "@/utils/platform";
import {
  NormalizedMessage,
  normalizeRawMessage,
  collectSequencedHistorySignals,
  RawRecord,
} from "./typesRaw";
import {
  handleNewMessageUpdate,
  handleDeleteSessionUpdate,
  handleUpdateSessionUpdate,
  handleUpdateAccountUpdate,
  handleUpdateMachineUpdate,
  handleRelationshipUpdate,
  handleNewArtifactUpdate,
  handleUpdateArtifactUpdate,
  handleDeleteArtifactUpdate,
  handleNewFeedPostUpdate,
  handleKvBatchUpdate,
  handleProjectUpdate,
  type UpdateHandlerContext,
  type ResearchConfigChange,
} from "./syncUpdateHandlers";
import {
  fetchArtifactsList as fetchArtifactsListAction,
  fetchArtifactWithBody as fetchArtifactWithBodyAction,
  createArtifactAction,
  updateArtifactAction,
  type ArtifactContext,
} from "./syncArtifacts";
import {
  hasPendingOutboxMessages as hasPendingOutboxMessagesHelper,
  maybeStartBackgroundSendWatchdog as maybeStartBackgroundSendWatchdogHelper,
  clearBackgroundSendWatchdog as clearBackgroundSendWatchdogHelper,
  scheduleBackgroundSendTimeoutNotification as scheduleBackgroundSendTimeoutNotificationHelper,
  cancelBackgroundSendTimeoutNotification as cancelBackgroundSendTimeoutNotificationHelper,
  notifyMessageSendFailed as notifyMessageSendFailedHelper,
  failPendingOutboxMessages as failPendingOutboxMessagesHelper,
  handleBackgroundSendTimeout as handleBackgroundSendTimeoutHelper,
  type BackgroundSendState,
} from "./syncBackgroundSend";
import { getCurrentLanguage, t } from "@/text";
import { issueSessionStore } from "./issueSessionStore";
import {
  handleWebhookIssueLinked as issueHandleWebhookIssueLinked,
  handleWebhookPRMerged as issueHandleWebhookPRMerged,
  markFailedIssueSessionsForEndedSessions as issueMarkFailed,
  checkProcessingPRs as issueCheckProcessingPRs,
  recoverMissingPRUrls as issueRecoverMissingPRUrls,
} from "./syncIssueHandlers";
import {
  applySettings,
  Settings,
  settingsDefaults,
  settingsParse,
} from "./settings";
import {
  mergeServerSettingsWithLocalProfiles,
  stripManagedAccountProfileSettings,
} from "./accountProfileSettings";
import { profileParse } from "./profile";
import {
  loadPendingSettings,
  savePendingSettings,
  loadLastSeqs,
  saveLastSeq,
  deleteLastSeq,
} from "./persistence";
import { initializeTracking, tracking } from "@/track";
import { parseToken } from "@/utils/parseToken";
import { RevenueCat, LogLevel, PaywallResult } from "./revenueCat";
import {
  trackPaywallPresented,
  trackPaywallPurchased,
  trackPaywallCancelled,
  trackPaywallRestored,
  trackPaywallError,
} from "@/track";
import { getServerUrl } from "./serverConfig";
import { config } from "@/config";
import { log } from "@/log";
import { gitStatusSync } from "./gitStatusSync";
import { projectManager } from "./projectManager";
import { AsyncLock } from "@/utils/lock";
import { NonRetryableError } from "@/utils/time";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import { autoOptionSendService } from "@/sync/autoOptionSendService";
import { Message } from "./typesMessage";
import { EncryptionCache } from "./encryption/encryptionCache";
import { systemPrompt } from "./prompt/systemPrompt";
import type { DecryptedArtifact } from "./artifactTypes";
import { getFriendsList, getUserProfile } from "./apiFriends";
import { fetchFeed } from "./apiFeed";
import type { FeedItem } from "./feedTypes";
import { UserProfile } from "./friendTypes";
import { resolveMessageModeMeta } from "./messageMeta";
import { getSessionUsageSummary } from "./apiUsage";
import {
  initMessageCache,
  loadMessageCache,
  saveMessageCache,
  deleteMessageCache,
} from "./messageCache";
import { fetchAccountProfiles } from "./apiAccountProfiles";
import { mergeAccountProfiles } from "@/utils/mergeAccountProfiles";
import {
  fetchProjects,
  resolveProject,
  linkSessionsToProject,
  deleteProject as apiDeleteProject,
} from "./apiProjects";
import { resolveFetchedSessionRpcReady } from "./fetchSessionRpcReady";
import { recoverSessionMetadataAfterDecrypt } from "./sessionMetadataRecovery";

type V3GetSessionMessagesResponse = {
  messages: ApiMessage[];
  hasMore: boolean;
};

type V3PostSessionMessagesResponse = {
  messages: Array<{
    id: string;
    seq: number;
    localId: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
};

type OutboxMessage = {
  localId: string;
  content: string;
};

class Sync {
  private static readonly BACKGROUND_SEND_TIMEOUT_MS = 30_000;
  encryption!: Encryption;
  serverID!: string;
  anonID!: string;
  private credentials!: AuthCredentials;
  public encryptionCache = new EncryptionCache();
  private sessionsSync: InvalidateSync;
  private messagesSync = new Map<string, InvalidateSync>();
  private sendSync = new Map<string, InvalidateSync>();
  private sendAbortControllers = new Map<string, AbortController>();
  private sessionLastSeq = loadLastSeqs();
  private pendingOutbox = new Map<string, OutboxMessage[]>();
  private sessionMessageQueue = new Map<string, NormalizedMessage[]>();
  private sessionQueueProcessing = new Set<string>();
  private sessionMessageLocks = new Map<string, AsyncLock>();
  private deleted404Sessions = new Set<string>(); // Guard against re-creating sync for 404'd sessions
  private sessionDataKeys = new Map<string, Uint8Array>(); // Store session data encryption keys internally
  private machineDataKeys = new Map<string, Uint8Array>(); // Store machine data encryption keys internally
  private artifactDataKeys = new Map<string, Uint8Array>(); // Store artifact data encryption keys internally
  private cacheWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private settingsSync: InvalidateSync;
  private profileSync: InvalidateSync;
  private accountProfilesSync: InvalidateSync;
  private purchasesSync: InvalidateSync;
  private machinesSync: InvalidateSync;
  private pushTokenSync: InvalidateSync;
  private nativeUpdateSync: InvalidateSync;
  private artifactsSync: InvalidateSync;
  private friendsSync: InvalidateSync;
  private friendRequestsSync: InvalidateSync;
  private feedSync: InvalidateSync;
  private projectsSync: InvalidateSync;
  private activityAccumulator: ActivityUpdateAccumulator;
  private supervisorStatusListeners = new Set<(event: {
    projectId: string;
    status: string;
    runId: string;
    currentDimension?: string;
    dimensionIndex?: number;
    totalDimensions?: number;
  }) => void>();
  private researchConfigListeners = new Set<(event: ResearchConfigChange) => void>();
  private taskLogListeners = new Set<(sessionId: string, taskId: string, chunk: string) => void>();
  private taskStatusListeners = new Set<(event: {
    taskId: string;
    machineId?: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
    completedAt?: number;
  }) => void>();
  private supervisorLoopStatusListeners = new Set<(event: {
    loopId: string;
    projectId: string;
    status: string;
    currentIteration: number;
    maxIterations: number;
    currentPhase: string;
    totalCostUsd: number;
    totalActionsFound: number;
    totalActionsFixed: number;
    currentHealthScore: number | null;
    initialHealthScore: number | null;
    exitReason: string | null;
    consecutiveFailures: number;
  }) => void>();
  private inboxNewItemListeners = new Set<(item: {
    id: string;
    category: string;
    eventType: string;
    severity: string;
    title: string;
    body?: string;
    read: boolean;
    referenceUrl?: string;
    refType?: string;
    refId?: string;
    groupKey?: string;
    createdAt: number;
  }) => void>();
  private inboxUnreadCountListeners = new Set<(count: number) => void>();
  private sessionEventCreatedListeners = new Set<(event: {
    id: string;
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt: number;
  }) => void>();
  private preferencesMigrationDone = false;
  private projectMigrationFailures = new Map<string, number>();
  private pendingSettings: Partial<Settings> = loadPendingSettings();
  private appState: AppStateStatus = AppState.currentState;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private backgroundSendTimeout: ReturnType<typeof setTimeout> | null = null;
  private backgroundSendNotificationId: string | null = null;
  private backgroundSendStartedAt: number | null = null;
  revenueCatInitialized = false;

  // Generic locking mechanism
  private recalculationLockCount = 0;
  private lastRecalculationTime = 0;

  constructor() {
    this.sessionsSync = new InvalidateSync(this.fetchSessions);
    this.settingsSync = new InvalidateSync(this.syncSettings);
    this.profileSync = new InvalidateSync(this.fetchProfile);
    this.accountProfilesSync = new InvalidateSync(this.syncAccountProfiles);
    this.purchasesSync = new InvalidateSync(this.syncPurchases);
    this.machinesSync = new InvalidateSync(this.fetchMachines);
    this.nativeUpdateSync = new InvalidateSync(this.fetchNativeUpdate);
    this.artifactsSync = new InvalidateSync(this.fetchArtifactsList);
    this.friendsSync = new InvalidateSync(this.fetchFriends);
    this.friendRequestsSync = new InvalidateSync(this.fetchFriendRequests);
    this.feedSync = new InvalidateSync(this.fetchFeed);
    this.projectsSync = new InvalidateSync(this.fetchAndSyncProjects);

    const registerPushToken = async () => {
      if (__DEV__) {
        return;
      }
      await this.registerPushToken();
    };
    this.pushTokenSync = new InvalidateSync(registerPushToken);
    this.activityAccumulator = new ActivityUpdateAccumulator(
      this.flushActivityUpdates.bind(this),
      500, // Reduced from 2000ms for faster terminal feedback on mobile
    );

    // Listen for app state changes to refresh purchases
    this.appStateSubscription = AppState.addEventListener("change", (nextAppState) => {
      this.appState = nextAppState;
      if (nextAppState === "active") {
        const shouldFailAfterResume =
          this.backgroundSendStartedAt !== null &&
          this.hasPendingOutboxMessages() &&
          Date.now() - this.backgroundSendStartedAt >=
            Sync.BACKGROUND_SEND_TIMEOUT_MS;
        void this.cancelBackgroundSendTimeoutNotification();
        this.clearBackgroundSendWatchdog();
        if (shouldFailAfterResume) {
          void this.notifyMessageSendFailed();
          this.failPendingOutboxMessages(
            "Message failed to send in background after 30s. Please retry.",
          );
        }
        log.log("📱 App became active");
        this.purchasesSync.invalidate();
        this.profileSync.invalidate();
        this.accountProfilesSync.invalidate();
        this.machinesSync.invalidate();
        this.pushTokenSync.invalidate();
        this.sessionsSync.invalidate();
        this.nativeUpdateSync.invalidate();
        log.log("📱 App became active: Invalidating artifacts sync");
        this.artifactsSync.invalidate();
        this.friendsSync.invalidate();
        this.friendRequestsSync.invalidate();
        this.feedSync.invalidate();
        this.projectsSync.invalidate();
      } else {
        log.log(`📱 App state changed to: ${nextAppState}`);
        this.maybeStartBackgroundSendWatchdog();
        // Flush pending cache writes before going to background
        this.flushPendingCacheWrites();
      }
    });
  }

  async create(credentials: AuthCredentials, encryption: Encryption) {
    this.credentials = credentials;
    this.encryption = encryption;
    this.anonID = encryption.anonID;
    this.serverID = parseToken(credentials.token);

    // Cancel any pending cache writes from previous user before switching
    this.cancelPendingCacheWrites();

    // Initialize message cache - anonID is a 16-char hex derived from master secret,
    // used as a device-level deterrent, not cryptographic-grade protection
    initMessageCache(this.anonID + "-message-cache");

    await this.#init();

    // Await settings sync to have fresh settings
    await this.settingsSync.awaitQueue();

    // Await profile sync to have fresh profile
    await this.profileSync.awaitQueue();

    // Await account profile sync so selectors see server-backed profiles immediately
    await this.accountProfilesSync.awaitQueue();

    // Await purchases sync to have fresh purchases
    await this.purchasesSync.awaitQueue();
  }

  async restore(credentials: AuthCredentials, encryption: Encryption) {
    // NOTE: No awaiting anything here, we're restoring from a disk (ie app restarted)
    // Purchases sync is invalidated in #init() and will complete asynchronously
    this.credentials = credentials;
    this.encryption = encryption;
    this.anonID = encryption.anonID;
    this.serverID = parseToken(credentials.token);

    // Cancel any pending cache writes from previous user before switching
    this.cancelPendingCacheWrites();

    // Initialize message cache - anonID is a 16-char hex derived from master secret,
    // used as a device-level deterrent, not cryptographic-grade protection
    initMessageCache(this.anonID + "-message-cache");

    await this.#init();
  }

  async #init() {
    // Initialize auto-option-send global service
    autoOptionSendService.init(this.sendMessage.bind(this));

    // Register preferences sync callback so storage.ts can trigger server sync
    registerPreferencesSyncCallback((sessionId) => {
      this.syncSessionPreferences(sessionId);
    });

    // Subscribe to updates
    this.subscribeToUpdates();

    // Sync initial PostHog opt-out state with stored settings
    if (tracking) {
      const currentSettings = storage.getState().settings;
      if (currentSettings.analyticsOptOut) {
        tracking.optOut();
      } else {
        tracking.optIn();
      }
    }

    // Invalidate sync
    log.log("🔄 #init: Invalidating all syncs");
    this.sessionsSync.invalidate();
    this.settingsSync.invalidate();
    this.profileSync.invalidate();
    this.accountProfilesSync.invalidate();
    this.purchasesSync.invalidate();
    this.machinesSync.invalidate();
    this.pushTokenSync.invalidate();
    this.nativeUpdateSync.invalidate();
    this.friendsSync.invalidate();
    this.friendRequestsSync.invalidate();
    this.artifactsSync.invalidate();
    this.feedSync.invalidate();
    this.projectsSync.invalidate();
    log.log("🔄 #init: All syncs invalidated, including artifacts");

    // Wait for both sessions and machines to load, then mark as ready
    Promise.all([
      this.sessionsSync.awaitQueue(),
      this.machinesSync.awaitQueue(),
    ])
      .then(() => {
        storage.getState().applyReady();
        // Load issue-session links so UI can show processing status
        void issueSessionStore.getState().loadLinks();
        // Start PR status polling for processing issue sessions with open PRs
        this.startPRStatusPolling();
        // One-time recovery: backfill prUrl for recently-completed links that missed PR detection
        void issueRecoverMissingPRUrls();
      })
      .catch((error) => {
        log.error("Failed to load initial data:", error);
      });
  }

  onSessionVisible = (sessionId: string) => {
    // Restore from local cache if no messages in memory yet
    const existingMessages = storage.getState().sessionMessages[sessionId];
    if (!existingMessages || existingMessages.messages.length === 0) {
      const cached = loadMessageCache(sessionId);
      if (cached) {
        storage.getState().restoreMessagesFromCache(sessionId, cached);
        if (cached.isTrimmed) {
          // Cache was truncated — older messages are missing.
          // Use cached lastSeq for incremental fetch first (to get NEWEST messages fast),
          // then backfill older messages in the background.
          if (!this.sessionLastSeq.has(sessionId)) {
            this.sessionLastSeq.set(sessionId, cached.lastSeq);
          }
        } else if (!this.sessionLastSeq.has(sessionId)) {
          // Cache is complete — use cached lastSeq for incremental fetch only
          this.sessionLastSeq.set(sessionId, cached.lastSeq);
        }
        log.log(
          `💬 Restored ${cached.messages.length} cached messages for ${sessionId} (trimmed: ${cached.isTrimmed})`,
        );
      } else if (this.sessionLastSeq.has(sessionId)) {
        // lastSeq exists but no cache (e.g. first launch after feature rollout)
        // Reset to 0 to force full re-fetch, otherwise history would be missing
        this.sessionLastSeq.delete(sessionId);
        deleteLastSeq(sessionId);
        log.log(`💬 Reset lastSeq for ${sessionId} — no cache available`);
      }
    }

    this.getMessagesSync(sessionId)?.invalidate();

    // Also invalidate git status sync for this session
    gitStatusSync.getSync(sessionId).invalidate();

    // Notify voice assistant about session visibility
    const session = storage.getState().sessions[sessionId];
    if (session) {
      voiceHooks.onSessionFocus(sessionId, session.metadata || undefined);
    }
  };

  /**
   * Full refresh for a session: reset message seq to force full re-fetch,
   * refresh session metadata, and git status.
   * Used by the manual refresh button in the header.
   * Returns a promise that resolves when message fetch completes.
   */
  refreshSession = async (sessionId: string) => {
    // Reset lastSeq so fetchMessages does a full re-fetch instead of incremental
    this.sessionLastSeq.delete(sessionId);
    deleteLastSeq(sessionId);

    const messagesPromise = this.getMessagesSync(sessionId)?.invalidateAndAwait();
    gitStatusSync.getSync(sessionId).invalidate();
    this.sessionsSync.invalidate();

    await messagesPromise;
  };

  private getMessagesSync(sessionId: string): InvalidateSync | null {
    if (this.deleted404Sessions.has(sessionId)) {
      return null;
    }
    let sync = this.messagesSync.get(sessionId);
    if (!sync) {
      sync = new InvalidateSync(() => this.fetchMessages(sessionId));
      this.messagesSync.set(sessionId, sync);
    }
    return sync;
  }

  private getSendSync(sessionId: string): InvalidateSync | null {
    if (this.deleted404Sessions.has(sessionId)) {
      return null;
    }
    let sync = this.sendSync.get(sessionId);
    if (!sync) {
      sync = new InvalidateSync(() => this.flushOutbox(sessionId));
      this.sendSync.set(sessionId, sync);
    }
    return sync;
  }

  private enqueueMessages(sessionId: string, messages: NormalizedMessage[]) {
    if (messages.length === 0) {
      return;
    }

    let queue = this.sessionMessageQueue.get(sessionId);
    if (!queue) {
      queue = [];
      this.sessionMessageQueue.set(sessionId, queue);
    }
    queue.push(...messages);

    this.scheduleQueuedMessagesProcessing(sessionId);
  }

  private getSessionMessageLock(sessionId: string): AsyncLock {
    let lock = this.sessionMessageLocks.get(sessionId);
    if (!lock) {
      lock = new AsyncLock();
      this.sessionMessageLocks.set(sessionId, lock);
    }
    return lock;
  }

  /**
   * Clean up all local state for a session that no longer exists on the server (404).
   * Removes messagesSync from the map to prevent future invalidate() calls,
   * but does NOT call stop() on messagesSync since we are inside its own execution.
   * Does NOT delete the lock — we are still inside lock.inLock().
   * Adds sessionId to deleted404Sessions to prevent lazy re-creation.
   */
  private cleanupSessionLocally(sessionId: string) {
    this.deleted404Sessions.add(sessionId);
    storage.getState().deleteSession(sessionId);
    this.encryption.removeSessionEncryption(sessionId);
    projectManager.removeSession(sessionId);
    gitStatusSync.clearForSession(sessionId);
    // Remove from map so future invalidate() calls are no-ops,
    // but don't call stop() on messagesSync — we are inside this sync's callback.
    this.messagesSync.delete(sessionId);
    // sendSync is a separate object — safe to stop() from here.
    const sndSync = this.sendSync.get(sessionId);
    if (sndSync) {
      sndSync.stop();
      this.sendSync.delete(sessionId);
    }
    this.pendingOutbox.delete(sessionId);
    this.sessionLastSeq.delete(sessionId);
    deleteLastSeq(sessionId);
    deleteMessageCache(sessionId);
    // Do NOT delete sessionMessageLocks — we are still inside lock.inLock().
    this.sessionMessageQueue.delete(sessionId);
    this.sessionQueueProcessing.delete(sessionId);
  }

  private scheduleQueuedMessagesProcessing(sessionId: string) {
    if (this.sessionQueueProcessing.has(sessionId)) {
      return;
    }

    this.sessionQueueProcessing.add(sessionId);
    const lock = this.getSessionMessageLock(sessionId);
    void lock
      .inLock(() => {
        while (true) {
          const pending = this.sessionMessageQueue.get(sessionId);
          if (!pending || pending.length === 0) {
            break;
          }
          const batch = pending.splice(0, pending.length);
          this.applyMessages(sessionId, batch);
        }
      })
      .finally(() => {
        this.sessionQueueProcessing.delete(sessionId);
        // Use queueMicrotask to check for new messages immediately after
        // clearing the processing flag. This closes the race window where
        // messages arrive between the while-loop exit and the delete above.
        queueMicrotask(() => {
          const pending = this.sessionMessageQueue.get(sessionId);
          if (pending && pending.length > 0) {
            this.scheduleQueuedMessagesProcessing(sessionId);
          }
        });
      });
  }

  private get bgSendState(): BackgroundSendState {
    return {
      backgroundSendTimeout: this.backgroundSendTimeout,
      backgroundSendNotificationId: this.backgroundSendNotificationId,
      backgroundSendStartedAt: this.backgroundSendStartedAt,
      appState: this.appState,
      sendAbortControllers: this.sendAbortControllers,
      pendingOutbox: this.pendingOutbox,
      BACKGROUND_SEND_TIMEOUT_MS: Sync.BACKGROUND_SEND_TIMEOUT_MS,
    };
  }

  private syncBgSendState(state: BackgroundSendState) {
    this.backgroundSendTimeout = state.backgroundSendTimeout;
    this.backgroundSendNotificationId = state.backgroundSendNotificationId;
    this.backgroundSendStartedAt = state.backgroundSendStartedAt;
  }

  private hasPendingOutboxMessages() {
    return hasPendingOutboxMessagesHelper(this.bgSendState);
  }

  private maybeStartBackgroundSendWatchdog() {
    const state = this.bgSendState;
    maybeStartBackgroundSendWatchdogHelper(
      state,
      () => this.handleBackgroundSendTimeout(),
      () => this.scheduleBackgroundSendTimeoutNotification(),
    );
    this.syncBgSendState(state);
  }

  private clearBackgroundSendWatchdog() {
    const state = this.bgSendState;
    clearBackgroundSendWatchdogHelper(state);
    this.syncBgSendState(state);
  }

  private async scheduleBackgroundSendTimeoutNotification() {
    const state = this.bgSendState;
    await scheduleBackgroundSendTimeoutNotificationHelper(state);
    this.syncBgSendState(state);
  }

  private async cancelBackgroundSendTimeoutNotification() {
    const state = this.bgSendState;
    await cancelBackgroundSendTimeoutNotificationHelper(state);
    this.syncBgSendState(state);
  }

  private async notifyMessageSendFailed() {
    await notifyMessageSendFailedHelper();
  }

  private failPendingOutboxMessages(reasonText: string) {
    const state = this.bgSendState;
    failPendingOutboxMessagesHelper(state, reasonText, this.enqueueMessages.bind(this));
    this.syncBgSendState(state);
  }

  private async handleBackgroundSendTimeout() {
    const state = this.bgSendState;
    await handleBackgroundSendTimeoutHelper(state, this.enqueueMessages.bind(this));
    this.syncBgSendState(state);
  }

  async sendMessage(
    sessionId: string,
    text: string,
    displayText?: string,
    options?: {
      continue?: boolean;
      localId?: string;
      source?: "auto-option-send";
    },
  ) {
    // Clear any existing prompt suggestion and needsContinue when user sends a message
    storage.getState().setPromptSuggestion(sessionId, null);
    storage.getState().setNeedsContinue(sessionId, false);

    // In ElevenLabs Conversational AI mode, TTS interruption is handled
    // automatically by the ElevenLabs SDK when the user speaks.

    // Get encryption
    const encryption = this.encryption.getSessionEncryption(sessionId);
    if (!encryption) {
      // Should never happen
      log.error(`Session ${sessionId} not found`);
      return;
    }

    // Get session data from storage
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session) {
      log.error(`Session ${sessionId} not found in storage`);
      return;
    }

    // Clear needsAttention when user sends a message (user has responded)
    if (session.needsAttention) {
      storage.getState().applySessions([{ ...session, needsAttention: false }]);
    }

    const { permissionMode, model, thinking, effort, maxBudgetUsd, taskBudget } =
      resolveMessageModeMeta(session);

    // Generate local ID (or use provided one)
    const localId = options?.localId ?? randomUUID();

    // Determine sentFrom based on platform
    let sentFrom: string;
    if (Platform.OS === "web") {
      sentFrom = "web";
    } else if (Platform.OS === "android") {
      sentFrom = "android";
    } else if (Platform.OS === "ios") {
      // Check if running on Mac (Catalyst or Designed for iPad on Mac)
      if (isRunningOnMac()) {
        sentFrom = "mac";
      } else {
        sentFrom = "ios";
      }
    } else {
      sentFrom = "web"; // fallback
    }

    const fallbackModel: string | null = null;
    const createdAt = Date.now();

    // Create user message content with metadata
    const content: RawRecord = {
      role: "user",
      content: {
        type: "text",
        text,
      },
      meta: {
        sentFrom,
        ...(options?.source && { source: options.source }),
        permissionMode,
        model,
        fallbackModel,
        appendSystemPrompt: systemPrompt,
        locale: getCurrentLanguage(),
        ...(displayText && { displayText }),
        ...(thinking && { thinking }),
        effort,
        ...(maxBudgetUsd != null && { maxBudgetUsd }),
        ...(taskBudget && { taskBudget }),
        ...(options?.continue && { continue: true }),
      },
    };
    const encryptedRawRecord = await encryption.encryptRawRecord(content);

    // Add to messages - normalize the raw record
    const normalizedMessage = normalizeRawMessage(
      localId,
      localId,
      createdAt,
      content,
    );
    if (normalizedMessage) {
      this.enqueueMessages(sessionId, [normalizedMessage]);
    }

    let pending = this.pendingOutbox.get(sessionId);
    if (!pending) {
      pending = [];
      this.pendingOutbox.set(sessionId, pending);
    }
    pending.push({
      localId,
      content: encryptedRawRecord,
    });

    this.getSendSync(sessionId)?.invalidate();
    this.maybeStartBackgroundSendWatchdog();
  }

  applySettings = (delta: Partial<Settings>) => {
    storage.getState().applySettingsLocal(delta);

    // Save pending settings
    this.pendingSettings = { ...this.pendingSettings, ...delta };
    savePendingSettings(this.pendingSettings);

    // Sync PostHog opt-out state if it was changed
    if (tracking && "analyticsOptOut" in delta) {
      const currentSettings = storage.getState().settings;
      if (currentSettings.analyticsOptOut) {
        tracking.optOut();
      } else {
        tracking.optIn();
      }
    }

    // Invalidate settings sync
    this.settingsSync.invalidate();
  };

  refreshPurchases = () => {
    this.purchasesSync.invalidate();
  };

  refreshProfile = async () => {
    await this.profileSync.invalidateAndAwait();
  };

  refreshAccountProfiles = async () => {
    await this.accountProfilesSync.invalidateAndAwait();
  };

  refreshProjects = async () => {
    await this.projectsSync.invalidateAndAwait();
  };

  purchaseProduct = async (
    productId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if RevenueCat is initialized
      if (!this.revenueCatInitialized) {
        return { success: false, error: "RevenueCat not initialized" };
      }

      // Fetch the product
      const products = await RevenueCat.getProducts([productId]);
      if (products.length === 0) {
        return { success: false, error: `Product '${productId}' not found` };
      }

      // Purchase the product
      const product = products[0];
      const { customerInfo } = await RevenueCat.purchaseStoreProduct(product);

      // Update local purchases data
      storage.getState().applyPurchases(customerInfo);

      return { success: true };
    } catch (error: any) {
      // Check if user cancelled
      if (error.userCancelled) {
        return { success: false, error: "Purchase cancelled" };
      }

      // Return the error message
      return { success: false, error: error.message || "Purchase failed" };
    }
  };

  getOfferings = async (): Promise<{
    success: boolean;
    offerings?: any;
    error?: string;
  }> => {
    try {
      // Check if RevenueCat is initialized
      if (!this.revenueCatInitialized) {
        return { success: false, error: "RevenueCat not initialized" };
      }

      // Fetch offerings
      const offerings = await RevenueCat.getOfferings();

      // Return the offerings data
      return {
        success: true,
        offerings: {
          current: offerings.current,
          all: offerings.all,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to fetch offerings",
      };
    }
  };

  presentPaywall = async (): Promise<{
    success: boolean;
    purchased?: boolean;
    error?: string;
  }> => {
    try {
      // Check if RevenueCat is initialized
      if (!this.revenueCatInitialized) {
        const error = "RevenueCat not initialized";
        trackPaywallError(error);
        return { success: false, error };
      }

      // Track paywall presentation
      trackPaywallPresented();

      // Present the paywall
      const result = await RevenueCat.presentPaywall();

      // Handle the result
      switch (result) {
        case PaywallResult.PURCHASED:
          trackPaywallPurchased();
          // Refresh customer info after purchase
          await this.syncPurchases();
          return { success: true, purchased: true };
        case PaywallResult.RESTORED:
          trackPaywallRestored();
          // Refresh customer info after restore
          await this.syncPurchases();
          return { success: true, purchased: true };
        case PaywallResult.CANCELLED:
          trackPaywallCancelled();
          return { success: true, purchased: false };
        case PaywallResult.NOT_PRESENTED:
          // Don't track error for NOT_PRESENTED as it's a platform limitation
          return {
            success: false,
            error: "Paywall not available on this platform",
          };
        case PaywallResult.ERROR:
        default:
          const errorMsg = "Failed to present paywall";
          trackPaywallError(errorMsg);
          return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      const errorMessage = error.message || "Failed to present paywall";
      trackPaywallError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  async assumeUsers(userIds: string[]): Promise<void> {
    if (!this.credentials || userIds.length === 0) return;

    const state = storage.getState();
    // Filter out users we already have in cache (including null for 404s)
    const missingIds = userIds.filter((id) => !(id in state.users));

    if (missingIds.length === 0) return;

    log.log(`👤 Fetching ${missingIds.length} missing users...`);

    // Fetch missing users in parallel
    const results = await Promise.all(
      missingIds.map(async (id) => {
        try {
          const profile = await getUserProfile(this.credentials!, id);
          return { id, profile }; // profile is null if 404
        } catch (error) {
          log.error(`Failed to fetch user ${id}:`, error);
          return { id, profile: null }; // Treat errors as 404
        }
      }),
    );

    // Convert to Record<string, UserProfile | null>
    const usersMap: Record<string, UserProfile | null> = {};
    results.forEach(({ id, profile }) => {
      usersMap[id] = profile;
    });

    storage.getState().applyUsers(usersMap);
    log.log(
      `👤 Applied ${results.length} users to cache (${results.filter((r) => r.profile).length} found, ${results.filter((r) => !r.profile).length} not found)`,
    );
  }

  //
  // Private
  //

  private fetchSessions = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/sessions`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status}`);
    }

    const data = await response.json();
    const sessions = data.sessions as Array<{
      id: string;
      tag: string;
      seq: number;
      metadata: string;
      metadataVersion: number;
      agentState: string | null;
      agentStateVersion: number;
      preferences: string | null;
      preferencesVersion: number;
      dataEncryptionKey: string | null;
      active: boolean;
      activeAt: number;
      createdAt: number;
      updatedAt: number;
      lastMessage: ApiMessage | null;
      forkedFromSessionId: string | null;
    }>;

    // Initialize all session encryptions first
    const sessionKeys = new Map<string, Uint8Array | null>();
    for (const session of sessions) {
      if (session.dataEncryptionKey) {
        let decrypted = await this.encryption.decryptEncryptionKey(
          session.dataEncryptionKey,
        );
        if (!decrypted) {
          log.error(
            `Failed to decrypt data encryption key for session ${session.id}`,
          );
          continue;
        }
        sessionKeys.set(session.id, decrypted);
      } else {
        sessionKeys.set(session.id, null);
      }
    }
    await this.encryption.initializeSessions(sessionKeys);

    // Decrypt sessions
    let decryptedSessions: (Omit<Session, "presence"> & {
      presence?: "online" | number;
    })[] = [];
    for (const session of sessions) {
      // Get session encryption (should always exist after initialization)
      const sessionEncryption = this.encryption.getSessionEncryption(
        session.id,
      );
      if (!sessionEncryption) {
        log.error(
          `Session encryption not found for ${session.id} - this should never happen`,
        );
        continue;
      }

      // Decrypt metadata using session-specific encryption
      const decryptedMetadata = await sessionEncryption.decryptMetadata(
        session.metadataVersion,
        session.metadata,
      );
      const metadataRecovery = recoverSessionMetadataAfterDecrypt({
        existingSession: storage.getState().sessions[session.id],
        decryptedMetadata,
        incomingMetadataVersion: session.metadataVersion,
      });
      if (metadataRecovery.metadataDecryptFailed) {
        log.warn(
          `Failed to decrypt fetched session metadata for ${session.id} version ${session.metadataVersion}; preserving existing metadata when available`,
        );
      }

      // Decrypt agent state using session-specific encryption
      let agentState = await sessionEncryption.decryptAgentState(
        session.agentStateVersion,
        session.agentState,
      );

      // Decrypt preferences using session-specific encryption
      const preferences = await sessionEncryption.decryptPreferences(
        session.preferences,
      );

      // Put it all together
      const processedSession = {
        ...session,
        rpcReady: resolveFetchedSessionRpcReady(
          storage.getState().sessions[session.id],
        ),
        thinking: false,
        thinkingAt: 0,
        metadata: metadataRecovery.metadata,
        metadataVersion: metadataRecovery.metadataVersion,
        agentState,
        preferencesVersion: session.preferencesVersion ?? 0,
        // Spread server preferences into session fields if available
        ...(preferences
          ? {
              permissionMode: preferences.permissionMode,
              modelMode: preferences.modelMode,
              pinnedModelId: preferences.pinnedModelId,
              customModels: preferences.customModels,
              modelMappings: preferences.modelMappings,
              profileId: preferences.profileId,
              profileName: preferences.profileName,
              thinkingMode: preferences.thinkingMode,
              thinkingBudget: preferences.thinkingBudget,
              effortLevel: preferences.effortLevel,
              maxBudgetUsd: preferences.maxBudgetUsd,
              taskBudgetTokens: preferences.taskBudgetTokens,
            }
          : {}),
      };
      decryptedSessions.push(processedSession);
    }

    // Apply to storage — replace mode: remove sessions no longer on the server
    this.applySessions(decryptedSessions, true);
    log.log(
      `📥 fetchSessions completed - processed ${decryptedSessions.length} sessions`,
    );

    // Migrate local MMKV preferences to server for sessions that have never synced
    this.migrateLocalPreferencesToServer();
  };

  /**
   * One-time migration: push local MMKV preferences to server for sessions
   * that have preferencesVersion === 0 (never synced from any device).
   */
  private migrateLocalPreferencesToServer = async () => {
    if (this.preferencesMigrationDone) return;
    this.preferencesMigrationDone = true;

    const sessions = storage.getState().sessions;
    let migratedCount = 0;
    for (const [id, session] of Object.entries(sessions)) {
      // Only migrate sessions that have never had preferences synced
      if (session.preferencesVersion !== 0) continue;

      // Check if there's any local preference data worth migrating
      const hasLocalData =
        (session.permissionMode && session.permissionMode !== "default") ||
        (session.modelMode && session.modelMode !== "default") ||
        session.pinnedModelId ||
        session.customModels ||
        session.modelMappings ||
        session.profileId ||
        session.thinkingMode ||
        session.effortLevel ||
        session.maxBudgetUsd != null ||
        session.taskBudgetTokens != null;
      if (!hasLocalData) continue;

      // Trigger sync (debounced, will batch naturally)
      this.syncSessionPreferences(id);
      migratedCount++;
    }
    if (migratedCount > 0) {
      log.log(
        `📤 Preferences migration: queued ${migratedCount} sessions for server sync`,
      );
    }
  };

  /**
   * Fetch projects from server and merge into projectManager.
   * On first run, migrates local in-memory projects to server.
   */
  private fetchAndSyncProjects = async () => {
    if (!this.credentials) return;

    try {
      // Fetch server projects
      const serverProjects = await fetchProjects(this.credentials);

      // Merge into projectManager
      projectManager.mergeServerProjects(serverProjects);
      storage.getState().bumpProjectVersion();

      // Migrate any unsynced local projects to server (runs every sync cycle;
      // short-circuits immediately when there are no unsynced projects)
      await this.migrateProjectsToServer();

      log.log(
        `📁 Projects sync completed — ${serverProjects.length} from server`,
      );
    } catch (error) {
      log.log(`📁 Projects sync failed: ${error}`);
      throw error;
    }
  };

  /**
   * Migrate unsynced local projects to the server.
   * Short-circuits when there are no unsynced projects.
   */
  private migrateProjectsToServer = async () => {
    if (!this.credentials) return;

    const unsyncedProjects = projectManager.getUnsyncedProjects();
    if (unsyncedProjects.length === 0) return;

    log.log(
      `📁 Migrating ${unsyncedProjects.length} projects to server`,
    );

    const MAX_MIGRATION_RETRIES = 5;

    for (const project of unsyncedProjects) {
      const projectKey = `${project.key.machineId}:${project.key.path}`;
      const failures = this.projectMigrationFailures.get(projectKey) ?? 0;
      if (failures >= MAX_MIGRATION_RETRIES) continue;

      try {
        const result = await resolveProject(this.credentials, {
          machineId: project.key.machineId,
          path: project.key.path,
        });

        // Store serverId in projectManager
        projectManager.setServerId(project.key, result.project.id);
        this.projectMigrationFailures.delete(projectKey);

        // Link sessions to the server project
        if (project.sessionIds.length > 0) {
          await linkSessionsToProject(
            this.credentials,
            result.project.id,
            project.sessionIds,
          );
        }
      } catch (error) {
        this.projectMigrationFailures.set(projectKey, failures + 1);
        log.log(
          `📁 Failed to migrate project ${projectKey} (attempt ${failures + 1}/${MAX_MIGRATION_RETRIES}): ${error}`,
        );
      }
    }
  };

  /**
   * Manually create a project from the app (user-initiated).
   * Calls server API then merges into local projectManager.
   */
  public createManualProject = async (machineId: string, path: string) => {
    if (!this.credentials) {
      throw new Error("Not authenticated");
    }

    const result = await resolveProject(this.credentials, { machineId, path });
    const project = projectManager.addManualProject(result.project);
    storage.getState().bumpProjectVersion();
    this.projectsSync.invalidate();

    log.log(`📁 Manual project created: ${machineId}:${path}`);
    return project;
  };

  /**
   * Manually delete a project from the app (user-initiated).
   * Only allowed for projects with no active sessions.
   */
  public deleteManualProject = async (projectId: string) => {
    if (!this.credentials) {
      throw new Error("Not authenticated");
    }

    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.sessionIds.length > 0) {
      throw new Error("Cannot delete project with active sessions");
    }

    if (!project.serverId) {
      // Local-only project, just remove from memory
      projectManager.deleteProjectById(projectId);
      storage.getState().bumpProjectVersion();
      return;
    }

    await apiDeleteProject(this.credentials, project.serverId);
    projectManager.deleteProjectById(projectId);
    storage.getState().bumpProjectVersion();
    this.projectsSync.invalidate();

    log.log(`📁 Manual project deleted: ${project.key.machineId}:${project.key.path}`);
  };

  public refreshMachines = async () => {
    return this.fetchMachines();
  };

  public refreshSessions = async () => {
    return this.sessionsSync.invalidateAndAwait();
  };

  // Debounce timer for preferences sync
  private preferencesSyncTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  /**
   * Sync session preferences to server (debounced 300ms per session).
   * Encrypts all preference fields and pushes via update-preferences socket event.
   */
  public syncSessionPreferences = (sessionId: string) => {
    // Clear any existing timer for this session
    const existingTimer = this.preferencesSyncTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce: wait 300ms before syncing
    const timer = setTimeout(async () => {
      this.preferencesSyncTimers.delete(sessionId);
      try {
        const session = storage.getState().sessions[sessionId];
        if (!session) return;

        const sessionEncryption =
          this.encryption.getSessionEncryption(sessionId);
        if (!sessionEncryption) return;

        const preferences = {
          permissionMode: session.permissionMode,
          modelMode: session.modelMode,
          pinnedModelId: session.pinnedModelId,
          customModels: session.customModels,
          modelMappings: session.modelMappings,
          profileId: session.profileId,
          profileName: session.profileName,
          thinkingMode: session.thinkingMode,
          thinkingBudget: session.thinkingBudget,
          effortLevel: session.effortLevel,
          maxBudgetUsd: session.maxBudgetUsd,
          taskBudgetTokens: session.taskBudgetTokens,
        };

        const encrypted =
          await sessionEncryption.encryptPreferences(preferences);
        const result = await apiSocket.emitWithAck<{
          result: string;
          version?: number;
          preferences?: string;
        }>("update-preferences", {
          sid: sessionId,
          preferences: encrypted,
          expectedVersion: session.preferencesVersion,
        });

        if (result.result === "success" && result.version !== undefined) {
          storage
            .getState()
            .clearPendingSessionPreferencesIfMatch(sessionId, preferences);
          // Update preferencesVersion in storage
          storage
            .getState()
            .updateSessionPreferencesVersion(sessionId, result.version);
        } else if (result.result === "version-mismatch") {
          // Retry with the latest version (simple retry, no backoff needed for user-driven changes)
          log.log(
            `⚠️ Preferences version mismatch for session ${sessionId}, retrying...`,
          );
          const freshSession = storage.getState().sessions[sessionId];
          if (freshSession && result.version !== undefined) {
            storage
              .getState()
              .updateSessionPreferencesVersion(sessionId, result.version);
            // Re-trigger sync with updated version
            this.syncSessionPreferences(sessionId);
          }
        }
      } catch (error) {
        log.log(
          `❌ Failed to sync preferences for session ${sessionId}: ${error}`,
        );
      }
    }, 300);

    this.preferencesSyncTimers.set(sessionId, timer);
  };

  public getCredentials() {
    return this.credentials;
  }

  // Artifact methods - delegated to syncArtifacts.ts
  private get artifactCtx(): ArtifactContext {
    return {
      credentials: this.credentials,
      encryption: this.encryption,
      artifactDataKeys: this.artifactDataKeys,
    };
  }

  public fetchArtifactsList = async (): Promise<void> => {
    if (!this.credentials) {
      log.log("📦 fetchArtifactsList: No credentials, skipping");
      return;
    }
    await fetchArtifactsListAction(this.artifactCtx);
  };

  public async fetchArtifactWithBody(
    artifactId: string,
  ): Promise<DecryptedArtifact | null> {
    if (!this.credentials) return null;
    return fetchArtifactWithBodyAction(this.artifactCtx, artifactId);
  }

  public async createArtifact(
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean,
  ): Promise<string> {
    if (!this.credentials) {
      throw new Error("Not authenticated");
    }
    return createArtifactAction(this.artifactCtx, title, body, sessions, draft);
  }

  public async updateArtifact(
    artifactId: string,
    title: string | null,
    body: string | null,
    sessions?: string[],
    draft?: boolean,
  ): Promise<void> {
    if (!this.credentials) {
      throw new Error("Not authenticated");
    }
    await updateArtifactAction(this.artifactCtx, artifactId, title, body, sessions, draft);
  }

  private fetchMachines = async () => {
    if (!this.credentials) return;

    log.log("📊 Sync: Fetching machines...");
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/machines`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      log.error(`Failed to fetch machines: ${response.status}`);
      return;
    }

    const data = await response.json();
    log.log(
      `📊 Sync: Fetched ${Array.isArray(data) ? data.length : 0} machines from server`,
    );
    const machines = data as Array<{
      id: string;
      metadata: string;
      metadataVersion: number;
      daemonState?: string | null;
      daemonStateVersion?: number;
      dataEncryptionKey?: string | null; // Add support for per-machine encryption keys
      seq: number;
      active: boolean;
      activeAt: number; // Changed from lastActiveAt
      createdAt: number;
      updatedAt: number;
    }>;

    // First, collect and decrypt encryption keys for all machines
    const machineKeysMap = new Map<string, Uint8Array | null>();
    for (const machine of machines) {
      if (machine.dataEncryptionKey) {
        const decryptedKey = await this.encryption.decryptEncryptionKey(
          machine.dataEncryptionKey,
        );
        if (!decryptedKey) {
          log.error(
            `Failed to decrypt data encryption key for machine ${machine.id}`,
          );
          continue;
        }
        machineKeysMap.set(machine.id, decryptedKey);
        this.machineDataKeys.set(machine.id, decryptedKey);
      } else {
        machineKeysMap.set(machine.id, null);
      }
    }

    // Initialize machine encryptions
    await this.encryption.initializeMachines(machineKeysMap);

    // Process all machines first, then update state once
    const decryptedMachines: Machine[] = [];

    for (const machine of machines) {
      // Get machine-specific encryption (might exist from previous initialization)
      const machineEncryption = this.encryption.getMachineEncryption(
        machine.id,
      );
      if (!machineEncryption) {
        log.error(
          `Machine encryption not found for ${machine.id} - this should never happen`,
        );
        continue;
      }

      try {
        // Use machine-specific encryption (which handles fallback internally)
        const metadata = machine.metadata
          ? await machineEncryption.decryptMetadata(
              machine.metadataVersion,
              machine.metadata,
            )
          : null;

        const daemonState = machine.daemonState
          ? await machineEncryption.decryptDaemonState(
              machine.daemonStateVersion || 0,
              machine.daemonState,
            )
          : null;

        decryptedMachines.push({
          id: machine.id,
          seq: machine.seq,
          createdAt: machine.createdAt,
          updatedAt: machine.updatedAt,
          active: machine.active,
          activeAt: machine.activeAt,
          rpcReady: false,
          metadata,
          metadataVersion: machine.metadataVersion,
          daemonState,
          daemonStateVersion: machine.daemonStateVersion || 0,
        });
      } catch (error) {
        log.error(`Failed to decrypt machine ${machine.id}:`, error);
        // Still add the machine with null metadata
        decryptedMachines.push({
          id: machine.id,
          seq: machine.seq,
          createdAt: machine.createdAt,
          updatedAt: machine.updatedAt,
          active: machine.active,
          activeAt: machine.activeAt,
          rpcReady: false,
          metadata: null,
          metadataVersion: machine.metadataVersion,
          daemonState: null,
          daemonStateVersion: 0,
        });
      }
    }

    // Replace entire machine state with fetched machines
    storage.getState().applyMachines(decryptedMachines, true);
    log.log(
      `🖥️ fetchMachines completed - processed ${decryptedMachines.length} machines`,
    );
  };

  private fetchFriends = async () => {
    if (!this.credentials) return;

    try {
      log.log("👥 Fetching friends list...");
      const friendsList = await getFriendsList(this.credentials);
      storage.getState().applyFriends(friendsList, true);
      log.log(
        `👥 fetchFriends completed - processed ${friendsList.length} friends`,
      );
    } catch (error) {
      log.error("Failed to fetch friends:", error);
      // Silently handle error - UI will show appropriate state
    }
  };

  private fetchFriendRequests = async () => {
    // Friend requests are now included in the friends list with status='pending'
    // This method is kept for backward compatibility but does nothing
    log.log("👥 fetchFriendRequests called - now handled by fetchFriends");
  };

  private fetchFeed = async () => {
    if (!this.credentials) return;

    try {
      log.log("📰 Fetching feed...");
      const state = storage.getState();
      const existingItems = state.feedItems;
      const head = state.feedHead;

      // Load feed items - if we have a head, load newer items
      let allItems: FeedItem[] = [];
      let hasMore = true;
      let cursor = head ? { after: head } : undefined;
      let loadedCount = 0;
      const maxItems = 500;

      // Keep loading until we reach known items or hit max limit
      while (hasMore && loadedCount < maxItems) {
        const response = await fetchFeed(this.credentials, {
          limit: 100,
          ...cursor,
        });

        // Check if we reached known items
        const foundKnown = response.items.some((item) =>
          existingItems.some((existing) => existing.id === item.id),
        );

        allItems.push(...response.items);
        loadedCount += response.items.length;
        hasMore = response.hasMore && !foundKnown;

        // Update cursor for next page
        if (response.items.length > 0) {
          const lastItem = response.items[response.items.length - 1];
          cursor = { after: lastItem.cursor };
        }
      }

      // If this is initial load (no head), also load older items
      if (!head && allItems.length < 100) {
        const response = await fetchFeed(this.credentials, {
          limit: 100,
        });
        allItems.push(...response.items);
      }

      // Collect user IDs from friend-related feed items
      const userIds = new Set<string>();
      allItems.forEach((item) => {
        if (
          item.body &&
          (item.body.kind === "friend_request" ||
            item.body.kind === "friend_accepted")
        ) {
          userIds.add(item.body.uid);
        }
      });

      // Fetch missing users
      if (userIds.size > 0) {
        await this.assumeUsers(Array.from(userIds));
      }

      // Filter out items where user is not found (404)
      const users = storage.getState().users;
      const compatibleItems = allItems.filter((item) => {
        // Keep text items
        if (item.body.kind === "text") return true;

        // For friend-related items, check if user exists and is not null (404)
        if (
          item.body.kind === "friend_request" ||
          item.body.kind === "friend_accepted"
        ) {
          const userProfile = users[item.body.uid];
          // Keep item only if user exists and is not null
          return userProfile !== null && userProfile !== undefined;
        }

        return true;
      });

      // Apply only compatible items to storage
      storage.getState().applyFeedItems(compatibleItems);
      log.log(
        `📰 fetchFeed completed - loaded ${compatibleItems.length} compatible items (${allItems.length - compatibleItems.length} filtered)`,
      );
    } catch (error) {
      log.error("Failed to fetch feed:", error);
    }
  };

  private syncSettings = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const maxRetries = 3;
    let retryCount = 0;
    const syncablePendingSettings = stripManagedAccountProfileSettings(
      this.pendingSettings,
    );

    if (
      Object.keys(syncablePendingSettings).length !==
      Object.keys(this.pendingSettings).length
    ) {
      this.pendingSettings = syncablePendingSettings;
      savePendingSettings(syncablePendingSettings);
    }

    // Apply pending settings
    if (Object.keys(syncablePendingSettings).length > 0) {
      while (retryCount < maxRetries) {
        let version = storage.getState().settingsVersion;
        let settings = applySettings(
          storage.getState().settings,
          syncablePendingSettings,
        );
        const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
          method: "POST",
          body: JSON.stringify({
            settings: await this.encryption.encryptRaw(settings),
            expectedVersion: version ?? 0,
          }),
          headers: {
            Authorization: `Bearer ${this.credentials.token}`,
            "Content-Type": "application/json",
          },
        });
        const data = (await response.json()) as
          | {
              success: false;
              error: string;
              currentVersion: number;
              currentSettings: string | null;
            }
          | {
              success: true;
            };
        if (data.success) {
          this.pendingSettings = {};
          savePendingSettings({});
          break;
        }
        if (data.error === "version-mismatch") {
          // Parse server settings
          const serverSettings = data.currentSettings
            ? settingsParse(
                await this.encryption.decryptRaw(data.currentSettings),
              )
            : { ...settingsDefaults };

          // Merge: server base + our pending changes (our changes win)
          const mergedSettings = mergeServerSettingsWithLocalProfiles(
            applySettings(serverSettings, syncablePendingSettings),
            storage.getState().settings.profiles,
          );

          // Update local storage with merged result at server's version
          storage.getState().applySettings(mergedSettings, data.currentVersion);

          // Sync tracking state with merged settings
          if (tracking) {
            mergedSettings.analyticsOptOut
              ? tracking.optOut()
              : tracking.optIn();
          }

          // Log and retry
          log.log(`settings version-mismatch, retrying: serverVersion=${data.currentVersion}, retry=${retryCount + 1}, pendingKeys=${Object.keys(syncablePendingSettings).join(",")}`);
          retryCount++;
          continue;
        } else {
          throw new Error(`Failed to sync settings: ${data.error}`);
        }
      }
    }

    // If exhausted retries, throw to trigger outer backoff delay
    if (retryCount >= maxRetries) {
      throw new Error(
        `Settings sync failed after ${maxRetries} retries due to version conflicts`,
      );
    }

    // Run request
    const response = await fetch(`${API_ENDPOINT}/v1/account/settings`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    const data = (await response.json()) as {
      settings: string | null;
      settingsVersion: number;
    };

    // Parse response
    let parsedSettings: Settings;
    if (data.settings) {
      parsedSettings = settingsParse(
        await this.encryption.decryptRaw(data.settings),
      );
    } else {
      parsedSettings = { ...settingsDefaults };
    }
    parsedSettings = mergeServerSettingsWithLocalProfiles(
      parsedSettings,
      storage.getState().settings.profiles,
    );

    // Apply settings to storage
    storage.getState().applySettings(parsedSettings, data.settingsVersion);

    // Sync PostHog opt-out state with settings
    if (tracking) {
      if (parsedSettings.analyticsOptOut) {
        tracking.optOut();
      } else {
        tracking.optIn();
      }
    }
  };

  private syncAccountProfiles = async () => {
    if (!this.credentials) return;

    const remoteProfiles = await fetchAccountProfiles(this.credentials);
    const currentLocalProfiles = storage.getState().settings.profiles ?? [];
    const mergedProfiles = mergeAccountProfiles({
      localProfiles: currentLocalProfiles,
      remoteProfiles,
    });

    storage.getState().applySettingsLocal({
      profiles: mergedProfiles.profiles,
    });
  };

  private fetchProfile = async () => {
    if (!this.credentials) return;

    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/account/profile`, {
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const data = await response.json();
    const parsedProfile = profileParse(data);

    // Apply profile to storage
    storage.getState().applyProfile(parsedProfile);
  };

  private fetchNativeUpdate = async () => {
    try {
      // Skip in development
      if (
        (Platform.OS !== "android" && Platform.OS !== "ios") ||
        !Constants.expoConfig?.version
      ) {
        return;
      }
      if (
        Platform.OS === "ios" &&
        !Constants.expoConfig?.ios?.bundleIdentifier
      ) {
        return;
      }
      if (
        Platform.OS === "android" &&
        !Constants.expoConfig?.android?.package
      ) {
        return;
      }

      const serverUrl = getServerUrl();

      // Get platform and app identifiers
      const platform = Platform.OS;
      const version = Constants.expoConfig?.version!;
      const appId =
        Platform.OS === "ios"
          ? Constants.expoConfig?.ios?.bundleIdentifier!
          : Constants.expoConfig?.android?.package!;

      const response = await fetch(`${serverUrl}/v1/version`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform,
          version,
          app_id: appId,
        }),
      });

      if (!response.ok) {
        log.log(`[fetchNativeUpdate] Request failed: ${response.status}`);
        return;
      }

      const data = await response.json();

      // Apply update status to storage
      if (data.update_required && data.update_url) {
        storage.getState().applyNativeUpdateStatus({
          available: true,
          updateUrl: data.update_url,
        });
      } else {
        storage.getState().applyNativeUpdateStatus({
          available: false,
        });
      }
    } catch (error) {
      log.log(`[fetchNativeUpdate] Error: ${error}`);
      storage.getState().applyNativeUpdateStatus(null);
    }
  };

  private syncPurchases = async () => {
    try {
      // Initialize RevenueCat if not already done
      if (!this.revenueCatInitialized) {
        // Get the appropriate API key based on platform
        let apiKey: string | undefined;

        if (Platform.OS === "ios") {
          apiKey = config.revenueCatAppleKey;
        } else if (Platform.OS === "android") {
          apiKey = config.revenueCatGoogleKey;
        } else if (Platform.OS === "web") {
          apiKey = config.revenueCatStripeKey;
        }

        if (!apiKey) {
          return;
        }

        // Configure RevenueCat
        if (__DEV__) {
          RevenueCat.setLogLevel(LogLevel.DEBUG);
        }

        // Initialize with the public ID as user ID
        RevenueCat.configure({
          apiKey,
          appUserID: this.serverID, // In server this is a CUID, which we can assume is globaly unique even between servers
          useAmazon: false,
        });

        this.revenueCatInitialized = true;
        log.log("RevenueCat initialized successfully");
      }

      // Sync purchases
      await RevenueCat.syncPurchases();

      // Fetch customer info
      const customerInfo = await RevenueCat.getCustomerInfo();

      // Apply to storage (storage handles the transformation)
      storage.getState().applyPurchases(customerInfo);
    } catch (error) {
      log.error("Failed to sync purchases:", error);
      // Don't throw - purchases are optional
    }
  };

  private flushOutbox = async (sessionId: string) => {
    const pending = this.pendingOutbox.get(sessionId);
    if (!pending || pending.length === 0) {
      if (!this.hasPendingOutboxMessages()) {
        this.clearBackgroundSendWatchdog();
        await this.cancelBackgroundSendTimeoutNotification();
        this.backgroundSendStartedAt = null;
      }
      return;
    }

    const batch = pending.slice();
    const controller = new AbortController();
    this.sendAbortControllers.set(sessionId, controller);
    try {
      const response = await apiSocket.request(
        `/v3/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            messages: batch.map((message) => ({
              localId: message.localId,
              content: message.content,
            })),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to send messages for ${sessionId}: ${response.status}`,
        );
      }

      const data = (await response.json()) as V3PostSessionMessagesResponse;
      pending.splice(0, batch.length);
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const currentLastSeq = this.sessionLastSeq.get(sessionId) ?? 0;
        let maxSeq = currentLastSeq;
        for (const message of data.messages) {
          if (message.seq > maxSeq) {
            maxSeq = message.seq;
          }
        }
        this.sessionLastSeq.set(sessionId, maxSeq);
        saveLastSeq(sessionId, maxSeq);
      }
    } catch (error) {
      this.maybeStartBackgroundSendWatchdog();
      throw error;
    } finally {
      this.sendAbortControllers.delete(sessionId);
    }

    if (pending.length === 0) {
      this.pendingOutbox.delete(sessionId);
    }
    if (!this.hasPendingOutboxMessages()) {
      this.clearBackgroundSendWatchdog();
      await this.cancelBackgroundSendTimeoutNotification();
      this.backgroundSendStartedAt = null;
    } else if (this.appState !== "active") {
      this.maybeStartBackgroundSendWatchdog();
    }
  };

  private fetchMessages = async (sessionId: string) => {
    log.log(
      `💬 fetchMessages starting for session ${sessionId} - acquiring lock`,
    );
    const lock = this.getSessionMessageLock(sessionId);
    await lock.inLock(async () => {
      const encryption = this.encryption.getSessionEncryption(sessionId);
      if (!encryption) {
        log.log(
          `💬 fetchMessages: Session encryption not ready for ${sessionId}, will retry`,
        );
        throw new Error(`Session encryption not ready for ${sessionId}`);
      }

      let afterSeq = this.sessionLastSeq.get(sessionId) ?? 0;
      let hasMore = true;
      let totalNormalized = 0;
      let isFirstBatch = true;

      // After the first batch is applied immediately (to exit loading state),
      // remaining batches are collected here and applied all at once at the end.
      const remainingNormalized: NormalizedMessage[] = [];
      const historySignalEntries: Array<{
        seq: number;
        content: RawRecord | null | undefined;
      }> = [];

      // When starting from seq 0 (no cache, no persisted lastSeq), fetch the
      // NEWEST messages first using reverse pagination (before_seq). This way
      // the user sees the latest content immediately instead of waiting for
      // all historical messages to load.
      let needsBackfill = false;
      let backfillMaxSeq = 0;
      if (afterSeq === 0) {
        const newestResponse = await apiSocket.request(
          `/v3/sessions/${sessionId}/messages?before_seq=2147483647&limit=300`,
        );
        if (!newestResponse.ok && newestResponse.status === 404) {
          log.log(
            `💬 fetchMessages: session ${sessionId} not found (404), cleaning up`,
          );
          this.cleanupSessionLocally(sessionId);
          throw new NonRetryableError(`Session ${sessionId} not found`);
        }
        if (newestResponse.ok) {
          const newestData =
            (await newestResponse.json()) as V3GetSessionMessagesResponse;
          const newestMessages = Array.isArray(newestData.messages)
            ? newestData.messages
            : [];
          if (newestMessages.length > 0) {
            const decryptResult = await this.decryptAndNormalizeBatch(
              encryption,
              newestMessages,
              sessionId,
            );
            const normalized = decryptResult.normalized;
            historySignalEntries.push(...decryptResult.sequencedContents);

            totalNormalized += normalized.length;
            if (normalized.length > 0) {
              this.applyMessages(sessionId, normalized);
            }
            storage.getState().applyMessagesLoaded(sessionId);
            isFirstBatch = false;

            // Track the seq range covered by the newest batch.
            // Forward pagination will fill in gaps (if any) below this range.
            let minNewestSeq = Infinity;
            let maxNewestSeq = 0;
            for (const msg of newestMessages) {
              if (msg.seq < minNewestSeq) minNewestSeq = msg.seq;
              if (msg.seq > maxNewestSeq) maxNewestSeq = msg.seq;
            }

            // If there are older messages, backfill with forward pagination.
            // Do NOT save maxNewestSeq as lastSeq yet — if backfill is interrupted,
            // the next attempt must still start from seq 0 to avoid missing messages.
            if (newestData.hasMore) {
              log.log(
                `💬 fetchMessages: newest batch loaded (seq ${minNewestSeq}-${maxNewestSeq}), backfilling older messages`,
              );
              needsBackfill = true;
              backfillMaxSeq = maxNewestSeq;
              // afterSeq stays at 0, forward pagination will fill in everything
            } else {
              // All messages fit in one batch, no more to fetch
              this.sessionLastSeq.set(sessionId, maxNewestSeq);
              saveLastSeq(sessionId, maxNewestSeq);
              hasMore = false;
            }
          }
        }
      }

      while (hasMore) {
        const response = await apiSocket.request(
          `/v3/sessions/${sessionId}/messages?after_seq=${afterSeq}&limit=100`,
        );
        if (!response.ok) {
          if (response.status === 404) {
            log.log(
              `💬 fetchMessages: session ${sessionId} not found (404), cleaning up`,
            );
            this.cleanupSessionLocally(sessionId);
            throw new NonRetryableError(`Session ${sessionId} not found`);
          }
          throw new Error(
            `Failed to fetch messages for ${sessionId}: ${response.status}`,
          );
        }
        const data = (await response.json()) as V3GetSessionMessagesResponse;
        const messages = Array.isArray(data.messages) ? data.messages : [];

        let maxSeq = afterSeq;
        for (const message of messages) {
          if (message.seq > maxSeq) {
            maxSeq = message.seq;
          }
        }

        const decryptResult = await this.decryptAndNormalizeBatch(
          encryption,
          messages,
          sessionId,
        );
        const batchNormalized = decryptResult.normalized;
        historySignalEntries.push(...decryptResult.sequencedContents);

        totalNormalized += batchNormalized.length;

        // Apply first batch immediately so the UI exits the loading spinner.
        // Subsequent batches are collected and applied all at once at the end
        // to avoid the jarring "old messages appear first" progressive loading.
        if (isFirstBatch) {
          if (batchNormalized.length > 0) {
            this.applyMessages(sessionId, batchNormalized);
          }
          storage.getState().applyMessagesLoaded(sessionId);
          isFirstBatch = false;
        } else {
          remainingNormalized.push(...batchNormalized);
        }

        // During backfill (needsBackfill=true), only update the in-memory cursor.
        // Persisting intermediate seq values would cause interrupted backfills to
        // skip earlier messages on next attempt. The final lastSeq is saved after
        // the loop completes successfully.
        this.sessionLastSeq.set(sessionId, maxSeq);
        if (!needsBackfill) {
          saveLastSeq(sessionId, maxSeq);
        }
        hasMore = !!data.hasMore;
        if (hasMore && maxSeq === afterSeq) {
          // API returned hasMore=true but no new messages (empty page).
          // Skip past current seq to avoid infinite loop.
          log.log(
            `💬 fetchMessages: pagination stalled at seq ${afterSeq} for ${sessionId}, advancing by 1`,
          );
          afterSeq = maxSeq + 1;
        } else {
          afterSeq = maxSeq;
        }
      }

      // Apply remaining batches at once so the UI renders them together.
      // We call applyMessages directly (not enqueueMessages) because we
      // already hold the sessionMessageLock — the queue processor needs
      // the same lock and would deadlock.
      if (remainingNormalized.length > 0) {
        this.applyMessages(sessionId, remainingNormalized);
      }

      // If we did a reverse-pagination + backfill, now that backfill is
      // complete we can safely persist the highest seq from the newest batch.
      // This ensures interrupted backfills restart from seq 0 next time.
      if (needsBackfill && backfillMaxSeq > 0) {
        this.sessionLastSeq.set(sessionId, backfillMaxSeq);
        saveLastSeq(sessionId, backfillMaxSeq);
      }

      // Surface side-channel session signals after all messages are merged in seq order.
      const finalHistorySignals = collectSequencedHistorySignals(historySignalEntries);
      storage.getState().setPromptSuggestion(sessionId, finalHistorySignals.promptSuggestion);
      storage.getState().setNeedsContinue(sessionId, finalHistorySignals.needsContinue);
      if (finalHistorySignals.sdkSessionState !== null) {
        const currentSession = storage.getState().sessions[sessionId];
        if (currentSession) {
          this.applySessions([
            {
              ...currentSession,
              sdkSessionState: finalHistorySignals.sdkSessionState,
            },
          ]);
        }
      }

      storage.getState().applyMessagesLoaded(sessionId);
      log.log(
        `💬 fetchMessages completed for session ${sessionId} - processed ${totalNormalized} messages`,
      );

      // Fetch cumulative usage baseline from server (non-blocking)
      if (this.credentials) {
        getSessionUsageSummary(this.credentials, sessionId)
          .then((summary) => {
            if (summary.reportCount > 0) {
              storage.getState().applySessionUsageBaseline(sessionId, {
                totalInputTokens: summary.totalInputTokens,
                totalOutputTokens: summary.totalOutputTokens,
                lastInputTokens: summary.lastInputTokens,
                lastOutputTokens: summary.lastOutputTokens,
                lastCacheCreation: summary.lastCacheCreation,
                lastCacheRead: summary.lastCacheRead,
              });
              log.log(
                `💬 Applied usage baseline for ${sessionId}: ${summary.totalInputTokens} in / ${summary.totalOutputTokens} out`,
              );
            }
          })
          .catch((error) => {
            log.log(
              `💬 Failed to fetch usage baseline for ${sessionId}: ${error}`,
            );
          });
      }
    });
  };

  private registerPushToken = async () => {
    log.log("registerPushToken");
    // Only register on mobile platforms
    if (Platform.OS === "web") {
      return;
    }

    // Request permission
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    log.log("existingStatus: " + JSON.stringify(existingStatus));

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    log.log("finalStatus: " + JSON.stringify(finalStatus));

    if (finalStatus !== "granted") {
      log.log("Failed to get push token for push notification!");
      return;
    }

    // Get push token
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    log.log("tokenData: " + JSON.stringify(tokenData));

    // Register with server
    try {
      await registerPushToken(this.credentials, tokenData.data);
      log.log("Push token registered successfully");
    } catch (error) {
      log.log("Failed to register push token: " + JSON.stringify(error));
    }
  };

  private subscribeToUpdates = () => {
    // Subscribe to message updates
    apiSocket.onMessage("update", this.handleUpdate.bind(this));
    apiSocket.onMessage("ephemeral", this.handleEphemeralUpdate.bind(this));

    // Subscribe to connection state changes
    apiSocket.onReconnected(() => {
      log.log("🔌 Socket reconnected");
      const syncState = storage.getState();
      const sessionsToReset = Object.values(syncState.sessions).map((session) => {
        const { presence: _presence, ...rest } = session;
        return {
          ...rest,
          rpcReady: false,
        };
      });
      if (sessionsToReset.length > 0) {
        syncState.applySessions(sessionsToReset);
      }
      const machinesToReset = Object.values(syncState.machines).map((machine) => ({
        ...machine,
        rpcReady: false,
      }));
      if (machinesToReset.length > 0) {
        syncState.applyMachines(machinesToReset);
      }
      this.sessionsSync.invalidate();
      this.machinesSync.invalidate();
      log.log("🔌 Socket reconnected: Invalidating artifacts sync");
      this.artifactsSync.invalidate();
      this.friendsSync.invalidate();
      this.friendRequestsSync.invalidate();
      this.feedSync.invalidate();
      const sessionsData = syncState.sessionsData;
      if (sessionsData) {
        for (const item of sessionsData) {
          if (typeof item !== "string") {
            this.getMessagesSync(item.id)?.invalidate();
            // Also invalidate git status on reconnection
            gitStatusSync.invalidate(item.id);
          }
        }
      }
      for (const sync of this.sendSync.values()) {
        sync.invalidate();
      }
    });
  };

  private get updateHandlerCtx(): UpdateHandlerContext {
    return {
      encryption: this.encryption,
      artifactDataKeys: this.artifactDataKeys,
      applySessions: this.applySessions.bind(this),
      enqueueMessages: this.enqueueMessages.bind(this),
      getMessagesSync: this.getMessagesSync.bind(this),
      fetchSessions: () => { this.fetchSessions(); },
      onSessionVisible: this.onSessionVisible.bind(this),
      sessionLastSeq: this.sessionLastSeq,
      saveLastSeq: saveLastSeq,
      deleted404Sessions: this.deleted404Sessions,
      messagesSync: this.messagesSync as Map<string, { stop: () => void }>,
      sendSync: this.sendSync as Map<string, { stop: () => void }>,
      pendingOutbox: this.pendingOutbox as Map<string, unknown[]>,
      deleteLastSeq: deleteLastSeq,
      sessionMessageLocks: this.sessionMessageLocks as Map<string, unknown>,
      sessionMessageQueue: this.sessionMessageQueue as Map<string, unknown[]>,
      sessionQueueProcessing: this.sessionQueueProcessing,
      artifactsSync: this.artifactsSync,
      friendsSync: this.friendsSync,
      friendRequestsSync: this.friendRequestsSync,
      feedSync: this.feedSync,
      projectsSync: this.projectsSync,
      sessionsSync: this.sessionsSync,
      assumeUsers: this.assumeUsers.bind(this),
    };
  }

  private handleUpdate = async (update: unknown) => {
    const validatedUpdate = ApiUpdateContainerSchema.safeParse(update);
    if (!validatedUpdate.success) {
      log.log(`❌ Sync: Invalid update received: ${validatedUpdate.error}`);
      return;
    }
    const updateData = validatedUpdate.data;
    const ctx = this.updateHandlerCtx;

    if (updateData.body.t === "new-message") {
      await handleNewMessageUpdate(updateData, updateData.body, ctx);
    } else if (updateData.body.t === "new-session") {
      log.log("🆕 New session update received");
      this.sessionsSync.invalidate();
    } else if (updateData.body.t === "delete-session") {
      handleDeleteSessionUpdate(updateData.body, ctx);
    } else if (updateData.body.t === "update-session") {
      await handleUpdateSessionUpdate(updateData, updateData.body, ctx);
    } else if (updateData.body.t === "update-account") {
      await handleUpdateAccountUpdate(updateData, updateData.body, ctx);
    } else if (updateData.body.t === "update-machine") {
      await handleUpdateMachineUpdate(updateData, updateData.body, ctx);
    } else if (updateData.body.t === "relationship-updated") {
      handleRelationshipUpdate(updateData.body, ctx);
    } else if (updateData.body.t === "new-artifact") {
      await handleNewArtifactUpdate(updateData.body, ctx);
    } else if (updateData.body.t === "update-artifact") {
      await handleUpdateArtifactUpdate(updateData, updateData.body, ctx);
    } else if (updateData.body.t === "delete-artifact") {
      handleDeleteArtifactUpdate(updateData.body, ctx);
    } else if (updateData.body.t === "new-feed-post") {
      await handleNewFeedPostUpdate(updateData.body, ctx);
    } else if (updateData.body.t === "kv-batch-update") {
      const { researchConfigChanges } = await handleKvBatchUpdate(updateData.body);
      for (const change of researchConfigChanges) {
        for (const listener of this.researchConfigListeners) {
          listener(change);
        }
      }
    } else if (
      updateData.body.t === "new-project" ||
      updateData.body.t === "update-project" ||
      updateData.body.t === "delete-project"
    ) {
      handleProjectUpdate(updateData.body, ctx);
    }
  };

  private flushActivityUpdates = (
    updates: Map<string, ApiEphemeralActivityUpdate>,
  ) => {
    // log.log(`🔄 Flushing activity updates for ${updates.size} sessions - acquiring lock`);

    const sessions: Session[] = [];

    for (const [sessionId, update] of updates) {
      const session = storage.getState().sessions[sessionId];
      if (session) {
        // Ephemeral activity updates carry the CLI's real-time thinking state.
        // Lifecycle events (turn-end via result messages) provide authoritative
        // turn boundaries and are applied separately via applySessions in handleUpdate.
        //
        // Guard: if a lifecycle event set thinkingAt more recently than this
        // ephemeral heartbeat's activeAt, keep the lifecycle thinking state
        // to avoid a stale heartbeat flashing the status back to "online".
        const resolved = resolveActivityThinking(
          { thinking: session.thinking, thinkingAt: session.thinkingAt },
          { active: update.active, activeAt: update.activeAt, thinking: update.thinking },
        );
        sessions.push({
          ...session,
          active: update.active,
          activeAt: update.activeAt,
          thinking: resolved.thinking,
          thinkingAt: resolved.thinkingAt,
          apiRetry: update.apiRetry
            ? {
                attempt: update.apiRetry.attempt,
                maxRetries: update.apiRetry.maxRetries,
                retryDelayMs: update.apiRetry.retryDelayMs,
                errorStatus: update.apiRetry.errorStatus,
                timestamp: Date.now(),
              }
            : null,
        });
      }
    }

    if (sessions.length > 0) {
      this.applySessions(sessions);
    }
  };

  private handleEphemeralUpdate = (update: unknown) => {
    const validatedUpdate = ApiEphemeralUpdateSchema.safeParse(update);
    if (!validatedUpdate.success) {
      log.log(`Invalid ephemeral update received: ${validatedUpdate.error}`);
      return;
    }
    const updateData = validatedUpdate.data;

    // Process activity updates through smart debounce accumulator
    if (updateData.type === "activity") {
      this.activityAccumulator.addUpdate(updateData);
    }

    // Handle machine activity updates
    if (updateData.type === "machine-activity") {
      // Update machine's active status and lastActiveAt
      const machine = storage.getState().machines[updateData.id];
      if (machine) {
        const updatedMachine: Machine = {
          ...machine,
          active: updateData.active,
          activeAt: updateData.activeAt,
        };
        storage.getState().applyMachines([updatedMachine]);
      }
    }

    // Handle RPC ready status updates
    if (updateData.type === "rpc-ready") {
      if (updateData.scope === "machine") {
        const machine = storage.getState().machines[updateData.id];
        if (machine) {
          storage.getState().applyMachines([{
            ...machine,
            rpcReady: updateData.ready,
          }]);
        }
      } else if (updateData.scope === "session") {
        const session = storage.getState().sessions[updateData.id];
        if (session) {
          this.applySessions([{
            ...session,
            rpcReady: updateData.ready,
          }]);
        }
      }
    }

    // Handle usage updates
    if (updateData.type === "usage") {
      const session = storage.getState().sessions[updateData.id];
      if (session) {
        const prevUsage = session.latestUsage;
        const updatedSession: Session = {
          ...session,
          latestUsage: {
            inputTokens: updateData.tokens.input,
            outputTokens: updateData.tokens.output,
            cacheCreation: updateData.tokens.cache_creation,
            cacheRead: updateData.tokens.cache_read,
            contextSize:
              updateData.tokens.input +
              updateData.tokens.cache_creation +
              updateData.tokens.cache_read,
            totalInputTokens:
              (prevUsage?.totalInputTokens ?? 0) +
              updateData.tokens.input +
              updateData.tokens.cache_creation +
              updateData.tokens.cache_read,
            totalOutputTokens:
              (prevUsage?.totalOutputTokens ?? 0) + updateData.tokens.output,
            timestamp: updateData.timestamp,
          },
        };
        this.applySessions([updatedSession]);
      }
    }

    // daemon-status ephemeral updates are deprecated, machine status is handled via machine-activity

    // Handle webhook-issue-linked: create IssueSessionLink so the session list
    // shows issue info for webhook-triggered sessions (same as app-initiated ones).
    if (updateData.type === "webhook-issue-linked") {
      void this.handleWebhookIssueLinked(updateData);
    }

    // Handle webhook-pr-merged: archive session and mark IssueSessionLink as completed.
    if (updateData.type === "webhook-pr-merged") {
      void this.handleWebhookPRMerged(updateData);
    }

    // Handle supervisor-status: notify listeners for real-time Health Tab updates.
    if (updateData.type === "supervisor-status") {
      const event = {
        projectId: updateData.projectId,
        status: updateData.status,
        runId: updateData.runId,
        currentDimension: updateData.currentDimension,
        dimensionIndex: updateData.dimensionIndex,
        totalDimensions: updateData.totalDimensions,
      };
      for (const listener of this.supervisorStatusListeners) {
        listener(event);
      }
    }

    // Handle knowledge-count: update session knowledge badge in header
    if (updateData.type === "knowledge-count") {
      storage.setState((prev) => ({
        sessionKnowledgeCount: {
          ...prev.sessionKnowledgeCount,
          [updateData.id]: updateData.count,
        },
      }));
    }

    // Handle knowledge-access-update: bump per-session revision so hooks
    // (useSessionKnowledge, useSessionKnowledgeAccesses) refetch and show
    // fresh turnsRemaining / hitCount / references.
    if (updateData.type === "knowledge-access-update") {
      storage.setState((prev) => ({
        sessionKnowledgeAccessRevision: {
          ...prev.sessionKnowledgeAccessRevision,
          [updateData.sessionId]:
            (prev.sessionKnowledgeAccessRevision[updateData.sessionId] ?? 0) + 1,
        },
      }));
    }

    // Handle task-log: forward log chunks to task-log listeners
    if (updateData.type === "task-log") {
      for (const listener of this.taskLogListeners) {
        listener(updateData.sessionId, updateData.taskId, updateData.chunk);
      }
    }

    // Handle task-status-changed: notify listeners for real-time task status updates
    if (updateData.type === "task-status-changed") {
      for (const listener of this.taskStatusListeners) {
        listener({
          taskId: updateData.taskId,
          machineId: updateData.machineId,
          status: updateData.status,
          sessionId: updateData.sessionId,
          errorMessage: updateData.errorMessage,
          completedAt: updateData.completedAt,
        });
      }
    }

    // Handle inbox-new-item: notify listeners for real-time inbox updates
    if (updateData.type === "inbox-new-item" && updateData.item) {
      for (const listener of this.inboxNewItemListeners) {
        listener(updateData.item);
      }
    }

    // Handle inbox-unread-count: notify listeners for badge updates
    if (updateData.type === "inbox-unread-count" && typeof updateData.count === "number") {
      for (const listener of this.inboxUnreadCountListeners) {
        listener(updateData.count);
      }
    }

    // Handle session-event-created: notify listeners for real-time timeline updates
    if (updateData.type === "session-event-created" && updateData.event) {
      for (const listener of this.sessionEventCreatedListeners) {
        listener(updateData.event);
      }
    }

    // Handle supervisor-loop-status: notify listeners for real-time Loop status updates.
    if (updateData.type === "supervisor-loop-status") {
      const loopEvent = {
        loopId: updateData.loopId,
        projectId: updateData.projectId,
        status: updateData.status,
        currentIteration: updateData.currentIteration,
        maxIterations: updateData.maxIterations,
        currentPhase: updateData.currentPhase,
        totalCostUsd: updateData.totalCostUsd,
        totalActionsFound: updateData.totalActionsFound,
        totalActionsFixed: updateData.totalActionsFixed,
        currentHealthScore: updateData.currentHealthScore,
        initialHealthScore: updateData.initialHealthScore,
        exitReason: updateData.exitReason,
        consecutiveFailures: updateData.consecutiveFailures,
      };
      for (const listener of this.supervisorLoopStatusListeners) {
        listener(loopEvent);
      }
    }

  };

  /**
   * Create an IssueSessionLink when a webhook-triggered session completes.
   * Delegates to syncIssueHandlers module.
   */
  private handleWebhookIssueLinked = async (data: {
    readonly issueNumber: number;
    readonly issueTitle: string;
    readonly issueBody: string;
    readonly issueAuthor: string;
    readonly issueLabels: string[];
    readonly issueUrl: string;
    readonly repoUrl: string;
    readonly repoPath: string;
    readonly machineId: string;
    readonly sessionId: string;
  }): Promise<void> => {
    await issueHandleWebhookIssueLinked(data);
  };

  private handleWebhookPRMerged = async (data: {
    readonly prNumber: number;
    readonly prUrl: string;
    readonly issueNumber: number;
    readonly sessionId: string;
    readonly machineId: string;
    readonly repoPath: string;
  }): Promise<void> => {
    await issueHandleWebhookPRMerged(data);
  };

  //
  // Apply store
  //

  private scheduleCacheWrite(sessionId: string): void {
    const existing = this.cacheWriteTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }

    this.cacheWriteTimers.set(
      sessionId,
      setTimeout(() => {
        this.cacheWriteTimers.delete(sessionId);
        const session = storage.getState().sessionMessages[sessionId];
        const lastSeq = this.sessionLastSeq.get(sessionId) ?? 0;
        if (session?.isLoaded && session.messages.length > 0) {
          saveMessageCache(sessionId, session.messages, lastSeq);
        }
      }, 2000),
    );
  }

  private flushPendingCacheWrites(): void {
    for (const [sessionId, timer] of this.cacheWriteTimers) {
      clearTimeout(timer);
      const session = storage.getState().sessionMessages[sessionId];
      const lastSeq = this.sessionLastSeq.get(sessionId) ?? 0;
      if (session?.isLoaded && session.messages.length > 0) {
        saveMessageCache(sessionId, session.messages, lastSeq);
      }
    }
    this.cacheWriteTimers.clear();
  }

  private cancelPendingCacheWrites(): void {
    for (const timer of this.cacheWriteTimers.values()) {
      clearTimeout(timer);
    }
    this.cacheWriteTimers.clear();
  }

  /**
   * Decrypt and normalize a batch of raw messages.
   * Extracted to share between reverse-pagination (newest-first) and forward pagination paths.
   */
  private async decryptAndNormalizeBatch(
    encryption: SessionEncryption,
    rawMessages: ApiMessage[],
    sessionId?: string,
  ): Promise<{
    normalized: NormalizedMessage[];
    sequencedContents: Array<{ seq: number; content: RawRecord | null | undefined }>;
  }> {
    const decryptedMessages = await encryption.decryptMessages(rawMessages);
    const normalized: NormalizedMessage[] = [];
    const sequencedContents: Array<{ seq: number; content: RawRecord | null | undefined }> = [];
    let decryptFailCount = 0;
    for (let i = 0; i < decryptedMessages.length; i++) {
      const decrypted = decryptedMessages[i];
      const rawMessage = rawMessages[i];
      if (!decrypted) { decryptFailCount++; continue; }
      sequencedContents.push({ seq: rawMessage.seq, content: decrypted.content });
      const msg = normalizeRawMessage(
        decrypted.id,
        decrypted.localId,
        decrypted.createdAt,
        decrypted.content,
      );
      if (msg) normalized.push(msg);
    }
    if (decryptFailCount > 0) {
      log.warn(
        `⚠️ ${decryptFailCount}/${rawMessages.length} messages failed to decrypt for session ${sessionId ?? "unknown"} (possible encryption key mismatch after session reconnect)`,
      );
    }
    return { normalized, sequencedContents };
  }

  private applyMessages = (
    sessionId: string,
    messages: NormalizedMessage[],
  ) => {
    const result = storage.getState().applyMessages(sessionId, messages);
    let m: Message[] = [];
    for (let messageId of result.changed) {
      const message =
        storage.getState().sessionMessages[sessionId].messagesMap[messageId];
      if (message) {
        m.push(message);
      }
    }
    if (m.length > 0) {
      voiceHooks.onMessages(sessionId, m);
      autoOptionSendService.onMessages(sessionId);
    }
    if (result.hasReadyEvent) {
      voiceHooks.onReady(sessionId);
      autoOptionSendService.onReady(sessionId);
    }

    // Schedule debounced cache write
    this.scheduleCacheWrite(sessionId);
  };

  private applySessions = (
    sessions: (Omit<Session, "presence"> & {
      presence?: "online" | number;
    })[],
    replace?: boolean,
  ) => {
    const active = storage.getState().getActiveSessions();
    storage.getState().applySessions(sessions, replace);
    const newActive = storage.getState().getActiveSessions();
    this.applySessionDiff(active, newActive);
  };

  private applySessionDiff = (active: Session[], newActive: Session[]) => {
    let wasActive = new Set(active.map((s) => s.id));
    let isActive = new Set(newActive.map((s) => s.id));
    const endedSessionIds: string[] = [];
    for (let s of active) {
      if (!isActive.has(s.id)) {
        voiceHooks.onSessionOffline(s.id, s.metadata ?? undefined);
        endedSessionIds.push(s.id);
      }
    }
    for (let s of newActive) {
      if (!wasActive.has(s.id)) {
        voiceHooks.onSessionOnline(s.id, s.metadata ?? undefined);
      }
    }
    if (endedSessionIds.length > 0) {
      void issueMarkFailed(endedSessionIds);
    }
  };


  private prStatusCheckTimer: ReturnType<typeof setInterval> | null = null;

  startPRStatusPolling(): void {
    if (this.prStatusCheckTimer) return;
    this.prStatusCheckTimer = setInterval(
      () => void issueCheckProcessingPRs(),
      60_000, // Check every 60s
    );
  }

  stopPRStatusPolling(): void {
    if (this.prStatusCheckTimer) {
      clearInterval(this.prStatusCheckTimer);
      this.prStatusCheckTimer = null;
    }
  }

  // --- Supervisor status event subscription ---

  onSupervisorStatus(listener: (event: {
    projectId: string;
    status: string;
    runId: string;
    currentDimension?: string;
    dimensionIndex?: number;
    totalDimensions?: number;
  }) => void): () => void {
    this.supervisorStatusListeners.add(listener);
    return () => { this.supervisorStatusListeners.delete(listener); };
  }

  // --- Research config update subscription ---

  onResearchConfigUpdate(listener: (event: ResearchConfigChange) => void): () => void {
    this.researchConfigListeners.add(listener);
    return () => { this.researchConfigListeners.delete(listener); };
  }

  // --- Supervisor Loop status event subscription ---

  onSupervisorLoopStatus(listener: (event: {
    loopId: string;
    projectId: string;
    status: string;
    currentIteration: number;
    maxIterations: number;
    currentPhase: string;
    totalCostUsd: number;
    totalActionsFound: number;
    totalActionsFixed: number;
    currentHealthScore: number | null;
    initialHealthScore: number | null;
    exitReason: string | null;
    consecutiveFailures: number;
  }) => void): () => void {
    this.supervisorLoopStatusListeners.add(listener);
    return () => { this.supervisorLoopStatusListeners.delete(listener); };
  }

  // --- Task log streaming subscription ---

  onTaskLog(listener: (sessionId: string, taskId: string, chunk: string) => void): () => void {
    this.taskLogListeners.add(listener);
    return () => { this.taskLogListeners.delete(listener); };
  }


  onTaskStatusChanged(listener: (event: {
    taskId: string;
    machineId?: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
    completedAt?: number;
  }) => void): () => void {
    this.taskStatusListeners.add(listener);
    return () => { this.taskStatusListeners.delete(listener); };
  }

  onInboxNewItem(listener: (item: {
    id: string;
    category: string;
    eventType: string;
    severity: string;
    title: string;
    body?: string;
    read: boolean;
    referenceUrl?: string;
    refType?: string;
    refId?: string;
    groupKey?: string;
    createdAt: number;
  }) => void): () => void {
    this.inboxNewItemListeners.add(listener);
    return () => { this.inboxNewItemListeners.delete(listener); };
  }

  onInboxUnreadCount(listener: (count: number) => void): () => void {
    this.inboxUnreadCountListeners.add(listener);
    return () => { this.inboxUnreadCountListeners.delete(listener); };
  }

  onSessionEventCreated(listener: (event: {
    id: string;
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt: number;
  }) => void): () => void {
    this.sessionEventCreatedListeners.add(listener);
    return () => { this.sessionEventCreatedListeners.delete(listener); };
  }


  destroy() {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

}
export const sync = new Sync();

//
// Init sequence
//

let isInitialized = false;
export async function syncCreate(credentials: AuthCredentials) {
  if (isInitialized) {
    log.warn("Sync already initialized: ignoring");
    return;
  }
  isInitialized = true;
  await syncInit(credentials, false);
}

export async function syncRestore(credentials: AuthCredentials) {
  if (isInitialized) {
    log.warn("Sync already initialized: ignoring");
    return;
  }
  isInitialized = true;
  await syncInit(credentials, true);
}

async function syncInit(credentials: AuthCredentials, restore: boolean) {
  if (!hasCredentialSecret(credentials)) {
    throw new Error("Auth credentials do not include a sync secret");
  }

  // Initialize sync engine
  const secretKey = decodeBase64(credentials.secret, "base64url");
  if (secretKey.length !== 32) {
    throw new Error(
      `Invalid secret key length: ${secretKey.length}, expected 32`,
    );
  }
  const encryption = await Encryption.create(secretKey);

  // Initialize tracking
  initializeTracking(encryption.anonID);

  // Initialize socket connection
  const API_ENDPOINT = getServerUrl();
  apiSocket.initialize(
    { endpoint: API_ENDPOINT, token: credentials.token },
    encryption,
  );

  // Wire socket status to storage
  apiSocket.onStatusChange((status) => {
    storage.getState().setSocketStatus(status);
  });

  // Initialize sessions engine
  if (restore) {
    await sync.restore(credentials, encryption);
  } else {
    await sync.create(credentials, encryption);
  }
}
