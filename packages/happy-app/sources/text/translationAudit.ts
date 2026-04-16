import { en } from "./translations/en";
import { ru } from "./translations/ru";
import { pl } from "./translations/pl";
import { es } from "./translations/es";
import { it } from "./translations/it";
import { pt } from "./translations/pt";
import { ca } from "./translations/ca";
import { zhHans } from "./translations/zh-Hans";
import { zhHant } from "./translations/zh-Hant";
import { ja } from "./translations/ja";
import {
    SUPPORTED_LANGUAGES,
    type SupportedLanguage,
} from "./_all";
import type { TranslationStructure } from "./_default";
import { isAllowlistedTranslation } from "./translationAuditAllowlist";

export type TranslationLeaf = string | ((...args: any[]) => string);

export type TranslationTree = {
    [key: string]: TranslationLeaf | TranslationTree;
};

export type TranslationAuditLanguageResult<TLanguage extends string> = {
    langCode: TLanguage;
    languageName: string;
    keyCount: number;
    missing: string[];
    extra: string[];
    untranslated: string[];
};

export type TranslationAuditReport<TLanguage extends string> = {
    referenceLanguage: TLanguage;
    referenceKeyCount: number;
    results: TranslationAuditLanguageResult<TLanguage>[];
    hasMissingOrExtra: boolean;
    hasUntranslated: boolean;
    shouldFail: boolean;
};

export type TranslationAuditOptions<TLanguage extends string> = {
    referenceLanguage: NoInfer<TLanguage>;
    languageNames?: Partial<Record<TLanguage, string>>;
    failOnUntranslated?: boolean;
    technicalTerms?: string[];
};

const DEFAULT_TECHNICAL_TERMS = [
    "GitHub",
    "URL",
    "API",
    "CLI",
    "OAuth",
    "QR",
    "JSON",
    "HTTP",
    "HTTPS",
    "ID",
    "PID",
    "OK",
];

export const APP_TRANSLATIONS: Record<SupportedLanguage, TranslationStructure> = {
    en,
    ru,
    pl,
    es,
    it,
    pt,
    ca,
    "zh-Hans": zhHans,
    "zh-Hant": zhHant,
    ja,
};

export const APP_LANGUAGE_NAMES: Record<SupportedLanguage, string> =
    Object.fromEntries(
        Object.entries(SUPPORTED_LANGUAGES).map(([code, meta]) => [
            code,
            meta.englishName,
        ]),
    ) as Record<SupportedLanguage, string>;

function isTranslationLeaf(
    value: TranslationLeaf | TranslationTree | undefined,
): value is TranslationLeaf {
    return typeof value === "string" || typeof value === "function";
}

export function extractTranslationKeys(
    obj: TranslationTree,
    prefix: string = "",
): Set<string> {
    const keys = new Set<string>();

    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];

        if (isTranslationLeaf(value)) {
            keys.add(fullKey);
            continue;
        }

        const subKeys = extractTranslationKeys(value, fullKey);
        subKeys.forEach((subKey) => keys.add(subKey));
    }

    return keys;
}

export function getNestedTranslationValue(
    obj: TranslationTree,
    path: string,
): TranslationLeaf | TranslationTree | undefined {
    let current: TranslationLeaf | TranslationTree | undefined = obj;

    for (const key of path.split(".")) {
        if (!current || isTranslationLeaf(current) || !(key in current)) {
            return undefined;
        }

        current = current[key];
    }

    return current;
}

export function isLikelyUntranslated(
    key: string,
    value: TranslationLeaf | TranslationTree | undefined,
    englishValue: TranslationLeaf | TranslationTree | undefined,
    langCode: string,
    technicalTerms: string[] = DEFAULT_TECHNICAL_TERMS,
): boolean {
    if (langCode === "en") {
        return false;
    }

    if (typeof value === "function" && typeof englishValue === "function") {
        return false;
    }

    if (typeof value !== "string" || typeof englishValue !== "string") {
        return false;
    }

    if (
        isAllowlistedTranslation({
            key,
            langCode,
            value,
            englishValue,
        })
    ) {
        return false;
    }

    if (value.length <= 3) {
        return false;
    }

    if (
        technicalTerms.includes(value) ||
        technicalTerms.includes(englishValue)
    ) {
        return false;
    }

    return value === englishValue;
}

function sortStringList(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

export function auditTranslations<TLanguage extends string>(
    translations: Record<TLanguage, TranslationTree>,
    options: TranslationAuditOptions<TLanguage>,
): TranslationAuditReport<TLanguage> {
    const {
        referenceLanguage,
        languageNames = {} as Partial<Record<TLanguage, string>>,
        failOnUntranslated = false,
        technicalTerms = DEFAULT_TECHNICAL_TERMS,
    } = options;

    const referenceTranslations = translations[referenceLanguage];
    const referenceKeys = extractTranslationKeys(referenceTranslations);

    const translationEntries = Object.entries(translations) as Array<
        [TLanguage, TranslationTree]
    >;

    const results = translationEntries.map(([langCode, translation]) => {
        const langKeys = extractTranslationKeys(translation);
        const missing: string[] = [];
        const extra: string[] = [];
        const untranslated: string[] = [];

        for (const key of referenceKeys) {
            if (!langKeys.has(key)) {
                missing.push(key);
                continue;
            }

            const value = getNestedTranslationValue(translation, key);
            const englishValue = getNestedTranslationValue(referenceTranslations, key);

            if (
                isLikelyUntranslated(
                    key,
                    value,
                    englishValue,
                    langCode,
                    technicalTerms,
                )
            ) {
                untranslated.push(key);
            }
        }

        for (const key of langKeys) {
            if (!referenceKeys.has(key)) {
                extra.push(key);
            }
        }

        return {
            langCode,
            languageName: languageNames[langCode] ?? langCode,
            keyCount: langKeys.size,
            missing: sortStringList(missing),
            extra: sortStringList(extra),
            untranslated: sortStringList(untranslated),
        };
    });

    const nonReferenceResults = results.filter(
        (result) => result.langCode !== referenceLanguage,
    );
    const hasMissingOrExtra = nonReferenceResults.some(
        (result) => result.missing.length > 0 || result.extra.length > 0,
    );
    const hasUntranslated = nonReferenceResults.some(
        (result) => result.untranslated.length > 0,
    );

    return {
        referenceLanguage,
        referenceKeyCount: referenceKeys.size,
        results,
        hasMissingOrExtra,
        hasUntranslated,
        shouldFail: hasMissingOrExtra || (failOnUntranslated && hasUntranslated),
    };
}
