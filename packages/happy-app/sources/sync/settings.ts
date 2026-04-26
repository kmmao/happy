import * as z from "zod";
import { log } from '@/log';
import {
  AIBackendProfileSchema as SharedAIBackendProfileSchema,
  getProfileEnvironmentVariables as sharedGetProfileEnvironmentVariables,
  validateProfileForAgent as sharedValidateProfileForAgent,
  type AIBackendProfile as SharedAIBackendProfile,
} from "@kmmao/happy-wire";

export const AIBackendProfileSchema = SharedAIBackendProfileSchema;
export type AIBackendProfile = SharedAIBackendProfile;
export const validateProfileForAgent = sharedValidateProfileForAgent;
export const getProfileEnvironmentVariables =
  sharedGetProfileEnvironmentVariables;

// Profile versioning system
export const CURRENT_PROFILE_VERSION = "1.0.0";

// Profile version validation
export function validateProfileVersion(profile: AIBackendProfile): boolean {
  // Simple semver validation for now
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(profile.version);
}

// Profile compatibility check for version upgrades
export function isProfileVersionCompatible(
  profileVersion: string,
  requiredVersion: string = CURRENT_PROFILE_VERSION,
): boolean {
  // For now, all 1.x.x versions are compatible
  const [major] = profileVersion.split(".");
  const [requiredMajor] = requiredVersion.split(".");
  return major === requiredMajor;
}

//
// Settings Schema
//

// Current schema version for backward compatibility
export const SUPPORTED_SCHEMA_VERSION = 2;

export const SettingsSchema = z.object({
  // Schema version for compatibility detection
  schemaVersion: z
    .number()
    .default(SUPPORTED_SCHEMA_VERSION)
    .describe("Settings schema version for compatibility checks"),

  viewInline: z.boolean().describe("Whether to view inline tool calls"),
  inferenceOpenAIKey: z
    .string()
    .nullish()
    .describe("OpenAI API key for inference"),
  expandTodos: z.boolean().describe("Whether to expand todo lists"),
  expandTools: z.boolean().describe("Whether to expand tool call details"),
  showLineNumbers: z
    .boolean()
    .describe("Whether to show line numbers in diffs"),
  showLineNumbersInToolViews: z
    .boolean()
    .describe("Whether to show line numbers in tool view diffs"),
  wrapLinesInDiffs: z
    .boolean()
    .describe("Whether to wrap long lines in diff views"),
  expandDiffsByDefault: z
    .boolean()
    .describe(
      "Whether code diffs in conversations start fully expanded (vs. a 5-line preview)",
    ),
  analyticsOptOut: z
    .boolean()
    .describe("Whether to opt out of anonymous analytics"),
  experiments: z.boolean().describe("Whether to enable experimental features"),
  showAgentActivity: z
    .boolean()
    .describe(
      "Show real-time agent activity details in chat (thinking state, subagent info, tool descriptions)",
    ),
  knowledgeBase: z
    .boolean()
    .describe("Enable project knowledge base (experimental). Controls Tab visibility and CLI kill-switch; per-project mode/sensitivity/track options live on Project.knowledgeConfig."),
  enablePreviewTab: z
    .boolean()
    .describe("Enable preview tab in session side panel (experimental)"),
  useEnhancedSessionWizard: z
    .boolean()
    .describe("A/B test flag: Use enhanced profile-based session wizard UI"),

  alwaysShowContextSize: z
    .boolean()
    .describe("Always show context size in agent input"),
  agentInputEnterToSend: z
    .boolean()
    .describe("Whether pressing Enter submits/sends in the agent input (web)"),
  avatarStyle: z.string().describe("Avatar display style"),
  showFlavorIcons: z
    .boolean()
    .describe("Whether to show AI provider icons in avatars"),
  compactSessionView: z
    .boolean()
    .describe("Whether to use compact view for active sessions"),
  collapsibleInput: z
    .boolean()
    .describe(
      "Whether to enable collapsible input box in sessions (auto-collapse when messages exist)",
    ),
  expandThinkingByDefault: z
    .boolean()
    .describe("Whether thinking blocks should start expanded by default"),
  hideInactiveSessions: z
    .boolean()
    .describe("Hide inactive sessions in the main list"),
  realtimeSessionSort: z
    .boolean()
    .describe(
      "Sort sessions by last activity in real-time (when off, sessions use stable creation order)",
    ),
  reviewPromptAnswered: z
    .boolean()
    .describe("Whether the review prompt has been answered"),
  reviewPromptLikedApp: z
    .boolean()
    .nullish()
    .describe("Whether user liked the app when asked"),
  voiceAssistantLanguage: z
    .string()
    .nullable()
    .describe("Preferred language for voice assistant (null for auto-detect)"),
  voiceInputLanguage: z
    .string()
    .nullable()
    .describe(
      "Language for STT voice input (null = auto from device locale, e.g. 'en-US', 'zh-CN', 'zh-TW')",
    ),
  ttsProvider: z
    .enum(["edge", "elevenlabs", "voicebox", "browser-web-speech"])
    .describe(
      "TTS provider: 'edge' (free, default), 'elevenlabs' (paid, user's own API key), 'voicebox' (local Voicebox service), or 'browser-web-speech' (zero-cost browser Web Speech API)",
    ),
  voiceboxEndpoint: z
    .string()
    .nullable()
    .describe(
      "Voicebox local TTS service endpoint URL (null uses default http://localhost:17493)",
    ),
  elevenLabsApiKey: z
    .string()
    .nullable()
    .describe("User's own ElevenLabs API key for paid TTS"),
  elevenLabsVoiceId: z
    .string()
    .regex(/^[a-zA-Z0-9]{10,30}$/)
    .nullable()
    .describe("ElevenLabs voice ID (null for default 'Rachel')"),
  preferredLanguage: z
    .string()
    .nullable()
    .describe(
      "Preferred UI language (null for auto-detect from device locale)",
    ),
  recentMachinePaths: z
    .array(
      z.object({
        machineId: z.string(),
        path: z.string(),
      }),
    )
    .describe(
      "Last 10 machine-path combinations, ordered by most recent first",
    ),
  recentRemoteRepos: z
    .array(
      z.object({
        host: z.string(),
        repoUrl: z.string(),
        fullName: z.string(),
      }),
    )
    .describe(
      "Last selected remote repositories, ordered by most recent first",
    ),
  lastUsedGitHost: z
    .string()
    .nullable()
    .describe("Last selected Git host for remote repo cloning"),
  lastUsedAgent: z
    .string()
    .nullable()
    .describe("Last selected agent type for new sessions"),
  lastUsedPermissionMode: z
    .string()
    .nullable()
    .describe("Last selected permission mode for new sessions"),
  lastUsedModelMode: z
    .string()
    .nullable()
    .describe("Last selected model mode for new sessions"),
  lastUsedThinkingMode: z
    .string()
    .nullable()
    .describe("Last selected thinking mode for new sessions"),
  lastUsedEffortLevel: z
    .string()
    .nullable()
    .describe("Last selected effort level for new sessions"),
  // Profile management settings
  profiles: z
    .array(AIBackendProfileSchema)
    .describe("User-defined profiles for AI backend and environment variables"),
  lastUsedProfile: z
    .string()
    .nullable()
    .describe("Last selected profile for new sessions"),
  // Favorite directories for quick path selection
  favoriteDirectories: z
    .array(z.string())
    .describe(
      "User-defined favorite directories for quick access in path selection",
    ),
  // Favorite machines for quick machine selection
  favoriteMachines: z
    .array(z.string())
    .describe(
      "User-defined favorite machines (machine IDs) for quick access in machine selection",
    ),
  // Favorite shell commands for quick access in quick commands panel
  favoriteCommands: z
    .array(z.string())
    .describe("User-defined favorite shell commands for quick access"),
  // Favorite slash commands for quick access in command list popover
  favoriteSlashCommands: z
    .array(z.string())
    .describe("User-defined favorite slash commands for quick access"),
  // Claude Code plugins configuration
  plugins: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        enabled: z.boolean(),
        source: z.enum(["manual", "discovered"]),
        // Cached metadata (optional, populated on discover/inspect)
        version: z.string().optional(),
        description: z.string().optional(),
        author: z.string().optional(),
        homepage: z.string().optional(),
        counts: z
          .object({
            commands: z.number(),
            skills: z.number(),
            agents: z.number(),
          })
          .optional(),
      }),
    )
    .describe("Claude Code plugins — managed locally on each machine"),
  // Dismissed CLI warning banners (supports both per-machine and global dismissal)
  showProjectTab: z
    .boolean()
    .describe("Whether to show the project (kanban) tab in the tab bar"),
  // Git host → provider mappings (user-configured overrides for host detection)
  gitHosts: z
    .array(
      z.object({
        host: z.string(),
        provider: z.enum(["github", "gitea"]),
        apiToken: z.string().optional(),
        autoIssueEnabled: z.boolean().optional(),
        autoIssueLabel: z.string().optional(),
        autoIssueAllowedAuthors: z.array(z.string()).optional(),
        webhookRepos: z
          .array(
            z.object({
              repoUrl: z.string(),
              machineId: z.string(),
              repoPath: z.string(),
              secret: z.string(),
              routeId: z.string().optional(),
              enabled: z.boolean(),
            }),
          )
          .optional(),
        // Legacy single-webhook fields (auto-migrated to webhookRepos)
        webhookEnabled: z.boolean().optional(),
        webhookSecret: z.string().optional(),
        webhookMachineId: z.string().optional(),
        webhookRepoPath: z.string().optional(),
        webhookRepoUrl: z.string().optional(),
        webhookRouteId: z.string().optional(),
      }),
    )
    .transform((hosts) =>
      hosts.map((h) => {
        // Migrate legacy single-value webhook fields → webhookRepos array
        if (h.webhookRepoUrl && !h.webhookRepos?.length) {
          const {
            webhookEnabled,
            webhookSecret,
            webhookMachineId,
            webhookRepoPath,
            webhookRepoUrl,
            webhookRouteId,
            ...rest
          } = h;
          return {
            ...rest,
            webhookRepos: [
              {
                repoUrl: webhookRepoUrl,
                machineId: webhookMachineId ?? "",
                repoPath: webhookRepoPath ?? "",
                secret: webhookSecret ?? "",
                routeId: webhookRouteId,
                enabled: webhookEnabled ?? false,
              },
            ],
          };
        }
        // Strip legacy fields if already migrated
        const {
          webhookEnabled: _a,
          webhookSecret: _b,
          webhookMachineId: _c,
          webhookRepoPath: _d,
          webhookRepoUrl: _e,
          webhookRouteId: _f,
          ...rest
        } = h;
        return rest;
      }),
    )
    .describe(
      "Custom Git host provider mappings (e.g. GitHub Enterprise → github, self-hosted Gitea → gitea)",
    ),
  // Auto issue session: configured per-host in gitHosts array
  dismissedCLIWarnings: z
    .object({
      perMachine: z
        .record(
          z.string(),
          z.object({
            claude: z.boolean().optional(),
            codex: z.boolean().optional(),
            gemini: z.boolean().optional(),
          }),
        )
        .default({}),
      global: z
        .object({
          claude: z.boolean().optional(),
          codex: z.boolean().optional(),
          gemini: z.boolean().optional(),
        })
        .default({}),
    })
    .default({ perMachine: {}, global: {} })
    .describe(
      "Tracks which CLI installation warnings user has dismissed (per-machine or globally)",
    ),
  webNotifications: z
    .boolean()
    .describe(
      "Enable browser notifications for task completion and permission requests (web only)",
    ),
  webNotificationsPersistent: z
    .boolean()
    .describe(
      "Keep browser notifications visible until manually dismissed (web only)",
    ),
});

//
// NOTE: Settings must be a flat object with no to minimal nesting, one field == one setting,
// you can name them with a prefix if you want to group them, but don't nest them.
// You can nest if value is a single value (like image with url and width and height)
// Settings are always merged with defaults and field by field.
//
// This structure must be forward and backward compatible. Meaning that some versions of the app
// could be missing some fields or have a new fields. Everything must be preserved and client must
// only touch the fields it knows about.
//

const SettingsSchemaPartial = SettingsSchema.partial();

export type Settings = z.infer<typeof SettingsSchema>;

//
// Defaults
//

export const settingsDefaults: Settings = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  viewInline: false,
  inferenceOpenAIKey: null,
  expandTodos: true,
  expandTools: false,
  showLineNumbers: true,
  showLineNumbersInToolViews: false,
  wrapLinesInDiffs: false,
  expandDiffsByDefault: true,
  analyticsOptOut: false,
  experiments: false,
  showAgentActivity: true,
  knowledgeBase: false,
  enablePreviewTab: false,
  useEnhancedSessionWizard: false,
  alwaysShowContextSize: true,
  agentInputEnterToSend: true,
  avatarStyle: "brutalist",
  showFlavorIcons: false,
  compactSessionView: false,
  collapsibleInput: false,
  expandThinkingByDefault: false,
  hideInactiveSessions: false,
  realtimeSessionSort: true,
  reviewPromptAnswered: false,
  reviewPromptLikedApp: null,
  voiceAssistantLanguage: null,
  voiceInputLanguage: null,
  ttsProvider: "edge",
  voiceboxEndpoint: null,
  elevenLabsApiKey: null,
  elevenLabsVoiceId: null,
  preferredLanguage: null,
  recentMachinePaths: [],
  recentRemoteRepos: [],
  lastUsedGitHost: null,
  lastUsedAgent: null,
  lastUsedPermissionMode: null,
  lastUsedModelMode: null,
  lastUsedThinkingMode: null,
  lastUsedEffortLevel: null,
  // Profile management defaults
  profiles: [],
  lastUsedProfile: null,
  // Default favorite directories (real common directories on Unix-like systems)
  favoriteDirectories: ["~/src", "~/Desktop", "~/Documents"],
  // Favorite machines (empty by default)
  favoriteMachines: [],
  // Favorite commands (empty by default)
  favoriteCommands: [],
  // Favorite slash commands (empty by default)
  favoriteSlashCommands: [],
  // Plugins (empty by default, populated via discovery or manual add)
  plugins: [],
  // Git host provider mappings (empty by default, uses built-in detection as fallback)
  gitHosts: [],
  // Project tab visibility (hidden by default)
  showProjectTab: false,
  // Dismissed CLI warnings (empty by default)
  dismissedCLIWarnings: { perMachine: {}, global: {} },
  // Browser notifications (web only, off by default)
  webNotifications: false,
  webNotificationsPersistent: false,
};
Object.freeze(settingsDefaults);

//
// Resolving
//

export function settingsParse(settings: unknown): Settings {
  // Handle null/undefined/invalid inputs
  if (!settings || typeof settings !== "object") {
    return { ...settingsDefaults };
  }

  const parsed = SettingsSchemaPartial.safeParse(settings);
  if (!parsed.success) {
    // For invalid settings, preserve unknown fields but use defaults for known fields
    const unknownFields = { ...(settings as any) };
    // Remove all known schema fields from unknownFields
    const knownFields = Object.keys(SettingsSchema.shape);
    knownFields.forEach((key) => delete unknownFields[key]);
    return { ...settingsDefaults, ...unknownFields };
  }

  // Migration: Convert old 'zh' language code to 'zh-Hans'
  if (parsed.data.preferredLanguage === "zh") {
    log.log(
      '[Settings Migration] Converting language code from "zh" to "zh-Hans"',
    );
    parsed.data.preferredLanguage = "zh-Hans";
  }

  // Migration: Convert legacy single-webhook fields to webhookRepos array
  if (parsed.data.gitHosts) {
    parsed.data.gitHosts = parsed.data.gitHosts.map((host: any) => {
      if (host.webhookRepoUrl && !host.webhookRepos) {
        const {
          webhookEnabled,
          webhookSecret,
          webhookMachineId,
          webhookRepoPath,
          webhookRepoUrl,
          webhookRouteId,
          ...rest
        } = host;
        return {
          ...rest,
          webhookRepos: [
            {
              repoUrl: webhookRepoUrl,
              machineId: webhookMachineId ?? "",
              repoPath: webhookRepoPath ?? "",
              secret: webhookSecret ?? "",
              routeId: webhookRouteId,
              enabled: webhookEnabled ?? false,
            },
          ],
        };
      }
      return host;
    });
  }

  // Merge defaults, parsed settings, and preserve unknown fields
  const unknownFields = { ...(settings as any) };
  // Remove known fields from unknownFields to preserve only the unknown ones
  Object.keys(parsed.data).forEach((key) => delete unknownFields[key]);

  return { ...settingsDefaults, ...parsed.data, ...unknownFields };
}

//
// Applying changes
// NOTE: May be something more sophisticated here around defaults and merging, but for now this is fine.
//

export function applySettings(
  settings: Settings,
  delta: Partial<Settings>,
): Settings {
  // Original behavior: start with settings, apply delta, fill in missing with defaults
  const result = { ...settings, ...delta };

  // Fill in any missing fields with defaults
  Object.keys(settingsDefaults).forEach((key) => {
    if (!(key in result)) {
      (result as any)[key] = (settingsDefaults as any)[key];
    }
  });

  return result;
}
