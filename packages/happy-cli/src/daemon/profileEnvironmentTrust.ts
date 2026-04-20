import type { SpawnSessionOptions } from "@/modules/common/registerCommonHandlers";
import {
  isTrustedRuntimeProfile,
  normalizeResolvedRuntimeProfile,
} from "@kmmao/happy-wire";
import { OPERATOR_ONLY_ENV_VARS } from "./operatorOnlyEnvironment";

type ProfileTrustInput = Pick<
  SpawnSessionOptions,
  "profileId" | "automationContext" | "runtimeProfile"
>;

export function isTrustedProfileEnvironment(input: ProfileTrustInput): boolean {
  if (input.runtimeProfile) {
    return isTrustedRuntimeProfile(
      normalizeResolvedRuntimeProfile(input.runtimeProfile),
    );
  }
  if (input.profileId) return true;
  return input.automationContext?.kind === "supervisor";
}

export function filterGuiEnvironmentVariables(
  rawEnvironmentVariables: Record<string, string | undefined>,
  input: ProfileTrustInput,
  daemonEnvironment: NodeJS.ProcessEnv = process.env,
): {
  environmentVariables: Record<string, string>;
  stripped: string[];
  trusted: boolean;
} {
  const trusted = isTrustedProfileEnvironment(input);
  const stripped: string[] = [];
  const environmentVariables = Object.fromEntries(
    Object.entries(rawEnvironmentVariables).filter(
      (entry): entry is [string, string] => {
        if (entry[1] === undefined) return false;
        if (
          !trusted &&
          OPERATOR_ONLY_ENV_VARS.has(entry[0]) &&
          daemonEnvironment[entry[0]]
        ) {
          stripped.push(entry[0]);
          return false;
        }
        return true;
      },
    ),
  );

  return {
    environmentVariables,
    stripped,
    trusted,
  };
}
