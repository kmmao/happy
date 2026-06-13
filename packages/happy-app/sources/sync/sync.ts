import Constants from "expo-constants";
import { apiSocket } from "@/sync/apiSocket";
import { AuthCredentials } from "@/auth/tokenStorage";
import { hasCredentialSecret } from "@/auth/authCredentials";
import { Encryption } from "@/sync/encryption/encryption";
import { SessionEncryption } from "@/sync/encryption/sessionEncryption";
import { decodeBase64 } from "@/encryption/base64";
import { ingestStorage, storage, registerPreferencesSyncCallback, registerSessionEvictionCallback, registerPendingQueueDispatchCallback } from "./storage";
import { isSessionRunning, getSessionName } from "@/utils/sessionUtils";
import {
  notifyPermissionRequest,
  notifyTaskComplete,
  clearNotifiedRequests,
} from "@/utils/webNotification";
import { handleIssueSessionCompletion as issueHandleCompletion } from "./syncIssueHandlers";
import { throwIfNotOk } from "@/utils/http";
import {
  ApiMessage,
  ApiUpdateContainerSchema,
} from "./apiTypes";
import type { ApiEphemeralActivityUpdate } from "./apiTypes";
import type { Machine, Session } from "./storageTypes";
import { InvalidateSync } from "@/utils/sync";
import { ActivityUpdateAccumulator } from "./reducer/activityUpdateAccumulator";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "./apiPush";
import { Platform, AppState, type AppStateStatus } from "react-native";
import { isRunningOnMac } from "@/utils/platform";
import {
  NormalizedMessage,
  normalizeRawMessage,
  RawRecord,
} from "./typesRaw";
import {
  // All 12 handle*Update functions have been replaced by SyncUpdateIngest
  // (PRs 3–5 per ADR-0026). Their exports remain in syncUpdateHandlers.ts
  // for the moment; removal is deferred to PR 7 cleanup. Only the shared
  // type aliases are still imported here.
  type UpdateHandlerContext,
  type ResearchConfigChange,
} from "./syncUpdateHandlers";
import { ingestSyncUpdate } from "./ingest/syncUpdateIngest";
import { ingestEvents } from "./ingest/dispatcher";
import type { IngestContext } from "./ingest/ingestContext";
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
  markFailedIssueSessionsForEndedSessions as issueMarkFailed,
  checkProcessingPRs as issueCheckProcessingPRs,
  recoverMissingPRUrls as issueRecoverMissingPRUrls,
} from "./syncIssueHandlers";
import {
  applySettings,
  Settings,
  settingsDefaults,
  settingsParse,
  settingsToSyncPayload,
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
  deleteBackfillBoundary,
} from "./persistence";
import { SessionMessageCursorRegistry } from "./sessionMessageCursor";
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
import {
  createSessionMessageProcessor,
  type SessionMessageProcessor,
} from "./sessionMessageProcessor";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import { autoOptionSendService } from "@/sync/autoOptionSendService";
import { EncryptionCache } from "./encryption/encryptionCache";
import { systemPrompt } from "./prompt/systemPrompt";
import type { DecryptedArtifact } from "./artifactTypes";
import { getFriendsList, getUserProfile } from "./apiFriends";
import { fetchFeed } from "./apiFeed";
import type { FeedItem } from "./feedTypes";
import { UserProfile } from "./friendTypes";
import { resolveMessageModeMeta } from "./messageMeta";
import {
  initMessageCache,
  loadMessageCache,
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
import { fetchMachinesAction } from "./syncMachines";
import {
  // handleEphemeralUpdateAction — replaced by SyncEphemeralIngest in PR 6.
  // flushActivityUpdatesAction is still used by the ActivityUpdateAccumulator
  // flush callback (the seam pushes to the accumulator via
  // `ctx.addActivityUpdate`; the accumulator decides when to flush and uses
  // this helper to project pending updates into `applySessions`).
  flushActivityUpdatesAction,
} from "./syncEphemeralHandlers";
import { ingestSyncEphemeral } from "./ingest/syncEphemeralIngest";
import { ApiEphemeralUpdateSchema } from "./apiTypes";
import {
  fetchMessagesAction,
  applyMessagesAction,
  scheduleCacheWriteAction,
  flushPendingCacheWritesAction,
  cancelPendingCacheWritesAction,
  decryptAndNormalizeBatchAction,
  cleanupSessionLocallyCore,
  type MessageFetchContext,
} from "./syncMessageFetch";
import {
  prefetchOlderMessagesInBackground,
  type OlderMessagePrefetchDeps,
} from "./messagePrefetch";
import { pendingQueueDispatcher } from "./pendingQueueDispatcher";

type V3GetSessionMessagesResponse = {
  messages: ApiMessage[];
  hasMore: boolean;
  totalCount?: number;
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
  /**
   * Single owner of per-session read position (seq) + live dedup. Replaces the
   * former parallel `sessionLastSeq` + `processedWebSocketMessageIds` maps; seq
   * persistence is owned by the cursor's advanceTo (no ad-hoc saveLastSeq).
   */
  private cursors = new SessionMessageCursorRegistry(saveLastSeq, loadLastSeqs());
  private pendingOutbox = new Map<string, OutboxMessage[]>();
  // Owns the per-session message queue, serialization lock, processing flag,
  // and delta-batching frame. See sessionMessageProcessor.ts.
  private messageProcessor: SessionMessageProcessor =
    createSessionMessageProcessor({
      applyMessages: (sessionId, messages) =>
        this.applyMessages(sessionId, messages),
    });
  private deleted404Sessions = new Set<string>(); // Guard against re-creating sync for 404'd sessions
  // Tracks sessions that have completed a full history backfill in this app session.
  // In-memory only (not persisted) so every app restart re-backfills trimmed sessions,
  // ensuring users can always access their full message history.
  private backfilledSessions = new Set<string>();
  private sessionOldestSeq = new Map<string, number>();
  // Sessions with a running background older-message prefetch loop (re-entrancy guard).
  private backgroundPrefetchSessions = new Set<string>();

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
    triggerType?: string;
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
  private supervisorLoopBriefListeners = new Set<(event: {
    loopId: string;
    projectId: string;
    status: string;
    exitReason: string | null;
    generatedAt: number;
    currentIteration: number;
    maxIterations: number;
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    healthDelta: number | null;
    totalActionsFound: number;
    totalActionsFixed: number;
    consecutiveFailures: number;
    totalCostUsd: number;
    costCapUsd: number | null;
    summary: string;
  }) => void>();
  private autoLoopFiredListeners = new Set<(event: {
    projectId: string;
    loopId: string;
    healthScore: number;
    threshold: number;
    firedAt: number;
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
  private interAgentMessageListeners = new Set<(event: {
    fromSessionId: string;
    toSessionId: string;
    message: string;
    sentAt: number;
  }) => void>();
  private preferencesMigrationDone = false;
  private projectMigrationFailures = new Map<string, number>();
  private pendingSettings: Partial<Settings> = loadPendingSettings();
  private appState: AppStateStatus = AppState.currentState;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  // Last session opened via onSessionVisible. On AppState→active we re-invalidate
  // its messagesSync so the foreground session catches up if any `update` push
  // was missed while backgrounded but the socket stayed connected (web tab
  // throttling, iOS keep-alive). Socket reconnect already covers the disconnect case.
  private lastVisibleSessionId: string | null = null;
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
        pendingQueueDispatcher.scheduleAll();
        this.nativeUpdateSync.invalidate();
        log.log("📱 App became active: Invalidating artifacts sync");
        this.artifactsSync.invalidate();
        this.friendsSync.invalidate();
        this.friendRequestsSync.invalidate();
        this.feedSync.invalidate();
        this.projectsSync.invalidate();
        // Foreground session may have missed `update` pushes while backgrounded
        // (web tab throttled, iOS keep-alive). Re-invalidate its messagesSync
        // so lastSeq-based incremental fetch fills any gap.
        const foregroundSessionId = this.lastVisibleSessionId;
        if (foregroundSessionId) {
          this.getMessagesSync(foregroundSessionId)?.invalidate();
          gitStatusSync.getSync(foregroundSessionId).invalidate();
        }
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
    // Wire SyncUpdateIngest subscribers BEFORE subscribeToUpdates() so
    // the first incoming update finds its listeners already registered
    // (see ADR-0026; subscribers live for the process lifetime — Sync is
    // a singleton, no unsubscribe is tracked).
    this.registerIngestSubscribers();

    pendingQueueDispatcher.init(this.sendMessage.bind(this));

    // Initialize auto-option-send global service
    autoOptionSendService.init(this.sendMessage.bind(this));

    // Register pending queue dispatch callback so storage.ts can wake the
    // app-level queue owner without depending on SessionView mounting.
    registerPendingQueueDispatchCallback((sessionId) => {
      pendingQueueDispatcher.schedule(sessionId);
    });

    // Register preferences sync callback so storage.ts can trigger server sync
    registerPreferencesSyncCallback((sessionId) => {
      this.syncSessionPreferences(sessionId);
    });

    // Register LRU eviction callback to release per-session resources when
    // storage evicts session messages. Without this, messagesSync / sendSync /
    // locks / queues grow unboundedly as the user visits more sessions,
    // eventually causing the web tab to lag and crash.
    registerSessionEvictionCallback((sessionIds) => {
      this.releaseSessionResources(sessionIds);
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
        ingestStorage.getState().applyReady();
        pendingQueueDispatcher.scheduleAll();
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
    this.lastVisibleSessionId = sessionId;
    // Restore from local cache if no messages in memory yet
    const existingMessages = storage.getState().sessionMessages[sessionId];
    if (!existingMessages || existingMessages.messages.length === 0) {
      const cached = loadMessageCache(sessionId);
      if (cached) {
        storage.getState().restoreMessagesFromCache(sessionId, cached);
        if (cached.isTrimmed) {
          // Cache was truncated — older messages are missing.
          // Always re-run full backfill for trimmed caches because only the
          // newest messages are persisted between app launches.
          if (!this.backfilledSessions.has(sessionId)) {
            this.cursors.delete(sessionId);
            deleteLastSeq(sessionId);
          } else if (!this.cursors.has(sessionId)) {
            this.cursors.seed(sessionId, cached.lastSeq);
          }
        } else if (!this.cursors.has(sessionId)) {
          // Cache is complete — use cached lastSeq for incremental fetch only
          this.cursors.seed(sessionId, cached.lastSeq);
        }
        log.log(
          `💬 Restored ${cached.messages.length} cached messages for ${sessionId} (trimmed: ${cached.isTrimmed})`,
        );
      } else if (this.cursors.peekSeq(sessionId) > 0) {
        // lastSeq exists but no cache (e.g. first launch after feature rollout)
        // Reset to 0 to force full re-fetch, otherwise history would be missing.
        // Clear any stale backfill boundary too — the tail range it claims to
        // cover is no longer guaranteed to be in storage.
        this.cursors.delete(sessionId);
        deleteLastSeq(sessionId);
        deleteBackfillBoundary(sessionId);
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
   * Force a full re-fetch of session messages from the server.
   * Clears lastSeq and backfill state so the next sync fetches everything
   * from the beginning, recovering any messages that went missing.
   */
  forceReloadMessages = (sessionId: string): void => {
    this.cursors.delete(sessionId);
    deleteLastSeq(sessionId);
    deleteBackfillBoundary(sessionId);
    this.backfilledSessions.delete(sessionId);
    this.sessionOldestSeq.delete(sessionId);
    this.getMessagesSync(sessionId)?.invalidate();
  };

  fetchOlderMessages = async (sessionId: string): Promise<void> => {
    const oldestSeq = this.sessionOldestSeq.get(sessionId);
    if (oldestSeq === undefined || oldestSeq <= 1) {
      storage.getState().setHasServerOlderMessages(sessionId, false);
      return;
    }

    const encryption = this.encryption.getSessionEncryption(sessionId);
    if (!encryption) return;

    const response = await apiSocket.request(
      `/v3/sessions/${sessionId}/messages?before_seq=${oldestSeq}&limit=2000`,
    );
    if (!response.ok) return;

    const data = (await response.json()) as V3GetSessionMessagesResponse;
    const messages = Array.isArray(data.messages) ? data.messages : [];

    if (messages.length > 0) {
      const decryptResult = await this.decryptAndNormalizeBatch(
        encryption,
        messages,
        sessionId,
      );
      if (decryptResult.normalized.length > 0) {
        ingestStorage.getState().applyOlderMessages(sessionId, decryptResult.normalized);
      }
      const minSeq = Math.min(...messages.map((m) => m.seq));
      this.sessionOldestSeq.set(sessionId, minSeq);
    }

    storage.getState().setHasServerOlderMessages(sessionId, data.hasMore);
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
    this.messageProcessor.enqueue(sessionId, messages);
  }

  /**
   * Clean up all local state for a session that no longer exists on the server (404).
   * Delegates to cleanupSessionLocallyCore for shared per-session state, then handles
   * lastVisibleSessionId which is specific to the Sync class.
   */
  private cleanupSessionLocally(sessionId: string) {
    // Drop queued/in-flight processing + pending frame, but keep the lock — a
    // 404 cleanup can fire while we are still inside lock.inLock().
    this.messageProcessor.forget(sessionId);
    cleanupSessionLocallyCore(
      {
        deleted404Sessions: this.deleted404Sessions,
        encryption: this.encryption,
        messagesSync: this.messagesSync,
        sendSync: this.sendSync,
        pendingOutbox: this.pendingOutbox,
        getCursor: (sid) => this.cursors.get(sid),
        deleteCursor: (sid) => this.cursors.delete(sid),
      },
      sessionId,
    );
    this.backgroundPrefetchSessions.delete(sessionId);
    if (this.lastVisibleSessionId === sessionId) {
      this.lastVisibleSessionId = null;
    }
  }

  /**
   * Release per-session resources when LRU evicts session messages from storage.
   * Unlike cleanupSessionLocally (which handles 404 deletions), this is a soft
   * eviction: the session still exists on the server, so we keep sessionLastSeq
   * (for incremental fetch when the user returns) but release heavy objects
   * (InvalidateSync with closures, locks, queues) that accumulate over time.
   */
  private releaseSessionResources(sessionIds: string[]) {
    for (const sessionId of sessionIds) {
      // Stop and remove message sync (will be re-created lazily on next visit)
      const msgSync = this.messagesSync.get(sessionId);
      if (msgSync) {
        msgSync.stop();
        this.messagesSync.delete(sessionId);
      }
      pendingQueueDispatcher.disposeSession(sessionId);
      // Stop and remove send sync
      const sndSync = this.sendSync.get(sessionId);
      if (sndSync) {
        sndSync.stop();
        this.sendSync.delete(sessionId);
      }
      // Abort in-flight send requests
      this.sendAbortControllers.get(sessionId)?.abort();
      this.sendAbortControllers.delete(sessionId);
      // Release queue, lock, processing flag, and pending delta frame
      this.messageProcessor.release(sessionId);
      // Release the live dedup set but keep the cursor's seq — the session still
      // exists on the server and we need incremental fetch when the user returns.
      if (this.cursors.has(sessionId)) {
        this.cursors.get(sessionId).releaseDedup();
      }
      // Cancel any pending cache-write timer
      const cacheTimer = this.cacheWriteTimers.get(sessionId);
      if (cacheTimer) {
        clearTimeout(cacheTimer);
        this.cacheWriteTimers.delete(sessionId);
      }
      // Release backfill tracking (will re-backfill on next visit)
      this.backfilledSessions.delete(sessionId);
      this.sessionOldestSeq.delete(sessionId);
      this.backgroundPrefetchSessions.delete(sessionId);
    }
    if (sessionIds.length > 0) {
      log.log(`♻️ Released resources for ${sessionIds.length} evicted session(s)`);
    }
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

  /**
   * Send a user message.
   *
   * Returns `true` once the message has been accepted into the local
   * pipeline — either appended to the pending queue (running-check path)
   * OR added to the local message list and the outbox (normal-send path).
   * Once it returns `true`, the outbox retry layer takes responsibility for
   * actual delivery and the caller can safely drop its own copy.
   *
   * Returns `false` only when no progress was possible (session record
   * missing, no encryption key available) — these are genuine "dropped on
   * the floor" cases. Callers that own the source-of-truth copy (e.g. the
   * pending queue) should KEEP their copy when `false` is returned so the
   * user can retry.
   *
   * Existing callers that ignored the previous `Promise<void>` return value
   * continue to work; the new boolean is purely additive.
   */
  async sendMessage(
    sessionId: string,
    text: string,
    displayText?: string,
    options?: {
      continue?: boolean;
      localId?: string;
      source?: "auto-option-send";
      /**
       * Skip the "session is running → re-enqueue" guard at the top of this
       * method. The auto-dispatch effect in SessionView passes this when it
       * pops an item off the queue so a stale session.sdkSessionState read
       * does NOT push the same item right back into the queue (same localId →
       * duplicate). Unlike `continue: true`, this flag is local-only and
       * does NOT propagate to the server meta.
       */
      bypassRunningCheck?: boolean;
    },
  ): Promise<boolean> {
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
      return false;
    }

    // Get session data from storage
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session) {
      log.error(`Session ${sessionId} not found in storage`);
      return false;
    }

    // If the session is currently running, queue the message instead of sending.
    // This covers cross-client scenarios (e.g. AI started from Web, user sends from App).
    // The auto-dispatch effect in SessionView passes `bypassRunningCheck: true`
    // when draining the queue — without it, a stale running flag would push the
    // shifted item right back into the queue with the same localId, creating a
    // duplicate that the dispatch effect would then try to send again.
    if (isSessionRunning(session) && !options?.continue && !options?.bypassRunningCheck) {
      const localId = options?.localId ?? randomUUID();
      storage.getState().appendToPendingQueue(sessionId, { localId, message: text, displayText });
      return true;
    }

    // Clear needsAttention when user sends a message (user has responded)
    if (session.needsAttention) {
      storage.getState().applySessions([{ ...session, needsAttention: false }]);
    }

    // Pass current settings so resolveMessageModeMeta can fall back to the
    // user's per-agent defaults (settings.agentDefaultOverrides) when the
    // session itself has no explicit override.
    const { permissionMode, model, thinking, effort, maxBudgetUsd, taskBudget } =
      resolveMessageModeMeta(session, storage.getState().settings);

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
    return true;
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
      ingestStorage.getState().applyPurchases(customerInfo);

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

    ingestStorage.getState().applyUsers(usersMap);
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

    throwIfNotOk(response, "Failed to fetch sessions");

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
      parentSessionId: string | null;
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
              starred: preferences.starred,
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
        session.taskBudgetTokens != null ||
        session.starred;
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
          starred: session.starred,
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
    await fetchMachinesAction({
      credentials: this.credentials,
      encryption: this.encryption,
      machineDataKeys: this.machineDataKeys,
    });
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
      ingestStorage.getState().applyFeedItems(compatibleItems);
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
            settings: await this.encryption.encryptRaw(
              settingsToSyncPayload(settings),
            ),
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
    throwIfNotOk(response, "Failed to fetch settings");
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

    // Re-apply any pending settings that arrived while the sync was in-flight,
    // so the GET response doesn't overwrite locally-staged but not-yet-POSTed values.
    if (Object.keys(this.pendingSettings).length > 0) {
      storage.getState().applySettingsLocal(this.pendingSettings);
    }

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

    throwIfNotOk(response, "Failed to fetch profile");

    const data = await response.json();
    const parsedProfile = profileParse(data);

    // Apply profile to storage
    ingestStorage.getState().applyProfile(parsedProfile);
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
        ingestStorage.getState().applyNativeUpdateStatus({
          available: true,
          updateUrl: data.update_url,
        });
      } else {
        ingestStorage.getState().applyNativeUpdateStatus({
          available: false,
        });
      }
    } catch (error) {
      log.log(`[fetchNativeUpdate] Error: ${error}`);
      ingestStorage.getState().applyNativeUpdateStatus(null);
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
      ingestStorage.getState().applyPurchases(customerInfo);
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
        // Advance the cursor past every message the server echoed back.
        // advanceTo only moves forward and persists, so the max wins.
        const cursor = this.cursors.get(sessionId);
        for (const message of data.messages) {
          cursor.advanceTo(message.seq);
        }
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

  private get messageFetchCtx(): MessageFetchContext {
    return {
      encryption: this.encryption,
      getCursor: (sessionId) => this.cursors.get(sessionId),
      getMessageLock: (sessionId) => this.messageProcessor.getLock(sessionId),
      sessionOldestSeq: this.sessionOldestSeq,
      backfilledSessions: this.backfilledSessions,
      cacheWriteTimers: this.cacheWriteTimers,
      credentials: this.credentials,
      deleted404Sessions: this.deleted404Sessions,
      messagesSync: this.messagesSync,
      sendSync: this.sendSync,
      pendingOutbox: this.pendingOutbox,
      cleanupSession: this.cleanupSessionLocally.bind(this),
      applySessions: (sessions) =>
        this.applySessions(
          sessions as Parameters<typeof this.applySessions>[0],
        ),
    };
  }

  private get olderMessagePrefetchDeps(): OlderMessagePrefetchDeps {
    return {
      fetchOlderMessages: this.fetchOlderMessages,
      hasServerOlderMessages: (sessionId) =>
        storage.getState().sessionMessages[sessionId]?.hasServerOlderMessages ??
        false,
      hasSessionEncryption: (sessionId) =>
        this.encryption.getSessionEncryption(sessionId) !== null,
      getOldestSeq: (sessionId) => this.sessionOldestSeq.get(sessionId),
      activePrefetches: this.backgroundPrefetchSessions,
    };
  }

  private fetchMessages = async (sessionId: string) => {
    await fetchMessagesAction(this.messageFetchCtx, sessionId);
    // Once the initial page is in, fire-and-forget the background loop that
    // pulls the remaining history so scrolling up never blocks on the network.
    void prefetchOlderMessagesInBackground(
      this.olderMessagePrefetchDeps,
      sessionId,
    );
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
        ingestStorage.getState().applyMachines(machinesToReset);
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
      pendingQueueDispatcher.scheduleAll();
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
      fetchMachines: () => { this.fetchMachines(); },
      onSessionVisible: this.onSessionVisible.bind(this),
      getCursor: (sessionId) => this.cursors.get(sessionId),
      deleteCursor: (sessionId) => this.cursors.delete(sessionId),
      deleted404Sessions: this.deleted404Sessions,
      messagesSync: this.messagesSync as Map<string, { stop: () => void }>,
      sendSync: this.sendSync as Map<string, { stop: () => void }>,
      pendingOutbox: this.pendingOutbox as Map<string, unknown[]>,
      deleteLastSeq: deleteLastSeq,
      releaseMessageProcessing: (sessionId) =>
        this.messageProcessor.release(sessionId),
      artifactsSync: this.artifactsSync,
      friendsSync: this.friendsSync,
      friendRequestsSync: this.friendRequestsSync,
      feedSync: this.feedSync,
      projectsSync: this.projectsSync,
      sessionsSync: this.sessionsSync,
      machinesSync: this.machinesSync,
      assumeUsers: this.assumeUsers.bind(this),
    };
  }

  /**
   * The reduced IngestContext consumed by `ingestSyncUpdate` (ADR-0026).
   * Compare with the 24-field `updateHandlerCtx` above — everything the
   * ingest seam doesn't need has moved to `ingestEvents` subscribers
   * (sync invalidators, listener Sets) or to direct `storage.getState()`
   * calls inside the seam (Zustand stays the store of record).
   */
  private get ingestCtx(): IngestContext {
    return {
      encryption: this.encryption,
      cursor: {
        get: (sessionId) => this.cursors.get(sessionId),
        delete: (sessionId) => this.cursors.delete(sessionId),
      },
      sessionsSync: {
        awaitQueue: () => this.sessionsSync.awaitQueue(),
        forceRefetch: () => { this.fetchSessions(); },
      },
      machinesSync: {
        awaitQueue: () => this.machinesSync.awaitQueue(),
        forceRefetch: () => { this.fetchMachines(); },
      },
      machineDataKeys: {
        set: (machineId, key) => this.machineDataKeys.set(machineId, key),
      },
      assumeUsers: (userIds) => this.assumeUsers(userIds),
      applySessions: this.applySessions.bind(this),
      onSessionVisible: this.onSessionVisible.bind(this),
      artifactDataKeys: {
        get: (id) => this.artifactDataKeys.get(id),
        set: (id, key) => this.artifactDataKeys.set(id, key),
        delete: (id) => this.artifactDataKeys.delete(id),
      },
      enqueueMessages: this.enqueueMessages.bind(this),
      addActivityUpdate: (update) => this.activityAccumulator.addUpdate(update),
    };
  }

  /**
   * Wire SyncUpdateIngest event subscribers (ADR-0026). Called from #init
   * BEFORE subscribeToUpdates. Each `*.invalidate()` and listener Set call
   * that used to live inside a SyncUpdate handler becomes a typed subscriber
   * here — one place to audit every reaction to a server broadcast.
   */
  private registerIngestSubscribers() {
    // Stale-sync subscribers translate ingest events back into the
    // existing InvalidateSync triggers. This is the "many shallow handlers
    // collapse to one place" payoff of ADR-0026.
    ingestEvents.on("sessions-stale", () => this.sessionsSync.invalidate());
    ingestEvents.on("machines-stale", () => this.machinesSync.invalidate());
    ingestEvents.on("artifacts-stale", () => this.artifactsSync.invalidate());
    ingestEvents.on("feed-stale", () => this.feedSync.invalidate());
    ingestEvents.on("friends-stale", () => this.friendsSync.invalidate());
    ingestEvents.on("friend-requests-stale", () =>
      this.friendRequestsSync.invalidate(),
    );
    ingestEvents.on("projects-stale", () => this.projectsSync.invalidate());

    // Research config changes fan out to per-feature listener Set. The Set
    // itself is owned by Sync (Sync exposes register/unregister methods to
    // feature modules); this subscriber is the single translation point
    // from "kv update arrived" to "listener invoked per change".
    ingestEvents.on("research-config-changed", (event) => {
      for (const change of event.changes) {
        for (const listener of this.researchConfigListeners) {
          listener(change);
        }
      }
    });

    // PR 4 subscribers ----------------------------------------------------

    // Session deletion cleanup: every Sync-class internal queue / map /
    // flag that referenced this session is released here. The seam owns
    // module-level cleanups (storage, encryption, cache, worktree); this
    // subscriber owns *class-internal* state.
    ingestEvents.on("session-deleted", (event) => {
      const sessionId = event.sid;
      this.deleted404Sessions.delete(sessionId);

      const msgSync = this.messagesSync.get(sessionId);
      if (msgSync) {
        msgSync.stop();
        this.messagesSync.delete(sessionId);
      }
      const sndSync = this.sendSync.get(sessionId);
      if (sndSync) {
        sndSync.stop();
        this.sendSync.delete(sessionId);
      }
      this.pendingOutbox.delete(sessionId);
      pendingQueueDispatcher.disposeSession(sessionId);
      deleteLastSeq(sessionId);
      this.messageProcessor.release(sessionId);
    });

    // Permission request notification: voice cue always; web notification
    // only when the setting is enabled (platform check stays in the
    // subscriber, not in the seam).
    ingestEvents.on("permission-requested", (event) => {
      // voiceHooks / notifyPermissionRequest currently require `string` for
      // toolName even though the request payload's tool field is technically
      // optional. Default to "" to preserve the existing call shape; a
      // future signature update can accept undefined directly.
      const toolName = event.toolName ?? "";
      voiceHooks.onPermissionRequested(
        event.sid,
        event.requestId,
        toolName,
        event.toolArguments,
      );
      if (Platform.OS === "web" && storage.getState().settings.webNotifications) {
        const permSession = storage.getState().sessions[event.sid];
        if (permSession) {
          const sessionName = getSessionName(permSession);
          notifyPermissionRequest(
            sessionName,
            event.sid,
            event.requestId,
            toolName,
            t("webNotification.permissionRequest"),
            storage.getState().settings.webNotificationsPersistent,
          );
        }
      }
    });

    // Permission resolved: clear notified-request tracking on web.
    ingestEvents.on("permission-resolved", (event) => {
      if (Platform.OS === "web") {
        clearNotifiedRequests(event.resolvedRequestIds);
      }
    });

    // Control returned to mobile: re-fetch messages so the user sees what
    // happened while the agent was driving.
    ingestEvents.on("session-control-returned", (event) => {
      this.onSessionVisible(event.sid);
    });

    // Server settings just landed: re-layer local pending settings on top
    // (pendingSettings is Sync-class internal — the seam doesn't see it).
    ingestEvents.on("account-settings-applied", () => {
      if (Object.keys(this.pendingSettings).length > 0) {
        storage.getState().applySettingsLocal(this.pendingSettings);
      }
    });

    // PR 5 subscribers (new-message) ---------------------------------------

    // Terminal signal dispatch — the per-kind switch that used to live in
    // syncUpdateHandlers.dispatchTerminalSignal moves here. The seam owns
    // extraction (`extractTerminalSignalFromRaw`); the subscriber owns the
    // presentation choice per kind.
    ingestEvents.on("terminal-signal", (event) => {
      const { sid, signal } = event;
      switch (signal.kind) {
        case "window-title": {
          // Empty string is treated as "clear the title" — TUIs commonly
          // emit `\x1b]0;\x07` to wipe a stale label, and the subtitle
          // helper falls back to the static path when null.
          const next =
            signal.text && signal.text.length > 0 ? signal.text : null;
          storage.getState().setTerminalTitle(sid, next);
          return;
        }
        case "notification": {
          const body = signal.text?.trim();
          if (!body) return;
          const session = storage.getState().sessions[sid];
          const title = session ? getSessionName(session) : t("status.unknown");
          // trigger: null = deliver immediately. Foreground delivery shows
          // a banner; background delivery becomes a system notification.
          Notifications.scheduleNotificationAsync({
            content: { title, body, sound: false },
            trigger: null,
          }).catch((err) => {
            log.log(`[terminal-signal] notification schedule failed: ${err}`);
          });
          return;
        }
        case "bell":
          log.log(`[terminal-signal] bell from session ${sid}`);
          return;
        case "other":
          log.log(
            `[terminal-signal] OSC ${signal.oscCode ?? "?"} from session ${sid}: ${signal.text ?? ""}`,
          );
          return;
      }
    });

    // Task completion: web notification (platform + setting gated) AND
    // forward to issue-session completion handler if a link is processing.
    ingestEvents.on("task-completed", (event) => {
      const sid = event.sid;
      const session = storage.getState().sessions[sid];

      if (
        session &&
        Platform.OS === "web" &&
        storage.getState().settings.webNotifications
      ) {
        const settings = storage.getState().settings;
        const sessionName = getSessionName(session);
        notifyTaskComplete(
          sessionName,
          sid,
          t("webNotification.taskComplete"),
          settings.webNotificationsPersistent,
        );
      }

      const link = issueSessionStore.getState().findBySessionId(sid);
      log.log(
        `🔄 [IssueSession] turn-end: sid=${sid}, link=${link ? `${link.issueKey}(${link.status})` : "NONE"}`,
      );
      if (link && link.status === "processing") {
        void issueHandleCompletion(link);
      }
    });

    // Mutable tool observed → refresh per-session git status.
    ingestEvents.on("mutable-tool-observed", (event) => {
      gitStatusSync.invalidate(event.sid);
    });

    // Per-session message gap → trigger a refetch for that session's
    // messagesSync (if one exists; gap on a session we're not tracking is
    // a no-op).
    ingestEvents.on("message-gap", (event) => {
      this.getMessagesSync(event.sid)?.invalidate();
    });

    // PR 6 subscribers (SyncEphemeral fan-out) -----------------------------
    // Each ephemeral listener Set on Sync gets exactly one subscriber. The
    // Sets remain owned by Sync (feature modules register / unregister via
    // Sync's public methods); the subscribers are the single translation
    // point from "ephemeral arrived" to "iterate the Set".

    ingestEvents.on("supervisor-status-update", (e) => {
      for (const listener of this.supervisorStatusListeners) listener(e.event);
    });
    ingestEvents.on("task-log-chunk", (e) => {
      for (const listener of this.taskLogListeners) {
        listener(e.sessionId, e.taskId, e.chunk);
      }
    });
    ingestEvents.on("task-status-changed", (e) => {
      for (const listener of this.taskStatusListeners) listener(e.event);
    });
    ingestEvents.on("inbox-new-item", (e) => {
      for (const listener of this.inboxNewItemListeners) listener(e.item);
    });
    ingestEvents.on("inbox-unread-count", (e) => {
      for (const listener of this.inboxUnreadCountListeners) listener(e.count);
    });
    ingestEvents.on("session-event-created", (e) => {
      for (const listener of this.sessionEventCreatedListeners) listener(e.event);
    });
    ingestEvents.on("inter-agent-message-received", (e) => {
      for (const listener of this.interAgentMessageListeners) listener(e.message);
    });
    ingestEvents.on("supervisor-loop-status", (e) => {
      for (const listener of this.supervisorLoopStatusListeners) listener(e.event);
    });
    ingestEvents.on("auto-loop-fired", (e) => {
      for (const listener of this.autoLoopFiredListeners) listener(e.event);
    });
    ingestEvents.on("supervisor-loop-brief", (e) => {
      for (const listener of this.supervisorLoopBriefListeners) listener(e.event);
    });
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
      // PR 5: routed through ingest seam — emits 'terminal-signal',
      // 'task-completed', 'mutable-tool-observed', 'message-gap' as
      // applicable. Storage mutations (prompt suggestion, needsContinue,
      // sdkSessionState, session thinking state) are applied inside the
      // seam; subscribers handle the per-kind dispatch + web notification
      // + git status invalidation + per-session refetch.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "new-session") {
      // PR 3: routed through ingest seam — emits 'sessions-stale' which the
      // subscriber registered in `registerIngestSubscribers()` translates
      // into `sessionsSync.invalidate()`.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "delete-session") {
      // PR 4: routed through ingest seam — emits 'session-deleted' which
      // the subscriber translates into Sync-class queue cleanup (messagesSync,
      // sendSync, pendingOutbox, lastSeq, deleted404Sessions, message processor).
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "update-session") {
      // PR 4: routed through ingest seam — emits 'permission-requested'
      // (voice + web notification), 'permission-resolved' (clear notified),
      // and/or 'session-control-returned' (re-fetch messages).
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "update-account") {
      // PR 4: routed through ingest seam — emits 'account-settings-applied'
      // when settings were decrypted; subscriber re-layers pendingSettings.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "new-machine") {
      // Per ADR-0026 PR 2: new-machine is the first variant migrated to the
      // SyncUpdateIngest seam. The seam owns the encryption-key pre-step
      // (previously the reason this 62-line block had to be inlined here),
      // mirrors the decrypted key into Sync.machineDataKeys via
      // `ctx.machineDataKeys.set`, and applies the new Machine to storage.
      // The seam returns IngestEvent[]; for new-machine today the list is
      // empty (no subscribers consume a machine-onboarding event), but the
      // emit is wired so future events from this variant fan out correctly.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "update-machine") {
      // PR 4: routed through ingest seam — uses the same race-recovery
      // primitives as new-machine; no subscriber-driven side effect today.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "relationship-updated") {
      // PR 3: routed through ingest seam — emits ['friends-stale',
      // 'friend-requests-stale', 'feed-stale'] after applying the storage
      // mutation; subscribers in `registerIngestSubscribers()` call the
      // matching invalidate().
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "new-artifact") {
      // PR 4: routed through ingest seam — populates artifactDataKeys via ctx,
      // decrypts header/body, applies to storage.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "update-artifact") {
      // PR 4: routed through ingest seam — emits 'artifacts-stale' when the
      // existing artifact / data key is missing (recovery path).
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "delete-artifact") {
      // PR 4: routed through ingest seam — storage delete + artifactDataKeys
      // cleanup; no event.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "new-feed-post") {
      // PR 3: routed through ingest seam — handles the assumeUsers gating
      // for friend_request / friend_accepted items inline; no event emitted
      // today (feed-stale is reserved for the relationship-updated path,
      // which arrives separately).
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (updateData.body.t === "kv-batch-update") {
      // PR 3: routed through ingest seam — issueSessionStore changes are
      // applied inside the seam; research-config changes fan out as a
      // single 'research-config-changed' event whose subscriber iterates
      // the listener Set (see `registerIngestSubscribers()`).
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    } else if (
      updateData.body.t === "new-project" ||
      updateData.body.t === "update-project" ||
      updateData.body.t === "delete-project"
    ) {
      // PR 3: routed through ingest seam — emits 'projects-stale' which the
      // subscriber translates into `projectsSync.invalidate()`.
      const events = await ingestSyncUpdate(updateData, this.ingestCtx);
      ingestEvents.emit(events);
    }
  };

  private flushActivityUpdates = (
    updates: Map<string, ApiEphemeralActivityUpdate>,
  ) => {
    flushActivityUpdatesAction(this.applySessions.bind(this), updates);
  };

  /**
   * Ephemeral entry point (PR 6, ADR-0026). Parses the wire shape and routes
   * it through `ingestSyncEphemeral`; subscribers registered in
   * `registerIngestSubscribers` translate the returned events back into
   * listener-Set fan-out. Storage mutations (activity, machine-activity,
   * rpc-ready, usage, knowledge-count / -access-update) are applied inside
   * the seam. The legacy `EphemeralHandlerContext` and the per-listener-Set
   * wiring it carried are gone.
   */
  private handleEphemeralUpdate = (update: unknown) => {
    const validated = ApiEphemeralUpdateSchema.safeParse(update);
    if (!validated.success) {
      log.log(`Invalid ephemeral update received: ${validated.error}`);
      return;
    }
    const events = ingestSyncEphemeral(validated.data, this.ingestCtx);
    if (events.length > 0) {
      ingestEvents.emit(events);
    }
  };

  //
  // Apply store
  //

  private flushPendingCacheWrites(): void {
    flushPendingCacheWritesAction(this.messageFetchCtx);
  }

  private cancelPendingCacheWrites(): void {
    cancelPendingCacheWritesAction(this.messageFetchCtx);
  }

  private async decryptAndNormalizeBatch(
    encryption: SessionEncryption,
    rawMessages: ApiMessage[],
    sessionId?: string,
  ) {
    return decryptAndNormalizeBatchAction(encryption, rawMessages, sessionId);
  }

  private applyMessages = (
    sessionId: string,
    messages: NormalizedMessage[],
  ) => {
    applyMessagesAction(this.messageFetchCtx, sessionId, messages);
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
    for (const session of sessions) {
      pendingQueueDispatcher.schedule(session.id);
    }
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

  // --- Supervisor Loop brief (one-shot on completion, per ADR-0022) ---

  onSupervisorLoopBrief(listener: (event: {
    loopId: string;
    projectId: string;
    status: string;
    exitReason: string | null;
    generatedAt: number;
    currentIteration: number;
    maxIterations: number;
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    healthDelta: number | null;
    totalActionsFound: number;
    totalActionsFixed: number;
    consecutiveFailures: number;
    totalCostUsd: number;
    costCapUsd: number | null;
    summary: string;
  }) => void): () => void {
    this.supervisorLoopBriefListeners.add(listener);
    return () => { this.supervisorLoopBriefListeners.delete(listener); };
  }

  // --- D-1 auto-loop-fired (one-shot when the system auto-starts a loop) ---

  onAutoLoopFired(listener: (event: {
    projectId: string;
    loopId: string;
    healthScore: number;
    threshold: number;
    firedAt: number;
  }) => void): () => void {
    this.autoLoopFiredListeners.add(listener);
    return () => { this.autoLoopFiredListeners.delete(listener); };
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
    triggerType?: string;
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

  onInterAgentMessage(listener: (event: {
    fromSessionId: string;
    toSessionId: string;
    message: string;
    sentAt: number;
  }) => void): () => void {
    this.interAgentMessageListeners.add(listener);
    return () => { this.interAgentMessageListeners.delete(listener); };
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
