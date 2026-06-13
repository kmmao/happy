import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Session, Machine, GitStatus, type SessionPreferences, type SessionLatestUserRequestPreview } from "./storageTypes";
import { createReducer, reducer, ReducerState, BackgroundTaskEntry } from "./reducer/reducer";
import { Message } from "./typesMessage";
import { foldReducerResultIntoSession } from "./sessionMessageFold";
import { NormalizedMessage } from "./typesRaw";
import { isMachineOnline } from "@/utils/machineUtils";
import { applySettings, Settings } from "./settings";
import { LocalSettings, applyLocalSettings } from "./localSettings";
import { Purchases, customerInfoToPurchases } from "./purchases";
import { Profile } from "./profile";
import { UserProfile, RelationshipUpdatedEvent } from "./friendTypes";
import {
  loadSettings,
  loadLocalSettings,
  saveLocalSettings,
  saveSettings,
  loadPurchases,
  savePurchases,
  loadProfile,
  saveProfile,
  loadSessionDrafts,
  saveSessionDrafts,
  loadSessionPermissionModes,
  saveSessionPermissionModes,
  loadSessionModelModes,
  saveSessionModelModes,
  loadSessionLastViewed,
  saveSessionLastViewed,
  loadSessionSdkSettings,
  saveSessionSdkSettings,
  type SessionSdkSettings,
  loadSessionNeedsAttention,
  saveSessionNeedsAttention,
  loadSessionStarred,
  saveSessionStarred,
  loadSessionModelMappings,
  saveSessionModelMappings,
  loadSessionCustomModels,
  saveSessionCustomModels,
  loadSessionProfiles,
  saveSessionProfiles,
  loadPendingSessionPreferences,
  savePendingSessionPreferences,
  deleteSessionBookmarks,
  loadPendingQueues,
  savePendingQueues,
  loadPendingQueuePaused,
  savePendingQueuePaused,
} from "./persistence";
import type { PermissionModeKey } from "@/components/PermissionModeSelector";
import type { CustomerInfo } from "./revenueCat/types";
import React from "react";
import { sync } from "./sync";
import { isMutableTool } from "@/components/tools/knownTools";
import { projectManager } from "./projectManager";
import { DecryptedArtifact } from "./artifactTypes";
import { FeedItem } from "./feedTypes";
import { hasUnreadMessages as computeHasUnreadMessages } from "./unread";
import { resolvePinnedModelIdFromSelection } from "./pinnedModel";
import {
  areSessionPreferencesEqual,
  buildSessionPreferencesSnapshot,
  overlayPendingSessionPreferences,
} from "./sessionPreferencesState";
import { compareMessagesDesc, mergeProcessedMessages } from "./messageOrdering";
import {
  aggregateLineChanges,
  gitStatusEqualsIgnoringTimestamp,
} from "@/utils/gitStatusUtils";

// Debounce timer for realtimeMode changes
let realtimeModeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const REALTIME_MODE_DEBOUNCE_MS = 150;

/**
 * Centralized session online state resolver
 * Returns either "online" (string) or a timestamp (number) for last seen
 */
function resolveSessionOnlineState(session: {
  active: boolean;
  activeAt: number;
}): "online" | number {
  // Session is online if the active flag is true
  return session.active ? "online" : session.activeAt;
}

/**
 * Checks if a session should be shown in the active sessions group
 */
function isSessionActive(session: {
  active: boolean;
  activeAt: number;
}): boolean {
  // Use the active flag directly, no timeout checks
  return session.active;
}

function isSandboxEnabled(
  metadata: Session["metadata"] | null | undefined,
): boolean {
  const sandbox = metadata?.sandbox;
  return (
    !!sandbox &&
    typeof sandbox === "object" &&
    (sandbox as { enabled?: unknown }).enabled === true
  );
}

// Known entitlement IDs
export type KnownEntitlements = "pro";

interface SessionMessages {
  messages: Message[];
  messagesMap: Record<string, Message>;
  reducerState: ReducerState;
  isLoaded: boolean;
  isBackfilling: boolean;
  hasServerOlderMessages: boolean;
  loadingProgress: { loaded: number; total: number } | null;
}

// Machine type is now imported from storageTypes - represents persisted machine data

// Unified list item type for SessionsList component
export type SessionListViewItem =
  | { type: "header"; title: string }
  | { type: "active-sessions"; sessions: Session[] }
  | { type: "project-group"; displayPath: string; machine: Machine }
  | { type: "session"; session: Session; variant?: "default" | "no-path" };

// Legacy type for backward compatibility - to be removed
export type SessionListItem = string | Session;

/**
 * Live status of a PTY-mode Claude TUI, merged from `terminal-signal` wire
 * events. `verb`/`tokens`/`seconds` mirror the parsed spinner status line;
 * `progressState`/`progressValue` mirror ConEmu OSC 9;4 progress reports;
 * `pickerPending` flips true when a numbered picker is detected on screen
 * and back to false on the next activity update.
 */
export type TerminalLiveStatus = {
  verb?: string | null;
  tokens?: number;
  seconds?: number;
  progressState?: "remove" | "normal" | "error" | "indeterminate" | "paused";
  progressValue?: number;
  pickerPending?: boolean;
  pickerSnippet?: string;
};

interface StorageState {
  settings: Settings;
  settingsVersion: number | null;
  localSettings: LocalSettings;
  purchases: Purchases;
  profile: Profile;
  sessions: Record<string, Session>;
  sessionsData: SessionListItem[] | null; // Legacy - to be removed
  sessionListViewData: SessionListViewItem[] | null;
  sessionMessages: Record<string, SessionMessages>;
  sessionMessagesLRU: string[];
  sessionGitStatus: Record<string, GitStatus | null>;
  sessionKnowledgeCount: Record<string, number>;
  sessionKnowledgeAccessRevision: Record<string, number>;
  sessionKnowledgeChangesRevision: Record<string, number>;
  sessionPromptSuggestions: Record<string, string | null>;
  setPromptSuggestion: (sessionId: string, suggestion: string | null) => void;
  sessionNeedsContinue: Record<string, boolean>;
  setNeedsContinue: (sessionId: string, value: boolean) => void;
  /**
   * Latest TUI window-title from a `terminal-signal` wire event (OSC 0/2).
   * Used by `getSessionSubtitle` as a higher-priority subtitle than path so
   * remote users see the same title a native terminal would render. Cleared
   * on session removal and on logout.
   */
  sessionTerminalTitles: Record<string, string | null>;
  setTerminalTitle: (sessionId: string, title: string | null) => void;
  /**
   * Live TUI status from `terminal-signal` wire events of kind `activity` /
   * `progress` / `picker`: spinner verb + counters from the parsed status
   * line, ConEmu progress state, and whether a numbered picker is blocking
   * on keyboard input. Ephemeral — cleared on session removal and logout.
   */
  sessionTerminalStatus: Record<string, TerminalLiveStatus | null>;
  mergeTerminalStatus: (
    sessionId: string,
    patch: Partial<TerminalLiveStatus>,
  ) => void;
  // Pending message queue per session (persisted via mmkv, survives reloads)
  sessionPendingQueues: Record<string, Array<{ localId: string; message: string; displayText?: string }>>;
  appendToPendingQueue: (sessionId: string, item: { localId: string; message: string; displayText?: string }) => void;
  shiftPendingQueue: (sessionId: string) => { localId: string; message: string; displayText?: string } | undefined;
  removePendingQueueItem: (sessionId: string, localId: string) => void;
  reorderPendingQueueItemToFront: (sessionId: string, localId: string) => void;
  /**
   * Replace the message/displayText of a single queued item, keeping its
   * localId and position. Returns true if the item was found and updated,
   * false if it was already shifted out (race with auto-dispatch).
   */
  updatePendingQueueItem: (
    sessionId: string,
    localId: string,
    patch: { message: string; displayText?: string },
  ) => boolean;
  clearPendingQueue: (sessionId: string) => void;
  /**
   * Per-session "auto-dispatch paused" flag. When true, the SessionView
   * effect won't pop the next queued message when the AI becomes idle —
   * the user has to explicitly send via the chip ▶ or the header "Send now".
   */
  sessionPendingQueuePaused: Record<string, boolean>;
  setPendingQueuePaused: (sessionId: string, paused: boolean) => void;
  machines: Record<string, Machine>;
  artifacts: Record<string, DecryptedArtifact>; // New artifacts storage
  friends: Record<string, UserProfile>; // All relationships (friends, pending, requested, etc.)
  users: Record<string, UserProfile | null>; // Global user cache, null = 404/failed fetch
  feedItems: FeedItem[]; // Simple list of feed items
  feedHead: string | null; // Newest cursor
  feedTail: string | null; // Oldest cursor
  feedHasMore: boolean;
  feedLoaded: boolean; // True after initial feed fetch
  friendsLoaded: boolean; // True after initial friends fetch
  realtimeStatus: "disconnected" | "connecting" | "connected" | "error";
  realtimeMode: "idle" | "listening" | "thinking" | "speaking";
  socketStatus: "disconnected" | "connecting" | "connected" | "error";
  socketLastConnectedAt: number | null;
  socketLastDisconnectedAt: number | null;
  isDataReady: boolean;
  nativeUpdateStatus: { available: boolean; updateUrl?: string } | null;
  // Project list version counter (bumped on manual add/delete to trigger re-render)
  projectVersion: number;
  bumpProjectVersion: () => void;
  sessionLastViewed: Record<string, number>;
  applySessions: (
    sessions: (Omit<Session, "presence"> & { presence?: "online" | number })[],
    replace?: boolean,
  ) => void;
  applyMachines: (machines: Machine[], replace?: boolean) => void;
  applyReady: () => void;
  applyMessages: (
    sessionId: string,
    messages: NormalizedMessage[],
  ) => { changed: string[]; hasReadyEvent: boolean };
  applyMessagesLoaded: (sessionId: string) => void;
  setHasServerOlderMessages: (sessionId: string, value: boolean) => void;
  applyOlderMessages: (sessionId: string, messages: NormalizedMessage[]) => void;
  setSessionBackfilling: (sessionId: string, value: boolean) => void;
  setSessionLoadingProgress: (sessionId: string, progress: { loaded: number; total: number } | null) => void;
  restoreMessagesFromCache: (
    sessionId: string,
    cached: { messages: readonly Message[]; lastSeq: number },
  ) => void;
  applySessionUsageBaseline: (
    sessionId: string,
    baseline: {
      totalInputTokens: number;
      totalOutputTokens: number;
      lastInputTokens: number;
      lastOutputTokens: number;
      lastCacheCreation: number;
      lastCacheRead: number;
    },
  ) => void;
  applySettings: (settings: Settings, version: number) => void;
  applySettingsLocal: (settings: Partial<Settings>) => void;
  applyLocalSettings: (settings: Partial<LocalSettings>) => void;
  applyPurchases: (customerInfo: CustomerInfo) => void;
  applyProfile: (profile: Profile) => void;
  applyGitStatus: (sessionId: string, status: GitStatus | null) => void;
  applyNativeUpdateStatus: (
    status: { available: boolean; updateUrl?: string } | null,
  ) => void;
  isMutableToolCall: (sessionId: string, callId: string) => boolean;
  setRealtimeStatus: (
    status: "disconnected" | "connecting" | "connected" | "error",
  ) => void;
  setRealtimeMode: (
    mode: "idle" | "listening" | "thinking" | "speaking",
    immediate?: boolean,
  ) => void;
  clearRealtimeModeDebounce: () => void;
  setSocketStatus: (
    status: "disconnected" | "connecting" | "connected" | "error",
  ) => void;
  getActiveSessions: () => Session[];
  updateSessionDraft: (sessionId: string, draft: string | null) => void;
  markSessionViewed: (sessionId: string) => void;
  updateSessionPermissionMode: (sessionId: string, mode: string) => void;
  updateSessionStarred: (sessionId: string, starred: boolean) => void;
  updateSessionModelMode: (sessionId: string, mode: string) => void;
  /**
   * Clear per-session permission/model/effort overrides so they fall back
   * to either the user's `agentDefaultOverrides` (settings) or the code
   * defaults. permissionMode and modelMode are set to `'default'` (this
   * fork's "no override" sentinel — see messageMeta.ts), effortLevel to
   * null. thinking/budget fields are left untouched — they are managed
   * via updateSessionSdkSettings and are out of scope for agent defaults.
   */
  resetSessionAgentOverrides: (sessionId: string) => void;
  updateSessionPinnedModelId: (sessionId: string, modelId: string | null) => void;
  updateSessionCustomModels: (
    sessionId: string,
    customModels: Array<{
      id: string;
      name: string;
      description?: string | null;
    }> | null,
  ) => void;
  updateSessionModelMappings: (
    sessionId: string,
    modelMappings: Record<string, string> | null,
  ) => void;
  updateSessionProfile: (
    sessionId: string,
    profile: { profileId: string | null; profileName: string | null },
  ) => void;
  updateSessionSdkSettings: (
    sessionId: string,
    settings: SessionSdkSettings,
  ) => void;
  getPendingSessionPreferences: (sessionId: string) => SessionPreferences | null;
  clearPendingSessionPreferencesIfMatch: (
    sessionId: string,
    preferences: SessionPreferences,
  ) => boolean;
  updateSessionPreferencesVersion: (sessionId: string, version: number) => void;
  // Artifact methods
  applyArtifacts: (artifacts: DecryptedArtifact[], replace?: boolean) => void;
  addArtifact: (artifact: DecryptedArtifact) => void;
  updateArtifact: (artifact: DecryptedArtifact) => void;
  deleteArtifact: (artifactId: string) => void;
  deleteSession: (sessionId: string) => void;
  // Project management methods
  getProjects: () => import("./projectManager").Project[];
  getProject: (projectId: string) => import("./projectManager").Project | null;
  getProjectForSession: (
    sessionId: string,
  ) => import("./projectManager").Project | null;
  getProjectSessions: (projectId: string) => string[];
  // Project git status methods
  getProjectGitStatus: (
    projectId: string,
  ) => import("./storageTypes").GitStatus | null;
  getSessionProjectGitStatus: (
    sessionId: string,
  ) => import("./storageTypes").GitStatus | null;
  updateSessionProjectGitStatus: (
    sessionId: string,
    status: import("./storageTypes").GitStatus | null,
  ) => void;
  // Project submodule methods
  getSessionProjectSubmodules: (
    sessionId: string,
  ) => import("./projectManager").SubmoduleInfo[] | undefined;
  // Friend management methods
  applyFriends: (friends: UserProfile[], replace?: boolean) => void;
  applyRelationshipUpdate: (event: RelationshipUpdatedEvent) => void;
  getFriend: (userId: string) => UserProfile | undefined;
  getAcceptedFriends: () => UserProfile[];
  // User cache methods
  applyUsers: (users: Record<string, UserProfile | null>) => void;
  getUser: (userId: string) => UserProfile | null | undefined;
  assumeUsers: (userIds: string[]) => Promise<void>;
  // Feed methods
  applyFeedItems: (items: FeedItem[]) => void;
  clearFeed: () => void;
}

// Helper function to build unified list view data from sessions and machines
function buildSessionListViewData(
  sessions: Record<string, Session>,
  realtimeSessionSort: boolean = true,
): SessionListViewItem[] {
  // Separate active and inactive sessions
  const activeSessions: Session[] = [];
  const inactiveSessions: Session[] = [];

  Object.values(sessions).forEach((session) => {
    if (isSessionActive(session)) {
      activeSessions.push(session);
    } else {
      inactiveSessions.push(session);
    }
  });

  // Sort sessions (by updatedAt for real-time, createdAt for stable order)
  const sortKey = realtimeSessionSort ? "updatedAt" : "createdAt";
  activeSessions.sort((a, b) => b[sortKey] - a[sortKey]);
  inactiveSessions.sort((a, b) => b[sortKey] - a[sortKey]);

  // Build unified list view data
  const listData: SessionListViewItem[] = [];

  // Add active sessions as a single item at the top (if any)
  if (activeSessions.length > 0) {
    listData.push({ type: "active-sessions", sessions: activeSessions });
  }

  // Group inactive sessions by date
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  let currentDateGroup: Session[] = [];
  let currentDateString: string | null = null;

  for (const session of inactiveSessions) {
    const sessionDate = new Date(session[sortKey]);
    const dateString = sessionDate.toDateString();

    if (currentDateString !== dateString) {
      // Process previous group
      if (currentDateGroup.length > 0 && currentDateString) {
        const groupDate = new Date(currentDateString);
        const sessionDateOnly = new Date(
          groupDate.getFullYear(),
          groupDate.getMonth(),
          groupDate.getDate(),
        );

        let headerTitle: string;
        if (sessionDateOnly.getTime() === today.getTime()) {
          headerTitle = "Today";
        } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
          headerTitle = "Yesterday";
        } else {
          const diffTime = today.getTime() - sessionDateOnly.getTime();
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          headerTitle = `${diffDays} days ago`;
        }

        listData.push({ type: "header", title: headerTitle });
        currentDateGroup.forEach((sess) => {
          listData.push({ type: "session", session: sess });
        });
      }

      // Start new group
      currentDateString = dateString;
      currentDateGroup = [session];
    } else {
      currentDateGroup.push(session);
    }
  }

  // Process final group
  if (currentDateGroup.length > 0 && currentDateString) {
    const groupDate = new Date(currentDateString);
    const sessionDateOnly = new Date(
      groupDate.getFullYear(),
      groupDate.getMonth(),
      groupDate.getDate(),
    );

    let headerTitle: string;
    if (sessionDateOnly.getTime() === today.getTime()) {
      headerTitle = "Today";
    } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
      headerTitle = "Yesterday";
    } else {
      const diffTime = today.getTime() - sessionDateOnly.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      headerTitle = `${diffDays} days ago`;
    }

    listData.push({ type: "header", title: headerTitle });
    currentDateGroup.forEach((sess) => {
      listData.push({ type: "session", session: sess });
    });
  }

  return listData;
}

// Maximum number of sessions whose full message history is kept in memory at once.
// Older sessions are evicted when this limit is exceeded; they reload on demand.
const MAX_LOADED_SESSIONS = 5;

/**
 * Updates the LRU access order and evicts the oldest session messages when the
 * limit is exceeded. Sessions with `presence === "online"` are never evicted
 * because they receive live WebSocket updates.
 */
function applySessionMessagesLRU(
    sessionId: string,
    sessionMessages: Record<string, SessionMessages>,
    sessionMessagesLRU: string[],
    sessions: Record<string, Session>,
): { sessionMessages: Record<string, SessionMessages>; sessionMessagesLRU: string[] } {
    // Move sessionId to front of LRU (most recently used)
    const nextLRU = [sessionId, ...sessionMessagesLRU.filter((id) => id !== sessionId)];

    // Evict tail entries that exceed the cap, skipping online sessions
    let evictedMessages = sessionMessages;
    let evictedLRU = nextLRU;

    if (nextLRU.length > MAX_LOADED_SESSIONS) {
        const toKeep = new Set<string>();
        const toCheck = [...nextLRU];
        for (const id of toCheck) {
            if (toKeep.size < MAX_LOADED_SESSIONS) {
                toKeep.add(id);
            } else if (sessions[id]?.presence === "online") {
                // Always keep online sessions; remove them from LRU tracking
                // so they don't block eviction of other sessions
                toKeep.add(id);
            }
        }

        const evicted = toCheck.filter((id) => !toKeep.has(id));
        if (evicted.length > 0) {
            evictedMessages = { ...sessionMessages };
            for (const id of evicted) {
                delete evictedMessages[id];
            }
            evictedLRU = toCheck.filter((id) => toKeep.has(id));
            // Notify sync.ts to release per-session resources (InvalidateSync, locks, queues)
            // for evicted sessions. Deferred via queueMicrotask to avoid side-effects
            // inside a Zustand set() call.
            queueMicrotask(() => onSessionMessagesEvicted?.(evicted));
        }
    }

    return { sessionMessages: evictedMessages, sessionMessagesLRU: evictedLRU };
}

// Callback for syncing preferences to server (registered by sync.ts to avoid circular dependency)
let onPreferencesChanged: ((sessionId: string) => void) | null = null;
export function registerPreferencesSyncCallback(
  callback: (sessionId: string) => void,
) {
  onPreferencesChanged = callback;
}

// Callback for cleaning up per-session resources when LRU evicts session messages.
// Registered by sync.ts to avoid circular dependency.
let onSessionMessagesEvicted: ((sessionIds: string[]) => void) | null = null;
export function registerSessionEvictionCallback(
  callback: (sessionIds: string[]) => void,
) {
  onSessionMessagesEvicted = callback;
}

// Callback for app-level pending queue dispatch.
// Registered by sync.ts so queue draining does not depend on SessionView mounting.
let onPendingQueueDispatch: ((sessionId: string) => void) | null = null;
export function registerPendingQueueDispatchCallback(
  callback: (sessionId: string) => void,
) {
  onPendingQueueDispatch = callback;
}

const storageStore = create<StorageState>()((set, get) => {
  let { settings, version } = loadSettings();
  let localSettings = loadLocalSettings();
  let purchases = loadPurchases();
  let profile = loadProfile();
  let sessionDrafts = loadSessionDrafts();
  let sessionPermissionModes = loadSessionPermissionModes();
  let sessionModelModes = loadSessionModelModes();
  let sessionSdkSettings = loadSessionSdkSettings();
  let sessionNeedsAttention = loadSessionNeedsAttention();
  let sessionStarred = loadSessionStarred();
  let sessionModelMappings = loadSessionModelMappings();
  let sessionCustomModels = loadSessionCustomModels();
  let sessionProfiles = loadSessionProfiles();
  let pendingSessionPreferences = loadPendingSessionPreferences();
  let sessionLastViewed = loadSessionLastViewed();
  const savedPendingQueues = loadPendingQueues();
  const savedPendingQueuePaused = loadPendingQueuePaused();

  const stagePendingSessionPreferences = (sessionId: string) => {
    const session = get().sessions[sessionId];
    if (!session) return;
    pendingSessionPreferences = {
      ...pendingSessionPreferences,
      [sessionId]: buildSessionPreferencesSnapshot(session),
    };
    savePendingSessionPreferences(pendingSessionPreferences);
  };

  return {
    settings,
    settingsVersion: version,
    localSettings,
    purchases,
    profile,
    sessions: {},
    machines: {},
    artifacts: {}, // Initialize artifacts
    friends: {}, // Initialize relationships cache
    users: {}, // Initialize global user cache
    feedItems: [], // Initialize feed items list
    feedHead: null,
    feedTail: null,
    feedHasMore: false,
    feedLoaded: false, // Initialize as false
    friendsLoaded: false, // Initialize as false
    sessionsData: null, // Legacy - to be removed
    sessionListViewData: null,
    sessionMessages: {},
    sessionMessagesLRU: [],
    sessionGitStatus: {},
    sessionKnowledgeCount: {},
    sessionKnowledgeAccessRevision: {},
    sessionKnowledgeChangesRevision: {},
    sessionPromptSuggestions: {},
    setPromptSuggestion: (sessionId: string, suggestion: string | null) =>
      set((prev) => ({
        sessionPromptSuggestions: {
          ...prev.sessionPromptSuggestions,
          [sessionId]: suggestion,
        },
      })),
    sessionNeedsContinue: {},
    setNeedsContinue: (sessionId: string, value: boolean) =>
      set((prev) => ({
        sessionNeedsContinue: {
          ...prev.sessionNeedsContinue,
          [sessionId]: value,
        },
      })),
    sessionTerminalStatus: {},
    mergeTerminalStatus: (
      sessionId: string,
      patch: Partial<TerminalLiveStatus>,
    ) =>
      set((prev) => {
        const current = prev.sessionTerminalStatus[sessionId] ?? {};
        const next = { ...current, ...patch };
        // Shallow no-op guard — activity events are already debounced CLI-side
        // (≥1 s), but identical consecutive payloads still happen (e.g. the
        // same verb re-emitted after a picker clears).
        const keys = new Set([
          ...Object.keys(current),
          ...Object.keys(next),
        ]) as Set<keyof TerminalLiveStatus>;
        let changed = false;
        for (const k of keys) {
          if (current[k] !== next[k]) {
            changed = true;
            break;
          }
        }
        if (!changed) return prev;
        return {
          sessionTerminalStatus: {
            ...prev.sessionTerminalStatus,
            [sessionId]: next,
          },
        };
      }),
    sessionTerminalTitles: {},
    setTerminalTitle: (sessionId: string, title: string | null) =>
      set((prev) => {
        // No-op when value hasn't changed — terminal-signal events can fire
        // many times per second from animated TUIs that rewrite the title in
        // a tight loop (e.g. a build progress bar). Skipping equal writes
        // saves React from re-rendering every subtitle consumer on each
        // identical update.
        if ((prev.sessionTerminalTitles[sessionId] ?? null) === title) {
          return prev;
        }
        return {
          sessionTerminalTitles: {
            ...prev.sessionTerminalTitles,
            [sessionId]: title,
          },
        };
      }),
    sessionPendingQueues: savedPendingQueues,
    appendToPendingQueue: (sessionId, item) => {
      set((prev) => ({
        sessionPendingQueues: {
          ...prev.sessionPendingQueues,
          [sessionId]: [...(prev.sessionPendingQueues[sessionId] ?? []), item],
        },
      }));
      savePendingQueues(get().sessionPendingQueues);
      onPendingQueueDispatch?.(sessionId);
    },
    shiftPendingQueue: (sessionId) => {
      let shifted: { localId: string; message: string; displayText?: string } | undefined;
      set((prev) => {
        const queue = prev.sessionPendingQueues[sessionId];
        if (!queue || queue.length === 0) return prev;
        shifted = queue[0];
        return {
          sessionPendingQueues: {
            ...prev.sessionPendingQueues,
            [sessionId]: queue.slice(1),
          },
        };
      });
      if (shifted) {
        savePendingQueues(get().sessionPendingQueues);
        onPendingQueueDispatch?.(sessionId);
      }
      return shifted;
    },
    removePendingQueueItem: (sessionId, localId) => {
      let changed = false;
      set((prev) => {
        const queue = prev.sessionPendingQueues[sessionId];
        if (!queue) return prev;
        const filtered = queue.filter((m) => m.localId !== localId);
        if (filtered.length === queue.length) return prev;
        changed = true;
        return {
          sessionPendingQueues: {
            ...prev.sessionPendingQueues,
            [sessionId]: filtered,
          },
        };
      });
      savePendingQueues(get().sessionPendingQueues);
      if (changed) onPendingQueueDispatch?.(sessionId);
    },
    reorderPendingQueueItemToFront: (sessionId, localId) => {
      let changed = false;
      set((prev) => {
        const queue = prev.sessionPendingQueues[sessionId];
        if (!queue) return prev;
        const idx = queue.findIndex((m) => m.localId === localId);
        if (idx <= 0) return prev;
        const item = queue[idx]!;
        changed = true;
        return {
          sessionPendingQueues: {
            ...prev.sessionPendingQueues,
            [sessionId]: [item, ...queue.slice(0, idx), ...queue.slice(idx + 1)],
          },
        };
      });
      savePendingQueues(get().sessionPendingQueues);
      if (changed) onPendingQueueDispatch?.(sessionId);
    },
    updatePendingQueueItem: (sessionId, localId, patch) => {
      let found = false;
      set((prev) => {
        const queue = prev.sessionPendingQueues[sessionId];
        if (!queue) return prev;
        const idx = queue.findIndex((m) => m.localId === localId);
        if (idx === -1) return prev;
        found = true;
        const next = queue.slice();
        next[idx] = {
          localId,
          message: patch.message,
          displayText: patch.displayText,
        };
        return {
          sessionPendingQueues: {
            ...prev.sessionPendingQueues,
            [sessionId]: next,
          },
        };
      });
      if (found) {
        savePendingQueues(get().sessionPendingQueues);
      }
      return found;
    },
    clearPendingQueue: (sessionId) => {
      set((prev) => {
        const { [sessionId]: _, ...rest } = prev.sessionPendingQueues;
        return { sessionPendingQueues: rest };
      });
      savePendingQueues(get().sessionPendingQueues);
      onPendingQueueDispatch?.(sessionId);
    },
    sessionPendingQueuePaused: savedPendingQueuePaused,
    setPendingQueuePaused: (sessionId, paused) => {
      let changed = false;
      set((prev) => {
        const current = prev.sessionPendingQueuePaused[sessionId] ?? false;
        if (current === paused) return prev;
        changed = true;
        if (paused) {
          return {
            sessionPendingQueuePaused: {
              ...prev.sessionPendingQueuePaused,
              [sessionId]: true,
            },
          };
        }
        // Pruning false entries keeps the persisted blob small.
        const { [sessionId]: _, ...rest } = prev.sessionPendingQueuePaused;
        return { sessionPendingQueuePaused: rest };
      });
      savePendingQueuePaused(get().sessionPendingQueuePaused);
      if (changed && !paused) onPendingQueueDispatch?.(sessionId);
    },
    realtimeStatus: "disconnected",
    realtimeMode: "idle",
    socketStatus: "disconnected",
    socketLastConnectedAt: null,
    socketLastDisconnectedAt: null,
    isDataReady: false,
    nativeUpdateStatus: null,
    projectVersion: 0,
    bumpProjectVersion: () => set((prev) => ({ projectVersion: prev.projectVersion + 1 })),
    sessionLastViewed,
    isMutableToolCall: (sessionId: string, callId: string) => {
      const sessionMessages = get().sessionMessages[sessionId];
      if (!sessionMessages) {
        return true;
      }
      const toolCall =
        sessionMessages.reducerState.toolIdToMessageId.get(callId);
      if (!toolCall) {
        return true;
      }
      const toolCallMessage = sessionMessages.messagesMap[toolCall];
      if (!toolCallMessage || toolCallMessage.kind !== "tool-call") {
        return true;
      }
      return toolCallMessage.tool?.name
        ? isMutableTool(toolCallMessage.tool?.name)
        : true;
    },
    getActiveSessions: () => {
      const state = get();
      return Object.values(state.sessions).filter((s) => s.active);
    },
    applySessions: (
      sessions: (Omit<Session, "presence"> & {
        presence?: "online" | number;
      })[],
      replace?: boolean,
    ) =>
      set((state) => {
        // Load drafts, permission modes and needsAttention if sessions are empty (initial load)
        const isInitialLoad = Object.keys(state.sessions).length === 0;
        const savedDrafts = isInitialLoad ? sessionDrafts : {};
        const savedPermissionModes = isInitialLoad
          ? sessionPermissionModes
          : {};
        const savedModelModes = isInitialLoad ? sessionModelModes : {};
        const savedSdkSettings = isInitialLoad ? sessionSdkSettings : {};
        const savedModelMappingsAll = isInitialLoad ? sessionModelMappings : {};
        const savedCustomModelsAll = isInitialLoad ? sessionCustomModels : {};
        const savedProfilesAll = isInitialLoad ? sessionProfiles : {};
        const savedNeedsAttention = isInitialLoad ? sessionNeedsAttention : {};
        const savedStarred = isInitialLoad ? sessionStarred : {};

        // When replace=true (full server refresh), start empty so sessions
        // no longer on the server are removed. Otherwise merge with existing.
        const mergedSessions: Record<string, Session> = replace
          ? {}
          : { ...state.sessions };

        // Update sessions with calculated presence using centralized resolver
        sessions.forEach((session) => {
          // Use centralized resolver for consistent state management
          const presence = resolveSessionOnlineState(session);

          // Preserve existing draft and permission mode if they exist, or load from saved data
          const existingDraft = state.sessions[session.id]?.draft;
          const savedDraft = savedDrafts[session.id];
          const existingPermissionMode =
            state.sessions[session.id]?.permissionMode;
          const savedPermissionMode = savedPermissionModes[session.id];
          const defaultPermissionMode: PermissionModeKey = isSandboxEnabled(
            session.metadata,
          )
            ? "bypassPermissions"
            : "default";
          // Priority: 1) existing in-memory, 2) server preferences (from session), 3) saved MMKV (initial load), 4) default
          const resolvedPermissionMode: PermissionModeKey =
            (existingPermissionMode && existingPermissionMode !== "default"
              ? existingPermissionMode
              : undefined) ||
            (session.permissionMode && session.permissionMode !== "default"
              ? session.permissionMode
              : undefined) ||
            (savedPermissionMode && savedPermissionMode !== "default"
              ? savedPermissionMode
              : undefined) ||
            defaultPermissionMode;

          // Resolve modelMode: same priority as permissionMode
          const existingModelMode = state.sessions[session.id]?.modelMode;
          const savedModelMode = savedModelModes[session.id];
          // Priority: 1) existing in-memory, 2) server preferences (from session), 3) saved MMKV (initial load), 4) default
          const resolvedModelMode: string =
            (existingModelMode && existingModelMode !== "default"
              ? existingModelMode
              : undefined) ||
            (session.modelMode && session.modelMode !== "default"
              ? session.modelMode
              : undefined) ||
            (savedModelMode && savedModelMode !== "default"
              ? savedModelMode
              : undefined) ||
            "default";

          // Resolve SDK settings: prefer existing, then server preferences, then saved MMKV
          const existingSdk = state.sessions[session.id];
          const savedSdk = savedSdkSettings[session.id];
          const resolvedThinkingMode =
            existingSdk?.thinkingMode ??
            session.thinkingMode ??
            savedSdk?.thinkingMode ??
            null;
          const resolvedThinkingBudget =
            existingSdk?.thinkingBudget ??
            session.thinkingBudget ??
            savedSdk?.thinkingBudget ??
            null;
          const resolvedEffortLevel =
            existingSdk?.effortLevel ??
            session.effortLevel ??
            savedSdk?.effortLevel ??
            null;
          const resolvedMaxBudgetUsd =
            existingSdk?.maxBudgetUsd ??
            session.maxBudgetUsd ??
            savedSdk?.maxBudgetUsd ??
            null;
          const resolvedTaskBudgetTokens =
            existingSdk?.taskBudgetTokens ??
            session.taskBudgetTokens ??
            savedSdk?.taskBudgetTokens ??
            null;

          // Resolve needsAttention: prefer explicit value from update, then existing, then saved
          const existingNeedsAttention =
            state.sessions[session.id]?.needsAttention;
          const resolvedNeedsAttention =
            session.needsAttention ??
            existingNeedsAttention ??
            savedNeedsAttention[session.id] ??
            false;

          // Resolve starred: prefer in-memory (live toggle) > server value (cross-device) > MMKV cache (local fallback)
          const existingStarred = state.sessions[session.id]?.starred;
          const resolvedStarred =
            existingStarred ??
            session.starred ??
            savedStarred[session.id] ??
            false;

          // Preserve metadata.summary when new metadata doesn't have one
          // (e.g. after session reconnect, CLI sends fresh metadata without summary)
          const existingSummary = state.sessions[session.id]?.metadata?.summary;
          const resolvedMetadata =
            session.metadata && !session.metadata.summary && existingSummary
              ? { ...session.metadata, summary: existingSummary }
              : session.metadata;

          // Resolve modelMappings: prefer existing in-memory, then server preferences, then saved MMKV
          const resolvedModelMappings =
            state.sessions[session.id]?.modelMappings ??
            session.modelMappings ??
            savedModelMappingsAll[session.id] ??
            null;

          // Resolve customModels: prefer existing in-memory, then server preferences, then saved MMKV
          const resolvedCustomModels =
            state.sessions[session.id]?.customModels ??
            session.customModels ??
            savedCustomModelsAll[session.id] ??
            null;

          const resolvedPinnedModelId =
            state.sessions[session.id]?.pinnedModelId ??
            session.pinnedModelId ??
            null;

          // Resolve profile info: prefer existing in-memory, then server preferences, then saved MMKV
          const resolvedProfileId =
            state.sessions[session.id]?.profileId ??
            session.profileId ??
            savedProfilesAll[session.id]?.profileId ??
            null;
          const resolvedProfileName =
            state.sessions[session.id]?.profileName ??
            session.profileName ??
            savedProfilesAll[session.id]?.profileName ??
            null;

          // Preserve ephemeral thinking state ONLY when the incoming data
          // comes from fetchSessions (which always sends thinking:false,
          // thinkingAt:0 because the server doesn't persist it).
          // For all other callers (activity updates, lifecycle events),
          // use the incoming value so thinking state can actually change.
          const isFetchSessionsData = session.thinkingAt === 0;
          const preservedThinking = isFetchSessionsData
            ? (state.sessions[session.id]?.thinking ?? session.thinking)
            : session.thinking;
          const preservedThinkingAt = isFetchSessionsData
            ? (state.sessions[session.id]?.thinkingAt ?? session.thinkingAt)
            : session.thinkingAt;

          const preservedResolvedModelId =
            state.sessions[session.id]?.resolvedModelId ?? session.resolvedModelId;

          const mergedSession = {
            ...session,
            thinking: preservedThinking,
            thinkingAt: preservedThinkingAt,
            metadata: resolvedMetadata,
            presence,
            draft: existingDraft || savedDraft || session.draft || null,
            permissionMode: resolvedPermissionMode,
            modelMode: resolvedModelMode,
            pinnedModelId: resolvedPinnedModelId,
            modelMappings: resolvedModelMappings,
            customModels: resolvedCustomModels,
            profileId: resolvedProfileId,
            profileName: resolvedProfileName,
            thinkingMode: resolvedThinkingMode,
            thinkingBudget: resolvedThinkingBudget,
            effortLevel: resolvedEffortLevel,
            maxBudgetUsd: resolvedMaxBudgetUsd,
            taskBudgetTokens: resolvedTaskBudgetTokens,
            needsAttention: resolvedNeedsAttention,
            starred: resolvedStarred || null,
            latestUserRequestPreview:
              session.latestUserRequestPreview ??
              state.sessions[session.id]?.latestUserRequestPreview ??
              null,
            // Preserve client-only latestUsage — server doesn't return it
            latestUsage: state.sessions[session.id]?.latestUsage,
            ...(preservedResolvedModelId && {
              resolvedModelId: preservedResolvedModelId,
            }),
          };

          mergedSessions[session.id] = overlayPendingSessionPreferences(
            mergedSession,
            pendingSessionPreferences[session.id],
          );
        });

        // Build active set from all sessions (including existing ones)
        const activeSet = new Set<string>();
        Object.values(mergedSessions).forEach((session) => {
          if (isSessionActive(session)) {
            activeSet.add(session.id);
          }
        });

        // Separate active and inactive sessions
        const activeSessions: Session[] = [];
        const inactiveSessions: Session[] = [];

        // Process all sessions from merged set
        Object.values(mergedSessions).forEach((session) => {
          if (activeSet.has(session.id)) {
            activeSessions.push(session);
          } else {
            inactiveSessions.push(session);
          }
        });

        // Sort both arrays by creation date for stable ordering
        activeSessions.sort((a, b) => b.createdAt - a.createdAt);
        inactiveSessions.sort((a, b) => b.createdAt - a.createdAt);

        // Build flat list data for FlashList
        const listData: SessionListItem[] = [];

        if (activeSessions.length > 0) {
          listData.push("online");
          listData.push(...activeSessions);
        }

        // Legacy sessionsData - to be removed
        // Machines are now integrated into sessionListViewData

        if (inactiveSessions.length > 0) {
          listData.push("offline");
          listData.push(...inactiveSessions);
        }


        // Process AgentState updates for sessions that already have messages loaded
        const updatedSessionMessages = { ...state.sessionMessages };

        sessions.forEach((session) => {
          const oldSession = state.sessions[session.id];
          const newSession = mergedSessions[session.id];

          // Check if sessionMessages exists AND agentStateVersion is newer
          const existingSessionMessages = updatedSessionMessages[session.id];
          if (
            existingSessionMessages &&
            newSession.agentState &&
            (!oldSession ||
              newSession.agentStateVersion >
                (oldSession.agentStateVersion || 0))
          ) {
            // Process new AgentState through reducer
            const reducerResult = reducer(
              existingSessionMessages.reducerState,
              [],
              newSession.agentState,
            );
            const processedMessages = reducerResult.messages;

            // Always update the session messages, even if no new messages were
            // created — this keeps the reducer state in sync with the new
            // AgentState. Same incremental-ordering strategy as applyMessages.
            const { messages: messagesArray, messagesMap } =
              mergeProcessedMessages(
                {
                  messages: existingSessionMessages.messages,
                  messagesMap: existingSessionMessages.messagesMap,
                },
                processedMessages,
                reducerResult.reordered === true,
              );

            updatedSessionMessages[session.id] = {
              messages: messagesArray,
              messagesMap,
              reducerState: existingSessionMessages.reducerState,
              isLoaded: existingSessionMessages.isLoaded,
              isBackfilling: existingSessionMessages.isBackfilling,
              hasServerOlderMessages: existingSessionMessages.hasServerOlderMessages,
              loadingProgress: existingSessionMessages.loadingProgress,
            };

            // IMPORTANT: Copy latestUsage from reducerState to Session for immediate availability
            if (existingSessionMessages.reducerState.latestUsage) {
              mergedSessions[session.id] = {
                ...mergedSessions[session.id],
                latestUsage: {
                  ...existingSessionMessages.reducerState.latestUsage,
                },
              };
            }
          }

          // Background task visibility is handled in the UI layer:
          // useBackgroundTasks(entries, isConnected=false) returns empty for offline sessions.
          // No need to mutate reducer state on offline transitions — tasks will naturally
          // hide when offline and reappear when back online.
        });

        // Persist needsAttention changes
        const allNeedsAttention: Record<string, boolean> = {};
        Object.entries(mergedSessions).forEach(([id, sess]) => {
          if (sess.needsAttention) {
            allNeedsAttention[id] = true;
          }
        });
        saveSessionNeedsAttention(allNeedsAttention);

        // Persist starred changes — write back server-resolved values so MMKV stays in sync across devices
        const allStarred: Record<string, boolean> = {};
        Object.entries(mergedSessions).forEach(([id, sess]) => {
          if (sess.starred) {
            allStarred[id] = true;
          }
        });
        sessionStarred = allStarred;
        saveSessionStarred(allStarred);

        // Build new unified list view data
        const sessionListViewData = buildSessionListViewData(
          mergedSessions,
          state.settings.realtimeSessionSort ?? true,
        );

        // Update project manager with current sessions and machines
        const machineMetadataMap = new Map<string, any>();
        Object.values(state.machines).forEach((machine) => {
          if (machine.metadata) {
            machineMetadataMap.set(machine.id, machine.metadata);
          }
        });
        projectManager.updateSessions(
          Object.values(mergedSessions),
          machineMetadataMap,
        );

        return {
          ...state,
          sessions: mergedSessions,
          sessionsData: listData, // Legacy - to be removed
          sessionListViewData,
          sessionMessages: updatedSessionMessages,
        };
      }),
    applyReady: () =>
      set((state) => ({
        ...state,
        isDataReady: true,
      })),
    applyMessages: (sessionId: string, messages: NormalizedMessage[]) => {
      const _perfT0 = __DEV__ && typeof performance !== "undefined" ? performance.now() : 0;
      let _perfReducerMs = 0;
      let _perfMergeMs = 0;
      let changed = new Set<string>();
      let hasReadyEvent = false;
      let pinnedModelIdChanged = false;
      set((state) => {
        // Resolve session messages state
        const existingSession = state.sessionMessages[sessionId] || {
          messages: [],
          messagesMap: {},
          reducerState: createReducer(),
          isLoaded: false,
          isBackfilling: false,
          hasServerOlderMessages: false,
        };

        // Get the session's agentState if available
        const session = state.sessions[sessionId];
        const agentState = session?.agentState;

        // Messages are already normalized, no need to process them again
        const normalizedMessages = messages;

        // Run reducer with agentState
        const _perfReducerT0 = _perfT0 > 0 ? performance.now() : 0;
        const reducerResult = reducer(
          existingSession.reducerState,
          normalizedMessages,
          agentState,
        );
        if (_perfReducerT0 > 0) _perfReducerMs = performance.now() - _perfReducerT0;
        const processedMessages = reducerResult.messages;
        for (let message of processedMessages) {
          changed.add(message.id);
        }
        if (reducerResult.hasReadyEvent) {
          hasReadyEvent = true;
        }

        const _perfMergeT0 = _perfT0 > 0 ? performance.now() : 0;
        // Incremental ordering: avoid an O(n log n) full re-sort on every
        // streaming update. existingSession.messages is already newest-first.
        const { messages: messagesArray, messagesMap: mergedMessagesMap } =
          mergeProcessedMessages(
            {
              messages: existingSession.messages,
              messagesMap: existingSession.messagesMap,
            },
            processedMessages,
            reducerResult.reordered === true,
          );

        // Fold the reducer's side-products (todos, latestUsage, resolvedModelId,
        // pinnedModelId, preview) back onto the Session. The fold returns the same
        // session reference when nothing changed, so we can skip the list rebuild.
        const folded = foldReducerResultIntoSession({
          session,
          reducerState: existingSession.reducerState,
          messages: messagesArray,
          todos: reducerResult.todos,
        });
        pinnedModelIdChanged = folded.pinnedModelIdChanged;
        const updatedSessions =
          session && folded.session !== session
            ? { ...state.sessions, [sessionId]: folded.session! }
            : state.sessions;

        const nextSessionListViewData =
          updatedSessions !== state.sessions
            ? buildSessionListViewData(
                updatedSessions,
                state.settings.realtimeSessionSort ?? true,
              )
            : state.sessionListViewData;

        const updatedSessionMessagesRaw = {
          ...state.sessionMessages,
          [sessionId]: {
            ...existingSession,
            messages: messagesArray,
            messagesMap: mergedMessagesMap,
            reducerState: existingSession.reducerState,
            isLoaded: true,
          },
        };
        const { sessionMessages: evictedSessionMessages, sessionMessagesLRU } =
          applySessionMessagesLRU(
            sessionId,
            updatedSessionMessagesRaw,
            state.sessionMessagesLRU,
            updatedSessions,
          );

        if (_perfMergeT0 > 0) _perfMergeMs = performance.now() - _perfMergeT0;

        return {
          ...state,
          sessions: updatedSessions,
          sessionListViewData: nextSessionListViewData,
          sessionMessages: evictedSessionMessages,
          sessionMessagesLRU,
        };
      });

      // [stream-perf] applyMessages timing
      if (_perfT0 > 0 && changed.size > 0) {
        const _perfTotalMs = performance.now() - _perfT0;
        if (_perfTotalMs > 1) {
          console.log(`[stream-perf] applyMessages: ${_perfTotalMs.toFixed(1)}ms (reducer=${_perfReducerMs.toFixed(1)}, merge=${_perfMergeMs.toFixed(1)}), changed=${changed.size}, msgs=${messages.length}`);
        }
      }

      if (pinnedModelIdChanged) {
        stagePendingSessionPreferences(sessionId);
        onPreferencesChanged?.(sessionId);
      }

      return { changed: Array.from(changed), hasReadyEvent };
    },
    applyMessagesLoaded: (sessionId: string) => {
      let pinnedModelIdChanged = false;
      set((state) => {
        const existingSession = state.sessionMessages[sessionId];
        let result: StorageState;
        if (!existingSession) {
          // First time loading - check for AgentState
          const session = state.sessions[sessionId];
          const agentState = session?.agentState;

          // Create new reducer state
          const reducerState = createReducer();

          // Process AgentState if it exists
          let messages: Message[] = [];
          let messagesMap: Record<string, Message> = {};

          if (agentState) {
            // Process AgentState through reducer to get initial permission messages
            const reducerResult = reducer(reducerState, [], agentState);
            const processedMessages = reducerResult.messages;

            processedMessages.forEach((message) => {
              messagesMap[message.id] = message;
            });

            messages = Object.values(messagesMap).sort(compareMessagesDesc);
          }

          // Fold reducer side-products onto the session (same rule as applyMessages).
          // On first load the freshly-reduced agentState carries no user-text, so the
          // preview is a no-op; todos are intentionally not folded here (pass undefined).
          const folded = foldReducerResultIntoSession({
            session,
            reducerState,
            messages,
            todos: undefined,
          });
          pinnedModelIdChanged = folded.pinnedModelIdChanged;
          const updatedSessions =
            session && folded.session !== session
              ? { ...state.sessions, [sessionId]: folded.session! }
              : state.sessions;

          result = {
            ...state,
            sessions: updatedSessions,
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: {
                reducerState,
                messages,
                messagesMap,
                isLoaded: true,
                isBackfilling: false,
                hasServerOlderMessages: false,
                loadingProgress: null,
              } satisfies SessionMessages,
            },
          };
        } else {
          result = {
            ...state,
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: {
                ...existingSession,
                isLoaded: true,
                loadingProgress: null,
              } satisfies SessionMessages,
            },
          };
        }

        const { sessionMessages: evictedSessionMessages, sessionMessagesLRU } =
          applySessionMessagesLRU(
            sessionId,
            result.sessionMessages,
            state.sessionMessagesLRU,
            result.sessions,
          );
        return { ...result, sessionMessages: evictedSessionMessages, sessionMessagesLRU };
      });

      if (pinnedModelIdChanged) {
        stagePendingSessionPreferences(sessionId);
        onPreferencesChanged?.(sessionId);
      }
    },
    setHasServerOlderMessages: (sessionId: string, value: boolean) =>
      set((state) => {
        const existing = state.sessionMessages[sessionId];
        if (!existing) return state;
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: { ...existing, hasServerOlderMessages: value },
          },
        };
      }),
    applyOlderMessages: (sessionId: string, messages: NormalizedMessage[]) =>
      set((state) => {
        const existing = state.sessionMessages[sessionId];
        if (!existing || messages.length === 0) return state;

        // Process through a fresh reducer to get properly typed Message[]
        const freshReducerState = createReducer();
        const reducerResult = reducer(freshReducerState, messages, undefined);

        const messagesMap = { ...existing.messagesMap };
        const newMessages: Message[] = [];
        for (const msg of reducerResult.messages) {
          if (!messagesMap[msg.id]) {
            messagesMap[msg.id] = msg;
            newMessages.push(msg);
          }
        }
        if (newMessages.length === 0) return state;

        // Sort descending (newest first) after merging
        const allMessages = [...existing.messages, ...newMessages].sort(compareMessagesDesc);
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: { ...existing, messages: allMessages, messagesMap },
          },
        };
      }),
    setSessionBackfilling: (sessionId: string, value: boolean) =>
      set((state) => {
        const existing = state.sessionMessages[sessionId];
        if (!existing) return state;
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: { ...existing, isBackfilling: value },
          },
        };
      }),
    setSessionLoadingProgress: (sessionId: string, progress: { loaded: number; total: number } | null) =>
      set((state) => {
        const existing = state.sessionMessages[sessionId];
        if (!existing) return state;
        return {
          ...state,
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: { ...existing, loadingProgress: progress },
          },
        };
      }),
    restoreMessagesFromCache: (
      sessionId: string,
      cached: { messages: readonly Message[]; lastSeq: number; latestUserRequestPreview?: SessionLatestUserRequestPreview | null },
    ) =>
      set((state) => {
        // Don't overwrite if we already have messages (fresher than cache)
        const existing = state.sessionMessages[sessionId];
        if (existing && existing.messages.length > 0) {
          return state;
        }

        // Build messagesMap from cached messages
        const messagesMap: Record<string, Message> = {};
        for (const msg of cached.messages) {
          messagesMap[msg.id] = msg;
        }

        // Create fresh reducer with pre-populated dedup maps
        // This ensures subsequent incremental messages are properly deduplicated.
        // messageIds keys must be server DB IDs (originalId → internalId), matching
        // how the reducer populates them during live processing. Using the internal
        // id (msg.id) as key was wrong — fetched messages arrive with server DB IDs
        // and the dedup check would silently fail, causing duplicates like
        // "Context was reset" appearing twice after a cache restore + backfill.
        const reducerState = createReducer();
        for (const msg of cached.messages) {
          // Prefer server DB ID as key so the reducer can dedup fetched messages.
          // UserTextMessage exposes realId; all other message kinds expose realID.
          const serverDbId =
            msg.kind === "user-text" ? msg.realId :
            "realID" in msg ? (msg.realID ?? null) :
            null;
          if (serverDbId) {
            reducerState.messageIds.set(serverDbId, msg.id);
          }
          if (msg.kind === "tool-call" && msg.tool) {
            reducerState.toolIdToMessageId.set(
              msg.tool.permission?.id ?? msg.id,
              msg.id,
            );
          }
          // Rebuild localIds map for user messages (prevents duplicate display)
          if ("localId" in msg && msg.localId) {
            reducerState.localIds.set(msg.localId, msg.id);
          }
        }

        // Fold the cached preview onto the session. The cache-rebuilt reducerState
        // carries no latestUsage/resolvedModelId, so only the preview participates.
        const session = state.sessions[sessionId];
        const folded = foldReducerResultIntoSession({
          session,
          reducerState,
          messages: cached.messages,
          todos: undefined,
        });
        const updatedSessions =
          session && folded.session !== session
            ? { ...state.sessions, [sessionId]: folded.session! }
            : state.sessions;

        const updatedSessionMessagesRaw = {
          ...state.sessionMessages,
          [sessionId]: {
            messages: cached.messages as Message[],
            messagesMap,
            reducerState,
            isLoaded: true,
            isBackfilling: false,
            hasServerOlderMessages: false,
            loadingProgress: null,
          } satisfies SessionMessages,
        };
        const { sessionMessages: evictedSessionMessages, sessionMessagesLRU } =
          applySessionMessagesLRU(
            sessionId,
            updatedSessionMessagesRaw,
            state.sessionMessagesLRU,
            updatedSessions,
          );

        return {
          ...state,
          sessions: updatedSessions,
          sessionListViewData:
            updatedSessions !== state.sessions
              ? buildSessionListViewData(
                  updatedSessions,
                  state.settings.realtimeSessionSort ?? true,
                )
              : state.sessionListViewData,
          sessionMessages: evictedSessionMessages,
          sessionMessagesLRU,
        };
      }),
    applySessionUsageBaseline: (
      sessionId: string,
      baseline: {
        totalInputTokens: number;
        totalOutputTokens: number;
        lastInputTokens: number;
        lastOutputTokens: number;
        lastCacheCreation: number;
        lastCacheRead: number;
      },
    ) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const currentUsage = session.latestUsage;
        const updatedUsage = currentUsage
          ? {
              ...currentUsage,
              totalInputTokens: baseline.totalInputTokens,
              totalOutputTokens: baseline.totalOutputTokens,
            }
          : {
              inputTokens: baseline.lastInputTokens,
              outputTokens: baseline.lastOutputTokens,
              cacheCreation: baseline.lastCacheCreation,
              cacheRead: baseline.lastCacheRead,
              contextSize:
                baseline.lastInputTokens +
                baseline.lastCacheCreation +
                baseline.lastCacheRead,
              totalInputTokens: baseline.totalInputTokens,
              totalOutputTokens: baseline.totalOutputTokens,
              timestamp: Date.now(),
            };

        const sessionMessages = state.sessionMessages[sessionId];
        const updatedSessionMessages = sessionMessages?.reducerState
          ? {
              ...state.sessionMessages,
              [sessionId]: {
                ...sessionMessages,
                reducerState: {
                  ...sessionMessages.reducerState,
                  latestUsage: { ...updatedUsage },
                },
              },
            }
          : state.sessionMessages;

        return {
          ...state,
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              latestUsage: updatedUsage,
            },
          },
          sessionMessages: updatedSessionMessages,
        };
      }),
    applySettingsLocal: (settings: Partial<Settings>) =>
      set((state) => {
        const newSettings = applySettings(state.settings, settings);
        saveSettings(newSettings, state.settingsVersion ?? 0);
        const sortChanged =
          newSettings.realtimeSessionSort !==
          state.settings.realtimeSessionSort;
        return {
          ...state,
          settings: newSettings,
          ...(sortChanged && {
            sessionListViewData: buildSessionListViewData(
              state.sessions,
              newSettings.realtimeSessionSort ?? true,
            ),
          }),
        };
      }),
    applySettings: (settings: Settings, version: number) =>
      set((state) => {
        if (state.settingsVersion === null || state.settingsVersion < version) {
          saveSettings(settings, version);
          const sortChanged =
            settings.realtimeSessionSort !== state.settings.realtimeSessionSort;
          return {
            ...state,
            settings,
            settingsVersion: version,
            ...(sortChanged && {
              sessionListViewData: buildSessionListViewData(
                state.sessions,
                settings.realtimeSessionSort ?? true,
              ),
            }),
          };
        } else {
          return state;
        }
      }),
    applyLocalSettings: (delta: Partial<LocalSettings>) =>
      set((state) => {
        const updatedLocalSettings = applyLocalSettings(
          state.localSettings,
          delta,
        );
        queueMicrotask(() => saveLocalSettings(updatedLocalSettings));
        return {
          ...state,
          localSettings: updatedLocalSettings,
        };
      }),
    applyPurchases: (customerInfo: CustomerInfo) =>
      set((state) => {
        // Transform CustomerInfo to our Purchases format
        const purchases = customerInfoToPurchases(customerInfo);

        // Always save and update - no need for version checks
        savePurchases(purchases);
        return {
          ...state,
          purchases,
        };
      }),
    applyProfile: (profile: Profile) =>
      set((state) => {
        // Always save and update profile
        saveProfile(profile);
        return {
          ...state,
          profile,
        };
      }),
    applyGitStatus: (sessionId: string, status: GitStatus | null) => {
      // The git fetcher rebuilds GitStatus from scratch every refresh (each
      // mutable tool call triggers one), and stamps a fresh `lastUpdatedAt`.
      // Without dedup, every downstream useShallow selector that captures the
      // GitStatus object sees a new reference per tick and re-renders the
      // entire side panel tab bar. Reuse the previous reference when the
      // content is identical so the chain short-circuits.
      const previous = get().sessionGitStatus[sessionId] ?? null;
      const effective = gitStatusEqualsIgnoringTimestamp(previous, status)
        ? previous
        : status;

      // Always sync the project mirror, but with the deduped reference so it
      // stays in lockstep with sessionGitStatus.
      projectManager.updateSessionProjectGitStatus(sessionId, effective);

      if (effective === previous) {
        // Identical content → skip the set() entirely so zustand does not
        // notify subscribers at all.
        return;
      }

      set((state) => ({
        ...state,
        sessionGitStatus: {
          ...state.sessionGitStatus,
          [sessionId]: effective,
        },
      }));
    },
    applyNativeUpdateStatus: (
      status: { available: boolean; updateUrl?: string } | null,
    ) =>
      set((state) => ({
        ...state,
        nativeUpdateStatus: status,
      })),
    setRealtimeStatus: (
      status: "disconnected" | "connecting" | "connected" | "error",
    ) =>
      set((state) => ({
        ...state,
        realtimeStatus: status,
      })),
    setRealtimeMode: (
      mode: "idle" | "listening" | "thinking" | "speaking",
      immediate?: boolean,
    ) => {
      if (immediate) {
        // Clear any pending debounce and set immediately
        if (realtimeModeDebounceTimer) {
          clearTimeout(realtimeModeDebounceTimer);
          realtimeModeDebounceTimer = null;
        }
        set((state) => ({ ...state, realtimeMode: mode }));
      } else {
        // Debounce mode changes to avoid flickering
        if (realtimeModeDebounceTimer) {
          clearTimeout(realtimeModeDebounceTimer);
        }
        realtimeModeDebounceTimer = setTimeout(() => {
          realtimeModeDebounceTimer = null;
          set((state) => ({ ...state, realtimeMode: mode }));
        }, REALTIME_MODE_DEBOUNCE_MS);
      }
    },
    clearRealtimeModeDebounce: () => {
      if (realtimeModeDebounceTimer) {
        clearTimeout(realtimeModeDebounceTimer);
        realtimeModeDebounceTimer = null;
      }
    },
    setSocketStatus: (
      status: "disconnected" | "connecting" | "connected" | "error",
    ) =>
      set((state) => {
        const now = Date.now();
        const updates: Partial<StorageState> = {
          socketStatus: status,
        };

        // Update timestamp based on status
        if (status === "connected") {
          updates.socketLastConnectedAt = now;
        } else if (status === "disconnected" || status === "error") {
          updates.socketLastDisconnectedAt = now;
        }

        return {
          ...state,
          ...updates,
        };
      }),
    updateSessionDraft: (sessionId: string, draft: string | null) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        // Don't store empty strings, convert to null
        const normalizedDraft = draft?.trim() ? draft : null;

        // Collect all drafts for persistence
        const allDrafts: Record<string, string> = {};
        Object.entries(state.sessions).forEach(([id, sess]) => {
          if (id === sessionId) {
            if (normalizedDraft) {
              allDrafts[id] = normalizedDraft;
            }
          } else if (sess.draft) {
            allDrafts[id] = sess.draft;
          }
        });

        // Persist drafts
        saveSessionDrafts(allDrafts);

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            draft: normalizedDraft,
          },
        };

        // Rebuild sessionListViewData to update the UI immediately
        const sessionListViewData = buildSessionListViewData(
          updatedSessions,
          state.settings.realtimeSessionSort ?? true,
        );

        return {
          ...state,
          sessions: updatedSessions,
          sessionListViewData,
        };
      }),
    markSessionViewed: (sessionId: string) => {
      const now = Date.now();
      sessionLastViewed[sessionId] = now;
      saveSessionLastViewed(sessionLastViewed);
      set((state) => ({
        ...state,
        sessionLastViewed: { ...sessionLastViewed },
      }));
    },
    updateSessionStarred: (sessionId: string, starred: boolean) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            starred: starred || null,
          },
        };

        // Persist only truthy values to save space
        const allStarred: Record<string, boolean> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.starred) allStarred[id] = true;
        });
        sessionStarred = allStarred;
        saveSessionStarred(allStarred);

        // Starred affects list visibility — rebuild the view data
        const realtimeSessionSort = state.settings?.realtimeSessionSort ?? true;
        return {
          ...state,
          sessions: updatedSessions,
          sessionListViewData: buildSessionListViewData(updatedSessions, realtimeSessionSort),
        };
      });
      // Sync starred state to server so other devices see the change in real time
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionPermissionMode: (sessionId: string, mode: string) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        // Update the session with the new permission mode
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            permissionMode: mode,
          },
        };

        // Collect all permission modes for persistence
        const allModes: Record<string, PermissionModeKey> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.permissionMode && sess.permissionMode !== "default") {
            allModes[id] = sess.permissionMode;
          }
        });

        // Persist permission modes (only non-default values to save space)
        saveSessionPermissionModes(allModes);

        // No need to rebuild sessionListViewData since permission mode doesn't affect the list display
        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionModelMode: (sessionId: string, mode: string) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        const nextPinnedModelId = resolvePinnedModelIdFromSelection(
          mode,
          session.modelMappings,
        );

        // Update the session with the new model mode
        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            modelMode: mode,
            pinnedModelId: nextPinnedModelId,
          },
        };

        // Persist model modes (only non-default values to save space)
        const allModelModes: Record<string, string> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.modelMode && sess.modelMode !== "default") {
            allModelModes[id] = sess.modelMode;
          }
        });
        saveSessionModelModes(allModelModes);

        // No need to rebuild sessionListViewData since model mode doesn't affect the list display
        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    resetSessionAgentOverrides: (sessionId: string) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            permissionMode: "default",
            modelMode: "default",
            effortLevel: null,
            pinnedModelId: null,
          },
        };

        // Re-persist permission / model / effort maps with this session's
        // override dropped. Iterates all sessions so the non-default
        // condition stays the source of truth.
        const permissionModes: Record<string, PermissionModeKey> = {};
        const modelModes: Record<string, string> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.permissionMode && sess.permissionMode !== "default") {
            permissionModes[id] = sess.permissionMode;
          }
          if (sess.modelMode && sess.modelMode !== "default") {
            modelModes[id] = sess.modelMode;
          }
        });
        saveSessionPermissionModes(permissionModes);
        saveSessionModelModes(modelModes);

        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionPinnedModelId: (sessionId: string, modelId: string | null) => {
      let changed = false;
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session || (session.pinnedModelId ?? null) === modelId) {
          return state;
        }
        changed = true;

        return {
          ...state,
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              pinnedModelId: modelId,
            },
          },
        };
      });
      if (changed) {
        stagePendingSessionPreferences(sessionId);
        onPreferencesChanged?.(sessionId);
      }
    },
    updateSessionCustomModels: (
      sessionId: string,
      customModels: Array<{
        id: string;
        name: string;
        description?: string | null;
      }> | null,
    ) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            customModels,
          },
        };

        // Persist custom models to disk
        const allCustomModels: Record<
          string,
          Array<{ id: string; name: string; description?: string | null }>
        > = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.customModels && sess.customModels.length > 0) {
            allCustomModels[id] = sess.customModels;
          }
        });
        saveSessionCustomModels(allCustomModels);

        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionModelMappings: (
      sessionId: string,
      modelMappings: Record<string, string> | null,
    ) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            modelMappings,
          },
        };

        // Persist model mappings to disk
        const allModelMappings: Record<string, Record<string, string>> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (
            sess.modelMappings &&
            Object.keys(sess.modelMappings).length > 0
          ) {
            allModelMappings[id] = sess.modelMappings;
          }
        });
        saveSessionModelMappings(allModelMappings);

        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionProfile: (
      sessionId: string,
      profile: { profileId: string | null; profileName: string | null },
    ) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            profileId: profile.profileId,
            profileName: profile.profileName,
          },
        };

        // Persist profile info to disk
        const allProfiles: Record<
          string,
          { profileId: string; profileName: string }
        > = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          if (sess.profileId && sess.profileName) {
            allProfiles[id] = {
              profileId: sess.profileId,
              profileName: sess.profileName,
            };
          }
        });
        saveSessionProfiles(allProfiles);

        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    updateSessionSdkSettings: (
      sessionId: string,
      settings: SessionSdkSettings,
    ) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        const updatedSessions = {
          ...state.sessions,
          [sessionId]: {
            ...session,
            ...("thinkingMode" in settings && {
              thinkingMode: settings.thinkingMode,
            }),
            ...("thinkingBudget" in settings && {
              thinkingBudget: settings.thinkingBudget,
            }),
            ...("effortLevel" in settings && {
              effortLevel: settings.effortLevel,
            }),
            ...("maxBudgetUsd" in settings && {
              maxBudgetUsd: settings.maxBudgetUsd,
            }),
            ...("taskBudgetTokens" in settings && {
              taskBudgetTokens: settings.taskBudgetTokens,
            }),
          },
        };

        // Persist SDK settings (only sessions with non-null values)
        const allSdkSettings: Record<string, SessionSdkSettings> = {};
        Object.entries(updatedSessions).forEach(([id, sess]) => {
          const sdk: SessionSdkSettings = {};
          if (sess.thinkingMode) sdk.thinkingMode = sess.thinkingMode;
          if (sess.thinkingBudget != null)
            sdk.thinkingBudget = sess.thinkingBudget;
          if (sess.effortLevel) sdk.effortLevel = sess.effortLevel;
          if (sess.maxBudgetUsd != null) sdk.maxBudgetUsd = sess.maxBudgetUsd;
          if (sess.taskBudgetTokens != null)
            sdk.taskBudgetTokens = sess.taskBudgetTokens;
          if (Object.keys(sdk).length > 0) {
            allSdkSettings[id] = sdk;
          }
        });
        saveSessionSdkSettings(allSdkSettings);

        return {
          ...state,
          sessions: updatedSessions,
        };
      });
      stagePendingSessionPreferences(sessionId);
      onPreferencesChanged?.(sessionId);
    },
    getPendingSessionPreferences: (sessionId: string) =>
      pendingSessionPreferences[sessionId] ?? null,
    clearPendingSessionPreferencesIfMatch: (
      sessionId: string,
      preferences: SessionPreferences,
    ) => {
      const current = pendingSessionPreferences[sessionId];
      if (!current || !areSessionPreferencesEqual(current, preferences)) {
        return false;
      }
      const { [sessionId]: _cleared, ...remaining } = pendingSessionPreferences;
      pendingSessionPreferences = remaining;
      savePendingSessionPreferences(pendingSessionPreferences);
      return true;
    },
    updateSessionPreferencesVersion: (sessionId: string, version: number) =>
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;

        return {
          ...state,
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              preferencesVersion: version,
            },
          },
        };
      }),
    // Project management methods
    getProjects: () => projectManager.getProjects(),
    getProject: (projectId: string) => projectManager.getProject(projectId),
    getProjectForSession: (sessionId: string) =>
      projectManager.getProjectForSession(sessionId),
    getProjectSessions: (projectId: string) =>
      projectManager.getProjectSessions(projectId),
    // Project git status methods
    getProjectGitStatus: (projectId: string) =>
      projectManager.getProjectGitStatus(projectId),
    getSessionProjectGitStatus: (sessionId: string) =>
      projectManager.getSessionProjectGitStatus(sessionId),
    updateSessionProjectGitStatus: (
      sessionId: string,
      status: GitStatus | null,
    ) => {
      projectManager.updateSessionProjectGitStatus(sessionId, status);
      // Trigger a state update to notify hooks
      set((state) => ({ ...state }));
    },
    // Project submodule methods
    getSessionProjectSubmodules: (sessionId: string) =>
      projectManager.getSessionProjectSubmodules(sessionId),
    applyMachines: (machines: Machine[], replace: boolean = false) =>
      set((state) => {
        // Either replace all machines or merge updates
        let mergedMachines: Record<string, Machine>;

        if (replace) {
          // Replace entire machine state (used by fetchMachines)
          mergedMachines = {};
          machines.forEach((machine) => {
            mergedMachines[machine.id] = machine;
          });
        } else {
          // Merge individual updates (used by update-machine)
          mergedMachines = { ...state.machines };
          machines.forEach((machine) => {
            mergedMachines[machine.id] = machine;
          });
        }

        // Rebuild sessionListViewData to reflect machine changes
        const sessionListViewData = buildSessionListViewData(
          state.sessions,
          state.settings.realtimeSessionSort ?? true,
        );

        return {
          ...state,
          machines: mergedMachines,
          sessionListViewData,
        };
      }),
    // Artifact methods
    applyArtifacts: (artifacts: DecryptedArtifact[], replace?: boolean) =>
      set((state) => {
        const mergedArtifacts = replace ? {} : { ...state.artifacts };
        artifacts.forEach((artifact) => {
          mergedArtifacts[artifact.id] = artifact;
        });

        return {
          ...state,
          artifacts: mergedArtifacts,
        };
      }),
    addArtifact: (artifact: DecryptedArtifact) =>
      set((state) => {
        const updatedArtifacts = {
          ...state.artifacts,
          [artifact.id]: artifact,
        };

        return {
          ...state,
          artifacts: updatedArtifacts,
        };
      }),
    updateArtifact: (artifact: DecryptedArtifact) =>
      set((state) => {
        const updatedArtifacts = {
          ...state.artifacts,
          [artifact.id]: artifact,
        };

        return {
          ...state,
          artifacts: updatedArtifacts,
        };
      }),
    deleteArtifact: (artifactId: string) =>
      set((state) => {
        const { [artifactId]: _, ...remainingArtifacts } = state.artifacts;

        return {
          ...state,
          artifacts: remainingArtifacts,
        };
      }),
    deleteSession: (sessionId: string) =>
      set((state) => {
        // Remove session from sessions
        const { [sessionId]: deletedSession, ...remainingSessions } =
          state.sessions;

        // Remove session messages if they exist
        const { [sessionId]: deletedMessages, ...remainingSessionMessages } =
          state.sessionMessages;

        // Remove from LRU tracking
        const remainingSessionMessagesLRU = state.sessionMessagesLRU.filter(
          (id) => id !== sessionId,
        );

        // Remove session git status if it exists
        const { [sessionId]: deletedGitStatus, ...remainingGitStatus } =
          state.sessionGitStatus;

        // Remove prompt suggestion if it exists
        const {
          [sessionId]: _deletedSuggestion,
          ...remainingPromptSuggestions
        } = state.sessionPromptSuggestions;

        // Drop any TUI-supplied window title — the next session that reuses
        // this id (highly unlikely but possible) should not inherit a stale
        // title from a prior process.
        const {
          [sessionId]: _deletedTerminalTitle,
          ...remainingTerminalTitles
        } = state.sessionTerminalTitles;
        const {
          [sessionId]: _deletedTerminalStatus,
          ...remainingTerminalStatus
        } = state.sessionTerminalStatus;

        // Clear drafts and permission modes from persistent storage
        const drafts = loadSessionDrafts();
        delete drafts[sessionId];
        saveSessionDrafts(drafts);

        const modes = loadSessionPermissionModes();
        delete modes[sessionId];
        saveSessionPermissionModes(modes);

        const attention = loadSessionNeedsAttention();
        delete attention[sessionId];
        saveSessionNeedsAttention(attention);

        const { [sessionId]: _sdk, ...remainingSdkSettings } =
          loadSessionSdkSettings();
        saveSessionSdkSettings(remainingSdkSettings);

        deleteSessionBookmarks(sessionId);

        const profiles = loadSessionProfiles();
        delete profiles[sessionId];
        saveSessionProfiles(profiles);

        const modelModes = loadSessionModelModes();
        delete modelModes[sessionId];
        saveSessionModelModes(modelModes);

        const modelMappings = loadSessionModelMappings();
        delete modelMappings[sessionId];
        saveSessionModelMappings(modelMappings);

        const customModels = loadSessionCustomModels();
        delete customModels[sessionId];
        saveSessionCustomModels(customModels);

        const { [sessionId]: _pendingPrefs, ...remainingPendingPrefs } =
          pendingSessionPreferences;
        pendingSessionPreferences = remainingPendingPrefs;
        savePendingSessionPreferences(pendingSessionPreferences);

        delete sessionLastViewed[sessionId];
        saveSessionLastViewed(sessionLastViewed);

        // Rebuild sessionListViewData without the deleted session
        const sessionListViewData = buildSessionListViewData(
          remainingSessions,
          state.settings.realtimeSessionSort ?? true,
        );

        return {
          ...state,
          sessions: remainingSessions,
          sessionMessages: remainingSessionMessages,
          sessionMessagesLRU: remainingSessionMessagesLRU,
          sessionGitStatus: remainingGitStatus,
          sessionPromptSuggestions: remainingPromptSuggestions,
          sessionTerminalTitles: remainingTerminalTitles,
          sessionTerminalStatus: remainingTerminalStatus,
          sessionLastViewed: { ...sessionLastViewed },
          sessionListViewData,
        };
      }),
    // Friend management methods
    applyFriends: (friends: UserProfile[], replace?: boolean) =>
      set((state) => {
        const mergedFriends = replace ? {} : { ...state.friends };
        friends.forEach((friend) => {
          mergedFriends[friend.id] = friend;
        });
        return {
          ...state,
          friends: mergedFriends,
          friendsLoaded: true, // Mark as loaded after first fetch
        };
      }),
    applyRelationshipUpdate: (event: RelationshipUpdatedEvent) =>
      set((state) => {
        const { fromUserId, toUserId, status, action, fromUser, toUser } =
          event;
        const currentUserId = state.profile.id;

        // Update friends cache
        const updatedFriends = { ...state.friends };

        // Determine which user profile to update based on perspective
        const otherUserId =
          fromUserId === currentUserId ? toUserId : fromUserId;
        const otherUser = fromUserId === currentUserId ? toUser : fromUser;

        if (action === "deleted" || status === "none") {
          // Remove from friends if deleted or status is none
          delete updatedFriends[otherUserId];
        } else if (otherUser) {
          // Update or add the user profile with current status
          updatedFriends[otherUserId] = otherUser;
        }

        return {
          ...state,
          friends: updatedFriends,
        };
      }),
    getFriend: (userId: string) => {
      return get().friends[userId];
    },
    getAcceptedFriends: () => {
      const friends = get().friends;
      return Object.values(friends).filter(
        (friend) => friend.status === "friend",
      );
    },
    // User cache methods
    applyUsers: (users: Record<string, UserProfile | null>) =>
      set((state) => ({
        ...state,
        users: { ...state.users, ...users },
      })),
    getUser: (userId: string) => {
      return get().users[userId]; // Returns UserProfile | null | undefined
    },
    assumeUsers: async (userIds: string[]) => {
      // This will be implemented in sync.ts as it needs access to credentials
      // Just a placeholder here for the interface
      const { sync } = await import("./sync");
      return sync.assumeUsers(userIds);
    },
    // Feed methods
    applyFeedItems: (items: FeedItem[]) =>
      set((state) => {
        // Always mark feed as loaded even if empty
        if (items.length === 0) {
          return {
            ...state,
            feedLoaded: true, // Mark as loaded even when empty
          };
        }

        // Create a map of existing items for quick lookup
        const existingMap = new Map<string, FeedItem>();
        state.feedItems.forEach((item) => {
          existingMap.set(item.id, item);
        });

        // Process new items
        const updatedItems = [...state.feedItems];
        let head = state.feedHead;
        let tail = state.feedTail;

        items.forEach((newItem) => {
          // Remove items with same repeatKey if it exists
          if (newItem.repeatKey) {
            const indexToRemove = updatedItems.findIndex(
              (item) => item.repeatKey === newItem.repeatKey,
            );
            if (indexToRemove !== -1) {
              updatedItems.splice(indexToRemove, 1);
            }
          }

          // Add new item if it doesn't exist
          if (!existingMap.has(newItem.id)) {
            updatedItems.push(newItem);
          }

          // Update head/tail cursors
          if (!head || newItem.counter > parseInt(head.substring(2), 10)) {
            head = newItem.cursor;
          }
          if (!tail || newItem.counter < parseInt(tail.substring(2), 10)) {
            tail = newItem.cursor;
          }
        });

        // Sort by counter (desc - newest first)
        updatedItems.sort((a, b) => b.counter - a.counter);

        return {
          ...state,
          feedItems: updatedItems,
          feedHead: head,
          feedTail: tail,
          feedLoaded: true, // Mark as loaded after first fetch
        };
      }),
    clearFeed: () =>
      set((state) => ({
        ...state,
        feedItems: [],
        feedHead: null,
        feedTail: null,
        feedHasMore: false,
        feedLoaded: false, // Reset loading flag
        friendsLoaded: false, // Reset loading flag
      })),
  };
});

/**
 * Mutations owned by the SyncUpdate/SyncEphemeral ingest seams and the sync
 * engine (ADR-0026). They land server-reported state; nothing outside
 * `sources/sync/` may call them — components react to the resulting state or
 * the ingest event stream instead. Excluded from the public `storage` type
 * below; reach them through `ingestStorage`.
 */
type SyncIngestMutations = Pick<
  StorageState,
  | "applyArtifacts"
  | "applyFeedItems"
  | "applyGitStatus"
  | "applyMachines"
  | "applyMessages"
  | "applyMessagesLoaded"
  | "applyNativeUpdateStatus"
  | "applyOlderMessages"
  | "applyProfile"
  | "applyPurchases"
  | "applyReady"
  | "applyRelationshipUpdate"
  | "applySessionUsageBaseline"
  | "applyUsers"
>;

/**
 * Local-intent appliers deliberately kept on the public view — components
 * call them as optimistic updates today (ADR-0029, "Deliberately still
 * public"). Do not add keys here for new server-driven mutations; those
 * belong in SyncIngestMutations.
 */
type PublicAppliers = Pick<
  StorageState,
  | "applyFriends"
  | "applyLocalSettings"
  | "applySessions"
  | "applySettings"
  | "applySettingsLocal"
>;

// Drift guard (#128): every `apply*` mutation on StorageState must be
// classified — ingest-only (SyncIngestMutations) or deliberately public
// (PublicAppliers). The narrowed `storage` export below is produced by a
// cast, so a forgotten key would otherwise land on the public view with no
// compile error. If you just added an apply* method and this line stopped
// compiling, add its key to exactly one of the two lists above.
type AssertNever<T extends never> = T;
type UnclassifiedAppliers = Exclude<
  Extract<keyof StorageState, `apply${string}`>,
  keyof SyncIngestMutations | keyof PublicAppliers
>;
type _StorageAppliersAreClassified = AssertNever<UnclassifiedAppliers>;

/** The storage interface everyone outside `sources/sync/` programs against. */
export type StoragePublicState = Omit<StorageState, keyof SyncIngestMutations>;

/**
 * Public storage view: read-only queries plus local-intent mutations (drafts,
 * settings, pending queues, per-session preferences). Same store instance as
 * `ingestStorage`, narrowed at the type level.
 */
export const storage = storageStore as unknown as UseBoundStore<
  StoreApi<StoragePublicState>
>;

/** Full storage view including ingest mutations. `sources/sync/` only. */
export const ingestStorage = storageStore;

export function useSessions() {
  return storage(
    useShallow((state) => (state.isDataReady ? state.sessionsData : null)),
  );
}

export function useSession(id: string): Session | null {
  return storage(useShallow((state) => state.sessions[id] ?? null));
}

const emptyArray: unknown[] = [];

export function useHasUnreadMessages(sessionId: string): boolean {
  return storage((state) => {
    const lastViewedAt = state.sessionLastViewed[sessionId];
    const messages = state.sessionMessages[sessionId]?.messages;
    return computeHasUnreadMessages({ lastViewedAt, messages });
  });
}

// Cap displayed messages to bound all downstream O(n) computations in ChatList.
// Full history is still in messagesMap; this only limits the rendered slice.
export const MAX_DISPLAY_MESSAGES = 10000;

export function useSessionMessages(
  sessionId: string,
  limit: number = MAX_DISPLAY_MESSAGES,
): {
  messages: Message[];
  isLoaded: boolean;
  hasOlderMessages: boolean;
  hasServerOlderMessages: boolean;
  isBackfilling: boolean;
  loadingProgress: { loaded: number; total: number } | null;
} {
  // slice() inside a zustand selector creates a new array reference on every getSnapshot
  // call, breaking useShallow's equality check and causing React 18's useSyncExternalStore
  // to detect an inconsistent snapshot → infinite update loop. Keep the selector
  // returning only stable store references; derive the capped slice via useMemo.
  const { all, isLoaded, isBackfilling, hasServerOlderMessages, loadingProgress } = storage(
    useShallow((state) => {
      const session = state.sessionMessages[sessionId];
      return {
        all: session?.messages ?? emptyArray,
        isLoaded: session?.isLoaded ?? false,
        isBackfilling: session?.isBackfilling ?? false,
        hasServerOlderMessages: session?.hasServerOlderMessages ?? false,
        loadingProgress: session?.loadingProgress ?? null,
      };
    }),
  );
  const capped = all.length > limit;
  const messages = React.useMemo(
    () => (capped ? all.slice(0, limit) : all),
    [all, limit, capped],
  );
  return { messages, isLoaded, hasOlderMessages: capped, hasServerOlderMessages, isBackfilling, loadingProgress };
}

const emptyBackgroundTasks: ReadonlyMap<string, BackgroundTaskEntry> = new Map();

/** Returns the backgroundTasks Map from reducer state.
 *  The Map reference is replaced (not mutated) on each change, so
 *  Zustand's default reference-equality check triggers re-renders correctly. */
export function useBackgroundTaskEntries(
  sessionId: string,
): ReadonlyMap<string, BackgroundTaskEntry> {
  return storage(
    (state) => state.sessionMessages[sessionId]?.reducerState.backgroundTasks ?? emptyBackgroundTasks,
  );
}

export function useMessage(
  sessionId: string,
  messageId: string,
): Message | null {
  return storage(
    useShallow((state) => {
      const session = state.sessionMessages[sessionId];
      return session?.messagesMap[messageId] ?? null;
    }),
  );
}

export function useSessionUsage(sessionId: string) {
  return storage(
    useShallow((state) => {
      const session = state.sessionMessages[sessionId];
      return session?.reducerState?.latestUsage ?? null;
    }),
  );
}

export function useSessionContextUsage(sessionId: string) {
  return storage(
    useShallow((state) => {
      const session = state.sessionMessages[sessionId];
      return session?.reducerState?.contextUsage ?? null;
    }),
  );
}

export function useSettings(): Settings {
  return storage(useShallow((state) => state.settings));
}

export function useSettingMutable<K extends keyof Settings>(
  name: K,
): [Settings[K], (value: Settings[K]) => void] {
  const setValue = React.useCallback(
    (value: Settings[K]) => {
      sync.applySettings({ [name]: value });
    },
    [name],
  );
  const value = useSetting(name);
  return [value, setValue];
}

export function useSetting<K extends keyof Settings>(name: K): Settings[K] {
  return storage(useShallow((state) => state.settings[name]));
}

export function useLocalSettings(): LocalSettings {
  return storage(useShallow((state) => state.localSettings));
}

export function useAllMachines(): Machine[] {
  return storage(
    useShallow((state) => {
      if (!state.isDataReady) return [];
      return Object.values(state.machines)
        .sort((a, b) => (b.activeAt ?? b.lastSeenAt ?? 0) - (a.activeAt ?? a.lastSeenAt ?? 0))
        .filter(isMachineOnline);
    }),
  );
}

export function useMachine(machineId: string): Machine | null {
  return storage(useShallow((state) => state.machines[machineId] ?? null));
}

export function useSessionListViewData(): SessionListViewItem[] | null {
  return storage((state) =>
    state.isDataReady ? state.sessionListViewData : null,
  );
}

export function useAllSessions(): Session[] {
  return storage(
    useShallow((state) => {
      if (!state.isDataReady) return [];
      return Object.values(state.sessions).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
    }),
  );
}

export function useLocalSettingMutable<K extends keyof LocalSettings>(
  name: K,
): [LocalSettings[K], (value: LocalSettings[K]) => void] {
  const setValue = React.useCallback(
    (value: LocalSettings[K]) => {
      storage.getState().applyLocalSettings({ [name]: value });
    },
    [name],
  );
  const value = useLocalSetting(name);
  return [value, setValue];
}

// Project management hooks
export function useProjects() {
  return storage(useShallow((state) => state.getProjects()));
}

export function useProject(projectId: string | null) {
  return storage(
    useShallow((state) => (projectId ? state.getProject(projectId) : null)),
  );
}

export function useProjectForSession(sessionId: string | null) {
  return storage(
    useShallow((state) =>
      sessionId ? state.getProjectForSession(sessionId) : null,
    ),
  );
}

export function useProjectSessions(projectId: string | null) {
  return storage(
    useShallow((state) =>
      projectId ? state.getProjectSessions(projectId) : [],
    ),
  );
}

export function useProjectGitStatus(projectId: string | null) {
  return storage(
    useShallow((state) =>
      projectId ? state.getProjectGitStatus(projectId) : null,
    ),
  );
}

export function useProjectAliasMap(): Map<string, string> {
  const projects = useProjects();
  return React.useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => {
      if (project.serverMetadata && !map.has(project.key.path)) {
        try {
          const meta = JSON.parse(project.serverMetadata);
          if (meta.alias) {
            map.set(project.key.path, meta.alias);
          }
        } catch { /* ignore */ }
      }
    });
    return map;
  }, [projects]);
}

export function useSessionProjectGitStatus(sessionId: string | null) {
  return storage(
    useShallow((state) =>
      sessionId ? state.getSessionProjectGitStatus(sessionId) : null,
    ),
  );
}

export function useSessionProjectSubmodules(sessionId: string | null) {
  return storage(
    useShallow((state) =>
      sessionId ? state.getSessionProjectSubmodules(sessionId) : undefined,
    ),
  );
}

/**
 * Returns the aggregated +N/-N line counts shown on the side panel's
 * "Changes" tab. The selector returns a tiny `{ totalAdded, totalRemoved }`
 * object (or null) and is paired with `useShallow`, so the consumer only
 * re-renders when the numbers themselves change — not when the underlying
 * GitStatus object reference changes (which happens every mutable-tool tick).
 */
export function useSessionChangesInfo(
  sessionId: string | null,
): { totalAdded: number; totalRemoved: number } | null {
  return storage(
    useShallow((state) => {
      if (!sessionId) return null;
      const projectStatus = state.getSessionProjectGitStatus(sessionId);
      const sessionStatus = state.sessionGitStatus[sessionId] ?? null;
      const gitStatus = projectStatus || sessionStatus;
      if (!gitStatus || gitStatus.lastUpdatedAt === 0) return null;
      const submodules = state.getSessionProjectSubmodules(sessionId);
      const { totalAdded, totalRemoved } = aggregateLineChanges(
        gitStatus,
        submodules,
      );
      if (totalAdded === 0 && totalRemoved === 0) return null;
      return { totalAdded, totalRemoved };
    }),
  );
}

export function useLocalSetting<K extends keyof LocalSettings>(
  name: K,
): LocalSettings[K] {
  return storage(useShallow((state) => state.localSettings[name]));
}

// Artifact hooks
export function useArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow((state) => {
      if (!state.isDataReady) return [];
      // Filter out draft artifacts from the main list
      return Object.values(state.artifacts)
        .filter((artifact) => !artifact.draft)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }),
  );
}

export function useAllArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow((state) => {
      if (!state.isDataReady) return [];
      // Return all artifacts including drafts
      return Object.values(state.artifacts).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
    }),
  );
}

export function useDraftArtifacts(): DecryptedArtifact[] {
  return storage(
    useShallow((state) => {
      if (!state.isDataReady) return [];
      // Return only draft artifacts
      return Object.values(state.artifacts)
        .filter((artifact) => artifact.draft === true)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }),
  );
}

export function useArtifact(artifactId: string): DecryptedArtifact | null {
  return storage(useShallow((state) => state.artifacts[artifactId] ?? null));
}

export function useArtifactsCount(): number {
  return storage(
    useShallow((state) => {
      // Count only non-draft artifacts
      return Object.values(state.artifacts).filter((a) => !a.draft).length;
    }),
  );
}

export function useEntitlement(id: KnownEntitlements): boolean {
  return storage(
    useShallow((state) => state.purchases.entitlements[id] ?? false),
  );
}

export function useRealtimeStatus():
  | "disconnected"
  | "connecting"
  | "connected"
  | "error" {
  return storage(useShallow((state) => state.realtimeStatus));
}

export function useRealtimeMode():
  | "idle"
  | "listening"
  | "thinking"
  | "speaking" {
  return storage(useShallow((state) => state.realtimeMode));
}

export function useSocketStatus() {
  return storage(
    useShallow((state) => ({
      status: state.socketStatus,
      lastConnectedAt: state.socketLastConnectedAt,
      lastDisconnectedAt: state.socketLastDisconnectedAt,
    })),
  );
}

export function useSessionGitStatus(sessionId: string): GitStatus | null {
  return storage(
    useShallow((state) => state.sessionGitStatus[sessionId] ?? null),
  );
}

export function usePromptSuggestion(sessionId: string): string | null {
  return storage(
    useShallow((state) => state.sessionPromptSuggestions[sessionId] ?? null),
  );
}

export function useNeedsContinue(sessionId: string): boolean {
  return storage(
    useShallow((state) => state.sessionNeedsContinue[sessionId] ?? false),
  );
}

/**
 * Latest TUI window title for `sessionId`, or `null` if none has been
 * received. Updated by `syncUpdateHandlers` whenever a `terminal-signal`
 * envelope of kind `window-title` lands. Consumers should treat it as a
 * higher-priority subtitle than the static project path so the user sees the
 * same context their native terminal would show.
 */
export function useSessionTerminalTitle(sessionId: string): string | null {
  return storage(
    useShallow((state) => state.sessionTerminalTitles[sessionId] ?? null),
  );
}

/**
 * Live TUI status for `sessionId` (spinner verb + counters, ConEmu progress,
 * picker-pending flag), or `null` if no terminal-signal status events have
 * been received. Updated by `syncUpdateHandlers` on `activity` / `progress` /
 * `picker` terminal-signal envelopes.
 */
export function useSessionTerminalStatus(
  sessionId: string,
): TerminalLiveStatus | null {
  return storage(
    useShallow((state) => state.sessionTerminalStatus[sessionId] ?? null),
  );
}

export function useSessionKnowledgeCount(sessionId: string): number {
  return storage((state) => state.sessionKnowledgeCount[sessionId] ?? 0);
}

export function useSessionKnowledgeAccessRevision(sessionId: string): number {
  return storage(
    (state) => state.sessionKnowledgeAccessRevision[sessionId] ?? 0,
  );
}

export function useSessionKnowledgeChangesRevision(sessionId: string): number {
  return storage(
    (state) => state.sessionKnowledgeChangesRevision[sessionId] ?? 0,
  );
}

export function useIsDataReady(): boolean {
  return storage(useShallow((state) => state.isDataReady));
}

export function useProfile() {
  return storage(useShallow((state) => state.profile));
}

export function useFriends() {
  return storage(useShallow((state) => state.friends));
}

export function useFriendRequests() {
  return storage(
    useShallow((state) => {
      // Filter friends to get pending requests (where status is 'pending')
      return Object.values(state.friends).filter(
        (friend) => friend.status === "pending",
      );
    }),
  );
}

export function useAcceptedFriends() {
  return storage(
    useShallow((state) => {
      return Object.values(state.friends).filter(
        (friend) => friend.status === "friend",
      );
    }),
  );
}

export function useFeedItems() {
  return storage(useShallow((state) => state.feedItems));
}
export function useFeedLoaded() {
  return storage((state) => state.feedLoaded);
}
export function useFriendsLoaded() {
  return storage((state) => state.friendsLoaded);
}

export function useFriend(userId: string | undefined) {
  return storage(
    useShallow((state) => (userId ? state.friends[userId] : undefined)),
  );
}

export function useUser(userId: string | undefined) {
  return storage(
    useShallow((state) => (userId ? state.users[userId] : undefined)),
  );
}

export function useRequestedFriends() {
  return storage(
    useShallow((state) => {
      // Filter friends to get sent requests (where status is 'requested')
      return Object.values(state.friends).filter(
        (friend) => friend.status === "requested",
      );
    }),
  );
}
