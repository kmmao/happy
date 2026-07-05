import { MMKV } from "react-native-mmkv";
import { z } from "zod";
import { SessionPreferencesSchema, type SessionPreferences } from "./storageTypes";
import {
  Settings,
  settingsDefaults,
  settingsParse,
  settingsToSyncPayload,
  SettingsSchema,
} from "./settings";
import {
  LocalSettings,
  localSettingsDefaults,
  localSettingsParse,
} from "./localSettings";
import { Purchases, purchasesDefaults, purchasesParse } from "./purchases";
import { Profile, profileDefaults, profileParse } from "./profile";
import type { PermissionModeKey } from "@/components/PermissionModeSelector";
import { clearAllMessageCaches } from "./messageCache";
import { log } from '@/log';

const mmkv = new MMKV();
const NEW_SESSION_DRAFT_KEY = "new-session-draft-v1";
const DISMISSED_TASKS_PREFIX = "dismissed-tasks:";

/**
 * Load a JSON-encoded MMKV value under `key`, run `parse` on the decoded value,
 * and return its result — or `fallback` when the key is absent or parsing throws.
 *
 * Concentrates the `getString → JSON.parse → validate → catch→fallback` envelope
 * that the simple `loadX` accessors previously repeated inline (with drifting
 * amounts of validation — some ran a `*Parse` helper, some cast unchecked).
 * `parse` decides the validation: an identity cast keeps the prior unchecked
 * behavior; a `*Parse`/Zod call validates and may throw, which is caught and
 * logged here. Specialized loaders that also delete stale keys, migrate legacy
 * formats, or filter fields keep their own bodies.
 */
function loadJson<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  const raw = mmkv.getString(key);
  if (!raw) {
    return fallback;
  }
  try {
    return parse(JSON.parse(raw));
  } catch (e) {
    log.error(`Failed to parse ${key}`, e);
    return fallback;
  }
}

export type NewSessionAgentType = "claude" | "codex" | "gemini";
export type NewSessionSessionType = "simple" | "worktree";

export interface NewSessionDraft {
  input: string;
  selectedMachineId: string | null;
  selectedPath: string | null;
  agentType: NewSessionAgentType;
  permissionMode: PermissionModeKey;
  sessionType: NewSessionSessionType;
  updatedAt: number;
}

export function loadSettings(): { settings: Settings; version: number | null } {
  return loadJson(
    "settings",
    (v) => {
      const parsed = v as { settings: unknown; version: number | null };
      return { settings: settingsParse(parsed.settings), version: parsed.version };
    },
    { settings: { ...settingsDefaults }, version: null },
  );
}

export function saveSettings(settings: Settings, version: number) {
  // Strip empty agentDefaultOverrides entries so MMKV doesn't accumulate
  // ghost "claude: {}" / "codex: {}" objects after the user clears
  // overrides one field at a time.
  mmkv.set(
    "settings",
    JSON.stringify({ settings: settingsToSyncPayload(settings), version }),
  );
}

export function loadPendingSettings(): Partial<Settings> {
  return loadJson("pending-settings", (v) => SettingsSchema.partial().parse(v), {});
}

export function savePendingSettings(settings: Partial<Settings>) {
  mmkv.set("pending-settings", JSON.stringify(settings));
}

const PendingSessionPreferencesMapSchema = z.record(
  z.string(),
  SessionPreferencesSchema,
);

export function loadPendingSessionPreferences(): Record<
  string,
  SessionPreferences
> {
  return loadJson(
    "pending-session-preferences",
    (v) => PendingSessionPreferencesMapSchema.parse(v),
    {},
  );
}

export function savePendingSessionPreferences(
  preferences: Record<string, SessionPreferences>,
) {
  mmkv.set("pending-session-preferences", JSON.stringify(preferences));
}

export function loadLocalSettings(): LocalSettings {
  return loadJson("local-settings", localSettingsParse, { ...localSettingsDefaults });
}

export function saveLocalSettings(settings: LocalSettings) {
  mmkv.set("local-settings", JSON.stringify(settings));
}

export function loadThemePreference(): "light" | "dark" | "adaptive" {
  return loadJson(
    "local-settings",
    (v) => localSettingsParse(v).themePreference,
    localSettingsDefaults.themePreference,
  );
}

export function loadPurchases(): Purchases {
  return loadJson("purchases", purchasesParse, { ...purchasesDefaults });
}

export function savePurchases(purchases: Purchases) {
  mmkv.set("purchases", JSON.stringify(purchases));
}

export function loadSessionDrafts(): Record<string, string> {
  return loadJson("session-drafts", (v) => v as Record<string, string>, {});
}

export function saveSessionDrafts(drafts: Record<string, string>) {
  mmkv.set("session-drafts", JSON.stringify(drafts));
}

export type PendingQueueItem = { localId: string; message: string; displayText?: string };

export function loadPendingQueues(): Record<string, PendingQueueItem[]> {
  return loadJson("session-pending-queues", (v) => v as Record<string, PendingQueueItem[]>, {});
}

export function savePendingQueues(queues: Record<string, PendingQueueItem[]>) {
  const filtered = Object.fromEntries(
    Object.entries(queues).filter(([, q]) => q.length > 0),
  );
  if (Object.keys(filtered).length === 0) {
    mmkv.delete("session-pending-queues");
  } else {
    mmkv.set("session-pending-queues", JSON.stringify(filtered));
  }
}

/**
 * Per-session "queue paused" flag. When true, the auto-dispatch effect in
 * SessionView won't pop the next message off the queue when the AI becomes
 * idle — the user has to explicitly send via the chip ▶ button or the header
 * "Send now" pill. Persisted so the choice survives reloads.
 */
export function loadPendingQueuePaused(): Record<string, boolean> {
  return loadJson("session-pending-queue-paused", (v) => v as Record<string, boolean>, {});
}

export function savePendingQueuePaused(paused: Record<string, boolean>) {
  const filtered = Object.fromEntries(
    Object.entries(paused).filter(([, v]) => v),
  );
  if (Object.keys(filtered).length === 0) {
    mmkv.delete("session-pending-queue-paused");
  } else {
    mmkv.set("session-pending-queue-paused", JSON.stringify(filtered));
  }
}

export function loadNewSessionDraft(): NewSessionDraft | null {
  const raw = mmkv.getString(NEW_SESSION_DRAFT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const input = typeof parsed.input === "string" ? parsed.input : "";
    const selectedMachineId =
      typeof parsed.selectedMachineId === "string"
        ? parsed.selectedMachineId
        : null;
    const selectedPath =
      typeof parsed.selectedPath === "string" ? parsed.selectedPath : null;
    const agentType: NewSessionAgentType =
      parsed.agentType === "codex" || parsed.agentType === "gemini"
        ? parsed.agentType
        : "claude";
    const permissionMode: PermissionModeKey =
      typeof parsed.permissionMode === "string"
        ? parsed.permissionMode
        : "default";
    const sessionType: NewSessionSessionType =
      parsed.sessionType === "worktree" ? "worktree" : "simple";
    const updatedAt =
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now();

    return {
      input,
      selectedMachineId,
      selectedPath,
      agentType,
      permissionMode,
      sessionType,
      updatedAt,
    };
  } catch (e) {
    log.error("Failed to parse new session draft", e);
    return null;
  }
}

export function saveNewSessionDraft(draft: NewSessionDraft) {
  mmkv.set(NEW_SESSION_DRAFT_KEY, JSON.stringify(draft));
}

export function clearNewSessionDraft() {
  mmkv.delete(NEW_SESSION_DRAFT_KEY);
}

export function loadSessionPermissionModes(): Record<string, string> {
  return loadJson("session-permission-modes", (v) => v as Record<string, string>, {});
}

export function saveSessionPermissionModes(modes: Record<string, string>) {
  mmkv.set("session-permission-modes", JSON.stringify(modes));
}

export function loadSessionModelModes(): Record<string, string> {
  return loadJson("session-model-modes", (v) => v as Record<string, string>, {});
}

export function saveSessionModelModes(modes: Record<string, string>) {
  mmkv.set("session-model-modes", JSON.stringify(modes));
}

export function loadSessionLastViewed(): Record<string, number> {
  const raw = mmkv.getString("session-last-viewed");
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      const result: Record<string, number> = {};
      for (const [sessionId, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof value === "number" && Number.isFinite(value)) {
          result[sessionId] = value;
        }
      }
      return result;
    } catch (e) {
      log.error("Failed to parse session last viewed timestamps", e);
      return {};
    }
  }
  return {};
}

export function saveSessionLastViewed(data: Record<string, number>) {
  mmkv.set("session-last-viewed", JSON.stringify(data));
}

// SDK settings per session (thinking, effort, budget)
export interface SessionSdkSettings {
  thinkingMode?: string | null;
  thinkingBudget?: number | null;
  effortLevel?: string | null;
  maxBudgetUsd?: number | null;
  taskBudgetTokens?: number | null;
}

export function loadSessionSdkSettings(): Record<string, SessionSdkSettings> {
  return loadJson("session-sdk-settings", (v) => v as Record<string, SessionSdkSettings>, {});
}

export function saveSessionSdkSettings(
  settings: Record<string, SessionSdkSettings>,
) {
  mmkv.set("session-sdk-settings", JSON.stringify(settings));
}

export function loadSessionNeedsAttention(): Record<string, boolean> {
  return loadJson("session-needs-attention", (v) => v as Record<string, boolean>, {});
}

export function saveSessionNeedsAttention(attention: Record<string, boolean>) {
  mmkv.set("session-needs-attention", JSON.stringify(attention));
}

// Starred sessions (user-bookmarked, device-local)
export function loadSessionStarred(): Record<string, boolean> {
  return loadJson("session-starred", (v) => v as Record<string, boolean>, {});
}

export function saveSessionStarred(starred: Record<string, boolean>) {
  mmkv.set("session-starred", JSON.stringify(starred));
}

// Model mappings per session (maps UI keys like opus/sonnet to provider model IDs)
export function loadSessionModelMappings(): Record<
  string,
  Record<string, string>
> {
  return loadJson("session-model-mappings", (v) => v as Record<string, Record<string, string>>, {});
}

export function saveSessionModelMappings(
  mappings: Record<string, Record<string, string>>,
) {
  mmkv.set("session-model-mappings", JSON.stringify(mappings));
}

// Custom models per session (provider-specific model lists for the model picker)
type CustomModelEntry = Array<{
  id: string;
  name: string;
  description?: string | null;
}>;

export function loadSessionCustomModels(): Record<string, CustomModelEntry> {
  return loadJson("session-custom-models", (v) => v as Record<string, CustomModelEntry>, {});
}

export function saveSessionCustomModels(
  models: Record<string, CustomModelEntry>,
) {
  mmkv.set("session-custom-models", JSON.stringify(models));
}

// Session profile info (profileId + profileName for display in session info)
type SessionProfileEntry = { profileId: string; profileName: string };

export function loadSessionProfiles(): Record<string, SessionProfileEntry> {
  return loadJson("session-profiles", (v) => v as Record<string, SessionProfileEntry>, {});
}

export function saveSessionProfiles(
  profiles: Record<string, SessionProfileEntry>,
) {
  mmkv.set("session-profiles", JSON.stringify(profiles));
}

export function loadProfile(): Profile {
  return loadJson("profile", profileParse, { ...profileDefaults });
}

export function saveProfile(profile: Profile) {
  mmkv.set("profile", JSON.stringify(profile));
}

// Session bookmarks - persisted per session, cleared on session delete
export interface BookmarkItem {
  text: string;
  source: "ai" | "user";
}

export function loadSessionBookmarks(sessionId: string): BookmarkItem[] {
  const raw = mmkv.getString(`session-bookmarks-${sessionId}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migrate legacy string[] format to BookmarkItem[]
        return parsed.map((item: unknown) =>
          typeof item === "string"
            ? { text: item, source: "ai" as const }
            : (item as BookmarkItem),
        );
      }
    } catch (e) {
      log.error("Failed to parse session bookmarks", e);
    }
  }
  return [];
}

export function saveSessionBookmarks(
  sessionId: string,
  bookmarks: BookmarkItem[],
) {
  if (bookmarks.length === 0) {
    mmkv.delete(`session-bookmarks-${sessionId}`);
  } else {
    mmkv.set(`session-bookmarks-${sessionId}`, JSON.stringify(bookmarks));
  }
}

export function deleteSessionBookmarks(sessionId: string) {
  mmkv.delete(`session-bookmarks-${sessionId}`);
}

// Simple temporary text storage for passing large strings between screens
export function storeTempText(content: string): string {
  const id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  mmkv.set(`temp_text_${id}`, content);
  return id;
}

export function retrieveTempText(id: string): string | null {
  const content = mmkv.getString(`temp_text_${id}`);
  if (content) {
    // Auto-delete after retrieval
    mmkv.delete(`temp_text_${id}`);
    return content;
  }
  return null;
}

// Session message lastSeq - tracks sync position per session
const LAST_SEQ_PREFIX = "msg-last-seq-";

export function loadLastSeqs(): Map<string, number> {
  const keys = mmkv.getAllKeys().filter((k) => k.startsWith(LAST_SEQ_PREFIX));
  const result = new Map<string, number>();
  for (const key of keys) {
    const sessionId = key.slice(LAST_SEQ_PREFIX.length);
    const seq = mmkv.getNumber(key);
    if (seq !== undefined && seq > 0) {
      result.set(sessionId, seq);
    }
  }
  return result;
}

export function saveLastSeq(sessionId: string, seq: number): void {
  mmkv.set(`${LAST_SEQ_PREFIX}${sessionId}`, seq);
}

export function deleteLastSeq(sessionId: string): void {
  mmkv.delete(`${LAST_SEQ_PREFIX}${sessionId}`);
}

// Backfill boundary — the seq range of the reverse-pagination "newest batch"
// that has already been applied to storage. Persisted so that an interrupted
// forward backfill can resume with the correct stop bound instead of re-fetching
// the already-applied tail range.
//
// Lifecycle:
//   1. Written at the end of reverse pagination when hasMore=true.
//   2. Consumed as the stop-bound of the forward backfill loop.
//   3. Deleted once the forward loop reaches boundary.minSeq - 1 (and cursor
//      is advanced to boundary.maxSeq).
//   4. Also deleted on manual refresh, 404 cleanup, and cache-less reset paths,
//      since the tail range in storage is no longer guaranteed to be present.
//
// Boundary entries are normally consumed within the same fetchMessages call
// they are created in. Persistence only matters across crashes/interrupts.
// A TTL guards against corrupt/ancient entries lingering after long gaps.
const BACKFILL_BOUNDARY_PREFIX = "msg-backfill-boundary-";
const BACKFILL_BOUNDARY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const BackfillBoundarySchema = z.object({
  minSeq: z.number().int().positive(),
  maxSeq: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
});

export type BackfillBoundary = z.infer<typeof BackfillBoundarySchema>;

export function loadBackfillBoundaries(): Map<string, BackfillBoundary> {
  const keys = mmkv
    .getAllKeys()
    .filter((k) => k.startsWith(BACKFILL_BOUNDARY_PREFIX));
  const result = new Map<string, BackfillBoundary>();
  const now = Date.now();
  for (const key of keys) {
    const raw = mmkv.getString(key);
    if (!raw) continue;
    try {
      const parsed = BackfillBoundarySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        mmkv.delete(key);
        continue;
      }
      if (
        parsed.data.minSeq > parsed.data.maxSeq ||
        now - parsed.data.updatedAt > BACKFILL_BOUNDARY_TTL_MS
      ) {
        mmkv.delete(key);
        continue;
      }
      const sessionId = key.slice(BACKFILL_BOUNDARY_PREFIX.length);
      result.set(sessionId, parsed.data);
    } catch {
      mmkv.delete(key);
    }
  }
  return result;
}

export function saveBackfillBoundary(
  sessionId: string,
  boundary: BackfillBoundary,
): void {
  mmkv.set(
    `${BACKFILL_BOUNDARY_PREFIX}${sessionId}`,
    JSON.stringify(boundary),
  );
}

export function deleteBackfillBoundary(sessionId: string): void {
  mmkv.delete(`${BACKFILL_BOUNDARY_PREFIX}${sessionId}`);
}

// Hidden processes per machine — user-configurable process name filter
const HIDDEN_PROCESSES_PREFIX = "hidden-processes-";
const HiddenProcessesSchema = z.array(z.string());

export function loadHiddenProcesses(machineId: string): readonly string[] {
  const raw = mmkv.getString(`${HIDDEN_PROCESSES_PREFIX}${machineId}`);
  if (raw) {
    try {
      const parsed = HiddenProcessesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch (e) {
      log.error("Failed to parse hidden processes", e);
    }
  }
  return [];
}

export function saveHiddenProcesses(machineId: string, names: readonly string[]) {
  if (names.length === 0) {
    mmkv.delete(`${HIDDEN_PROCESSES_PREFIX}${machineId}`);
  } else {
    mmkv.set(`${HIDDEN_PROCESSES_PREFIX}${machineId}`, JSON.stringify(names));
  }
}

/** One-click setup: Git repo paths hidden from scan list (per machine, local only). */
const ONE_CLICK_IGNORED_REPOS_PREFIX = "one-click-ignored-repos-";
const OneClickIgnoredReposSchema = z.array(z.string());

export function loadOneClickIgnoredRepos(machineId: string): readonly string[] {
  const raw = mmkv.getString(`${ONE_CLICK_IGNORED_REPOS_PREFIX}${machineId}`);
  if (raw) {
    try {
      const parsed = OneClickIgnoredReposSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch (e) {
      log.error("Failed to parse one-click ignored repos", e);
    }
  }
  return [];
}

export function saveOneClickIgnoredRepos(machineId: string, paths: readonly string[]) {
  if (paths.length === 0) {
    mmkv.delete(`${ONE_CLICK_IGNORED_REPOS_PREFIX}${machineId}`);
  } else {
    mmkv.set(`${ONE_CLICK_IGNORED_REPOS_PREFIX}${machineId}`, JSON.stringify(paths));
  }
}

export function loadDismissedTasks(sessionId: string): ReadonlySet<string> {
  const raw = mmkv.getString(`${DISMISSED_TASKS_PREFIX}${sessionId}`);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    } catch {
      // ignore
    }
  }
  return new Set();
}

export function saveDismissedTasks(sessionId: string, taskIds: ReadonlySet<string>) {
  if (taskIds.size === 0) {
    mmkv.delete(`${DISMISSED_TASKS_PREFIX}${sessionId}`);
  } else {
    mmkv.set(`${DISMISSED_TASKS_PREFIX}${sessionId}`, JSON.stringify([...taskIds]));
  }
}

export function clearPersistence() {
  mmkv.clearAll();
  clearAllMessageCaches();
}

/**
 * Research-specific preferences stored locally (MMKV) and synced via KV Store.
 *
 * These are **run-level parameters** for competitor research, NOT the
 * project-level supervisor config (which lives in the Project table fields
 * like supervisorMode, supervisorEnabledDimensions, etc.).
 *
 * Two separate config paths by design:
 * - Health analysis config → supervisor-settings.tsx → Server Project table
 * - Research analysis config → ResearchTab → MMKV + KV Store (this interface)
 */
const RESEARCH_PREFS_PREFIX = "research-prefs-";

export const ResearchPrefsSchema = z.object({
  dimensions: z.record(z.string(), z.boolean()),
  knownCompetitors: z.string(),
  additionalNotes: z.string(),
  customRules: z.string(),
  featureDirection: z.string(),
});

export type ResearchPrefs = z.infer<typeof ResearchPrefsSchema>;

export function loadResearchPrefs(projectId: string): ResearchPrefs | null {
  const raw = mmkv.getString(`${RESEARCH_PREFS_PREFIX}${projectId}`);
  if (raw) {
    try {
      const parsed = ResearchPrefsSchema.partial().safeParse(JSON.parse(raw));
      if (parsed.success) {
        return {
          dimensions: parsed.data.dimensions ?? {},
          knownCompetitors: parsed.data.knownCompetitors ?? "",
          additionalNotes: parsed.data.additionalNotes ?? "",
          customRules: parsed.data.customRules ?? "",
          featureDirection: parsed.data.featureDirection ?? "",
        };
      }
    } catch (e) {
      log.error("Failed to parse research prefs", e);
    }
  }
  // Migrate from old dimensions-only key
  const legacyRaw = mmkv.getString(`research-dims-${projectId}`);
  if (legacyRaw) {
    try {
      const dims = JSON.parse(legacyRaw);
      mmkv.delete(`research-dims-${projectId}`);
      if (dims && typeof dims === "object" && !Array.isArray(dims)) {
        return {
          dimensions: dims as Record<string, boolean>,
          knownCompetitors: "",
          additionalNotes: "",
          customRules: "",
          featureDirection: "",
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function saveResearchPrefs(
  projectId: string,
  prefs: ResearchPrefs,
) {
  mmkv.set(`${RESEARCH_PREFS_PREFIX}${projectId}`, JSON.stringify(prefs));
}
