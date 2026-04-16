import * as fs from "fs/promises";
import * as path from "path";
import type {
    TranslationAuditLanguageResult,
    TranslationAuditReport,
} from "./translationAudit";

export const TRANSLATION_BASELINE_SCHEMA_VERSION = 1;
export const DEFAULT_TRANSLATION_BASELINE_FILE =
    "sources/text/translations/logs/untranslated/baseline.json";

export type TranslationAuditBaseline<TLanguage extends string> = {
    schemaVersion: number;
    referenceLanguage: TLanguage;
    referenceKeyCount: number;
    untranslated: Partial<Record<TLanguage, string[]>>;
};

export type TranslationBaselineLanguageResult<TLanguage extends string> =
    TranslationAuditLanguageResult<TLanguage> & {
        baselineUntranslated: string[];
        newUntranslated: string[];
        resolvedUntranslated: string[];
    };

export type TranslationBaselineComparison<TLanguage extends string> = {
    baseline: TranslationAuditBaseline<TLanguage>;
    results: TranslationBaselineLanguageResult<TLanguage>[];
    hasNewUntranslated: boolean;
};

function sortStringList(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

export function buildTranslationBaseline<TLanguage extends string>(
    report: TranslationAuditReport<TLanguage>,
): TranslationAuditBaseline<TLanguage> {
    const untranslated = Object.fromEntries(
        report.results
            .filter((result) => result.langCode !== report.referenceLanguage)
            .map((result) => [result.langCode, sortStringList(result.untranslated)]),
    ) as Partial<Record<TLanguage, string[]>>;

    return {
        schemaVersion: TRANSLATION_BASELINE_SCHEMA_VERSION,
        referenceLanguage: report.referenceLanguage,
        referenceKeyCount: report.referenceKeyCount,
        untranslated,
    };
}

export function compareTranslationReportToBaseline<TLanguage extends string>(
    report: TranslationAuditReport<TLanguage>,
    baseline: TranslationAuditBaseline<TLanguage>,
): TranslationBaselineComparison<TLanguage> {
    const results = report.results.map((result) => {
        const baselineUntranslated = sortStringList(
            baseline.untranslated[result.langCode] ?? [],
        );
        const baselineSet = new Set(baselineUntranslated);
        const currentSet = new Set(result.untranslated);

        const newUntranslated = result.untranslated.filter(
            (key) => !baselineSet.has(key),
        );
        const resolvedUntranslated = baselineUntranslated.filter(
            (key) => !currentSet.has(key),
        );

        return {
            ...result,
            baselineUntranslated,
            newUntranslated: sortStringList(newUntranslated),
            resolvedUntranslated: sortStringList(resolvedUntranslated),
        };
    });

    const nonReferenceResults = results.filter(
        (result) => result.langCode !== report.referenceLanguage,
    );

    return {
        baseline,
        results,
        hasNewUntranslated: nonReferenceResults.some(
            (result) => result.newUntranslated.length > 0,
        ),
    };
}

export async function readTranslationBaseline<TLanguage extends string>(
    filePath: string,
): Promise<TranslationAuditBaseline<TLanguage> | null> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as TranslationAuditBaseline<TLanguage>;
    } catch (error) {
        const code =
            typeof error === "object" &&
            error &&
            "code" in error &&
            typeof error.code === "string"
                ? error.code
                : null;

        if (code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

export async function writeTranslationBaseline<TLanguage extends string>(
    filePath: string,
    report: TranslationAuditReport<TLanguage>,
): Promise<TranslationAuditBaseline<TLanguage>> {
    const baseline = buildTranslationBaseline(report);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
        filePath,
        JSON.stringify(baseline, null, 2) + "\n",
        "utf8",
    );
    return baseline;
}
