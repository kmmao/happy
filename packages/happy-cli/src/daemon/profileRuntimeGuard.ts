import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";

export function shouldIsolateProfileFromDaemonDefaults(options: {
  profileId?: string;
  runtimeProfile?: ResolvedRuntimeProfile;
}): boolean {
  if (!options.profileId) {
    return false;
  }

  return options.runtimeProfile?.source !== "built-in-profile";
}

export function getExplicitProfileFallbackError(options: {
  profileId?: string;
  runtimeProfile?: ResolvedRuntimeProfile;
  resolvedProfileEnv: Record<string, string>;
  startupBashScript?: string;
}): string | null {
  if (!shouldIsolateProfileFromDaemonDefaults(options)) {
    return null;
  }

  if (Object.keys(options.resolvedProfileEnv).length > 0) {
    return null;
  }

  if (options.startupBashScript?.trim()) {
    return null;
  }

  return `Profile "${options.profileId}" is selected but provides no runtime environment on this machine. Refusing to fall back to daemon defaults. Please refresh account profiles or reselect the profile in Supervisor settings.`;
}
