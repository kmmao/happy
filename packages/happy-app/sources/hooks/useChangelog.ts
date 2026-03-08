import { useState, useCallback } from "react";
import {
  getLastViewedVersion,
  setLastViewedVersion,
  getLatestVersion,
  compareSemver,
} from "@/changelog";

export function useChangelog() {
  // MMKV reads are synchronous - no need for useEffect
  const latestVersion = getLatestVersion();

  const [hasUnread, setHasUnread] = useState(() => {
    const lastViewed = getLastViewedVersion();

    // On first install, mark as read so user doesn't see old entries
    if (!lastViewed && latestVersion) {
      setLastViewedVersion(latestVersion);
      return false;
    }

    return compareSemver(latestVersion, lastViewed) > 0;
  });

  const markAsRead = useCallback(() => {
    if (latestVersion) {
      setLastViewedVersion(latestVersion);
      setHasUnread(false);
    }
  }, [latestVersion]);

  return {
    hasUnread,
    latestVersion,
    markAsRead,
  };
}
