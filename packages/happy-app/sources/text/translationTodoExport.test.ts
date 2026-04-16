import { describe, expect, it } from "vitest";
import {
    getTranslationTodoFilename,
    renderTranslationTodoIndex,
    renderTranslationTodoMarkdown,
} from "./translationTodoExport";
import type { TranslationAuditReport } from "./translationAudit";

describe("translationTodoExport", () => {
    it("creates predictable filenames per language", () => {
        expect(getTranslationTodoFilename("zh-Hans")).toBe("zh-Hans.todo.md");
    });

    it("renders a markdown checklist for untranslated keys", () => {
        const markdown = renderTranslationTodoMarkdown({
            langCode: "es",
            languageName: "Spanish",
            keyCount: 2,
            missing: [],
            extra: [],
            untranslated: ["common.save", "settings.title"],
        });

        expect(markdown).toContain("# Translation TODO — Spanish (es)");
        expect(markdown).toContain("- [ ] common.save");
        expect(markdown).toContain("- [ ] settings.title");
    });

    it("renders an index summary for all non-reference languages", () => {
        const report: TranslationAuditReport<"en" | "es" | "ja"> = {
            referenceLanguage: "en",
            referenceKeyCount: 100,
            hasMissingOrExtra: false,
            hasUntranslated: true,
            shouldFail: false,
            results: [
                {
                    langCode: "en",
                    languageName: "English",
                    keyCount: 100,
                    missing: [],
                    extra: [],
                    untranslated: [],
                },
                {
                    langCode: "es",
                    languageName: "Spanish",
                    keyCount: 100,
                    missing: [],
                    extra: [],
                    untranslated: ["common.save"],
                },
                {
                    langCode: "ja",
                    languageName: "Japanese",
                    keyCount: 100,
                    missing: [],
                    extra: [],
                    untranslated: [],
                },
            ],
        };

        const markdown = renderTranslationTodoIndex(report);

        expect(markdown).toContain("Reference language: en (100 keys)");
        expect(markdown).toContain("- Spanish (es): 1 untranslated");
        expect(markdown).toContain("- Japanese (ja): 0 untranslated");
        expect(markdown).not.toContain("- English (en):");
    });
});
