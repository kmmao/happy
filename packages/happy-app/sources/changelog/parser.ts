import { ChangelogEntry, LocalizedChangelogData } from "./types";
import { getCurrentLanguage } from "@/text";

const DEFAULT_LOCALE = "en";

// This will be populated by the build-time script
let changelogData: LocalizedChangelogData | null = null;

function loadChangelogData(): LocalizedChangelogData {
    if (!changelogData) {
        try {
            changelogData = require("./changelog.json") as LocalizedChangelogData;
        } catch (error) {
            console.warn("Changelog data not found, returning empty changelog");
            changelogData = { entries: {}, latestVersion: "", availableLocales: [] };
        }
    }
    return changelogData;
}

function resolveLocale(locale: string): string {
    const data = loadChangelogData();
    if (data.entries[locale]) return locale;
    // Try base language (e.g. "zh-Hant" → "zh-Hans" if no zh-Hant)
    const baseLang = locale.split("-")[0];
    for (const available of data.availableLocales) {
        if (available === baseLang || available.startsWith(baseLang + "-")) return available;
    }
    return DEFAULT_LOCALE;
}

export function getChangelogEntries(): ChangelogEntry[] {
    const data = loadChangelogData();
    const locale = resolveLocale(getCurrentLanguage());
    return data.entries[locale] ?? data.entries[DEFAULT_LOCALE] ?? [];
}

export function getLatestVersion(): string {
    return loadChangelogData().latestVersion;
}

export function compareSemver(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}

export function getUnreadEntries(lastViewedVersion: string): ChangelogEntry[] {
    return getChangelogEntries().filter(
        (entry) => compareSemver(entry.version, lastViewedVersion) > 0,
    );
}
