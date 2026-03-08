export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  changes: string[];
  rawMarkdown?: string;
}

export interface ChangelogData {
  entries: ChangelogEntry[];
  latestVersion: string;
}
