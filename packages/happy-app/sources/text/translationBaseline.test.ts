import { describe, expect, it } from "vitest";
import {
    buildTranslationBaseline,
    compareTranslationReportToBaseline,
    type TranslationAuditBaseline,
} from "./translationBaseline";
import type { TranslationAuditReport } from "./translationAudit";

describe("translationBaseline", () => {
    it("builds a stable untranslated baseline excluding the reference language", () => {
        const report: TranslationAuditReport<"en" | "es" | "ja"> = {
            referenceLanguage: "en",
            referenceKeyCount: 10,
            hasMissingOrExtra: false,
            hasUntranslated: true,
            shouldFail: false,
            results: [
                {
                    langCode: "en",
                    languageName: "English",
                    keyCount: 10,
                    missing: [],
                    extra: [],
                    untranslated: [],
                },
                {
                    langCode: "es",
                    languageName: "Spanish",
                    keyCount: 10,
                    missing: [],
                    extra: [],
                    untranslated: ["settings.title", "common.save"],
                },
                {
                    langCode: "ja",
                    languageName: "Japanese",
                    keyCount: 10,
                    missing: [],
                    extra: [],
                    untranslated: [],
                },
            ],
        };

        expect(buildTranslationBaseline(report)).toEqual({
            schemaVersion: 1,
            referenceLanguage: "en",
            referenceKeyCount: 10,
            untranslated: {
                es: ["common.save", "settings.title"],
                ja: [],
            },
        });
    });

    it("computes new and resolved untranslated keys relative to the baseline", () => {
        const report: TranslationAuditReport<"en" | "es"> = {
            referenceLanguage: "en",
            referenceKeyCount: 10,
            hasMissingOrExtra: false,
            hasUntranslated: true,
            shouldFail: false,
            results: [
                {
                    langCode: "en",
                    languageName: "English",
                    keyCount: 10,
                    missing: [],
                    extra: [],
                    untranslated: [],
                },
                {
                    langCode: "es",
                    languageName: "Spanish",
                    keyCount: 10,
                    missing: [],
                    extra: [],
                    untranslated: ["common.cancel", "settings.title"],
                },
            ],
        };

        const baseline: TranslationAuditBaseline<"en" | "es"> = {
            schemaVersion: 1,
            referenceLanguage: "en",
            referenceKeyCount: 9,
            untranslated: {
                es: ["common.save", "settings.title"],
            },
        };

        const comparison = compareTranslationReportToBaseline(report, baseline);
        const spanish = comparison.results.find((result) => result.langCode === "es");

        expect(comparison.hasNewUntranslated).toBe(true);
        expect(spanish?.newUntranslated).toEqual(["common.cancel"]);
        expect(spanish?.resolvedUntranslated).toEqual(["common.save"]);
        expect(spanish?.baselineUntranslated).toEqual(["common.save", "settings.title"]);
    });
});
