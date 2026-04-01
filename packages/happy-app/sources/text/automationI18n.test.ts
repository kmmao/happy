import { describe, expect, it } from "vitest";
import { en } from "./_default";
import { zhHans } from "./translations/zh-Hans";
import { zhHant } from "./translations/zh-Hant";

function getValue(source: Record<string, any>, key: string): any {
    return key.split(".").reduce((acc, segment) => acc?.[segment], source);
}

function renderValue(source: Record<string, any>, key: string): string {
    const value = getValue(source, key);
    if (typeof value === "function") {
        switch (key) {
            case "supervisor.scheduleMissedRuns":
                return value({ count: 3 });
            case "supervisor.scheduleCadence":
                return value({ hours: 6 });
            case "supervisor.autonomyBannerLoopRunning":
            case "supervisor.autonomyBannerLoopPaused":
            case "supervisor.viewActiveLoop":
                return value({ iteration: 2 });
            case "supervisor.autonomyBannerLoopDetail":
                return value({ phase: "analyzing" });
            case "supervisor.autonomyBannerOverdue":
                return value({ duration: "2h" });
            default:
                throw new Error(`Missing sample params for ${key}`);
        }
    }
    return value;
}

describe("automation i18n", () => {
    const criticalKeys = [
        "machine.automation",
        "machine.automationClearAudit",
        "machine.automationAuditEventSessionReattached",
        "machine.automationGuardianRecovered",
        "machine.automationRecoveredAfterRestart",
        "machine.automationSessionReattachedCount",
        "machine.automationRecoveredSessions",
        "machine.automationRecoveredGuardians",
        "machine.automationClearAuditMessage",
        "machine.automationGuardianRecoveryNeeded",
        "machine.automationGuardianRecoveryNeededMessage",
        "machine.automationSearchPlaceholder",
        "machine.automationAlerts",
        "machine.automationTimeline",
        "machine.automationFilterRecovered",
        "machine.automationNoMatches",
        "machine.agentLoopsViewAll",
        "machine.agentLoopsViewAllHint",
        "machine.agentLoopCreate",
        "machine.agentLoopEdit",
        "machine.agentLoopViewAutomation",
        "machine.agentLoopSearchPlaceholder",
        "machine.agentLoopAdvancedShow",
        "machine.agentLoopEnvironmentInvalid",
        "machine.agentLoopPromptPlaceholder",
        "machine.agentLoopIntervalInvalid",
        "machine.agentLoopRemoveMessage",
        "supervisor.scheduleOverdue",
        "supervisor.scheduleMissedRuns",
        "supervisor.scheduleCadence",
        "supervisor.autonomyBannerLoopRunning",
        "supervisor.autonomyBannerLoopDetail",
        "supervisor.autonomyBannerManualOnlyDetail",
        "supervisor.viewActiveLoop",
    ] as const;

    for (const key of criticalKeys) {
        it(`keeps ${key} localized in zh-Hans`, () => {
            expect(renderValue(zhHans as any, key)).not.toBe(renderValue(en as any, key));
        });

        it(`keeps ${key} localized in zh-Hant`, () => {
            expect(renderValue(zhHant as any, key)).not.toBe(renderValue(en as any, key));
        });
    }
});
