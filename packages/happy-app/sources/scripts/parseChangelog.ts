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

interface ChangelogData {
  entries: ChangelogEntry[];
  latestVersion: string;
}

function parseChangelog(): ChangelogData {
  const changelogPath = path.join(__dirname, "../../CHANGELOG.md");

  if (!fs.existsSync(changelogPath)) {
    console.warn("CHANGELOG.md not found, creating empty changelog data");
    return { entries: [], latestVersion: "" };
  }

  const content = fs.readFileSync(changelogPath, "utf-8");
  const entries: ChangelogEntry[] = [];

  // Split by version headers (## X.Y.Z - Date)
  const versionSections = content.split(/^## (\d+\.\d+\.\d+) - (.+)$/gm);

  // Skip the first element (content before first version)
  for (let i = 1; i < versionSections.length; i += 3) {
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
        // This is part of the summary (before any bullet points, skip section headers)
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

  // Sort entries by version descending (newest first)
  const compareSemver = (a: string, b: string): number => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
  };
  entries.sort((a, b) => compareSemver(a.version, b.version));

  const latestVersion = entries.length > 0 ? entries[0].version : "";

  return { entries, latestVersion };
}

function main() {
  console.log("Parsing CHANGELOG.md...");

  const changelogData = parseChangelog();
  const outputPath = path.join(__dirname, "../changelog/changelog.json");

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write the parsed data
  fs.writeFileSync(outputPath, JSON.stringify(changelogData, null, 2));

  console.log(`✅ Parsed ${changelogData.entries.length} changelog entries`);
  console.log(`📝 Latest version: ${changelogData.latestVersion}`);
  console.log(`💾 Output written to: ${outputPath}`);
}

if (require.main === module) {
  main();
}

export { parseChangelog };
