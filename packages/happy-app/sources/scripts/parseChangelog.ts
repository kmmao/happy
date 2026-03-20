#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";

interface ChangelogEntry {
    version: string;
    date: string;
    summary: string;
    changes: string[];
    rawMarkdown?: string;
}

interface LocalizedChangelogData {
    entries: Record<string, ChangelogEntry[]>;
    latestVersion: string;
    availableLocales: string[];
}

const DEFAULT_LOCALE = "en";

function parseMarkdown(content: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];

    // Split by version headers (## X.Y.Z - Date)
    const versionSections = content.split(/^## (\d+\.\d+\.\d+) - (.+)$/gm);

    // Skip the first element (content before first version)
    for (let i = 1; i < versionSections.length; i += 3) {
        if (i + 2 >= versionSections.length) break;
        const versionStr = versionSections[i];
        const dateStr = versionSections[i + 1];
        const changesContent = versionSections[i + 2];

        const version = versionStr.trim();
        if (!version) continue;

        // Extract summary and bullet points
        const changes: string[] = [];
        const lines = changesContent.trim().split("\n");
        let summary = "";
        let foundFirstBullet = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("- ")) {
                foundFirstBullet = true;
                changes.push(trimmed.substring(2));
            } else if (
                !foundFirstBullet &&
                trimmed.length > 0 &&
                !trimmed.startsWith("#")
            ) {
                summary += (summary ? " " : "") + trimmed;
            }
        }

        entries.push({
            version,
            date: dateStr.trim(),
            summary: summary.trim(),
            changes,
            rawMarkdown: `## ${version} - ${dateStr}\n${changesContent}`.trim(),
        });
    }

    return entries;
}

function compareSemver(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
}

function discoverLocaleFiles(changelogDir: string): Map<string, string> {
    const localeFiles = new Map<string, string>();

    // CHANGELOG.md → "en" (default)
    const defaultPath = path.join(changelogDir, "CHANGELOG.md");
    if (fs.existsSync(defaultPath)) {
        localeFiles.set(DEFAULT_LOCALE, defaultPath);
    }

    // CHANGELOG.{locale}.md → locale
    const files = fs.readdirSync(changelogDir);
    const localePattern = /^CHANGELOG\.([a-zA-Z-]+)\.md$/;

    for (const file of files) {
        const match = file.match(localePattern);
        if (match) {
            const locale = match[1];
            localeFiles.set(locale, path.join(changelogDir, file));
        }
    }

    return localeFiles;
}

function parseChangelog(): LocalizedChangelogData {
    const changelogDir = path.join(__dirname, "../..");
    const localeFiles = discoverLocaleFiles(changelogDir);

    if (localeFiles.size === 0) {
        console.warn("No CHANGELOG files found, creating empty changelog data");
        return { entries: {}, latestVersion: "", availableLocales: [] };
    }

    const allEntries: Record<string, ChangelogEntry[]> = {};
    let latestVersion = "";

    for (const [locale, filePath] of localeFiles) {
        const content = fs.readFileSync(filePath, "utf-8");
        const entries = parseMarkdown(content);

        // Sort entries by version descending
        entries.sort((a, b) => compareSemver(a.version, b.version));
        allEntries[locale] = entries;

        // latestVersion from en (source of truth)
        if (locale === DEFAULT_LOCALE && entries.length > 0) {
            latestVersion = entries[0].version;
        }
    }

    // Fallback: if no en file, use first locale's latest version
    if (!latestVersion) {
        const firstEntries = Object.values(allEntries)[0];
        if (firstEntries && firstEntries.length > 0) {
            latestVersion = firstEntries[0].version;
        }
    }

    const availableLocales = Array.from(localeFiles.keys()).sort();

    return { entries: allEntries, latestVersion, availableLocales };
}

function main() {
    console.log("Parsing CHANGELOG files...");

    const changelogData = parseChangelog();
    const outputPath = path.join(__dirname, "../changelog/changelog.json");

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write the parsed data
    fs.writeFileSync(outputPath, JSON.stringify(changelogData, null, 2));

    const totalEntries = Object.values(changelogData.entries).reduce(
        (sum, entries) => sum + entries.length,
        0,
    );

    console.log(`✅ Parsed ${totalEntries} changelog entries across ${changelogData.availableLocales.length} locale(s)`);
    console.log(`🌐 Locales: ${changelogData.availableLocales.join(", ")}`);
    console.log(`📝 Latest version: ${changelogData.latestVersion}`);
    console.log(`💾 Output written to: ${outputPath}`);
}

if (require.main === module) {
    main();
}

export { parseChangelog, parseMarkdown };
