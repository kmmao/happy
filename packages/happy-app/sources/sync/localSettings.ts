import * as z from "zod";

//
// Schema
//

export const LocalSettingsSchema = z.object({
  // Developer settings (device-specific)
  debugMode: z.boolean().describe("Enable debug logging"),
  devModeEnabled: z.boolean().describe("Enable developer menu in settings"),
  commandPaletteEnabled: z
    .boolean()
    .describe("Enable CMD+K command palette (web only)"),
  themePreference: z
    .enum(["light", "dark", "adaptive"])
    .describe("Theme preference: light, dark, or adaptive (follows system)"),
  markdownCopyV2: z
    .boolean()
    .describe(
      "Replace native paragraph selection with long-press modal for full markdown copy",
    ),
  // CLI version acknowledgments - keyed by machineId
  acknowledgedCliVersions: z
    .record(z.string(), z.string())
    .describe("Acknowledged CLI versions per machine"),
  // Tool detail view mode
  toolDetailMode: z
    .enum(["simple", "developer"])
    .describe(
      "Tool detail view mode: simple (human-readable) or developer (raw JSON)",
    ),
  // Sessions where the user has manually expanded the input
  inputExpandedSessions: z
    .record(z.string(), z.boolean())
    .describe("Sessions with manually expanded input, keyed by session ID"),
  // Side panel collapsed state (tablet+ widescreen)
  sidePanelCollapsed: z
    .boolean()
    .describe("Whether the session side panel is collapsed"),
  // Side panel width in pixels (tablet+ widescreen, user-resizable)
  sidePanelWidth: z
    .number()
    .describe("Width of the session side panel in pixels"),
  // Favorited entries in the Files browser, keyed by basePath
  fileFavorites: z
    .record(
      z.string(),
      z.array(z.object({ path: z.string(), type: z.enum(["file", "directory"]) })),
    )
    .describe("Favorited file/directory entries per project, keyed by basePath"),
  // Sessions with auto-option-send enabled
  autoOptionSendSessions: z
    .record(z.string(), z.boolean())
    .describe("Sessions with auto-option-send enabled, keyed by session ID"),
  // Scoring model override per provider for option recommendation
  scoringModelOverride: z
    .record(z.string(), z.string())
    .describe("Scoring model override per provider (e.g. anthropic → claude-haiku-4-5-20251001)"),
  // Third-party integration visibility toggles (default off)
  openClawEnabled: z.boolean().describe("Show OpenClaw integration in settings and tab bar"),
  sub2ApiEnabled: z.boolean().describe("Show Sub2API usage monitor in settings"),
  // App lock (PIN / biometric) — privacy deterrent gate, device-local only.
  // The PIN itself is NOT stored here; only a salted hash lives in expo-secure-store.
  appLockEnabled: z
    .boolean()
    .describe("Require a PIN/biometric to open the app on this device"),
  appLockTimeout: z
    .enum(["immediate", "30s", "1m", "5m", "never"])
    .describe(
      "How long the app can be backgrounded before it re-locks. 'never' = background never auto-locks, but a cold start still locks.",
    ),
  appLockBiometricEnabled: z
    .boolean()
    .describe("Allow Face ID / Touch ID / fingerprint to unlock instead of the PIN"),
  // Sessions list — collapse the automation header per machine
  sessionsAutomationCollapsed: z
    .boolean()
    .describe(
      "Whether the per-machine automation header on the sessions list is collapsed",
    ),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
  debugMode: false,
  devModeEnabled: false,
  commandPaletteEnabled: false,
  themePreference: "adaptive",
  markdownCopyV2: false,
  acknowledgedCliVersions: {},
  toolDetailMode: "simple",
  inputExpandedSessions: {},
  sidePanelCollapsed: false,
  sidePanelWidth: 400,
  fileFavorites: {},
  autoOptionSendSessions: {},
  scoringModelOverride: {},
  openClawEnabled: false,
  sub2ApiEnabled: false,
  appLockEnabled: false,
  appLockTimeout: "immediate",
  appLockBiometricEnabled: false,
  sessionsAutomationCollapsed: false,
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
  const parsed = LocalSettingsSchemaPartial.safeParse(settings);
  if (!parsed.success) {
    return { ...localSettingsDefaults };
  }
  return { ...localSettingsDefaults, ...parsed.data };
}

//
// Applying changes
//

export function applyLocalSettings(
  settings: LocalSettings,
  delta: Partial<LocalSettings>,
): LocalSettings {
  return { ...localSettingsDefaults, ...settings, ...delta };
}
