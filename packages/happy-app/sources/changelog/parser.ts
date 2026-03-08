import { ChangelogData, ChangelogEntry } from "./types";

// This will be populated by the build-time script
let changelogData: ChangelogData | null = null;

export function getChangelogData(): ChangelogData {
  if (!changelogData) {
    // Fallback to require the generated JSON file
    try {
      changelogData = require("./changelog.json") as ChangelogData;
    } catch (error) {
      console.warn("Changelog data not found, returning empty changelog");
      changelogData = { entries: [], latestVersion: "" };
    }
  }
  return changelogData;
}

export function getChangelogEntries(): ChangelogEntry[] {
  return getChangelogData().entries;
}

export function getLatestVersion(): string {
  return getChangelogData().latestVersion;
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
  return getChangelogData().entries.filter(
    (entry) => compareSemver(entry.version, lastViewedVersion) > 0,
  );
}
