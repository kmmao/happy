import { MMKV } from "react-native-mmkv";
import { compareSemver } from "./parser";

const mmkv = new MMKV();

const LAST_VIEWED_VERSION_KEY = "changelog-last-viewed-version";

export function getLastViewedVersion(): string {
  return mmkv.getString(LAST_VIEWED_VERSION_KEY) ?? "";
}

export function setLastViewedVersion(version: string): void {
  mmkv.set(LAST_VIEWED_VERSION_KEY, version);
}

export function hasUnreadChangelog(latestVersion: string): boolean {
  const lastViewed = getLastViewedVersion();
  return compareSemver(latestVersion, lastViewed) > 0;
}
