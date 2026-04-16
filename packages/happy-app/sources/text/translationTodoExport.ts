import * as path from "path";
import * as fs from "fs/promises";
import type {
    TranslationAuditLanguageResult,
    TranslationAuditReport,
} from "./translationAudit";

export const DEFAULT_TRANSLATION_TODO_DIR =
    "sources/text/translations/logs/untranslated";

export function getTranslationTodoFilename(langCode: string): string {
    return `${langCode}.todo.md`;
}

export function renderTranslationTodoMarkdown<TLanguage extends string>(
    result: TranslationAuditLanguageResult<TLanguage>,
): string {
    const lines = [
        `# Translation TODO — ${result.languageName} (${result.langCode})`,
        "",
        `Untranslated keys: ${result.untranslated.length}`,
        "",
        "> Generated from the i18n audit. These keys still match English according to the current heuristic.",
        "",
    ];

    if (result.untranslated.length === 0) {
        lines.push("- [x] No untranslated keys detected.");
        lines.push("");
        return lines.join("\n");
    }

    for (const key of result.untranslated) {
        lines.push(`- [ ] ${key}`);
    }

    lines.push("");
    return lines.join("\n");
}

export function renderTranslationTodoIndex<TLanguage extends string>(
    report: TranslationAuditReport<TLanguage>,
): string {
    const lines = [
        "# Translation TODO Index",
        "",
        `Reference language: ${report.referenceLanguage} (${report.referenceKeyCount} keys)`,
        "",
    ];

    const todoResults = report.results.filter((result) => result.langCode !== report.referenceLanguage);

    for (const result of todoResults) {
        lines.push(
            `- ${result.languageName} (${result.langCode}): ${result.untranslated.length} untranslated`,
        );
    }

    lines.push("");
    return lines.join("\n");
}

export async function exportTranslationTodoLists<TLanguage extends string>(
    report: TranslationAuditReport<TLanguage>,
    outputDir: string,
): Promise<string[]> {
    await fs.mkdir(outputDir, { recursive: true });
    const existingFiles = await fs.readdir(outputDir);

    await Promise.all(
        existingFiles
            .filter((name) => name === "README.md" || name.endsWith(".todo.md"))
            .map((name) => fs.rm(path.join(outputDir, name), { force: true })),
    );

    const writtenFiles: string[] = [];
    const todoResults = report.results.filter(
        (result) => result.langCode !== report.referenceLanguage,
    );

    for (const result of todoResults) {
        const filePath = path.join(
            outputDir,
            getTranslationTodoFilename(result.langCode),
        );
        await fs.writeFile(filePath, renderTranslationTodoMarkdown(result), "utf8");
        writtenFiles.push(filePath);
    }

    const indexPath = path.join(outputDir, "README.md");
    await fs.writeFile(indexPath, renderTranslationTodoIndex(report), "utf8");
    writtenFiles.push(indexPath);

    return writtenFiles;
}
