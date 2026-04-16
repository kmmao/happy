#!/usr/bin/env tsx

import * as path from "path";
import {
    APP_LANGUAGE_NAMES,
    APP_TRANSLATIONS,
    auditTranslations,
} from "../text/translationAudit";
import {
    compareTranslationReportToBaseline,
    DEFAULT_TRANSLATION_BASELINE_FILE,
    readTranslationBaseline,
    writeTranslationBaseline,
} from "../text/translationBaseline";
import {
    DEFAULT_TRANSLATION_TODO_DIR,
    exportTranslationTodoLists,
} from "../text/translationTodoExport";

const args = new Set(process.argv.slice(2));
const failOnUntranslated = args.has("--fail-on-untranslated");
const showUntranslated = failOnUntranslated || args.has("--show-untranslated");
const showAllUntranslated = args.has("--show-untranslated-all");
const exportUntranslated = args.has("--export-untranslated");
const updateBaseline = args.has("--update-baseline");

const report = auditTranslations(APP_TRANSLATIONS, {
    referenceLanguage: "en",
    languageNames: APP_LANGUAGE_NAMES,
});

async function main() {
    const baselinePath = path.resolve(process.cwd(), DEFAULT_TRANSLATION_BASELINE_FILE);
    const baseline = await readTranslationBaseline(baselinePath);
    const baselineComparison = baseline
        ? compareTranslationReportToBaseline(report, baseline)
        : null;

    console.log("# Translation Audit\n");
    console.log(`Reference language: English (${report.referenceKeyCount} keys)\n`);

    const displayResults = baselineComparison?.results ?? report.results;

    for (const result of displayResults) {
        if (result.langCode === "en") {
            console.log(`- ${result.languageName} (${result.langCode}): reference`);
            continue;
        }

        const parts: string[] = [`- ${result.languageName} (${result.langCode}): ${result.keyCount} keys`];

        if (result.missing.length > 0) {
            parts.push(`missing ${result.missing.length}`);
        }
        if (result.extra.length > 0) {
            parts.push(`extra ${result.extra.length}`);
        }
        if (result.untranslated.length > 0) {
            parts.push(`untranslated ${result.untranslated.length}`);
        }
        if ("newUntranslated" in result) {
            parts.push(`new ${result.newUntranslated.length}`);
            if (result.resolvedUntranslated.length > 0) {
                parts.push(`resolved ${result.resolvedUntranslated.length}`);
            }
        }
        if (
            result.missing.length === 0 &&
            result.extra.length === 0 &&
            result.untranslated.length === 0
        ) {
            parts.push("clean");
        }

        console.log(parts.join(" · "));
    }

    console.log("");

    const resultsWithStructuralIssues = report.results.filter(
        (result) =>
            result.langCode !== "en" &&
            (result.missing.length > 0 || result.extra.length > 0),
    );

    if (resultsWithStructuralIssues.length > 0) {
        console.log("## Blocking issues\n");
        for (const result of resultsWithStructuralIssues) {
            console.log(`### ${result.languageName} (${result.langCode})`);
            if (result.missing.length > 0) {
                console.log("Missing keys:");
                for (const key of result.missing) {
                    console.log(`- ${key}`);
                }
            }
            if (result.extra.length > 0) {
                console.log("Extra keys:");
                for (const key of result.extra) {
                    console.log(`- ${key}`);
                }
            }
            console.log("");
        }
    }

    if (baselineComparison) {
        const resultsWithNewUntranslated = baselineComparison.results.filter(
            (result) => result.langCode !== "en" && result.newUntranslated.length > 0,
        );

        console.log("## Baseline tracking\n");
        console.log(
            `Using baseline: ${path.relative(process.cwd(), baselinePath)}` +
            ` (${baselineComparison.baseline.referenceKeyCount} reference keys)\n`,
        );

        if (resultsWithNewUntranslated.length > 0) {
            console.log("New untranslated keys since baseline detected.\n");
            if (showUntranslated && !showAllUntranslated) {
                for (const result of resultsWithNewUntranslated) {
                    console.log(`### ${result.languageName} (${result.langCode})`);
                    for (const key of result.newUntranslated) {
                        console.log(`- ${key}`);
                    }
                    console.log("");
                }
            } else if (!showAllUntranslated) {
                console.log(
                    "Run `yarn workspace happy-app check:i18n --show-untranslated` " +
                    "to print only the new untranslated keys since baseline.\n",
                );
            }
        } else {
            console.log("No new untranslated keys since baseline.\n");
        }
    }

    const resultsWithUntranslated = report.results.filter(
        (result) => result.langCode !== "en" && result.untranslated.length > 0,
    );

    if (resultsWithUntranslated.length > 0) {
        console.log("## Untranslated warnings\n");
        if (showAllUntranslated) {
            for (const result of resultsWithUntranslated) {
                console.log(`### ${result.languageName} (${result.langCode})`);
                for (const key of result.untranslated) {
                    console.log(`- ${key}`);
                }
                console.log("");
            }
        } else if (!baselineComparison && showUntranslated) {
            for (const result of resultsWithUntranslated) {
                console.log(`### ${result.languageName} (${result.langCode})`);
                for (const key of result.untranslated) {
                    console.log(`- ${key}`);
                }
                console.log("");
            }
        } else if (!baselineComparison) {
            console.log(
                "Detected untranslated strings that still match English. " +
                "They do not fail this check by default.",
            );
            console.log(
                "Run `yarn workspace happy-app check:i18n:strict` to fail on untranslated strings, " +
                "`yarn workspace happy-app check:i18n:baseline:update` to snapshot the current backlog, " +
                "or `yarn workspace happy-app check:i18n --show-untranslated-all` to print every key.\n",
            );
        } else if (showAllUntranslated) {
            // no-op: full list already printed above
        } else {
            console.log(
                "Historical untranslated strings still exist, but baseline tracking ignores them unless they are newly introduced.",
            );
            console.log(
                "Run `yarn workspace happy-app check:i18n --show-untranslated-all` to print the full backlog, " +
                "or `yarn workspace happy-app check:i18n:strict` to fail only on newly introduced untranslated keys.\n",
            );
        }
    }

    if (updateBaseline) {
        await writeTranslationBaseline(baselinePath, report);
        console.log(`Updated baseline: ${path.relative(process.cwd(), baselinePath)}`);
    }

    if (exportUntranslated) {
        const outputDir = path.resolve(process.cwd(), DEFAULT_TRANSLATION_TODO_DIR);
        const writtenFiles = await exportTranslationTodoLists(report, outputDir);
        console.log(`Exported untranslated TODO lists to ${outputDir}`);
        for (const filePath of writtenFiles) {
            console.log(`- ${path.relative(process.cwd(), filePath)}`);
        }
    }

    const shouldFailOnUntranslated = failOnUntranslated
        ? baselineComparison
            ? baselineComparison.hasNewUntranslated
            : report.hasUntranslated
        : false;
    const shouldFail =
        report.hasMissingOrExtra || shouldFailOnUntranslated;

    if (shouldFail) {
        console.error("i18n audit failed.");
        process.exitCode = 1;
    } else {
        console.log("i18n audit passed.");
    }
}

void main();
