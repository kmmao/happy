export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
  rawMarkdown?: string;
}

export interface LocalizedChangelogData {
  entries: Record<string, ChangelogEntry[]>;
  latestVersion: string;
  availableLocales: string[];
}
