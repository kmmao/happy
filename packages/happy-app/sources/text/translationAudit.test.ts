import { describe, expect, it } from "vitest";
import {
    auditTranslations,
    extractTranslationKeys,
    isLikelyUntranslated,
    type TranslationTree,
} from "./translationAudit";

describe("extractTranslationKeys", () => {
    it("collects nested string and function keys", () => {
        const translations: TranslationTree = {
            common: {
                save: "Save",
                itemCount: ({ count }: { count: number }) => `${count}`,
            },
        };

        expect(Array.from(extractTranslationKeys(translations)).sort()).toEqual([
            "common.itemCount",
            "common.save",
        ]);
    });
});

describe("isLikelyUntranslated", () => {
    it("ignores allowed technical terms", () => {
        expect(
            isLikelyUntranslated("settings.apiLabel", "API", "API", "es"),
        ).toBe(false);
    });

    it("flags identical non-english strings", () => {
        expect(
            isLikelyUntranslated(
                "profiles.saveFailed",
                "Save profile",
                "Save profile",
                "es",
            ),
        ).toBe(true);
    });

    it("ignores allowlisted product and model identifiers", () => {
        expect(
            isLikelyUntranslated(
                "agentInput.codexModel.gpt54",
                "GPT-5.4",
                "GPT-5.4",
                "zh-Hans",
            ),
        ).toBe(false);
        expect(
            isLikelyUntranslated(
                "tabs.openclaw",
                "OpenClaw",
                "OpenClaw",
                "ja",
            ),
        ).toBe(false);
    });

    it("ignores allowlisted placeholder literals without suppressing normal text", () => {
        expect(
            isLikelyUntranslated(
                "preview.urlPlaceholder",
                "http://localhost:3000",
                "http://localhost:3000",
                "zh-Hans",
            ),
        ).toBe(false);
        expect(
            isLikelyUntranslated(
                "common.error",
                "Error",
                "Error",
                "es",
            ),
        ).toBe(true);
    });

    it("ignores allowlisted command examples without muting normal copy", () => {
        expect(
            isLikelyUntranslated(
                "settingsMcp.addServerCommandPlaceholder",
                "npx -y @my/mcp-server",
                "npx -y @my/mcp-server",
                "zh-Hans",
            ),
        ).toBe(false);
        expect(
            isLikelyUntranslated(
                "machine.automationRetry",
                "Retry Job",
                "Retry Job",
                "es",
            ),
        ).toBe(true);
    });
});

describe("auditTranslations", () => {
    it("reports missing keys as blocking issues", () => {
        const translations = {
            en: {
                common: {
                    save: "Save",
                    cancel: "Cancel",
                },
            },
            es: {
                common: {
                    save: "Guardar",
                },
            },
        } satisfies Record<"en" | "es", TranslationTree>;

        const report = auditTranslations(translations, {
            referenceLanguage: "en",
            languageNames: { en: "English", es: "Spanish" },
        });

        const spanish = report.results.find((result) => result.langCode === "es");

        expect(report.hasMissingOrExtra).toBe(true);
        expect(report.shouldFail).toBe(true);
        expect(spanish?.missing).toEqual(["common.cancel"]);
    });

    it("does not fail on untranslated strings unless explicitly requested", () => {
        const translations = {
            en: {
                common: {
                    save: "Save profile",
                },
            },
            es: {
                common: {
                    save: "Save profile",
                },
            },
        } satisfies Record<"en" | "es", TranslationTree>;

        const nonStrictReport = auditTranslations(translations, {
            referenceLanguage: "en",
            languageNames: { en: "English", es: "Spanish" },
        });
        const strictReport = auditTranslations(translations, {
            referenceLanguage: "en",
            languageNames: { en: "English", es: "Spanish" },
            failOnUntranslated: true,
        });

        expect(nonStrictReport.hasUntranslated).toBe(true);
        expect(nonStrictReport.shouldFail).toBe(false);
        expect(strictReport.shouldFail).toBe(true);
    });
});
