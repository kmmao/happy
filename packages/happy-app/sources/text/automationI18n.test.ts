import { describe, expect, it } from "vitest";
import { en } from "./_default";
import { zhHans } from "./translations/zh-Hans";
import { zhHant } from "./translations/zh-Hant";
import { ru } from "./translations/ru";
import { pl } from "./translations/pl";
import { es } from "./translations/es";
import { it as itLang } from "./translations/it";
import { pt } from "./translations/pt";
import { ca } from "./translations/ca";
import { ja } from "./translations/ja";

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
            case "machine.agentLoopSuggestionAdoptAllSummary":
                return value({ count: 3 });
            default:
                throw new Error(`Missing sample params for ${key}`);
        }
    }
    return value;
}

const nonEnglishTranslations = [
    ["ru", ru],
    ["pl", pl],
    ["es", es],
    ["it", itLang],
    ["pt", pt],
    ["ca", ca],
    ["zh-Hans", zhHans],
    ["zh-Hant", zhHant],
    ["ja", ja],
] as const;

const guardianCopyKeys = [
    "machine.automationGuardiansHint",
    "machine.automationGuardians",
    "machine.automationGuardiansEmpty",
    "machine.automationGuardianSession",
    "machine.automationResetGuardians",
    "machine.automationResetGuardiansMessage",
    "machine.automationResetGuardian",
    "machine.automationResetGuardianMessage",
    "machine.automationResetGuardianFailed",
    "machine.automationGuardianUsage",
    "machine.automationGuardianUsageEmpty",
    "machine.automationGuardianReuseCount",
    "machine.automationGuardianReuseRate",
    "machine.automationGuardianRememberCount",
    "machine.automationGuardianResetCount",
    "machine.automationGuardianReuseCountHint",
    "machine.automationGuardianReuseRateHint",
    "machine.automationGuardianResetCountHint",
    "machine.automationGuardianUsageHint",
    "machine.automationClearAuditHint",
    "machine.automationAuditHint",
    "machine.automationAlertsHint",
    "machine.automationAuditGuardian",
    "machine.automationAuditEventGuardianReused",
    "machine.automationAuditEventGuardianRemembered",
    "machine.automationAuditEventGuardianCleared",
    "machine.automationOverviewHint",
    "machine.automationSearchHint",
    "machine.automationAuditFiltersHint",
    "machine.automationGuardianFiltersHint",
    "machine.automationSearchPlaceholder",
    "machine.automationFilterGuardian",
    "machine.automationGuardianDetails",
    "machine.automationGuardianAttached",
    "machine.automationGuardianPersisted",
    "machine.automationGuardianRecovered",
    "machine.automationRecoveredGuardians",
    "machine.automationGuardianRecoveryNeeded",
    "machine.automationGuardianRecoveryNeededMessage",
    "machine.automationSectionGuardians",
    "machine.automationSectionGuardianUsage",
] as const;

describe("automation i18n", () => {
    const criticalKeys = [
        "machine.automation",
        "machine.automationClearAudit",
        "machine.automationAuditEventSessionReattached",
        "machine.automationAuditEventLoopPolicyGated",
        "machine.automationAuditEventLoopDownstreamEmitted",
        "machine.automationPolicyGatedCount",
        "machine.automationLoopRollup",
        "machine.automationLoopsTotal",
        "machine.automationLoopsActive",
        "machine.automationLoopsBlocked",
        "machine.automationLoopsPaused",
        "machine.automationLoopsPendingEvents",
        "machine.automationLoopsPolicyStopped",
        "machine.automationOpenLoops",
        "machine.automationDownstreamEmitCount",
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
        "machine.agentLoopViewBrief",
        "machine.agentLoopViewMemory",
        "machine.agentLoopViewContext",
        "machine.agentLoopSearchPlaceholder",
        "machine.agentLoopAdvancedShow",
        "machine.agentLoopRuntime",
        "machine.agentLoopTriggerEvent",
        "machine.agentLoopRecentEvents",
        "machine.agentLoopGoal",
        "machine.agentLoopCurrentFocus",
        "machine.agentLoopWorkingMemory",
        "machine.agentLoopReflectionSummary",
        "machine.agentLoopMemoryUpdated",
        "machine.agentLoopSuggest",
        "machine.agentLoopSuggestions",
        "machine.agentLoopSuggestionAdopt",
        "machine.agentLoopSuggestionAdoptAll",
        "machine.agentLoopSuggestionAdoptAllSummary",
        "machine.agentLoopBootstrap",
        "machine.agentLoopBootstrapHint",
        "machine.agentLoopBootstrapEmpty",
        "machine.agentLoopFileWatch",
        "machine.agentLoopGithubBridge",
        "machine.agentLoopCiBridge",
        "machine.agentLoopCiBridgeEnabled",
        "machine.agentLoopCiBridgeDisabled",
        "machine.agentLoopFailurePolicy",
        "machine.agentLoopMaxFailures",
        "machine.agentLoopRetryBackoff",
        "machine.agentLoopCooldown",
        "machine.agentLoopQuietHours",
        "machine.agentLoopMaxAutoRuns",
        "machine.agentLoopMaxIterations",
        "machine.agentLoopStopOnSuccess",
        "machine.agentLoopStopReason",
        "machine.agentLoopPolicyStateMaxIterations",
        "machine.agentLoopDownstreamLoops",
        "machine.agentLoopDownstreamTriggers",
        "machine.agentLoopPolicyState",
        "machine.agentLoopLastPolicyGate",
        "machine.agentLoopUpstreamLoops",
        "machine.agentLoopEventSources",
        "machine.agentLoopEventKeywords",
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

    for (const key of guardianCopyKeys) {
        for (const [langCode, translations] of nonEnglishTranslations) {
            it(`keeps ${key} guardian copy localized in ${langCode}`, () => {
                const localized = renderValue(translations as any, key);

                expect(localized).not.toBe(renderValue(en as any, key));
                expect(localized.toLowerCase()).not.toContain("guardian");
            });
        }
    }

    it("uses explicit session reuse wording in Simplified Chinese", () => {
        expect(renderValue(zhHans as any, "machine.automationGuardianReuseCount")).toBe("会话复用次数");
    });

    it("uses explicit session reuse wording in Traditional Chinese", () => {
        expect(renderValue(zhHant as any, "machine.automationGuardianReuseCount")).toBe("會話複用次數");
    });

});
