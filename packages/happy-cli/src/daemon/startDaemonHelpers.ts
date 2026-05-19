import os from "os";

import { configuration } from "@/configuration";
import { MachineMetadata } from "@/api/types";
import { logger } from "@/ui/logger";
import packageJson from "../../package.json";
import { projectPath } from "@/projectPath";
import {
  getProfileEnvironmentVariables,
  readSettings,
  validateProfileForAgent,
} from "@/persistence";

export const SESSION_WEBHOOK_TIMEOUT_MS = Math.max(
  15_000,
  Number.parseInt(process.env.HAPPY_SESSION_WEBHOOK_TIMEOUT_MS ?? "90000", 10) || 90_000,
);

export function shellescape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export const initialMachineMetadata: MachineMetadata = {
  host: os.hostname(),
  platform: os.platform(),
  happyCliVersion: packageJson.version,
  homeDir: os.homedir(),
  happyHomeDir: configuration.happyHomeDir,
  happyLibDir: projectPath(),
};

export async function getProfileEnvironmentVariablesForAgent(
  profileId: string,
  agentType: "claude" | "codex" | "gemini",
): Promise<Record<string, string>> {
  try {
    const settings = await readSettings();
    const profile = settings.profiles.find((p) => p.id === profileId);

    if (!profile) {
      logger.debug(`[DAEMON RUN] Profile ${profileId} not found`);
      return {};
    }

    if (!validateProfileForAgent(profile, agentType)) {
      logger.debug(
        `[DAEMON RUN] Profile ${profileId} not compatible with agent ${agentType}`,
      );
      return {};
    }

    const envVars = getProfileEnvironmentVariables(profile);

    logger.debug(
      `[DAEMON RUN] Loaded ${Object.keys(envVars).length} environment variables from profile ${profileId} for agent ${agentType}`,
    );
    return envVars;
  } catch (error) {
    logger.debug(
      "[DAEMON RUN] Failed to get profile environment variables:",
      error,
    );
    return {};
  }
}
