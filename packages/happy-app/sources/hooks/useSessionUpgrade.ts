import { runWithSessionResumeGuard } from "@/sync/sessionResumeGuard";
import { useCallback } from "react";
import { Session, Machine } from "@/sync/storageTypes";
import { sessionKill, machineSpawnNewSession } from "@/sync/ops";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { Modal } from "@/modal";
import { t } from "@/text";
import { storage } from "@/sync/storage";
import { buildSessionRespawnProfile } from "./sessionUpgradeProfile";
import { resolveSessionUpgradeContext } from "./sessionUpgradeSupport";

/**
 * Hook for upgrading an active session to the latest CLI version.
 * Compares session.metadata.version against the daemon's startedWithCliVersion.
 * When needsUpgrade is true, handleUpgrade will kill the old process and resume
 * with the new CLI version, preserving the session context when the backend
 * exposes a resumable session handle (Claude session id or Codex thread id).
 */
export function useSessionUpgrade(
    session: Session,
    machine: Machine | null | undefined,
) {
    const upgradeContext = resolveSessionUpgradeContext(session, machine);
    const machineCliVersion = upgradeContext?.machineCliVersion;
    const needsUpgrade = upgradeContext !== null;

    const [upgrading, performUpgrade] = useHappyAction(async () => {
        if (!upgradeContext) {
            throw new HappyError(
                t("sessionInfo.failedToUpgradeSession"),
                false,
            );
        }

        await runWithSessionResumeGuard(session.id, async () => {
            const killResult = await sessionKill(session.id);
            if (!killResult.success) {
                throw new HappyError(
                    killResult.message || t("sessionInfo.failedToUpgradeSession"),
                    false,
                );
            }
            const spawnProfile = buildSessionRespawnProfile(
                session,
                storage.getState().settings.profiles ?? [],
            );
            const spawnResult = await machineSpawnNewSession({
                ...upgradeContext.baseSpawnOptions,
                ...spawnProfile,
            });
            if (spawnResult.type === "error") {
                throw new HappyError(spawnResult.errorMessage, false);
            }
        });
    });

    const handleUpgrade = useCallback(() => {
        Modal.alert(
            t("sessionInfo.upgradeRestart"),
            t("sessionInfo.upgradeRestartConfirm"),
            [
                { text: t("common.cancel"), style: "cancel" },
                {
                    text: t("sessionInfo.upgradeRestart"),
                    onPress: performUpgrade,
                },
            ],
        );
    }, [performUpgrade]);

    return {
        needsUpgrade,
        machineCliVersion,
        upgrading,
        handleUpgrade,
        handleUpgradeDirect: performUpgrade,
    };
}
