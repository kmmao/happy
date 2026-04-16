import { runWithSessionResumeGuard } from "@/sync/sessionResumeGuard";
import { useCallback } from "react";
import { Session, Machine } from "@/sync/storageTypes";
import { sessionKill, machineSpawnNewSession } from "@/sync/ops";
import { useHappyAction } from "@/hooks/useHappyAction";
import { HappyError } from "@/utils/errors";
import { isMachineOnline } from "@/utils/machineUtils";
import { compareVersions } from "@/utils/versionUtils";
import { Modal } from "@/modal";
import { t } from "@/text";
import { storage } from "@/sync/storage";
import { buildSessionRespawnProfile } from "./sessionUpgradeProfile";

/**
 * Hook for upgrading an active session to the latest CLI version.
 * Compares session.metadata.version against the daemon's startedWithCliVersion.
 * When needsUpgrade is true, handleUpgrade will kill the old process and resume
 * with the new CLI version, preserving the session context.
 */
export function useSessionUpgrade(
    session: Session,
    machine: Machine | null | undefined,
) {
    const machineCliVersion = machine?.daemonState?.startedWithCliVersion as string | undefined;

    const needsUpgrade =
        session.active &&
        !!session.metadata?.version &&
        !!session.metadata?.claudeSessionId &&
        !!session.metadata?.machineId &&
        !!session.metadata?.path &&
        !!machine &&
        isMachineOnline(machine) &&
        !!machineCliVersion &&
        compareVersions(session.metadata.version, machineCliVersion) < 0;

    const [upgrading, performUpgrade] = useHappyAction(async () => {
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
                machineId: session.metadata!.machineId!,
                directory: session.metadata!.path!,
                claudeSessionId: session.metadata!.claudeSessionId!,
                happySessionId: session.id,
                agent: (session.metadata?.flavor as "claude" | "codex" | "gemini") ?? "claude",
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
    };
}
