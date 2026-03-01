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
  // Favorite slash commands
  favoriteCommands: z
    .array(z.string())
    .describe("User-pinned slash commands for quick access"),
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
  favoriteCommands: [],
  toolDetailMode: "simple",
  inputExpandedSessions: {},
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
