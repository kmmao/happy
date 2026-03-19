import { MMKV } from "react-native-mmkv";
import {
  Settings,
  settingsDefaults,
  settingsParse,
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

const mmkv = new MMKV();
const NEW_SESSION_DRAFT_KEY = "new-session-draft-v1";

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
  const settings = mmkv.getString("settings");
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      return {
        settings: settingsParse(parsed.settings),
        version: parsed.version,
      };
    } catch (e) {
      console.error("Failed to parse settings", e);
      return { settings: { ...settingsDefaults }, version: null };
    }
  }
  return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number) {
  mmkv.set("settings", JSON.stringify({ settings, version }));
}

export function loadPendingSettings(): Partial<Settings> {
  const pending = mmkv.getString("pending-settings");
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      return SettingsSchema.partial().parse(parsed);
    } catch (e) {
      console.error("Failed to parse pending settings", e);
      return {};
    }
  }
  return {};
}

export function savePendingSettings(settings: Partial<Settings>) {
  mmkv.set("pending-settings", JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
  const localSettings = mmkv.getString("local-settings");
  if (localSettings) {
    try {
      const parsed = JSON.parse(localSettings);
      return localSettingsParse(parsed);
    } catch (e) {
      console.error("Failed to parse local settings", e);
      return { ...localSettingsDefaults };
    }
  }
  return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings) {
  mmkv.set("local-settings", JSON.stringify(settings));
}

export function loadThemePreference(): "light" | "dark" | "adaptive" {
  const localSettings = mmkv.getString("local-settings");
  if (localSettings) {
    try {
      const parsed = JSON.parse(localSettings);
      const settings = localSettingsParse(parsed);
      return settings.themePreference;
    } catch (e) {
      console.error("Failed to parse local settings for theme preference", e);
      return localSettingsDefaults.themePreference;
    }
  }
  return localSettingsDefaults.themePreference;
}

export function loadPurchases(): Purchases {
  const purchases = mmkv.getString("purchases");
  if (purchases) {
    try {
      const parsed = JSON.parse(purchases);
      return purchasesParse(parsed);
    } catch (e) {
      console.error("Failed to parse purchases", e);
      return { ...purchasesDefaults };
    }
  }
  return { ...purchasesDefaults };
}

export function savePurchases(purchases: Purchases) {
  mmkv.set("purchases", JSON.stringify(purchases));
}

export function loadSessionDrafts(): Record<string, string> {
  const drafts = mmkv.getString("session-drafts");
  if (drafts) {
    try {
      return JSON.parse(drafts);
    } catch (e) {
      console.error("Failed to parse session drafts", e);
      return {};
    }
  }
  return {};
}

export function saveSessionDrafts(drafts: Record<string, string>) {
  mmkv.set("session-drafts", JSON.stringify(drafts));
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
    console.error("Failed to parse new session draft", e);
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
  const modes = mmkv.getString("session-permission-modes");
  if (modes) {
    try {
      return JSON.parse(modes);
    } catch (e) {
      console.error("Failed to parse session permission modes", e);
      return {};
    }
  }
  return {};
}

export function saveSessionPermissionModes(modes: Record<string, string>) {
  mmkv.set("session-permission-modes", JSON.stringify(modes));
}

export function loadSessionModelModes(): Record<string, string> {
  const modes = mmkv.getString("session-model-modes");
  if (modes) {
    try {
      return JSON.parse(modes);
    } catch (e) {
      console.error("Failed to parse session model modes", e);
      return {};
    }
  }
  return {};
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
      console.error("Failed to parse session last viewed timestamps", e);
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
}

export function loadSessionSdkSettings(): Record<string, SessionSdkSettings> {
  const data = mmkv.getString("session-sdk-settings");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse session SDK settings", e);
      return {};
    }
  }
  return {};
}

export function saveSessionSdkSettings(
  settings: Record<string, SessionSdkSettings>,
) {
  mmkv.set("session-sdk-settings", JSON.stringify(settings));
}

export function loadSessionNeedsAttention(): Record<string, boolean> {
  const data = mmkv.getString("session-needs-attention");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse session needs attention", e);
      return {};
    }
  }
  return {};
}

export function saveSessionNeedsAttention(attention: Record<string, boolean>) {
  mmkv.set("session-needs-attention", JSON.stringify(attention));
}

// Model mappings per session (maps UI keys like opus/sonnet to provider model IDs)
export function loadSessionModelMappings(): Record<
  string,
  Record<string, string>
> {
  const data = mmkv.getString("session-model-mappings");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse session model mappings", e);
      return {};
    }
  }
  return {};
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
  const data = mmkv.getString("session-custom-models");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse session custom models", e);
      return {};
    }
  }
  return {};
}

export function saveSessionCustomModels(
  models: Record<string, CustomModelEntry>,
) {
  mmkv.set("session-custom-models", JSON.stringify(models));
}

// Session profile info (profileId + profileName for display in session info)
type SessionProfileEntry = { profileId: string; profileName: string };

export function loadSessionProfiles(): Record<string, SessionProfileEntry> {
  const data = mmkv.getString("session-profiles");
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Failed to parse session profiles", e);
      return {};
    }
  }
  return {};
}

export function saveSessionProfiles(
  profiles: Record<string, SessionProfileEntry>,
) {
  mmkv.set("session-profiles", JSON.stringify(profiles));
}

export function loadProfile(): Profile {
  const profile = mmkv.getString("profile");
  if (profile) {
    try {
      const parsed = JSON.parse(profile);
      return profileParse(parsed);
    } catch (e) {
      console.error("Failed to parse profile", e);
      return { ...profileDefaults };
    }
  }
  return { ...profileDefaults };
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
      console.error("Failed to parse session bookmarks", e);
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

export function clearPersistence() {
  mmkv.clearAll();
  clearAllMessageCaches();
}

// Research preferences per project (dimensions + text fields)
const RESEARCH_PREFS_PREFIX = "research-prefs-";

export interface ResearchPrefs {
  dimensions: Record<string, boolean>;
  knownCompetitors: string;
  additionalNotes: string;
  customRules: string;
}

export function loadResearchPrefs(projectId: string): ResearchPrefs | null {
  const raw = mmkv.getString(`${RESEARCH_PREFS_PREFIX}${projectId}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          dimensions:
            parsed.dimensions && typeof parsed.dimensions === "object"
              ? (parsed.dimensions as Record<string, boolean>)
              : {},
          knownCompetitors:
            typeof parsed.knownCompetitors === "string"
              ? parsed.knownCompetitors
              : "",
          additionalNotes:
            typeof parsed.additionalNotes === "string"
              ? parsed.additionalNotes
              : "",
          customRules:
            typeof parsed.customRules === "string"
              ? parsed.customRules
              : "",
        };
      }
    } catch (e) {
      console.error("Failed to parse research prefs", e);
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
