import type { Settings } from "./settings";

export function stripManagedAccountProfileSettings(
  settings: Partial<Settings>,
): Partial<Settings> {
  const { profiles: _profiles, ...rest } = settings;
  return rest;
}

export function mergeServerSettingsWithLocalProfiles(
  settings: Settings,
  localProfiles: Settings["profiles"],
): Settings {
  return {
    ...settings,
    profiles: localProfiles,
  };
}
