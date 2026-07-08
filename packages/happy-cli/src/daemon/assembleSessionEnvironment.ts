import { randomUUID } from "node:crypto";
import { logger } from "@/ui/logger";
import { readSettings } from "@/persistence";
import { expandEnvironmentVariables } from "@/utils/expandEnvVars";
import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";
import type { SpawnSessionOptions } from "@/modules/common/registerCommonHandlers";
import {
  filterGuiEnvironmentVariables,
  isTrustedProfileEnvironment,
} from "./profileEnvironmentTrust";
import { OPERATOR_ONLY_ENV_VARS } from "./operatorOnlyEnvironment";
import {
  getFilteredDaemonEnvironment,
  resolveStartupScriptEnvironment,
} from "./startupScriptEnvironment";
import {
  getExplicitProfileFallbackError,
  shouldIsolateProfileFromDaemonDefaults,
} from "./profileRuntimeGuard";
import { getProfileEnvironmentVariablesForAgent } from "./startDaemonHelpers";

export interface AssembleSessionEnvironmentInput {
  options: SpawnSessionOptions;
  /** Already normalized via normalizeResolvedRuntimeProfile. */
  runtimeProfile: ResolvedRuntimeProfile | undefined;
  directory: string;
  happySessionId: string | undefined;
  daemonControlPort: number;
  automationContext: SpawnSessionOptions["automationContext"];
  /**
   * Layer-1 authentication env (CLAUDE_CODE_OAUTH_TOKEN or CODEX_HOME overlay),
   * resolved by the caller so it retains ownership of any cleanup resources.
   * These keys take precedence over profile/startup values.
   */
  authEnv: Record<string, string>;
}

export type AssembleSessionEnvironmentResult =
  | { type: "error"; errorMessage: string }
  | {
      type: "ok";
      /** Full environment handed to the spawned child process. */
      finalSessionEnv: Record<string, string>;
      /** Profile + startup + auth layer only (used for tmux args / TMUX_SESSION_NAME). */
      sessionScopedEnv: Record<string, string>;
      /** Daemon-generated pre-registry spawn id, injected as HAPPY_SPAWN_ID. */
      spawnId: string;
    };

/**
 * Resolve the environment a spawned session runs with, applying the explicit
 * precedence layers that used to live inline in `startDaemon`'s spawnSession:
 *
 *  Layer 2  — profile env: GUI-provided profile > CLI local active profile,
 *             with trust-gated operator-only stripping and profile-API loading.
 *  Layer 3  — startup bash script diff, merged over the profile+auth base.
 *  Layer 4  — daemon-fallback merge (filtered for server secrets / operator-only),
 *             ${VAR} expansion, and the injected HAPPY_* control vars.
 *  Layer 5  — fail-fast validation that auth vars contain no unexpanded refs.
 *
 * Authentication (Layer 1) is resolved by the caller and passed in as `authEnv`
 * so the caller keeps ownership of any cleanup resource (e.g. the Codex home
 * overlay). Returns a discriminated result; the three error paths mirror the
 * original early returns. The interface is the test surface — callers assert on
 * `finalSessionEnv` / `errorMessage` without driving a real spawn.
 */
export async function assembleSessionEnvironment(
  input: AssembleSessionEnvironmentInput,
): Promise<AssembleSessionEnvironmentResult> {
  const {
    options,
    runtimeProfile,
    directory,
    happySessionId,
    daemonControlPort,
    automationContext,
    authEnv,
  } = input;

  // Layer 2: Profile environment variables
  // Priority: GUI-provided profile > CLI local active profile > none
  // IMPORTANT: Distinguish between undefined (no profile selected) and {} (profile selected but empty)
  // When GUI explicitly provides environmentVariables (even empty {}), NEVER fallback to CLI local profile
  let profileEnv: Record<string, string> = {};
  const guiProfileProvided =
    runtimeProfile !== undefined ||
    options.environmentVariables !== undefined;

  // ── Trust check: Does the GUI provide a profileId? ──
  // If profileId is present, the request came from the App's profile system
  // (built-in or user-configured). The RPC channel is E2E encrypted, so only
  // authorized App users can send requests. Trust the profile and allow
  // operator-only env vars (ANTHROPIC_BASE_URL, etc.) to pass through.
  // Supervisor-triggered runs also qualify here because the server already
  // resolved the selected profile into env vars before asking the daemon to spawn.
  // Without either trust signal, ad-hoc env vars are still filtered for safety.
  const profileTrusted = isTrustedProfileEnvironment(options);
  if (profileTrusted) {
    logger.info(
      runtimeProfile?.profileId || options.profileId
        ? `[DAEMON RUN] Profile ${runtimeProfile?.profileId ?? options.profileId} provided — trusted runtime profile, operator-only env vars allowed`
        : `[DAEMON RUN] Trusted runtime profile env provided — operator-only env vars allowed`,
    );
  }

  // Layer 2a: Load profile API env vars from local settings when profileId is provided
  // This handles supervisor triggers where profileId is set but environmentVariables
  // only contains operational vars (HAPPY_INITIAL_PROMPT_FILE etc.), not API config.
  const runtimeProfileEnvCount = Object.keys(
    runtimeProfile?.environmentVariables ?? {},
  ).length;
  if (options.profileId && runtimeProfileEnvCount === 0) {
    try {
      const profileVars = await getProfileEnvironmentVariablesForAgent(
        options.profileId,
        options.agent || "claude",
      );
      const profileVarCount = Object.keys(profileVars).length;
      if (profileVarCount > 0) {
        profileEnv = profileVars;
        logger.info(
          `[DAEMON RUN] Loaded ${profileVarCount} env vars from profile ${options.profileId} (keys: ${Object.keys(profileVars).join(", ")})`,
        );
      } else {
        logger.debug(
          `[DAEMON RUN] Profile ${options.profileId} has no env vars (built-in or empty)`,
        );
      }
    } catch (error) {
      logger.debug(
        `[DAEMON RUN] Failed to load profile ${options.profileId} env vars:`,
        error,
      );
    }
  }

  if (guiProfileProvided) {
    // GUI explicitly provided environment variables (may be profile API vars or operational vars)
    // Security: Only strip operator-only keys when the daemon operator has already
    // set them in process.env AND the profile is NOT trusted (not in local settings).
    // Trusted profiles (configured by operator) are allowed to override operator-only vars.
    const raw = {
      ...(runtimeProfile?.environmentVariables ?? {}),
      ...(options.environmentVariables ?? {}),
    };
    const { environmentVariables: guiVars, stripped } =
      filterGuiEnvironmentVariables(raw, options);
    if (stripped.length > 0) {
      logger.warn(
        `[DAEMON RUN] Security: Stripped ${stripped.length} operator-only env vars from GUI profile (daemon already has them, profile untrusted): ${stripped.join(", ")}`,
      );
    }
    // Merge: profile API vars first, then GUI-provided vars on top (GUI overrides)
    profileEnv = { ...profileEnv, ...guiVars };
    const varCount = Object.keys(profileEnv).length;
    logger.info(
      `[DAEMON RUN] Using merged profile environment variables (${varCount} vars)`,
    );
    logger.debug(
      `[DAEMON RUN] Merged env var keys: ${Object.keys(profileEnv).join(", ") || "(none)"}`,
    );
  } else {
    // No GUI profile provided — fallback to CLI local active profile
    try {
      const settings = await readSettings();
      if (settings.activeProfileId) {
        logger.debug(
          `[DAEMON RUN] No GUI profile provided, loading CLI local active profile: ${settings.activeProfileId}`,
        );

        // Get profile environment variables filtered for agent compatibility
        profileEnv = await getProfileEnvironmentVariablesForAgent(
          settings.activeProfileId,
          options.agent || "claude",
        );

        logger.debug(
          `[DAEMON RUN] Loaded ${Object.keys(profileEnv).length} environment variables from CLI local profile for agent ${options.agent || "claude"}`,
        );
        logger.debug(
          `[DAEMON RUN] CLI profile env var keys: ${Object.keys(profileEnv).join(", ")}`,
        );
      } else {
        logger.debug("[DAEMON RUN] No CLI local active profile set");
      }
    } catch (error) {
      logger.debug(
        "[DAEMON RUN] Failed to load CLI local profile environment variables:",
        error,
      );
      // Continue without profile env vars - this is not a fatal error
    }
  }

  const startupBashScript = runtimeProfile?.startupBashScript?.trim();
  const explicitProfileFallbackError = getExplicitProfileFallbackError({
    profileId: options.profileId,
    runtimeProfile,
    resolvedProfileEnv: profileEnv,
    startupBashScript,
  });
  if (explicitProfileFallbackError) {
    logger.warn(`[DAEMON RUN] ${explicitProfileFallbackError}`);
    return { type: "error", errorMessage: explicitProfileFallbackError };
  }

  // Final merge: Profile vars first, then auth (auth takes precedence to protect authentication)
  let extraEnv = { ...profileEnv, ...authEnv };

  // If spawning Claude and profile did not set ANTHROPIC_MODEL, inherit from daemon's env
  // ONLY when no GUI profile was explicitly provided (to avoid overriding profile's model choice)
  // (e.g. daemon started via dev:local-server with .env.dev-local-server)
  if (
    !guiProfileProvided &&
    (options.agent === "claude" || !options.agent) &&
    !extraEnv.ANTHROPIC_MODEL &&
    process.env.ANTHROPIC_MODEL
  ) {
    extraEnv.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
    logger.debug(
      `[DAEMON RUN] Using ANTHROPIC_MODEL from daemon env: ${extraEnv.ANTHROPIC_MODEL}`,
    );
  }

  logger.debug(
    `[DAEMON RUN] Final environment variable keys (before expansion) (${Object.keys(extraEnv).length}): ${Object.keys(extraEnv).join(", ")}`,
  );

  // Expand ${VAR} references from daemon's process.env
  // This ensures variable substitution works in both tmux and non-tmux modes
  // Example: ANTHROPIC_AUTH_TOKEN="${Z_AI_AUTH_TOKEN}" → ANTHROPIC_AUTH_TOKEN="sk-real-key"
  extraEnv = expandEnvironmentVariables(extraEnv, process.env);
  logger.debug(
    `[DAEMON RUN] After variable expansion: ${Object.keys(extraEnv).join(", ")}`,
  );

  const filteredDaemonEnv = getFilteredDaemonEnvironment(process.env, {
    excludeOperatorOnlyVars: shouldIsolateProfileFromDaemonDefaults({
      profileId: options.profileId,
      runtimeProfile,
    }),
  });
  let sessionScopedEnv = { ...extraEnv };
  if (startupBashScript) {
    try {
      const startupScriptEnv = await resolveStartupScriptEnvironment({
        cwd: directory,
        startupBashScript,
        baseEnv: {
          ...filteredDaemonEnv,
          ...sessionScopedEnv,
        },
      });
      sessionScopedEnv = {
        ...sessionScopedEnv,
        ...startupScriptEnv,
        ...authEnv,
      };
      logger.info(
        `[DAEMON RUN] Applied startup bash script from runtime profile${runtimeProfile?.profileId ? ` ${runtimeProfile.profileId}` : ""}`,
      );
      if (Object.keys(startupScriptEnv).length > 0) {
        logger.debug(
          `[DAEMON RUN] Startup script updated env vars: ${Object.keys(startupScriptEnv).join(", ")}`,
        );
      }
    } catch (error) {
      const errorMessage = `Startup bash script failed: ${error instanceof Error ? error.message : String(error)}`;
      logger.warn(`[DAEMON RUN] ${errorMessage}`);
      return { type: "error", errorMessage };
    }
  }

  // Daemon-generated spawn id — pre-registry key that's stable before the
  // child posts /session-started with its server-assigned happySessionId.
  // Injected as HAPPY_SPAWN_ID env var so any of the 4 runners can read
  // it uniformly without touching CLI arg parsing.
  const spawnId: string = randomUUID();
  const finalSessionEnv: Record<string, string> = {
    ...filteredDaemonEnv,
    ...sessionScopedEnv,
    HAPPY_SPAWN_ID: spawnId,
    ...(happySessionId ? { HAPPY_SESSION_ID: happySessionId } : {}),
    ...(daemonControlPort > 0
      ? {
          HAPPY_INTER_AGENT_URL: `http://127.0.0.1:${daemonControlPort}/inter-agent-message`,
          // Base URL for daemon control HTTP — children build other
          // endpoints (e.g. /claude-pty/attach) by appending paths.
          HAPPY_DAEMON_CONTROL_URL: `http://127.0.0.1:${daemonControlPort}`,
        }
      : {}),
    // Surface the full automationContext to the child happy process
    // as a single JSON env var so createSessionMetadata can stamp it
    // on Metadata. This is what lets the Workflow IA in happy-app
    // group these Sessions under their owning Loop / Schedule /
    // Webhook (otherwise every loop iteration shows up as an
    // unattached Ad-hoc row).
    ...(automationContext
      ? { HAPPY_AUTOMATION_CONTEXT_JSON: JSON.stringify(automationContext) }
      : {}),
  };

  // ── Env composition summary — one-line audit of what the spawn
  // actually sees, grouped by source. Lets operators answer "why does
  // ANTHROPIC_BASE_URL leak into my session?" without grepping for
  // each `[DAEMON RUN] Loaded N env vars from profile ...` line. The
  // operator-only callout below names the specific OPERATOR_ONLY_ENV_VARS
  // keys that survived into the spawn, and which side (profile vs
  // daemon shell) seeded them.
  const operatorOnlyInFinal = Object.keys(finalSessionEnv)
    .filter((k) => OPERATOR_ONLY_ENV_VARS.has(k))
    .sort();
  const isolationActive = shouldIsolateProfileFromDaemonDefaults({
    profileId: options.profileId,
    runtimeProfile,
  });
  logger.info(
    `[DAEMON RUN] Env composition for spawn: ` +
      `profile=${Object.keys(profileEnv).length}, ` +
      `auth=${Object.keys(authEnv).length}, ` +
      `daemonFallback=${Object.keys(filteredDaemonEnv).length}, ` +
      `total=${Object.keys(finalSessionEnv).length}` +
      (startupBashScript ? " (+ startup script — see line above)" : ""),
  );
  if (operatorOnlyInFinal.length > 0) {
    logger.info(
      `[DAEMON RUN] Operator-only env vars present in spawn: ${operatorOnlyInFinal.join(", ")}` +
        (isolationActive
          ? " (profile-provided; daemon shell isolated)"
          : " (from daemon shell — attach a profileId to isolate)"),
    );
  }

  // Fail-fast validation: Check that any auth variables present are fully expanded
  // Only validate variables that are actually set (different agents need different auth)
  const potentialAuthVars = [
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_HOME",
    "AZURE_OPENAI_API_KEY",
    "TOGETHER_API_KEY",
  ];
  const unexpandedAuthVars = potentialAuthVars.filter((varName) => {
    const value = finalSessionEnv[varName];
    // Only fail if variable IS SET and contains unexpanded ${VAR} references
    return value && typeof value === "string" && value.includes("${");
  });

  if (unexpandedAuthVars.length > 0) {
    // Extract the specific missing variable names from unexpanded references
    const missingVarDetails = unexpandedAuthVars.map((authVar) => {
      const value = finalSessionEnv[authVar];
      const unresolvedMatch = value?.match(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/);
      const missingVar = unresolvedMatch ? unresolvedMatch[1] : "unknown";
      return `${authVar} references \${${missingVar}} which is not defined`;
    });

    const errorMessage =
      `Authentication will fail - environment variables not found in daemon: ${missingVarDetails.join("; ")}. ` +
      `Ensure these variables are set in the daemon's environment (not just your shell) before starting sessions.`;
    logger.warn(`[DAEMON RUN] ${errorMessage}`);
    return { type: "error", errorMessage };
  }

  return { type: "ok", finalSessionEnv, sessionScopedEnv, spawnId };
}
